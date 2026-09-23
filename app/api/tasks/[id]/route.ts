import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { submissions, tasks, verifications } from "@/lib/db/schema";

export const runtime = "nodejs";

/** Task + latest submission + latest verification — worker status page and console detail. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });

  const [submission] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.task_id, id))
    .orderBy(desc(submissions.created_at))
    .limit(1);
  const [verification] = await db
    .select()
    .from(verifications)
    .where(eq(verifications.task_id, id))
    .orderBy(desc(verifications.created_at))
    .limit(1);

  return NextResponse.json({
    task,
    submission: submission ?? null,
    verification: verification ?? null,
  });
}
