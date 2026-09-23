import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin } from "@/lib/admin";
import { clampDraft, draftMission } from "@/lib/ai/missions";
import { db } from "@/lib/db/client";
import { missions, tasks } from "@/lib/db/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ error: "console only" }, { status: 401 });
  const rows = await db.select().from(missions).orderBy(asc(missions.created_at));
  return NextResponse.json({ missions: rows });
}

const draftTaskSchema = z.object({
  title: z.string().min(1).max(200),
  instructions: z.string().min(1).max(2000),
  criteria: z
    .array(z.object({ id: z.string(), text: z.string(), required: z.boolean() }))
    .min(1)
    .max(6),
  extract_fields: z.array(
    z.object({
      key: z.string(),
      type: z.enum(["string", "number", "boolean"]),
      description: z.string(),
    }),
  ),
});

const bodySchema = z.object({
  brief: z.string().min(10).max(2000),
  budget: z.number().positive().max(10_000),
  /** true → return the draft without writing anything (the dialog preview). */
  dryRun: z.boolean().optional(),
  /** A previously previewed draft to post as-is. Rewards are re-clamped regardless. */
  draft: z
    .object({ title: z.string().min(1).max(200), reward_usdc: z.number(), tasks: z.array(draftTaskSchema).max(6) })
    .optional(),
});

/** Operator gives a brief and a budget; the model drafts, the server clamps. */
export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ error: "console only" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { brief, budget, dryRun } = parsed.data;
  const maxReward = Number(process.env.MAX_REWARD_USDC ?? 2);

  const draft = parsed.data.draft
    ? // A previewed draft comes back for posting — amounts still never survive
      // unclamped (clampDraft runs on it like on a fresh one).
      clampDraft(parsed.data.draft, { remainingBudgetUsdc: budget, maxRewardUsdc: maxReward })
    : await draftMission({
        brief,
        remainingBudgetUsdc: budget,
        maxRewardUsdc: maxReward,
      });
  if (dryRun) return NextResponse.json({ draft });
  if (draft.tasks.length === 0) {
    return NextResponse.json(
      { error: "the budget does not cover a single task at the drafted reward" },
      { status: 400 },
    );
  }

  const now = Date.now();
  const missionId = crypto.randomUUID();
  await db.insert(missions).values({
    id: missionId,
    title: draft.title,
    brief,
    budget_usdc: budget,
    reward_usdc: draft.reward_usdc,
    max_reward_usdc: maxReward,
    daily_cap_usdc: Number(process.env.DAILY_CAP_USDC ?? 50),
    acceptance_template: null,
    status: "active",
    created_at: now,
  });
  const taskRows = draft.tasks.map((t) => ({
    id: crypto.randomUUID(),
    mission_id: missionId,
    title: t.title,
    instructions: t.instructions,
    criteria: t.criteria,
    extract_fields: t.extract_fields,
    reward_usdc: draft.reward_usdc,
    status: "open" as const,
    escrow_status: "none" as const,
    created_at: now,
  }));
  await db.insert(tasks).values(taskRows);

  return NextResponse.json({
    mission: { id: missionId, title: draft.title, reward_usdc: draft.reward_usdc },
    tasks: taskRows,
    trimmed: draft.trimmed,
  });
}
