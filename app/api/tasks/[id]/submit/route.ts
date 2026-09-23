import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { submissions, tasks } from "@/lib/db/schema";
import { saveSubmissionImage } from "@/lib/storage/blob";
import { transition } from "@/lib/tasks/machine";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "expected multipart form data" }, { status: 400 });

  const worker = form.get("worker");
  const photo = form.get("photo");
  const text = form.get("text");
  if (typeof worker !== "string" || !/^G[A-Z2-7]{55}$/.test(worker)) {
    return NextResponse.json({ error: "missing or invalid worker address" }, { status: 400 });
  }
  if (!(photo instanceof File) || photo.size === 0) {
    return NextResponse.json({ error: "a photo is required" }, { status: 400 });
  }
  if (!photo.type.startsWith("image/")) {
    return NextResponse.json({ error: "the file must be an image" }, { status: 400 });
  }
  if (photo.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "photo too large — resize below 8 MB" }, { status: 413 });
  }

  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });
  if (task.worker_address !== worker) {
    return NextResponse.json({ error: "this task is claimed by someone else" }, { status: 403 });
  }
  const next = transition(task.status, "submit", task);
  if (!next) {
    return NextResponse.json({ error: `task is ${task.status}, not awaiting a photo` }, { status: 409 });
  }
  if (task.escrow_status !== "funded") {
    // The lock completes while the worker takes the photo; the UI retries.
    return NextResponse.json(
      { error: "Locking your reward — try again in a moment", escrow_pending: true },
      { status: 409 },
    );
  }

  const buffer = Buffer.from(await photo.arrayBuffer());
  const { url, sha256 } = await saveSubmissionImage(buffer, photo.type);

  const submission = {
    id: crypto.randomUUID(),
    task_id: task.id,
    worker_address: worker,
    image_url: url,
    image_sha256: sha256,
    text: typeof text === "string" && text.trim() ? text.trim().slice(0, 2000) : null,
    created_at: Date.now(),
  };
  await db.insert(submissions).values(submission);
  await db
    .update(tasks)
    .set({ status: next.status, submitted_at: Date.now() })
    .where(eq(tasks.id, id));

  const [fresh] = await db.select().from(tasks).where(eq(tasks.id, id));
  return NextResponse.json({ task: fresh, submission });
}

/** Latest submission for a task — used by the console detail pane. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const rows = await db
    .select()
    .from(submissions)
    .where(eq(submissions.task_id, id))
    .orderBy(desc(submissions.created_at))
    .limit(1);
  return NextResponse.json({ submission: rows[0] ?? null });
}
