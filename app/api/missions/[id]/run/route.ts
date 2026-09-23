import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { draftMission } from "@/lib/ai/missions";
import { db } from "@/lib/db/client";
import { missions, tasks, type EscrowStatus } from "@/lib/db/schema";

export const runtime = "nodejs";
export const maxDuration = 60;

const TARGET_OPEN_TASKS = 6;

const FUNDED_ESCROWS: EscrowStatus[] = [
  "deploying",
  "funded",
  "releasing",
  "released",
  "refunding",
];

/** "Run agent" — the agent posts the next batch of up to 6 open tasks. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return NextResponse.json({ error: "console only" }, { status: 401 });
  const { id } = await ctx.params;

  const [mission] = await db.select().from(missions).where(eq(missions.id, id));
  if (!mission) return NextResponse.json({ error: "mission not found" }, { status: 404 });
  if (mission.status !== "active") {
    return NextResponse.json({ error: `mission is ${mission.status}` }, { status: 409 });
  }

  const missionTasks = await db
    .select({
      status: tasks.status,
      escrow_status: tasks.escrow_status,
      reward: tasks.reward_usdc,
      claimed_at: tasks.claimed_at,
    })
    .from(tasks)
    .where(eq(tasks.mission_id, id));

  const openCount = missionTasks.filter((t) => t.status === "open").length;
  const wanted = TARGET_OPEN_TASKS - openCount;
  if (wanted <= 0) {
    return NextResponse.json({ tasks: [], message: "the board is already full of open tasks" });
  }

  const committed = missionTasks
    .filter(
      (t) =>
        t.status === "open" || (FUNDED_ESCROWS.includes(t.escrow_status) && t.claimed_at !== null),
    )
    .reduce((s, t) => s + t.reward, 0);
  const remaining = mission.budget_usdc - committed;

  const draft = await draftMission({
    brief: mission.brief,
    remainingBudgetUsdc: remaining,
    maxRewardUsdc: mission.max_reward_usdc,
    maxTasks: wanted,
    fixedRewardUsdc: mission.reward_usdc,
  });
  if (draft.tasks.length === 0) {
    return NextResponse.json(
      { tasks: [], message: "remaining budget does not cover another task" },
    );
  }

  const now = Date.now();
  const taskRows = draft.tasks.map((t) => ({
    id: crypto.randomUUID(),
    mission_id: id,
    title: t.title,
    instructions: t.instructions,
    criteria: t.criteria,
    extract_fields: t.extract_fields,
    reward_usdc: mission.reward_usdc,
    status: "open" as const,
    escrow_status: "none" as const,
    created_at: now,
  }));
  await db.insert(tasks).values(taskRows);

  return NextResponse.json({ tasks: taskRows, trimmed: draft.trimmed });
}
