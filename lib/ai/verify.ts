import type { Task } from "../db/schema";
import type { VerifyDecision } from "../tasks/tick";

/**
 * Phase 2 placeholder — the real pipeline (Claude vision, structured outputs,
 * code-side decision rule) lands in Phase 3. Throwing here is the designed
 * behaviour for "verification unavailable": the tick step catches it, writes a
 * verify_failed ledger event and routes the task to needs_review for a human.
 */
export async function verifySubmission(task: Task): Promise<VerifyDecision> {
  void task;
  throw new Error("verification pipeline not built yet (phase 3)");
}
