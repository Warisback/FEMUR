import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { ledgerEvents, missions, tasks } from "@/lib/db/schema";
import { getEscrowProvider } from "@/lib/escrow";
import { treasuryKeypair } from "@/lib/stellar/config";
import { getStats } from "@/lib/tasks/metrics";

export const runtime = "nodejs";

const LOCKED = ["deploying", "funded", "releasing"];

/** Everything the console header and activity strip need, in one poll. */
export async function GET() {
  const [mission] = await db
    .select()
    .from(missions)
    .where(eq(missions.status, "active"))
    .orderBy(desc(missions.created_at))
    .limit(1);

  let locked = 0;
  let paid = 0;
  if (mission) {
    const rows = await db
      .select({ reward: tasks.reward_usdc, escrow: tasks.escrow_status, status: tasks.status })
      .from(tasks)
      .where(eq(tasks.mission_id, mission.id));
    locked = rows.filter((r) => LOCKED.includes(r.escrow)).reduce((s, r) => s + r.reward, 0);
    paid = rows.filter((r) => r.status === "paid").reduce((s, r) => s + r.reward, 0);
  }

  const events = await db
    .select()
    .from(ledgerEvents)
    .orderBy(desc(ledgerEvents.created_at))
    .limit(8);

  return NextResponse.json({
    mission: mission ?? null,
    locked,
    paid,
    provider: getEscrowProvider().name,
    treasury: treasuryKeypair().publicKey(),
    stats: await getStats(),
    events,
  });
}
