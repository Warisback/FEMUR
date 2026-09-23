import { describe, expect, it, vi } from "vitest";
import type { Task } from "@/lib/db/schema";
import type { EscrowProvider } from "@/lib/escrow";
import {
  MISSING_TX_TIMEOUT_MS,
  nextStep,
  runStep,
  type TickDeps,
} from "@/lib/tasks/tick";

const NOW = 1_700_000_000_000;

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    mission_id: "mission-1",
    title: "Photograph the bar price list",
    instructions: "…",
    criteria: [],
    extract_fields: [],
    reward_usdc: 0.5,
    status: "open",
    escrow_status: "none",
    escrow_provider: null,
    escrow_ref: null,
    pending_tx: null,
    fund_tx: null,
    approve_tx: null,
    release_tx: null,
    refund_tx: null,
    worker_address: "GWORKER",
    attempts: 0,
    lock_until: 0,
    created_at: NOW,
    claimed_at: null,
    submitted_at: null,
    verified_at: null,
    paid_at: null,
    expires_at: null,
    ...overrides,
  };
}

function fakeDeps(overrides: Partial<TickDeps> = {}): TickDeps & {
  provider: EscrowProvider & Record<string, ReturnType<typeof vi.fn>>;
} {
  const provider = {
    name: "native" as const,
    create: vi.fn(async () => ({ escrowRef: "GESCROW", txHash: "fundhash" })),
    approve: vi.fn(async () => null),
    release: vi.fn(async () => ({ txHash: "releasehash" })),
    refund: vi.fn(async () => ({ txHash: "refundhash" })),
    status: vi.fn(async () => "funded" as const),
    explorerUrl: vi.fn(() => "https://example"),
  };
  return {
    provider,
    getTransactionStatus: vi.fn(async () => "success" as const),
    verify: vi.fn(async () => ({ decision: "approve" as const, summary: "ok" })),
    now: () => NOW,
    ...overrides,
  } as never;
}

describe("nextStep", () => {
  const cases: Array<[Partial<Task>, ReturnType<typeof nextStep>]> = [
    [{ status: "open" }, null],
    [{ status: "claimed", escrow_status: "deploying", pending_tx: "h" }, "fund.confirm"],
    [{ status: "claimed", escrow_status: "funded" }, null],
    [{ status: "submitted", escrow_status: "deploying", pending_tx: "h" }, "fund.confirm"],
    [{ status: "submitted", escrow_status: "funded" }, "verify.start"],
    [{ status: "verifying", escrow_status: "funded" }, "verify"],
    [{ status: "needs_review", escrow_status: "funded" }, null],
    [{ status: "approved", escrow_status: "funded" }, "approve"],
    [{ status: "approved", escrow_status: "releasing" }, "release"],
    [{ status: "approved", escrow_status: "releasing", release_tx: "r" }, "confirm-paid"],
    [{ status: "expired", escrow_status: "funded" }, "refund"],
    [{ status: "expired", escrow_status: "refunding", refund_tx: "r" }, "confirm-refunded"],
    [{ status: "paid", escrow_status: "released" }, null],
    [{ status: "refunded", escrow_status: "refunded" }, null],
    [{ status: "approved", escrow_status: "failed" }, null],
  ];

  it.each(cases)("%o → %s", (overrides, expected) => {
    expect(nextStep(makeTask(overrides))).toBe(expected);
  });
});

describe("runStep fund.confirm", () => {
  const task = makeTask({
    status: "claimed",
    escrow_status: "deploying",
    pending_tx: "fundhash",
    claimed_at: NOW - 5_000,
  });

  it("marks funded and records the ledger event on success", async () => {
    const result = await runStep(task, "fund.confirm", fakeDeps());
    expect(result.patch).toMatchObject({ escrow_status: "funded", fund_tx: "fundhash" });
    expect(result.events[0]).toMatchObject({ type: "escrow_funded", amount_usdc: 0.5 });
  });

  it("fails with network_rejected when the tx failed on-chain", async () => {
    const deps = fakeDeps({ getTransactionStatus: vi.fn(async () => "failed" as const) });
    const result = await runStep(task, "fund.confirm", deps);
    expect(result.patch.escrow_status).toBe("failed");
    expect(result.events[0].type).toBe("network_rejected");
  });

  it("keeps waiting while the tx is missing but young", async () => {
    const deps = fakeDeps({ getTransactionStatus: vi.fn(async () => "not_found" as const) });
    const result = await runStep(task, "fund.confirm", deps);
    expect(result.patch).toEqual({});
  });

  it("gives up after the missing-tx timeout", async () => {
    const old = makeTask({ ...task, claimed_at: NOW - MISSING_TX_TIMEOUT_MS - 1 });
    const deps = fakeDeps({ getTransactionStatus: vi.fn(async () => "not_found" as const) });
    const result = await runStep(old, "fund.confirm", deps);
    expect(result.patch.escrow_status).toBe("failed");
    expect(result.events[0].type).toBe("network_rejected");
  });
});

