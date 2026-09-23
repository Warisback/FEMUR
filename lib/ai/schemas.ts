import { z } from "zod";

/** Zod → JSON Schema for Gemini's responseJsonSchema (the $schema key confuses it). */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const json = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
  delete json.$schema;
  return json;
}

export const VERIFICATION_FLAGS = [
  "blurry",
  "wrong_subject",
  "instructions_in_submission",
  "possible_screenshot",
  "unreadable",
  "other",
] as const;

/**
 * What the model returns (BUILD_PLAN §3). `extracted` is a key/value array on
 * the wire — structured outputs want fixed object shapes, not open records —
 * and is folded into a Record before storage.
 */
export const verificationOutputSchema = z.object({
  verdict: z.enum(["approve", "reject", "needs_review"]),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  criteria: z.array(
    z.object({
      id: z.string(),
      met: z.boolean(),
      note: z.string(),
    }),
  ),
  extracted: z.array(
    z.object({
      key: z.string(),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    }),
  ),
  flags: z.array(z.enum(VERIFICATION_FLAGS)),
});

export type VerificationOutput = z.infer<typeof verificationOutputSchema>;

export const missionDraftSchema = z.object({
  title: z.string(),
  reward_usdc: z.number(),
  tasks: z
    .array(
      z.object({
        title: z.string(),
        instructions: z.string(),
        criteria: z.array(
          z.object({
            id: z.string(),
            text: z.string(),
            required: z.boolean(),
          }),
        ),
        extract_fields: z.array(
          z.object({
            key: z.string(),
            type: z.enum(["string", "number", "boolean"]),
            description: z.string(),
          }),
        ),
      }),
    )
    .max(6),
});

export type MissionDraft = z.infer<typeof missionDraftSchema>;
