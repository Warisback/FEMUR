import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "../db/client";
import { tasks } from "../db/schema";

export interface Stats {
  total_paid_usdc: number;
  tasks_paid: number;
  workers_paid: number;
  median_submit_to_paid_ms: number | null;
}

export async function getStats(): Promise<Stats> {
  const paid = await db
    .select({
      reward: tasks.reward_usdc,
      worker: tasks.worker_address,
      submitted_at: tasks.submitted_at,
      paid_at: tasks.paid_at,
    })
    .from(tasks)
    .where(and(eq(tasks.status, "paid"), isNotNull(tasks.paid_at)));

  const durations = paid
    .filter((t) => t.submitted_at !== null && t.paid_at !== null)
    .map((t) => t.paid_at! - t.submitted_at!)
    .sort((a, b) => a - b);

  return {
    total_paid_usdc: paid.reduce((sum, t) => sum + t.reward, 0),
    tasks_paid: paid.length,
    workers_paid: new Set(paid.map((t) => t.worker).filter(Boolean)).size,
    median_submit_to_paid_ms: median(durations),
  };
}

function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
