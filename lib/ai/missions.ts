import { readFileSync } from "node:fs";
import path from "node:path";
import { gemini, verifyModel } from "./client";
import { jsonSchemaOf, missionDraftSchema, type MissionDraft } from "./schemas";

const DRAFT_TIMEOUT_MS = 60_000;

export interface ClampedDraft {
  title: string;
  reward_usdc: number;
  tasks: MissionDraft["tasks"];
  /** How many drafted tasks were trimmed to fit the budget. */
  trimmed: number;
}

/**
 * Claude drafts the mission; the server clamps (BUILD_PLAN §3): the reward is
 * capped at max_reward_usdc and the batch is trimmed so Σ rewards fits the
 * remaining budget — BEFORE anything is written. Amounts are never taken from
 * model output beyond this clamped suggestion.
 */
export async function draftMission(opts: {
  brief: string;
  remainingBudgetUsdc: number;
  maxRewardUsdc: number;
  maxTasks?: number;
  /** When set (running an existing mission), the reward is fixed, not drafted. */
  fixedRewardUsdc?: number;
}): Promise<ClampedDraft> {
  const response = await gemini().models.generateContent({
    model: verifyModel(),
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `Mission brief: ${opts.brief}\n\nRemaining budget: ${opts.remainingBudgetUsdc} USDC. Draft up to ${opts.maxTasks ?? 6} tasks.`,
          },
        ],
      },
    ],
    config: {
      systemInstruction: readFileSync(
        path.join(process.cwd(), "lib", "ai", "prompts", "missions.md"),
        "utf8",
      ),
      responseMimeType: "application/json",
      responseJsonSchema: jsonSchemaOf(missionDraftSchema),
      httpOptions: { timeout: DRAFT_TIMEOUT_MS },
    },
  });
  if (!response.text) throw new Error("mission draft returned no text");
  const draft = missionDraftSchema.parse(JSON.parse(response.text));

  return clampDraft(draft, opts);
}

/** Pure and unit-tested — the model's numbers never survive unclamped. */
export function clampDraft(
  draft: MissionDraft,
  opts: {
    remainingBudgetUsdc: number;
    maxRewardUsdc: number;
    maxTasks?: number;
    fixedRewardUsdc?: number;
  },
): ClampedDraft {
  const reward =
    opts.fixedRewardUsdc ??
    Math.min(Math.max(draft.reward_usdc, 0.01), opts.maxRewardUsdc);
  const maxTasks = opts.maxTasks ?? 6;
  const affordable = Math.floor(opts.remainingBudgetUsdc / reward + 1e-9);
  const keep = Math.max(0, Math.min(draft.tasks.length, maxTasks, affordable));
  return {
    title: draft.title,
    reward_usdc: reward,
    tasks: draft.tasks.slice(0, keep),
    trimmed: draft.tasks.length - keep,
  };
}
