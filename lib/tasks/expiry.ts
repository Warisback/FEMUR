import { and, eq, isNotNull, lt } from "drizzle-orm";
import { db } from "../db/client";
import { tasks } from "../db/schema";

/**
 * Move stale claims to expired (claimed for CLAIM_TTL_MINUTES with no
 * submission). Called at the top of every tick and of GET /api/tasks; the
 * refund itself then runs as tick steps. A task sitting in `submitted` or
 * later is never expired here — the worker did their part.
 */
export async function expireStaleTasks(now = Date.now()): Promise<number> {
  const result = await db
    .update(tasks)
    .set({ status: "expired" })
    .where(
      and(
        eq(tasks.status, "claimed"),
        isNotNull(tasks.expires_at),
        lt(tasks.expires_at, now),
      ),
    )
    .returning({ id: tasks.id });
  return result.length;
}
