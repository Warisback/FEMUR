/**
 * Budget policy (BUILD_PLAN §3). Pure — evaluated before ANY escrow funding.
 * A block is written to ledger_events by the caller with the exact reason.
 * The on-chain layer (TREASURY funded with exactly the mission budget) is the
 * hard backstop behind these checks.
 */
export interface PolicyInput {
  reward_usdc: number;
  mission: {
    max_reward_usdc: number;
    daily_cap_usdc: number;
    budget_usdc: number;
  };
  /** Sum of rewards escrow-funded today, across missions. */
  funded_today_usdc: number;
  /** Sum of rewards escrow-funded for this mission, all time. */
  funded_for_mission_usdc: number;
  /** TREASURY's current USDC balance. */
  treasury_usdc: number;
}

export type PolicyResult = { ok: true } | { ok: false; reason: string };

export function checkPolicy(input: PolicyInput): PolicyResult {
  const { reward_usdc: reward, mission } = input;
  if (reward > mission.max_reward_usdc) {
    return {
      ok: false,
      reason: `reward ${reward} > max ${mission.max_reward_usdc}/task`,
    };
  }
  if (input.funded_today_usdc + reward > mission.daily_cap_usdc) {
    return {
      ok: false,
      reason: `daily cap: ${input.funded_today_usdc} locked today + ${reward} > ${mission.daily_cap_usdc}/day`,
    };
  }
  if (input.funded_for_mission_usdc + reward > mission.budget_usdc) {
    return {
      ok: false,
      reason: `mission budget: ${input.funded_for_mission_usdc} locked + ${reward} > ${mission.budget_usdc} budget`,
    };
  }
  if (input.treasury_usdc < reward) {
    return {
      ok: false,
      reason: `treasury holds ${input.treasury_usdc} USDC < reward ${reward}`,
    };
  }
  return { ok: true };
}
