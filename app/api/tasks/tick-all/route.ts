import { asc, notInArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { tasks } from "@/lib/db/schema";
import { nextStep, tickTask } from "@/lib/tasks/tick";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The console's one allowed batch endpoint (BUILD_PLAN Phase 5): step every
 * non-terminal task once, then return the full ledger. Sequential on purpose —
 * parallel chain steps would race TREASURY's sequence number.
 */
export async function POST() {
  const candidates = await db
    .select()
    .from(tasks)
    .where(notInArray(tasks.status, ["paid", "refunded"]))
    .orderBy(asc(tasks.created_at));

  for (const task of candidates) {
    if (!nextStep(task)) continue;
    try {
      await tickTask(task.id);
    } catch (err) {
      console.error(`tick-all ${task.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  const all = await db.select().from(tasks).orderBy(asc(tasks.created_at));
  return NextResponse.json({ tasks: all });
}
