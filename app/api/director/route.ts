import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import { asc, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { ledgerEvents, missions, submissions, tasks } from "@/lib/db/schema";
import { seedDemoMission } from "@/lib/db/seed";
import { ChainError } from "@/lib/stellar/horizon";
import { getUsdcBalance, payUsdc } from "@/lib/stellar/payments";
import { opsKeypair, treasuryKeypair } from "@/lib/stellar/config";
import { checkPolicy } from "@/lib/tasks/policy";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  action: z.enum([
    "seed",
    "reset",
    "insert_test_task",
    "simulate_good",
    "simulate_blurry",
    "simulate_wrong_subject",
    "simulate_injection",
    "overspend_policy",
    "overspend_network",
  ]),
});

/**
 * Demo director (BUILD_PLAN §6). Every action runs the real code paths — the
 * simulate actions drive the public claim/submit routes over HTTP as the demo
 * worker, so a failure here is a real failure to fix.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const origin = new URL(req.url).origin;

  try {
    switch (parsed.data.action) {
      case "seed": {
        const r = await seedDemoMission();
        return NextResponse.json({ message: `Seeded ${r.tasks} open tasks.` });
      }
      case "reset": {
        const r = await seedDemoMission({ clearWorkers: true });
        return NextResponse.json({ message: `Reset. ${r.tasks} open tasks, workers cleared.` });
      }
      case "insert_test_task":
        return NextResponse.json(await insertTestTask());
      case "simulate_good":
        return NextResponse.json(await simulate(origin, await pickGoodFixture()));
      case "simulate_blurry":
        return NextResponse.json(await simulate(origin, "blurry.jpg"));
      case "simulate_wrong_subject":
        return NextResponse.json(await simulate(origin, "wrong-subject.jpg"));
      case "simulate_injection":
        return NextResponse.json(await simulate(origin, "injection.jpg"));
      case "overspend_policy":
        return NextResponse.json(await overspendPolicy());
      case "overspend_network":
        return NextResponse.json(await overspendNetwork());
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "director action failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

function demoWorker(): Keypair {
  const secret = process.env.DEMO_WORKER_SECRET;
  if (!secret) {
    throw new Error("DEMO_WORKER_SECRET is not set — run pnpm stellar:setup first");
  }
  return Keypair.fromSecret(secret);
}

/** good-1 first, then good-2 on repeat (the duplicate check would fire otherwise). */
async function pickGoodFixture(): Promise<string> {
  const worker = demoWorker().publicKey();
  const prior = await db
    .select({ url: submissions.image_url })
    .from(submissions)
    .where(eq(submissions.worker_address, worker));
  return prior.some((s) => s.url?.includes("good-1")) ? "good-2.jpg" : "good-1.jpg";
}

async function simulate(origin: string, fixture: string) {
  const file = path.join(process.cwd(), "public", "demo", fixture);
  if (!existsSync(file)) {
    throw new Error(`fixture public/demo/${fixture} is missing — shoot it per BUILD_PLAN Phase 3`);
  }
  const worker = demoWorker().publicKey();

  const [open] = await db
    .select()
    .from(tasks)
    .where(eq(tasks.status, "open"))
    .orderBy(asc(tasks.created_at))
    .limit(1);
  if (!open) throw new Error("no open task to claim — seed or run the agent first");

  const claim = await fetch(`${origin}/api/tasks/${open.id}/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ worker }),
  });
  const claimBody = await claim.json();
  if (!claim.ok) throw new Error(`claim: ${claimBody.error}`);

  // Wait for funding the way the phone does: poll tick.
  let funded = false;
  for (let i = 0; i < 15; i++) {
    const tick = await fetch(`${origin}/api/tasks/${open.id}/tick`, { method: "POST" });
    const t = (await tick.json()).task;
    if (t?.escrow_status === "funded") {
      funded = true;
      break;
    }
    if (t?.escrow_status === "failed") throw new Error("escrow funding failed");
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (!funded) throw new Error("escrow did not fund in time");

  const form = new FormData();
  form.set("worker", worker);
  form.set(
    "photo",
    new Blob([new Uint8Array(readFileSync(file))], { type: "image/jpeg" }),
    fixture,
  );
  const submit = await fetch(`${origin}/api/tasks/${open.id}/submit`, {
    method: "POST",
    body: form,
  });
  const submitBody = await submit.json();
  if (!submit.ok) throw new Error(`submit: ${submitBody.error}`);

  return { message: `Demo worker submitted ${fixture} on "${open.title}". Watch the ledger.` };
}

/** A 500 USDC task attempt — blocked by the real policy engine, logged for the strip. */
async function overspendPolicy() {
  const [mission] = await db
    .select()
    .from(missions)
    .where(eq(missions.status, "active"))
    .orderBy(desc(missions.created_at))
    .limit(1);
  if (!mission) throw new Error("no active mission");

  const reward = 500;
  const result = checkPolicy({
    reward_usdc: reward,
    mission,
    funded_today_usdc: 0,
    funded_for_mission_usdc: 0,
    treasury_usdc: Number(await getUsdcBalance(treasuryKeypair().publicKey())),
  });
  if (result.ok) throw new Error("policy unexpectedly allowed 500 USDC — investigate");
  await db.insert(ledgerEvents).values({
    id: crypto.randomUUID(),
    task_id: null,
    type: "policy_blocked",
    message: result.reason,
    amount_usdc: reward,
    created_at: Date.now(),
  });
  return { message: `Blocked by policy: ${result.reason}` };
}

/** A payment beyond the treasury balance — rejected by the network itself. */
async function overspendNetwork() {
  const treasury = treasuryKeypair();
  const balance = Number(await getUsdcBalance(treasury.publicKey()));
  const amount = Math.max(1, Math.ceil(balance + 100));
  try {
    await payUsdc({ from: treasury, to: opsKeypair().publicKey(), amount });
    throw new Error(`the network unexpectedly allowed paying ${amount} USDC — investigate`);
  } catch (err) {
    if (!(err instanceof ChainError)) throw err;
    await db.insert(ledgerEvents).values({
      id: crypto.randomUUID(),
      task_id: null,
      type: "network_rejected",
      message: `tried to pay ${amount} USDC with ${balance} in the treasury: ${err.message}`,
      amount_usdc: amount,
      created_at: Date.now(),
    });
    return { message: `Rejected on-chain: ${err.message}` };
  }
}

/** A deterministic task the generated orange card satisfies — smoke and e2e use it. */
async function insertTestTask() {
  const id = `test-card-${Date.now()}`;
  await db.insert(tasks).values({
    id,
    mission_id: "mission-london-demo",
    title: "Photograph the orange test card",
    instructions: "Photograph the solid orange test card so it fills the whole frame.",
    criteria: [
      { id: "solid_colour", text: "The frame is filled edge to edge by one solid colour", required: true },
      { id: "orange", text: "That colour is orange", required: true },
    ],
    extract_fields: [
      { key: "colour_name", type: "string", description: "The colour, as a plain word" },
    ],
    reward_usdc: 0.5,
    status: "open",
    escrow_status: "none",
    created_at: Date.now(),
  });
  return { message: "Test-card task posted.", taskId: id };
}