describe("runStep verify", () => {
  const task = makeTask({ status: "verifying", escrow_status: "funded", attempts: 0 });

  it("approve → approved with verified_at", async () => {
    const result = await runStep(task, "verify", fakeDeps());
    expect(result.patch).toMatchObject({ status: "approved", verified_at: NOW });
  });

  it("needs_review → needs_review", async () => {
    const deps = fakeDeps({
      verify: vi.fn(async () => ({ decision: "needs_review" as const, summary: "unsure" })),
    });
    const result = await runStep(task, "verify", deps);
    expect(result.patch.status).toBe("needs_review");
  });

  it("first reject → claimed again with a fresh expiry", async () => {
    const deps = fakeDeps({
      verify: vi.fn(async () => ({ decision: "reject" as const, summary: "blurry" })),
    });
    const result = await runStep(task, "verify", deps);
    expect(result.patch).toMatchObject({ status: "claimed", attempts: 1 });
    expect(result.patch.expires_at).toBeGreaterThan(NOW);
  });

  it("second reject → expired", async () => {
    const deps = fakeDeps({
      verify: vi.fn(async () => ({ decision: "reject" as const, summary: "blurry" })),
    });
    const result = await runStep(makeTask({ ...task, attempts: 1 }), "verify", deps);
    expect(result.patch).toMatchObject({ status: "expired", attempts: 2 });
  });

  it("a verify error routes to needs_review with a verify_failed event", async () => {
    const deps = fakeDeps({
      verify: vi.fn(async () => {
        throw new Error("model timeout");
      }),
    });
    const result = await runStep(task, "verify", deps);
    expect(result.patch.status).toBe("needs_review");
    expect(result.events[0].type).toBe("verify_failed");
    expect(result.events[0].message).toContain("model timeout");
  });
});

describe("release is idempotent — the double-pay guard", () => {
  it("release step calls the provider exactly once and records release_tx", async () => {
    const task = makeTask({ status: "approved", escrow_status: "releasing" });
    const deps = fakeDeps();
    const result = await runStep(task, "release", deps);
    expect(result.patch).toMatchObject({ release_tx: "releasehash", pending_tx: "releasehash" });
    expect(deps.provider.release).toHaveBeenCalledTimes(1);
  });

  it("once release_tx is set, nextStep never selects release again", () => {
    const task = makeTask({
      status: "approved",
      escrow_status: "releasing",
      release_tx: "releasehash",
    });
    expect(nextStep(task)).toBe("confirm-paid");
  });

  it("even a forced re-run of release is a no-op", async () => {
    const task = makeTask({
      status: "approved",
      escrow_status: "releasing",
      release_tx: "releasehash",
    });
    const deps = fakeDeps();
    const result = await runStep(task, "release", deps);
    expect(result.patch).toEqual({});
    expect(deps.provider.release).not.toHaveBeenCalled();
  });

  it("confirm-paid marks paid and writes escrow_released", async () => {
    const task = makeTask({
      status: "approved",
      escrow_status: "releasing",
      release_tx: "releasehash",
      verified_at: NOW - 2_000,
    });
    const result = await runStep(task, "confirm-paid", fakeDeps());
    expect(result.patch).toMatchObject({ status: "paid", escrow_status: "released", paid_at: NOW });
    expect(result.events[0]).toMatchObject({ type: "escrow_released", tx_hash: "releasehash" });
  });
});

describe("refund path", () => {
  it("refund submits once and confirm-refunded closes the loop", async () => {
    const deps = fakeDeps();
    const task = makeTask({ status: "expired", escrow_status: "funded", expires_at: NOW - 1000 });
    const submitted = await runStep(task, "refund", deps);
    expect(submitted.patch).toMatchObject({ refund_tx: "refundhash", escrow_status: "refunding" });

    const confirmed = await runStep(
      makeTask({ ...task, ...submitted.patch }),
      "confirm-refunded",
      deps,
    );
    expect(confirmed.patch).toMatchObject({ status: "refunded", escrow_status: "refunded" });
    expect(confirmed.events[0].type).toBe("escrow_refunded");
  });

  it("a refund_tx already set is never re-submitted", async () => {
    const deps = fakeDeps();
    const task = makeTask({ status: "expired", escrow_status: "funded", refund_tx: "refundhash" });
    const result = await runStep(task, "refund", deps);
    expect(result.patch).toEqual({});
    expect(deps.provider.refund).not.toHaveBeenCalled();
  });
});
