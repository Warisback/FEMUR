import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../db/client";
import { ledgerEvents, tasks, workers, type NewLedgerEvent, type Task } from "../db/schema";
import { getEscrowProvider, type EscrowProvider } from "../escrow";
import { ChainError, getTransactionStatus, type TxStatus } from "../stellar/horizon";
import { expireStaleTasks } from "./expiry";
import { isTerminal, transition } from "./machine";

/**
 * The tick pattern (BUILD_PLAN §3): every long operation is a sequence of
 * steps that each fit one serverless call. POST /api/tasks/:id/tick acquires
 * the row lock, performs AT MOST ONE pending step, records it, releases the
 * lock, returns the task. Clients poll every 2 s while non-terminal.
 */
export type StepName =
  | "fund.confirm"
  | "verify.start"
  | "verify"
  | "approve"
  | "release"
  | "confirm-paid"
  | "refund"
  | "confirm-refunded";

export interface VerifyDecision {
  decision: "approve" | "reject" | "needs_review";
  summary: string;
}

export interface TickDeps {
  provider: EscrowProvider;
  getTransactionStatus: (hash: string) => Promise<TxStatus>;
  /** Runs the verification pipeline; must persist its own verification row. */
  verify: (task: Task) => Promise<VerifyDecision>;
  now: () => number;
}

/** How long a submitted tx may be missing from Horizon before we call it lost. */
export const MISSING_TX_TIMEOUT_MS = 60_000;

const LOCK_MS = 30_000;

export function nextStep(task: Task): StepName | null {
  if (isTerminal(task.status) || task.escrow_status === "failed") return null;
  if (task.escrow_status === "deploying" && task.pending_tx) return "fund.confirm";
  switch (task.status) {
    case "submitted":
      return task.escrow_status === "funded" ? "verify.start" : null;
    case "verifying":
      return "verify";
    case "approved":
      if (task.escrow_status === "funded") return "approve";
      if (task.escrow_status === "releasing") {
        return task.release_tx ? "confirm-paid" : "release";
      }
      return null;
    case "expired":
      if (task.escrow_status === "funded" || task.escrow_status === "releasing") return "refund";
      if (task.escrow_status === "refunding" && task.refund_tx) return "confirm-refunded";
      return null;
    default:
      return null; // open, claimed (waiting on the worker), needs_review (waiting on the resolver)
  }
}

export interface StepResult {
  patch: Partial<Task>;
  events: NewLedgerEvent[];
}

function event(
  task: Task,
  type: NewLedgerEvent["type"],
  message: string,
  extra: Partial<NewLedgerEvent> = {},
): NewLedgerEvent {
  return {
    id: crypto.randomUUID(),
    task_id: task.id,
    type,
    message,
    created_at: Date.now(),
    ...extra,
  };
}

/** Confirm a pending tx; shared by every .confirm step. */
async function confirmTx(
  task: Task,
  hash: string,
  sinceMs: number | null,
  deps: TickDeps,
  onSuccess: StepResult,
  failureContext: string,
): Promise<StepResult> {
  const status = await deps.getTransactionStatus(hash);
  if (status === "success") return onSuccess;
  if (
    status === "failed" ||
    (sinceMs !== null && deps.now() - sinceMs > MISSING_TX_TIMEOUT_MS)
  ) {
    return {
      patch: { escrow_status: "failed", pending_tx: null },
      events: [
        event(
          task,
          "network_rejected",
          status === "failed"
            ? `${failureContext} transaction failed on-chain`
            : `${failureContext} transaction never reached the ledger`,
          { tx_hash: hash },
        ),
      ],
    };
  }
  return { patch: {}, events: [] }; // still pending — try again next tick
}

