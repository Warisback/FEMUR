/**
 * Full-flow smoke test THROUGH THE API (BUILD_PLAN Phase 2 done-when): plays
 * the phone against a running dev server. Onboards a fresh worker (signs the
 * sponsored XDR locally), inserts a deterministic test task, claims it, waits
 * for escrow funding, submits a generated solid-orange photo, then polls tick
 * until the AI verifies and the escrow releases. Asserts `paid`.
 *
 * Usage: pnpm flow:smoke  (dev server must be running; pass APP_URL to override)
 */
import { deflateSync } from "node:zlib";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { db } from "../lib/db/client";
import { tasks, type Task } from "../lib/db/schema";
import { NETWORK_PASSPHRASE } from "../lib/stellar/config";
import { explorerUrl } from "../lib/stellar/explorer";

const BASE = process.env.APP_URL ?? "http://localhost:3000";

let last = Date.now();
function step(label: string) {
  const ms = Date.now() - last;
  last = Date.now();
  console.log(`✓ ${label} (${ms} ms)`);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${body.error ?? "unknown"}`);
  return body;
}

function orangePng(size = 512, rgb: [number, number, number] = [232, 100, 27]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, k) => {
    let c = k;
    for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3)]);
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = rgb[0];
    row[2 + x * 3] = rgb[1];
    row[3 + x * 3] = rgb[2];
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(Array(size).fill(row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function main() {
  // 1. Onboard a fresh worker — exactly the phone flow.
  const worker = Keypair.random();
  const { xdr } = await api<{ xdr: string }>("/api/worker/onboard", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: worker.publicKey() }),
  });
  const tx = TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE);
  tx.sign(worker);
  await api("/api/worker/onboard", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: worker.publicKey(), signedXdr: tx.toXDR() }),
  });
  step(`onboarded worker ${worker.publicKey().slice(0, 4)}…`);

  // 2. A deterministic test task the generated photo genuinely satisfies.
  const taskId = `flow-smoke-${Date.now()}`;
  await db.insert(tasks).values({
    id: taskId,
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
  step("inserted test task");

  // 3. Claim → policy check → escrow funding starts.
  await api(`/api/tasks/${taskId}/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ worker: worker.publicKey() }),
  });
  step("claimed — policy passed, escrow deploying");

  const tick = () => api<{ task: Task }>(`/api/tasks/${taskId}/tick`, { method: "POST" });

  // 4. Poll tick until the escrow is funded (the phone does this while the
  //    worker takes the photo).
  let task = (await tick()).task;
  while (task.escrow_status !== "funded") {
    if (task.escrow_status === "failed") throw new Error("escrow funding failed");
    await new Promise((r) => setTimeout(r, 2000));
    task = (await tick()).task;
  }
  step(`escrow funded — ${explorerUrl("tx", task.fund_tx!)}`);

  // 5. Submit the photo.
  const form = new FormData();
  form.set("worker", worker.publicKey());
  form.set("photo", new Blob([new Uint8Array(orangePng())], { type: "image/png" }), "orange.png");
  await api(`/api/tasks/${taskId}/submit`, { method: "POST", body: form });
  const submittedAt = Date.now();
  step("photo submitted");

  // 6. Poll tick to the end: verify → approve → release → paid.
  const deadline = Date.now() + 120_000;
  let lastStatus = "";
  while (Date.now() < deadline) {
    task = (await tick()).task;
    const state = `${task.status}/${task.escrow_status}`;
    if (state !== lastStatus) {
      console.log(`    → ${state}`);
      lastStatus = state;
    }
    if (task.status === "paid") break;
    if (["expired", "refunded"].includes(task.status) || task.escrow_status === "failed") {
      throw new Error(`flow ended in ${state}`);
    }
    if (task.status === "needs_review") {
      throw new Error("verification routed to needs_review — check the model/verification row");
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (task.status !== "paid") throw new Error("timed out before paid");

  const seconds = ((Date.now() - submittedAt) / 1000).toFixed(1);
  step(`PAID — submit → paid in ${seconds} s`);
  console.log(`    receipt: 0.50 USDC · ${seconds} s · tx ${task.release_tx!.slice(0, 4)}…${task.release_tx!.slice(-4)}`);
  console.log(`    ${explorerUrl("tx", task.release_tx!)}`);
  console.log(`    worker: ${explorerUrl("account", worker.publicKey())}`);
  console.log("\nFull-flow smoke test passed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
