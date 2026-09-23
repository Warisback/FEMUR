import { readFileSync } from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
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
import { anthropic, verifyModel } from "./client";
import { verificationOutputSchema, type VerificationOutput } from "./schemas";

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
  const image = await imageBlock(submission);
  const content: Anthropic.ContentBlockParam[] = [
    { type: "text", text: taskContext(task) },
    { type: "text", text: "<<<WORKER_SUBMISSION>>>" },
  ];
  if (image) content.push(image);
  if (submission.text) content.push({ type: "text", text: `Worker note: ${submission.text}` });
  content.push({ type: "text", text: "<<<END_WORKER_SUBMISSION>>>" });

  const request = {
    model: verifyModel(),
    max_tokens: 1024,
    // Sonnet 5 runs adaptive thinking by default; a vision check doesn't need
    // it and latency matters (BUILD_PLAN §3). No temperature/top_p — 400.
    thinking: { type: "disabled" as const },
    system: prompt("verify.md"),
    output_config: { format: zodOutputFormat(verificationOutputSchema) },
    messages: [{ role: "user" as const, content }],
  };

  try {
    const response = await anthropic().messages.parse(request, { timeout: VERIFY_TIMEOUT_MS });
    if (!response.parsed_output) throw new Error("model output failed schema validation");
    return verificationOutputSchema.parse(response.parsed_output);
  } catch (err) {
    // A URL the API could not fetch (e.g. blob store hiccup) → retry as base64.
    if (image?.source.type === "url" && isImageFetchError(err)) {
      const base64 = await base64Block(submission);
      const retryContent = content.map((block) => (block === image ? base64 : block));
      const response = await anthropic().messages.parse(
        { ...request, messages: [{ role: "user" as const, content: retryContent }] },
        { timeout: VERIFY_TIMEOUT_MS },
      );
      if (!response.parsed_output) throw new Error("model output failed schema validation");
      return verificationOutputSchema.parse(response.parsed_output);
    }
    throw err;
  }
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

async function imageBlock(
  submission: Submission,
): Promise<Anthropic.ImageBlockParam | null> {
  if (!submission.image_url) return null;
  if (/^https?:\/\//.test(submission.image_url) && !submission.image_url.includes("localhost")) {
    return { type: "image", source: { type: "url", url: submission.image_url } };
  }
  return base64Block(submission);
}

async function base64Block(submission: Submission): Promise<Anthropic.ImageBlockParam> {
  const url = submission.image_url!;
  let bytes: Buffer;
  if (/^https?:\/\//.test(url)) {
    bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
  } else {
    // local-dev fallback storage under public/
    bytes = readFileSync(path.join(process.cwd(), "public", url.replace(/^\//, "")));
  }
  const ext = url.split(".").pop()?.toLowerCase();
  const media =
    ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ("image/jpeg" as const);
  return {
    type: "image",
    source: { type: "base64", media_type: media, data: bytes.toString("base64") },
  };
}

function isImageFetchError(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : "";
  return message.includes("image") && (message.includes("url") || message.includes("fetch"));
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
