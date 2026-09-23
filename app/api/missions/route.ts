import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin } from "@/lib/admin";
import { draftMission } from "@/lib/ai/missions";
import { db } from "@/lib/db/client";
import { missions, tasks } from "@/lib/db/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ error: "console only" }, { status: 401 });
  const rows = await db.select().from(missions).orderBy(asc(missions.created_at));
  return NextResponse.json({ missions: rows });
}

const bodySchema = z.object({
  brief: z.string().min(10).max(2000),
  budget: z.number().positive().max(10_000),
});

/** Operator gives a brief and a budget; Claude drafts, the server clamps. */
export async function POST(req: Request) {
  if (!isAdmin(req)) return NextResponse.json({ error: "console only" }, { status: 401 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { brief, budget } = parsed.data;
  const maxReward = Number(process.env.MAX_REWARD_USDC ?? 2);

  const draft = await draftMission({
    brief,
    remainingBudgetUsdc: budget,
    maxRewardUsdc: maxReward,
  });
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
