import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export type MissionStatus = "active" | "paused" | "done";

export type TaskStatus =
  | "open"
  | "claimed"
  | "submitted"
  | "verifying"
  | "needs_review"
  | "approved"
  | "paid"
  | "expired"
  | "refunded";

export type EscrowStatus =
  | "none"
  | "deploying"
  | "funded"
  | "releasing"
  | "released"
  | "refunding"
  | "refunded"
  | "failed";

export type LedgerEventType =
  | "escrow_funded"
  | "escrow_released"
  | "escrow_refunded"
  | "policy_blocked"
  | "network_rejected"
  | "verify_failed"
  | "resolver_decision";

export interface Criterion {
  id: string;
  text: string;
  required: boolean;
}

export interface ExtractField {
  key: string;
  type: "string" | "number" | "boolean";
  description: string;
}

export interface CriterionResult {
  id: string;
  met: boolean;
  note: string;
}

// Timestamps are integer milliseconds since epoch.

export const missions = sqliteTable("missions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  brief: text("brief").notNull(),
  budget_usdc: real("budget_usdc").notNull(),
  reward_usdc: real("reward_usdc").notNull(),
  max_reward_usdc: real("max_reward_usdc").notNull(),
  daily_cap_usdc: real("daily_cap_usdc").notNull(),
  acceptance_template: text("acceptance_template", { mode: "json" }).$type<{
    criteria: Criterion[];
    extract_fields: ExtractField[];
  } | null>(),
  status: text("status").$type<MissionStatus>().notNull().default("active"),
  created_at: integer("created_at").notNull(),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  mission_id: text("mission_id").notNull(),
  title: text("title").notNull(),
  instructions: text("instructions").notNull(),
  criteria: text("criteria", { mode: "json" }).$type<Criterion[]>().notNull(),
  extract_fields: text("extract_fields", { mode: "json" })
    .$type<ExtractField[]>()
    .notNull(),
  reward_usdc: real("reward_usdc").notNull(),
  status: text("status").$type<TaskStatus>().notNull().default("open"),
  escrow_status: text("escrow_status").$type<EscrowStatus>().notNull().default("none"),
  escrow_provider: text("escrow_provider"),
  escrow_ref: text("escrow_ref"),
  pending_tx: text("pending_tx"),
  fund_tx: text("fund_tx"),
  approve_tx: text("approve_tx"),
  release_tx: text("release_tx"),
  refund_tx: text("refund_tx"),
  worker_address: text("worker_address"),
  attempts: integer("attempts").notNull().default(0),
  lock_until: integer("lock_until").notNull().default(0),
  created_at: integer("created_at").notNull(),
  claimed_at: integer("claimed_at"),
  submitted_at: integer("submitted_at"),
  verified_at: integer("verified_at"),
  paid_at: integer("paid_at"),
  expires_at: integer("expires_at"),
});

export const submissions = sqliteTable("submissions", {
  id: text("id").primaryKey(),
  task_id: text("task_id").notNull(),
  worker_address: text("worker_address").notNull(),
  image_url: text("image_url"),
  image_sha256: text("image_sha256"),
  text: text("text"),
  created_at: integer("created_at").notNull(),
});

export const verifications = sqliteTable("verifications", {
  id: text("id").primaryKey(),
  task_id: text("task_id").notNull(),
  submission_id: text("submission_id").notNull(),
  model: text("model").notNull(),
  verdict: text("verdict").notNull(),
  confidence: real("confidence").notNull(),
  summary: text("summary").notNull(),
  criteria: text("criteria", { mode: "json" }).$type<CriterionResult[]>().notNull(),
  extracted: text("extracted", { mode: "json" })
    .$type<Record<string, string | number | boolean | null>>()
    .notNull(),
  flags: text("flags", { mode: "json" }).$type<string[]>().notNull(),
  latency_ms: integer("latency_ms").notNull(),
  created_at: integer("created_at").notNull(),
});

export const workers = sqliteTable("workers", {
  address: text("address").primaryKey(),
  sponsored_tx: text("sponsored_tx"),
  tasks_completed: integer("tasks_completed").notNull().default(0),
  total_earned_usdc: real("total_earned_usdc").notNull().default(0),
  is_demo: integer("is_demo", { mode: "boolean" }).notNull().default(false),
  created_at: integer("created_at").notNull(),
});

export const ledgerEvents = sqliteTable("ledger_events", {
  id: text("id").primaryKey(),
  task_id: text("task_id"),
  type: text("type").$type<LedgerEventType>().notNull(),
  message: text("message").notNull(),
  tx_hash: text("tx_hash"),
  amount_usdc: real("amount_usdc"),
  created_at: integer("created_at").notNull(),
});

export type Mission = typeof missions.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Submission = typeof submissions.$inferSelect;
export type Verification = typeof verifications.$inferSelect;
export type Worker = typeof workers.$inferSelect;
export type LedgerEvent = typeof ledgerEvents.$inferSelect;
export type NewLedgerEvent = typeof ledgerEvents.$inferInsert;
