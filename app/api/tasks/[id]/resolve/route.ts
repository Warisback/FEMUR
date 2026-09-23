import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { ledgerEvents, tasks } from "@/lib/db/schema";
import { transition } from "@/lib/tasks/machine";
import { claimTtlMs } from "@/lib/tasks/tick";
import { isAdmin } from "@/lib/admin";

export const runtime = "nodejs";

const bodySchema = z.object({ decision: z.enum(["approve", "reject"]) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return NextResponse.json({ error: "console only" }, { status: 401 });

  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });
  if (task.status !== "needs_review") {
    return NextResponse.json({ error: `task is ${task.status}, not needs_review` }, { status: 409 });
  }

  const decision = parsed.data.decision;
  const next = transition(task.status, decision === "approve" ? "approve" : "reject", task);
  if (!next) return NextResponse.json({ error: "illegal transition" }, { status: 409 });

  const now = Date.now();
  await db
    .update(tasks)
    .set({
      status: next.status,
      attempts: next.attempts,
      ...(decision === "approve" ? { verified_at: now } : {}),
      ...(next.status === "claimed" ? { expires_at: now + claimTtlMs() } : {}),
    })
    .where(eq(tasks.id, id));
  await db.insert(ledgerEvents).values({
    id: crypto.randomUUID(),
    task_id: task.id,
    type: "resolver_decision",
    message: `resolver ${decision === "approve" ? "approved" : "rejected"} "${task.title}"`,
    created_at: now,
  });

  const [fresh] = await db.select().from(tasks).where(eq(tasks.id, id));
  return NextResponse.json({ task: fresh });
}
