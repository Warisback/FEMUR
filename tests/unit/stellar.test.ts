import { beforeAll, describe, expect, it } from "vitest";
import { Account, Asset, Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

// Config reads env at import time / lazily — pin a self-consistent testnet
// environment before any module under test loads.
const treasury = Keypair.random();
const issuer = Keypair.random();
process.env.NETWORK = "testnet";
process.env.USDC_CODE = "USDC";
process.env.USDC_ISSUER = issuer.publicKey();
process.env.TREASURY_SECRET = treasury.secret();

const { mapResultCodes, ChainError } = await import("@/lib/stellar/horizon");
const { verifyOnboardingXdr } = await import("@/lib/stellar/sponsor");
const { deriveEscrowKeypair } = await import("@/lib/escrow/native");
const { NETWORK_PASSPHRASE, TX_TIMEOUT_SECONDS, usdcAsset } = await import(
  "@/lib/stellar/config"
);

describe("mapResultCodes", () => {
  it("maps operation codes to human-readable reasons", () => {
    expect(
      mapResultCodes({ transaction: "tx_failed", operations: ["op_underfunded"] }),
    ).toBe("not enough of the asset in the paying account");
  });

  it("maps transaction-level codes", () => {
    expect(mapResultCodes({ transaction: "tx_bad_seq" })).toContain("sequence number");
  });

  it("skips op_success entries and passes unknown codes through", () => {
    expect(
      mapResultCodes({ transaction: "tx_failed", operations: ["op_success", "op_weird"] }),
    ).toBe("op_weird");
  });

  it("falls back to a generic message", () => {
    expect(mapResultCodes(undefined)).toBe("transaction rejected by the network");
  });

  it("ChainError.has finds codes at both levels", () => {
    const err = new ChainError("boom", {
      transaction: "tx_failed",
      operations: ["op_no_trust"],
    });
    expect(err.has("op_no_trust")).toBe(true);
    expect(err.has("tx_failed")).toBe(true);
    expect(err.has("tx_bad_seq")).toBe(false);
  });
});

describe("verifyOnboardingXdr", () => {
  const worker = Keypair.random();

  interface BuildOverrides {
    source?: string;
    destination?: string;
    startingBalance?: string;
    asset?: Asset;
    limit?: string;
    extraPayment?: boolean;
    skipTrust?: boolean;
  }

  function buildOnboarding(overrides: BuildOverrides = {}): string {
    const source = overrides.source ?? treasury.publicKey();
    const dest = overrides.destination ?? worker.publicKey();
    const builder = new TransactionBuilder(new Account(source, "0"), {
      fee: "1000",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: dest }))
      .addOperation(
        Operation.createAccount({
          destination: dest,
          startingBalance: overrides.startingBalance ?? "0",
        }),
      );
    if (!overrides.skipTrust) {
      builder.addOperation(
        Operation.changeTrust({
          asset: overrides.asset ?? usdcAsset(),
          source: dest,
          limit: overrides.limit,
        }),
      );
    }
    builder.addOperation(Operation.endSponsoringFutureReserves({ source: dest }));
    if (overrides.extraPayment) {
      builder.addOperation(
        Operation.payment({
          destination: treasury.publicKey(),
          asset: usdcAsset(),
          amount: "100",
          source: dest,
        }),
      );
    }
    const tx = builder.setTimeout(TX_TIMEOUT_SECONDS).build();
    tx.sign(treasury);
    return tx.toXDR();
  }

  it("accepts the exact transaction shape the server builds", () => {
    const tx = verifyOnboardingXdr(buildOnboarding(), worker.publicKey());
    expect(tx.operations).toHaveLength(4);
  });

  it("rejects a transaction for a different worker", () => {
    const other = Keypair.random().publicKey();
    expect(() => verifyOnboardingXdr(buildOnboarding(), other)).toThrow();
  });

  it("rejects a non-treasury source", () => {
    const xdr = buildOnboarding({ source: Keypair.random().publicKey() });
    expect(() => verifyOnboardingXdr(xdr, worker.publicKey())).toThrow(/treasury/);
  });

  it("rejects extra smuggled operations", () => {
    const xdr = buildOnboarding({ extraPayment: true });
    expect(() => verifyOnboardingXdr(xdr, worker.publicKey())).toThrow(/4 operations/);
  });

  it("rejects a non-zero starting balance", () => {
    const xdr = buildOnboarding({ startingBalance: "100" });
    expect(() => verifyOnboardingXdr(xdr, worker.publicKey())).toThrow(/0 XLM/);
  });

  it("rejects the wrong trustline asset", () => {
    const xdr = buildOnboarding({
      asset: new Asset("EURC", issuer.publicKey()),
    });
    expect(() => verifyOnboardingXdr(xdr, worker.publicKey())).toThrow(/USDC/);
  });

  it("rejects a lowered trustline limit", () => {
    const xdr = buildOnboarding({ limit: "1" });
    expect(() => verifyOnboardingXdr(xdr, worker.publicKey())).toThrow(/limit/);
  });
});

describe("deriveEscrowKeypair", () => {
  it("is deterministic per task id", () => {
    expect(deriveEscrowKeypair("task-1").publicKey()).toBe(
      deriveEscrowKeypair("task-1").publicKey(),
    );
  });

  it("differs across task ids", () => {
    expect(deriveEscrowKeypair("task-1").publicKey()).not.toBe(
      deriveEscrowKeypair("task-2").publicKey(),
    );
  });
});
