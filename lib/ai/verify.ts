import { readFileSync } from "node:fs";
import path from "node:path";
import type { Part } from "@google/genai";
import { and, desc, eq, lt, ne } from "drizzle-orm";
import { db } from "../db/client";
import {
  submissions,
  verifications,
  type Criterion,
  type Submission,
  type Task,
} from "../db/schema";
import type { VerifyDecision } from "../tasks/tick";
import { gemini, verifyModel } from "./client";
import { jsonSchemaOf, verificationOutputSchema, type VerificationOutput } from "./schemas";

const VERIFY_TIMEOUT_MS = 25_000;
const SUMMARY_MAX = 140;

/**
 * The decision rule lives in code, not in the model (BUILD_PLAN §3):
 * approve iff every required criterion is met, confidence ≥ 0.75, and no
 * instructions_in_submission flag. needs_review when confidence sits in
 * 0.5–0.75, or when the criteria pass but the submission tried to instruct
 * the verifier. Otherwise reject. The model's own verdict is stored for
 * comparison but never trusted on its own.
 */
export function decide(
  taskCriteria: Criterion[],
  output: Pick<VerificationOutput, "confidence" | "criteria" | "flags">,
): "approve" | "reject" | "needs_review" {
  const requiredMet = taskCriteria
    .filter((c) => c.required)
    .every((c) => output.criteria.find((r) => r.id === c.id)?.met === true);
  const injected = output.flags.includes("instructions_in_submission");

  if (requiredMet && output.confidence >= 0.75 && !injected) return "approve";
  if ((output.confidence >= 0.5 && output.confidence < 0.75) || (requiredMet && injected)) {
    return "needs_review";
  }
  return "reject";
}

export async function verifySubmission(task: Task): Promise<VerifyDecision> {
  const [submission] = await db
    .select()
    .from(submissions)
    .where(eq(submissions.task_id, task.id))
    .orderBy(desc(submissions.created_at))
    .limit(1);
  if (!submission) throw new Error(`task ${task.id} has no submission to verify`);

  // Exact duplicate of any prior submission → reject without calling the model.
  if (submission.image_sha256) {
    const [duplicate] = await db
      .select({ id: submissions.id })
      .from(submissions)
      .where(
        and(
          eq(submissions.image_sha256, submission.image_sha256),
          ne(submissions.id, submission.id),
          lt(submissions.created_at, submission.created_at),
        ),
      )
      .limit(1);
    if (duplicate) {
      const summary = "This exact photo was already submitted. Take a fresh photo of the subject.";
      await storeVerification(task, submission, {
        model: "none (duplicate check)",
        verdict: "reject",
        confidence: 1,
        summary,
        criteria: [],
        extracted: {},
        flags: ["other"],
        latency_ms: 0,
      });
      return { decision: "reject", summary };
    }
  }

  const started = Date.now();
  const output = await callModel(task, submission);
  const latency = Date.now() - started;

  const decision = decide(task.criteria, output);
  const summary = output.summary.slice(0, SUMMARY_MAX);

  await storeVerification(task, submission, {
    model: verifyModel(),
    verdict: output.verdict, // the model's own verdict, stored for comparison
    confidence: output.confidence,
    summary,
    criteria: output.criteria,
    extracted: Object.fromEntries(output.extracted.map((e) => [e.key, e.value])),
    flags: output.flags,
    latency_ms: latency,
  });

  return { decision, summary };
}

async function callModel(task: Task, submission: Submission): Promise<VerificationOutput> {
  const parts: Part[] = [
    { text: taskContext(task) },
    { text: "<<<WORKER_SUBMISSION>>>" },
  ];
  const image = await imagePart(submission);
  if (image) parts.push(image);
  if (submission.text) parts.push({ text: `Worker note: ${submission.text}` });
  parts.push({ text: "<<<END_WORKER_SUBMISSION>>>" });

  const response = await gemini().models.generateContent({
    model: verifyModel(),
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: prompt("verify.md"),
      responseMimeType: "application/json",
      responseJsonSchema: jsonSchemaOf(verificationOutputSchema),
      // sampling stays at model defaults (CLAUDE.md non-negotiable 6)
      httpOptions: { timeout: VERIFY_TIMEOUT_MS },
    },
  });
  const text = response.text;
  if (!text) throw new Error("model returned no text");
  return verificationOutputSchema.parse(JSON.parse(text));
}

function taskContext(task: Task): string {
  return [
    `Task: ${task.title}`,
    `Instructions to the worker: ${task.instructions}`,
    `Acceptance criteria (id · required · text):`,
    ...task.criteria.map((c) => `- ${c.id} · ${c.required ? "required" : "optional"} · ${c.text}`),
    `Fields to extract:`,
    ...task.extract_fields.map((f) => `- ${f.key} (${f.type}): ${f.description}`),
    `The worker's submission follows between the markers.`,
  ].join("\n");
}

/** Photos go inline as base64 — client-side resize keeps them ≤ ~400 KB. */
async function imagePart(submission: Submission): Promise<Part | null> {
  if (!submission.image_url) return null;
  const url = submission.image_url;
  let bytes: Buffer;
  if (/^https?:\/\//.test(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`could not fetch submission image (${res.status})`);
    bytes = Buffer.from(await res.arrayBuffer());
  } else {
    // local-dev fallback storage under public/
    bytes = readFileSync(path.join(process.cwd(), "public", url.replace(/^\//, "")));
  }
  const ext = url.split(".").pop()?.toLowerCase();
  const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return { inlineData: { mimeType, data: bytes.toString("base64") } };
}

const promptCache = new Map<string, string>();
function prompt(file: string): string {
  if (!promptCache.has(file)) {
    promptCache.set(file, readFileSync(path.join(process.cwd(), "lib", "ai", "prompts", file), "utf8"));
  }
  return promptCache.get(file)!;
}

async function storeVerification(
  task: Task,
  submission: Submission,
  row: {
    model: string;
    verdict: string;
    confidence: number;
    summary: string;
    criteria: VerificationOutput["criteria"];
    extracted: Record<string, string | number | boolean | null>;
    flags: string[];
    latency_ms: number;
  },
) {
  await db.insert(verifications).values({
    id: crypto.randomUUID(),
    task_id: task.id,
    submission_id: submission.id,
    created_at: Date.now(),
    ...row,
  });
}
