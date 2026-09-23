import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { verifications } from "@/lib/db/schema";
import { tickTask } from "@/lib/tasks/tick";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const task = await tickTask(id);
  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });

  const [verification] = await db
    .select()
    .from(verifications)
    .where(eq(verifications.task_id, id))
    .orderBy(desc(verifications.created_at))
    .limit(1);

  return NextResponse.json({ task, verification: verification ?? null });
}
