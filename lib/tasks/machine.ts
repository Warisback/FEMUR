import type { TaskStatus } from "../db/schema";

/**
 * The task state machine (BUILD_PLAN §3). Pure. Status changes anywhere in
 * the app go through transition() — routes turn a null into a 409.
 *
 * open ─claim→ claimed ─submit→ submitted ─verify_start→ verifying ─┬→ approved ─pay→ paid
 *                ▲                                                   ├→ needs_review ─approve→ approved
 *                └──────── reject (attempts < MAX_ATTEMPTS) ─────────┴──── reject ────┘
 * claimed ─expire→ expired ─refund→ refunded      reject at MAX_ATTEMPTS → expired
 */
export type TaskEvent =
  | "claim"
  | "submit"
  | "verify_start"
  | "approve"
  | "review"
  | "reject"
  | "pay"
  | "expire"
  | "refund";

/** A task is expired after its second reject. */
export const MAX_ATTEMPTS = 2;

const TRANSITIONS: Record<TaskEvent, Partial<Record<TaskStatus, TaskStatus>>> = {
  claim: { open: "claimed" },
  submit: { claimed: "submitted" },
  verify_start: { submitted: "verifying" },
  approve: { verifying: "approved", needs_review: "approved" },
  review: { verifying: "needs_review" },
  // reject's target depends on attempts — handled in transition()
  reject: { verifying: "claimed", needs_review: "claimed" },
  pay: { approved: "paid" },
  expire: { claimed: "expired" },
  refund: { expired: "refunded" },
};

export interface TransitionResult {
  status: TaskStatus;
  attempts: number;
}

/**
 * Returns the next status and attempt count, or null if the event is illegal
 * from the current status. `attempts` counts completed (rejected) tries.
 */
export function transition(
  current: TaskStatus,
  event: TaskEvent,
  ctx: { attempts: number } = { attempts: 0 },
): TransitionResult | null {
  const next = TRANSITIONS[event]?.[current];
  if (!next) return null;
  if (event === "reject") {
    const attempts = ctx.attempts + 1;
    return {
      status: attempts >= MAX_ATTEMPTS ? "expired" : "claimed",
      attempts,
    };
  }
  return { status: next, attempts: ctx.attempts };
}

export const TERMINAL_STATUSES: TaskStatus[] = ["paid", "refunded"];

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