export async function runStep(task: Task, step: StepName, deps: TickDeps): Promise<StepResult> {
  switch (step) {
    case "fund.confirm":
      return confirmTx(
        task,
        task.pending_tx!,
        task.claimed_at,
        deps,
        {
          patch: { escrow_status: "funded", fund_tx: task.pending_tx, pending_tx: null },
          events: [
            event(task, "escrow_funded", `${task.reward_usdc} USDC locked for "${task.title}"`, {
              tx_hash: task.pending_tx,
              amount_usdc: task.reward_usdc,
            }),
          ],
        },
        "escrow funding",
      );

    case "verify.start": {
      const t = transition(task.status, "verify_start", task);
      if (!t) return { patch: {}, events: [] };
      return { patch: { status: t.status }, events: [] };
    }

    case "verify": {
      let decision: VerifyDecision;
      try {
        decision = await deps.verify(task);
      } catch (err) {
        // Model error or timeout → a human decides (BUILD_PLAN §3).
        return {
          patch: { status: "needs_review" },
          events: [
            event(
              task,
              "verify_failed",
              `verification errored (${err instanceof Error ? err.message : "unknown"}) — routed to review`,
            ),
          ],
        };
      }
      if (decision.decision === "approve") {
        const t = transition(task.status, "approve", task)!;
        return { patch: { status: t.status, verified_at: deps.now() }, events: [] };
      }
      if (decision.decision === "needs_review") {
        const t = transition(task.status, "review", task)!;
        return { patch: { status: t.status }, events: [] };
      }
      const t = transition(task.status, "reject", task)!;
      const patch: Partial<Task> = { status: t.status, attempts: t.attempts };
      if (t.status === "claimed") {
        // Same worker retries; give them a fresh expiry window.
        patch.expires_at = deps.now() + claimTtlMs();
      }
      return { patch, events: [] };
    }

    case "approve": {
      const r = await deps.provider.approve(task);
      return {
        patch: { escrow_status: "releasing", approve_tx: r?.txHash ?? null },
        events: [],
      };
    }

    case "release": {
      // The double-pay guard: once release_tx is set this step is skipped
      // forever (nextStep returns confirm-paid instead). Belt and braces:
      if (task.release_tx) return { patch: {}, events: [] };
      const r = await deps.provider.release(task);
      return { patch: { release_tx: r.txHash, pending_tx: r.txHash }, events: [] };
    }

    case "confirm-paid":
      return confirmTx(
        task,
        task.release_tx!,
        task.verified_at,
        deps,
        {
          patch: {
            status: "paid",
            escrow_status: "released",
            paid_at: deps.now(),
            pending_tx: null,
          },
          events: [
            event(task, "escrow_released", `${task.reward_usdc} USDC paid for "${task.title}"`, {
              tx_hash: task.release_tx,
              amount_usdc: task.reward_usdc,
            }),
          ],
        },
        "release",
      );

    case "refund": {
      if (task.refund_tx) return { patch: {}, events: [] };
      const r = await deps.provider.refund(task);
      return {
        patch: { refund_tx: r.txHash, pending_tx: r.txHash, escrow_status: "refunding" },
        events: [],
      };
    }

    case "confirm-refunded":
      return confirmTx(
        task,
        task.refund_tx!,
        task.expires_at,
        deps,
        {
          patch: { status: "refunded", escrow_status: "refunded", pending_tx: null },
          events: [
            event(task, "escrow_refunded", `${task.reward_usdc} USDC refunded to treasury`, {
              tx_hash: task.refund_tx,
              amount_usdc: task.reward_usdc,
            }),
          ],
        },
        "refund",
      );
  }
}

export function claimTtlMs(): number {
  return Number(process.env.CLAIM_TTL_MINUTES ?? 15) * 60_000;
}

function defaultDeps(): TickDeps {
  return {
    provider: getEscrowProvider(),
    getTransactionStatus,
    verify: async (task) => {
      const { verifySubmission } = await import("../ai/verify");
      return verifySubmission(task);
    },
    now: Date.now,
  };
}

/**
 * Acquire the row lock, run at most one step, persist, unlock, return the
 * fresh task. Safe to call from many clients at once — losers of the lock
 * race get the current row back untouched.
 */
export async function tickTask(taskId: string, overrides?: Partial<TickDeps>): Promise<Task | null> {
  const deps = { ...defaultDeps(), ...overrides };
  await expireStaleTasks(deps.now());

  const now = deps.now();
  const locked = await db
    .update(tasks)
    .set({ lock_until: now + LOCK_MS })
    .where(and(eq(tasks.id, taskId), lt(tasks.lock_until, now)))
    .returning({ id: tasks.id });
  if (locked.length === 0) {
    const [current] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    return current ?? null;
  }

  try {
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    if (!task) return null;

    const step = nextStep(task);
    if (!step) return task;

    let result: StepResult;
    try {
      result = await runStep(task, step, deps);
    } catch (err) {
      if (err instanceof ChainError) {
        // A definitive network rejection — surface it, stop the pipeline.
        console.error(`tick ${taskId} step ${step}: ${err.message}`);
        result = {
          patch: { escrow_status: "failed", pending_tx: null },
          events: [event(task, "network_rejected", `${step}: ${err.message}`)],
        };
      } else {
        throw err; // transient (network blip) — the lock expires and the next tick retries
      }
    }

    if (Object.keys(result.patch).length > 0) {
      await db.update(tasks).set(result.patch).where(eq(tasks.id, taskId));
    }
    if (result.events.length > 0) {
      await db.insert(ledgerEvents).values(result.events);
    }
    if (result.patch.status === "paid" && task.worker_address) {
      await db
        .update(workers)
        .set({
          tasks_completed: sql`${workers.tasks_completed} + 1`,
          total_earned_usdc: sql`${workers.total_earned_usdc} + ${task.reward_usdc}`,
        })
        .where(eq(workers.address, task.worker_address));
    }

    const [fresh] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    return fresh ?? null;
  } finally {
    await db.update(tasks).set({ lock_until: 0 }).where(eq(tasks.id, taskId));
  }
}
