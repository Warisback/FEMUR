import { describe, expect, it } from "vitest";
import { decide } from "@/lib/ai/verify";
import { clampDraft } from "@/lib/ai/missions";
import type { Criterion } from "@/lib/db/schema";
import type { MissionDraft } from "@/lib/ai/schemas";

const CRITERIA: Criterion[] = [
  { id: "in_frame", text: "Fully in frame", required: true },
  { id: "legible", text: "Legible", required: true },
  { id: "bonus", text: "Nice framing", required: false },
];

function output(overrides: {
  confidence: number;
  met?: Record<string, boolean>;
  flags?: ("blurry" | "wrong_subject" | "instructions_in_submission" | "possible_screenshot" | "unreadable" | "other")[];
}) {
  return {
    confidence: overrides.confidence,
    criteria: CRITERIA.map((c) => ({
      id: c.id,
      met: overrides.met?.[c.id] ?? true,
      note: "",
    })),
    flags: overrides.flags ?? [],
  };
}

describe("decide — the decision rule lives in code", () => {
  it("approves when required criteria pass with high confidence", () => {
    expect(decide(CRITERIA, output({ confidence: 0.9 }))).toBe("approve");
  });

  it("an optional criterion failing does not block approval", () => {
    expect(decide(CRITERIA, output({ confidence: 0.9, met: { bonus: false } }))).toBe("approve");
  });

  it("rejects when a required criterion fails, even at high confidence", () => {
    expect(decide(CRITERIA, output({ confidence: 0.95, met: { legible: false } }))).toBe("reject");
  });

  it("a criterion the model did not report counts as unmet", () => {
    const out = output({ confidence: 0.9 });
    out.criteria = out.criteria.filter((c) => c.id !== "in_frame");
    expect(decide(CRITERIA, out)).toBe("reject");
  });

  it("mid confidence goes to review", () => {
    expect(decide(CRITERIA, output({ confidence: 0.6 }))).toBe("needs_review");
    expect(decide(CRITERIA, output({ confidence: 0.5 }))).toBe("needs_review");
    expect(decide(CRITERIA, output({ confidence: 0.749 }))).toBe("needs_review");
  });

  it("low confidence rejects", () => {
    expect(decide(CRITERIA, output({ confidence: 0.3 }))).toBe("reject");
  });

  it("injection with passing criteria goes to review, never auto-approves", () => {
    expect(
      decide(CRITERIA, output({ confidence: 0.95, flags: ["instructions_in_submission"] })),
    ).toBe("needs_review");
  });

  it("injection with failing criteria rejects", () => {
    expect(
      decide(
        CRITERIA,
        output({ confidence: 0.9, met: { in_frame: false }, flags: ["instructions_in_submission"] }),
      ),
    ).toBe("reject");
  });
});

describe("clampDraft — the model's numbers never survive unclamped", () => {
  const task = {
    title: "T",
    instructions: "I",
    criteria: [{ id: "a", text: "A", required: true }],
    extract_fields: [],
  };
  function draft(reward: number, count: number): MissionDraft {
    return { title: "M", reward_usdc: reward, tasks: Array(count).fill(task) };
  }

  it("caps a 500 USDC drafted reward at the per-task max", () => {
    const clamped = clampDraft(draft(500, 4), { remainingBudgetUsdc: 20, maxRewardUsdc: 2 });
    expect(clamped.reward_usdc).toBe(2);
    expect(clamped.tasks).toHaveLength(4);
  });

  it("trims the batch to fit the remaining budget", () => {
    const clamped = clampDraft(draft(0.5, 6), { remainingBudgetUsdc: 2, maxRewardUsdc: 2 });
    expect(clamped.tasks).toHaveLength(4);
    expect(clamped.trimmed).toBe(2);
  });

  it("returns zero tasks when the budget covers none", () => {
    const clamped = clampDraft(draft(0.5, 6), { remainingBudgetUsdc: 0.4, maxRewardUsdc: 2 });
    expect(clamped.tasks).toHaveLength(0);
  });

  it("a fixed reward overrides the drafted one", () => {
    const clamped = clampDraft(draft(1.5, 3), {
      remainingBudgetUsdc: 20,
      maxRewardUsdc: 2,
      fixedRewardUsdc: 0.5,
    });
    expect(clamped.reward_usdc).toBe(0.5);
  });

  it("respects maxTasks", () => {
    const clamped = clampDraft(draft(0.5, 6), {
      remainingBudgetUsdc: 20,
      maxRewardUsdc: 2,
      maxTasks: 2,
    });
    expect(clamped.tasks).toHaveLength(2);
  });
});
