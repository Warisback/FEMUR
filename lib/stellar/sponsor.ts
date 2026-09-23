import {
  Keypair,
  Operation,
  Transaction,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import {
  BASE_FEE_STROOPS,
  NETWORK_PASSPHRASE,
  treasuryKeypair,
  TX_TIMEOUT_SECONDS,
  usdcAsset,
} from "./config";
import { loadAccount, submit } from "./horizon";

/**
 * Sponsored onboarding (BUILD_PLAN §3): one transaction, source and fee-payer
 * TREASURY, that creates the worker account with 0 XLM and a USDC trustline,
 * both reserves sponsored. The worker signs on the phone; the server verifies
 * the signed envelope is exactly the one it built before submitting.
 */
export async function buildOnboardingTx(worker: string): Promise<{ xdr: string }> {
  const treasury = treasuryKeypair();
  const account = await loadAccount(treasury.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE_STROOPS,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(Operation.beginSponsoringFutureReserves({ sponsoredId: worker }))
    .addOperation(Operation.createAccount({ destination: worker, startingBalance: "0" }))
    .addOperation(Operation.changeTrust({ asset: usdcAsset(), source: worker }))
    .addOperation(Operation.endSponsoringFutureReserves({ source: worker }))
    .setTimeout(TX_TIMEOUT_SECONDS)
    .build();
  tx.sign(treasury);
  return { xdr: tx.toXDR() };
}

/**
 * Parse a signed onboarding envelope and assert it is shaped exactly like the
 * transaction buildOnboardingTx produces for this worker. Throws on any
 * mismatch. Pure apart from env reads — unit tested.
 */
export function verifyOnboardingXdr(signedXdr: string, worker: string): Transaction {
  const parsed = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  if (!(parsed instanceof Transaction)) {
    throw new Error("Onboarding envelope must be a plain transaction, not a fee bump");
  }
  const treasury = treasuryKeypair().publicKey();
  if (parsed.source !== treasury) {
    throw new Error("Onboarding transaction source is not the treasury");
  }
  if (parsed.operations.length !== 4) {
    throw new Error(`Onboarding transaction must have exactly 4 operations, got ${parsed.operations.length}`);
  }
  const [begin, create, trust, end] = parsed.operations;
  if (begin.type !== "beginSponsoringFutureReserves" || begin.sponsoredId !== worker) {
    throw new Error("Operation 1 must sponsor the worker's reserves");
  }
  if (
    create.type !== "createAccount" ||
    create.destination !== worker ||
    Number(create.startingBalance) !== 0 // XDR round-trips "0" as "0.0000000"
  ) {
    throw new Error("Operation 2 must create the worker account with 0 XLM");
  }
  const usdc = usdcAsset();
  if (
    trust.type !== "changeTrust" ||
    trust.source !== worker ||
    typeof trust.line === "string" ||
    !("code" in trust.line) ||
    trust.line.code !== usdc.getCode() ||
    trust.line.issuer !== usdc.getIssuer()
  ) {
    throw new Error("Operation 3 must add the USDC trustline for the worker");
  }
  if (trust.limit !== "922337203685.4775807") {
    throw new Error("Operation 3 must not lower the trustline limit");
  }
  if (end.type !== "endSponsoringFutureReserves" || end.source !== worker) {
    throw new Error("Operation 4 must end sponsoring as the worker");
  }
  return parsed;
}

function hasSignatureFrom(tx: Transaction, publicKey: string): boolean {
  const kp = Keypair.fromPublicKey(publicKey);
  const hash = Buffer.from(tx.hash());
  return tx.signatures.some((sig) => {
    try {
      // sig.signature is an xdr Signature instance (or an accessor in older
      // SDKs); Keypair.verify accepts it as-is — do NOT wrap in Buffer.from.
      const raw =
        typeof sig.signature === "function"
          ? (sig.signature as unknown as () => Buffer)()
          : (sig.signature as unknown as Buffer);
      return kp.verify(hash, raw);
    } catch {
      return false;
    }
  });
}

/** Verify the signed envelope, check both signatures, submit. Returns the tx hash. */
export async function submitOnboarding(
  signedXdr: string,
  worker: string,
): Promise<{ hash: string }> {
  const tx = verifyOnboardingXdr(signedXdr, worker);
  if (!hasSignatureFrom(tx, worker)) {
    throw new Error("Onboarding transaction is missing the worker's signature");
  }
  if (!hasSignatureFrom(tx, treasuryKeypair().publicKey())) {
    throw new Error("Onboarding transaction is missing the treasury signature");
  }
  return submit(tx);
}
