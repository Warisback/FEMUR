import { describe, expect, it } from "vitest";
import { checkPolicy, type PolicyInput } from "@/lib/tasks/policy";

function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    reward_usdc: 0.5,
    mission: { max_reward_usdc: 2, daily_cap_usdc: 50, budget_usdc: 20 },
    funded_today_usdc: 0,
    funded_for_mission_usdc: 0,
    treasury_usdc: 20,
    ...overrides,
  };
}

describe("checkPolicy", () => {
  it("passes a normal claim", () => {
    expect(checkPolicy(input())).toEqual({ ok: true });
  });

  it("blocks a reward over the per-task max, with the exact reason", () => {
    const result = checkPolicy(input({ reward_usdc: 500 }));
    expect(result).toEqual({ ok: false, reason: "reward 500 > max 2/task" });
  });

  it("allows a reward exactly at the per-task max", () => {
    expect(checkPolicy(input({ reward_usdc: 2 })).ok).toBe(true);
  });

  it("blocks when the daily cap would be exceeded", () => {
    const result = checkPolicy(input({ funded_today_usdc: 49.6 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("daily cap");
  });

  it("allows landing exactly on the daily cap", () => {
    expect(checkPolicy(input({ funded_today_usdc: 49.5 })).ok).toBe(true);
  });

  it("blocks when the mission budget would be exceeded", () => {
    const result = checkPolicy(input({ funded_for_mission_usdc: 19.6 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("mission budget");
  });

  it("allows spending the mission budget exactly", () => {
    expect(checkPolicy(input({ funded_for_mission_usdc: 19.5 })).ok).toBe(true);
  });

  it("blocks when the treasury cannot cover the reward", () => {
    const result = checkPolicy(input({ treasury_usdc: 0.4 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("treasury");
  });

  it("allows when the treasury holds exactly the reward", () => {
    expect(checkPolicy(input({ treasury_usdc: 0.5 })).ok).toBe(true);
  });
});
