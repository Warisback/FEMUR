import { inArray } from "drizzle-orm";
import { db } from "./client";
import {
  ledgerEvents,
  missions,
  submissions,
  tasks,
  verifications,
  workers,
  type Criterion,
  type ExtractField,
} from "./schema";

export const DEMO_MISSION_ID = "mission-london-demo";

interface SeedTask {
  slug: string;
  title: string;
  instructions: string;
  criteria: Criterion[];
  extract_fields: ExtractField[];
}

const photoCriteria = (subject: string, extra: Criterion[] = []): Criterion[] => [
  { id: "in_frame", text: `${subject} fully in frame`, required: true },
  { id: "legible", text: "Text is legible, not blurred", required: true },
  ...extra,
];

const SEED_TASKS: SeedTask[] = [
  {
    slug: "bar-price-list",
    title: "Photograph the bar price list",
    instructions:
      "Find the bar price board or printed menu at the venue and photograph it straight on, close enough that individual prices can be read.",
    criteria: photoCriteria("Price board or menu", [
      { id: "three_prices", text: "At least 3 items with prices visible", required: true },
    ]),
    extract_fields: [
      { key: "cheapest_item", type: "string", description: "Name of the cheapest listed item" },
      { key: "cheapest_price", type: "string", description: "Its listed price, with currency" },
    ],
  },
  {
    slug: "front-door-sign",
    title: "Photograph the front door signage",
    instructions:
      "Photograph the venue's main entrance sign from outside, including the venue name and any opening hours shown.",
    criteria: photoCriteria("Entrance sign", [
      { id: "venue_name", text: "Venue name is readable", required: true },
    ]),
    extract_fields: [
      { key: "venue_name", type: "string", description: "The venue name as written on the sign" },
      { key: "opening_hours_shown", type: "boolean", description: "Whether opening hours are visible" },
    ],
  },
  {
    slug: "agenda-wall",
    title: "Photograph the agenda or schedule wall",
    instructions:
      "Find today's printed agenda, schedule board or poster and photograph the whole thing.",
    criteria: photoCriteria("Agenda or schedule"),
    extract_fields: [
      { key: "first_item", type: "string", description: "The first item on the schedule" },
    ],
  },
  {
    slug: "toilets-sign",
    title: "Photograph the toilets direction sign",
    instructions: "Photograph the sign that points to the toilets, wherever it is in the venue.",
    criteria: photoCriteria("Direction sign"),
    extract_fields: [
      { key: "direction", type: "string", description: "Which way the sign points (left, right, upstairs…)" },
    ],
  },
  {
    slug: "wifi-details",
    title: "Photograph the guest wifi details",
    instructions:
      "Find the card, poster or screen showing the guest wifi network name and photograph it. Do not photograph anything marked private or staff-only.",
    criteria: photoCriteria("Wifi notice", [
      { id: "network_name", text: "Network (SSID) name is readable", required: true },
    ]),
    extract_fields: [
      { key: "network_name", type: "string", description: "The wifi network name" },
    ],
  },
  {
    slug: "fire-exit-map",
    title: "Photograph the fire exit floor plan",
    instructions:
      "Photograph the fire escape floor plan posted in the venue (usually near doors or lifts), with the whole plan in frame.",
    criteria: photoCriteria("Floor plan"),
    extract_fields: [
      { key: "exits_marked", type: "number", description: "How many exits are marked on the plan" },
    ],
  },
];

/**
 * Reset demo data and insert the London mission with 6 open tasks. Leaves
 * workers alone unless clearWorkers is set (then only the demo worker
 * survives). Never touches TREASURY or anything on-chain.
 */
export async function seedDemoMission(opts: { clearWorkers?: boolean } = {}) {
  const now = Date.now();
  await db.delete(verifications);
  await db.delete(submissions);
  await db.delete(ledgerEvents);
  await db.delete(tasks);
  await db.delete(missions);
  if (opts.clearWorkers) {
    const demo = await db.select().from(workers).where(inArray(workers.is_demo, [true]));
    await db.delete(workers);
    if (demo.length > 0) await db.insert(workers).values(demo);
  }

  await db.insert(missions).values({
    id: DEMO_MISSION_ID,
    title: "Verify London venue information",
    brief:
      "Confirm on-the-ground facts about the venue — prices, signage, schedule — with legible photos.",
    budget_usdc: 20,
    reward_usdc: 0.5,
    max_reward_usdc: Number(process.env.MAX_REWARD_USDC ?? 2),
    daily_cap_usdc: Number(process.env.DAILY_CAP_USDC ?? 50),
    acceptance_template: null,
    status: "active",
    created_at: now,
  });

  await db.insert(tasks).values(
    SEED_TASKS.map((t) => ({
      id: `task-${t.slug}`,
      mission_id: DEMO_MISSION_ID,
      title: t.title,
      instructions: t.instructions,
      criteria: t.criteria,
      extract_fields: t.extract_fields,
      reward_usdc: 0.5,
      status: "open" as const,
      escrow_status: "none" as const,
      created_at: now,
    })),
  );

  return { mission: DEMO_MISSION_ID, tasks: SEED_TASKS.length };
}
