import { createHmac } from "node:crypto";
import { Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  BASE_FEE_STROOPS,
  NETWORK_PASSPHRASE,
  toStellarAmount,
  treasuryKeypair,
  TX_TIMEOUT_SECONDS,
  usdcAsset,
} from "../stellar/config";
import { ChainError, submitWithRetry } from "../stellar/horizon";
import { getUsdcBalance } from "../stellar/payments";
import { explorerUrl } from "../stellar/explorer";
import type { EscrowChainStatus, EscrowProvider, EscrowTask } from "./provider";

/**
 * Fallback provider (BUILD_PLAN §3): a per-task escrow account, sponsored and
 * created by TREASURY, holding exactly the reward in USDC. Release pays the
 * worker from the escrow account; refund pays it back to TREASURY. TREASURY is
 * the fee payer for everything; the escrow account never needs XLM.
 *
 * The escrow key is derived, not stored: HMAC-SHA256 over the task id, keyed
 * by the treasury's raw seed. Same task id → same account, and nothing secret
 * touches the database.
 */
export function deriveEscrowKeypair(taskId: string): Keypair {
  const seed = createHmac("sha256", treasuryKeypair().rawSecretKey())
    .update(`legwork-escrow-v1:${taskId}`)
    .digest();
  return Keypair.fromRawEd25519Seed(seed);
}

export const nativeProvider: EscrowProvider = {
  name: "native",

  async create(task, worker) {
    void worker; // recorded on the task; the reward is locked regardless of who claims
    const treasury = treasuryKeypair();
    const escrow = deriveEscrowKeypair(task.id);
    const usdc = usdcAsset();
    const { hash } = await submitWithRetry({
      source: treasury.publicKey(),
      build: (account) => {
        const tx = new TransactionBuilder(account, {
          fee: BASE_FEE_STROOPS,
          networkPassphrase: NETWORK_PASSPHRASE,
        })
          .addOperation(
            Operation.beginSponsoringFutureReserves({ sponsoredId: escrow.publicKey() }),
          )
          .addOperation(
            Operation.createAccount({ destination: escrow.publicKey(), startingBalance: "0" }),
          )
          .addOperation(Operation.changeTrust({ asset: usdc, source: escrow.publicKey() }))
          .addOperation(Operation.endSponsoringFutureReserves({ source: escrow.publicKey() }))
          .addOperation(
            Operation.payment({
              destination: escrow.publicKey(),
              asset: usdc,
              amount: toStellarAmount(task.reward_usdc),
            }),
          )
          .setTimeout(TX_TIMEOUT_SECONDS)
          .build();
        tx.sign(treasury, escrow);
        return tx;
      },
    });
    return { escrowRef: escrow.publicKey(), txHash: hash };
  },

  async approve() {
    return null; // no approval step on the classic-operations path
  },

  async release(task) {
    if (!task.worker_address) {
      throw new Error(`Task ${task.id} has no worker to release to`);
    }
    return payFromEscrow(task, task.worker_address);
  },

  async refund(task) {
    return payFromEscrow(task, treasuryKeypair().publicKey());
  },

  async status(task): Promise<EscrowChainStatus> {
    if (!task.escrow_ref) return "pending";
    try {
      const balance = Number(await getUsdcBalance(task.escrow_ref));
      if (balance >= task.reward_usdc) return "funded";
      if (task.release_tx) return "released";
      if (task.refund_tx) return "refunded";
      return "pending";
    } catch (err) {
      if (err instanceof ChainError) return "pending"; // account not created yet
      throw err;
    }
  },

  explorerUrl(task) {
    return explorerUrl("account", task.escrow_ref ?? deriveEscrowKeypair(task.id).publicKey());
  },
};

/** Inner source = escrow (it pays the USDC); tx source = TREASURY (it pays the fee). */
async function payFromEscrow(task: EscrowTask, destination: string): Promise<{ txHash: string }> {
  const treasury = treasuryKeypair();
  const escrow = deriveEscrowKeypair(task.id);
  const { hash } = await submitWithRetry({
    source: treasury.publicKey(),
    build: (account) => {
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE_STROOPS,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          Operation.payment({
            source: escrow.publicKey(),
            destination,
            asset: usdcAsset(),
            amount: toStellarAmount(task.reward_usdc),
          }),
        )
        .setTimeout(TX_TIMEOUT_SECONDS)
        .build();
      tx.sign(treasury, escrow);
      return tx;
    },
  });
  return { txHash: hash };
}
