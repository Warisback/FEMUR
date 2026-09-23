import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { ledgerEvents, missions, tasks, type EscrowStatus } from "@/lib/db/schema";
import { getEscrowProvider } from "@/lib/escrow";
import { treasuryKeypair } from "@/lib/stellar/config";
import { getUsdcBalance } from "@/lib/stellar/payments";
import { transition } from "@/lib/tasks/machine";
import { checkPolicy } from "@/lib/tasks/policy";
import { claimTtlMs } from "@/lib/tasks/tick";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  worker: z.string().regex(/^G[A-Z2-7]{55}$/, "not a Stellar public key"),
});

const ACTIVE_STATUSES = ["claimed", "submitted", "verifying", "needs_review", "approved"] as const;
const MAX_CONCURRENT_CLAIMS = 3;

/** Escrow states that mean money left (or is leaving) the treasury. */
const FUNDED_ESCROWS: EscrowStatus[] = [
  "deploying",
  "funded",
  "releasing",
  "released",
  "refunding",
];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const worker = parsed.data.worker;

  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });
  if (!transition(task.status, "claim", task)) {
    return NextResponse.json({ error: `task is ${task.status}, not open` }, { status: 409 });
  }

  const active = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.worker_address, worker), inArray(tasks.status, [...ACTIVE_STATUSES])));
  if (active.length >= MAX_CONCURRENT_CLAIMS) {
    return NextResponse.json(
      { error: `you already have ${active.length} tasks in progress — finish one first` },
      { status: 429 },
    );
  }

  const [mission] = await db.select().from(missions).where(eq(missions.id, task.mission_id));
  if (!mission) return NextResponse.json({ error: "mission not found" }, { status: 404 });

  // Budget policy, then the on-chain hard cap behind it.
  const dayStart = new Date().setUTCHours(0, 0, 0, 0);
  const fundedRows = await db
    .select({
      reward: tasks.reward_usdc,
      mission_id: tasks.mission_id,
      claimed_at: tasks.claimed_at,
    })
    .from(tasks)
    .where(and(inArray(tasks.escrow_status, FUNDED_ESCROWS), isNotNull(tasks.claimed_at)));
  const policy = checkPolicy({
    reward_usdc: task.reward_usdc,
    mission,
    funded_today_usdc: fundedRows
      .filter((r) => (r.claimed_at ?? 0) >= dayStart)
      .reduce((s, r) => s + r.reward, 0),
    funded_for_mission_usdc: fundedRows
      .filter((r) => r.mission_id === task.mission_id)
      .reduce((s, r) => s + r.reward, 0),
    treasury_usdc: Number(await getUsdcBalance(treasuryKeypair().publicKey())),
  });
  if (!policy.ok) {
    await db.insert(ledgerEvents).values({
      id: crypto.randomUUID(),
      task_id: task.id,
      type: "policy_blocked",
      message: policy.reason,
      amount_usdc: task.reward_usdc,
      created_at: Date.now(),
    });
    return NextResponse.json({ error: policy.reason }, { status: 403 });
  }

  // Atomic claim — a concurrent claim loses here with a 409.
  const now = Date.now();
  const claimed = await db
    .update(tasks)
    .set({
      status: "claimed",
      worker_address: worker,
      claimed_at: now,
      expires_at: now + claimTtlMs(),
    })
    .where(and(eq(tasks.id, id), eq(tasks.status, "open")))
    .returning({ id: tasks.id });
  if (claimed.length === 0) {
    return NextResponse.json({ error: "task was just claimed by someone else" }, { status: 409 });
  }

  const provider = getEscrowProvider();
  try {
    const created = await provider.create(task, worker);
    await db
      .update(tasks)
      .set({
        escrow_status: "deploying",
        escrow_provider: provider.name,
        escrow_ref: created.escrowRef,
        pending_tx: created.txHash,
      })
      .where(eq(tasks.id, id));
  } catch (err) {
    const message = err instanceof Error ? err.message : "escrow funding failed";
    console.error(`claim ${id}: ${message}`);
    await db
      .update(tasks)
      .set({ status: "open", worker_address: null, claimed_at: null, expires_at: null })
      .where(eq(tasks.id, id));
    await db.insert(ledgerEvents).values({
      id: crypto.randomUUID(),
      task_id: task.id,
      type: "network_rejected",
      message: `escrow funding: ${message}`,
      amount_usdc: task.reward_usdc,
      created_at: Date.now(),
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const [fresh] = await db.select().from(tasks).where(eq(tasks.id, id));
  return NextResponse.json({ task: fresh });
}
