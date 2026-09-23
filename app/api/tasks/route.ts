import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { tasks, type TaskStatus } from "@/lib/db/schema";
import { expireStaleTasks } from "@/lib/tasks/expiry";

export const runtime = "nodejs";

const STATUSES: TaskStatus[] = [
  "open",
  "claimed",
  "submitted",
  "verifying",
  "needs_review",
  "approved",
  "paid",
  "expired",
  "refunded",
];

export async function GET(req: Request) {
  await expireStaleTasks();
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const worker = url.searchParams.get("worker");

  const filters = [];
  if (status) {
    if (!STATUSES.includes(status as TaskStatus)) {
      return NextResponse.json({ error: `unknown status "${status}"` }, { status: 400 });
    }
    filters.push(eq(tasks.status, status as TaskStatus));
  }
  if (worker) filters.push(eq(tasks.worker_address, worker));

  const rows = await db
    .select()
    .from(tasks)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(asc(tasks.created_at));
  return NextResponse.json({ tasks: rows });
}
