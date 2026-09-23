/**
 * End-to-end escrow smoke test against testnet (BUILD_PLAN Phase 1):
 * onboard a throwaway worker → create (fund) → approve → release, printing
 * each hash, explorer link and elapsed ms. Pass -refund to run the expiry
 * path (create → refund) instead.
 *
 * Requires TREASURY to hold USDC — run pnpm stellar:setup first.
 */
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { getEscrowProvider, type EscrowTask } from "../lib/escrow";
import { NETWORK_PASSPHRASE, treasuryKeypair } from "../lib/stellar/config";
import { explorerUrl } from "../lib/stellar/explorer";
import { getUsdcBalance } from "../lib/stellar/payments";
import { buildOnboardingTx, submitOnboarding } from "../lib/stellar/sponsor";

const REWARD = 0.5;

let last = Date.now();
function step(label: string, hash?: string) {
  const ms = Date.now() - last;
  last = Date.now();
  console.log(`✓ ${label} (${ms} ms)${hash ? `\n    tx ${hash}\n    ${explorerUrl("tx", hash)}` : ""}`);
}

async function main() {
  const refundPath = process.argv.includes("-refund");
  const provider = getEscrowProvider();

  const treasuryUsdc = Number(await getUsdcBalance(treasuryKeypair().publicKey()));
  if (treasuryUsdc < REWARD) {
    console.error(
      `TREASURY holds ${treasuryUsdc} USDC — not enough to lock ${REWARD}. Run pnpm stellar:setup for faucet instructions.`,
    );
    process.exit(1);
  }

  console.log(`Escrow provider: ${provider.name} · path: ${refundPath ? "refund" : "release"}`);
  last = Date.now();

  // 1. Sponsored onboarding of a throwaway worker — exactly the phone flow,
  //    except the script plays the phone and signs locally.
  const worker = Keypair.random();
  const { xdr } = await buildOnboardingTx(worker.publicKey());
  const clientTx = TransactionBuilder.fromXDR(xdr, NETWORK_PASSPHRASE);
  clientTx.sign(worker);
  const onboard = await submitOnboarding(clientTx.toXDR(), worker.publicKey());
  step(`onboarded worker ${worker.publicKey().slice(0, 4)}… (0 XLM needed)`, onboard.hash);

  // 2. Create + fund the escrow.
  const task: EscrowTask = {
    id: `smoke-${Date.now()}`,
    reward_usdc: REWARD,
    worker_address: worker.publicKey(),
    escrow_ref: null,
    release_tx: null,
    refund_tx: null,
  };
  const created = await provider.create(task, worker.publicKey());
  task.escrow_ref = created.escrowRef;
  step(`escrow created + funded with ${REWARD} USDC`, created.txHash);
  console.log(`    escrow: ${provider.explorerUrl(task)}`);

  const funded = await provider.status(task);
  if (funded !== "funded") throw new Error(`Expected status funded, got ${funded}`);
  step("status check: funded");

  if (refundPath) {
    const refunded = await provider.refund(task);
    task.refund_tx = refunded.txHash;
    step("refunded to treasury", refunded.txHash);
  } else {
    // 3. Approve (no-op on native) and release.
    const approved = await provider.approve(task);
    step(approved ? "milestone approved" : "approve: no-op for this provider", approved?.txHash);

    const released = await provider.release(task);
    task.release_tx = released.txHash;
    step(`released ${REWARD} USDC to the worker`, released.txHash);

    const workerBalance = await getUsdcBalance(worker.publicKey());
    if (Number(workerBalance) !== REWARD) {
      throw new Error(`Worker balance is ${workerBalance}, expected ${REWARD}`);
    }
    step(`worker balance verified: ${workerBalance} USDC`);
    console.log(`    worker: ${explorerUrl("account", worker.publicKey())}`);
  }

  console.log("\nSmoke test passed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
