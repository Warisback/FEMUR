export type EscrowChainStatus = "pending" | "funded" | "released" | "refunded" | "failed";

/**
 * The slice of a task an escrow provider needs. The db tasks row satisfies
 * this; scripts can pass a hand-made object.
 */
export interface EscrowTask {
  id: string;
  reward_usdc: number;
  worker_address: string | null;
  escrow_ref: string | null;
  release_tx: string | null;
  refund_tx: string | null;
}

export interface EscrowProvider {
  name: "trustlesswork" | "native";
  /** Deploy + fund (TW), or create + fund a per-task account (native). */
  create(task: EscrowTask, worker: string): Promise<{ escrowRef: string; txHash: string }>;
  /** null = no-op for this provider (native). */
  approve(task: EscrowTask): Promise<{ txHash: string } | null>;
  release(task: EscrowTask): Promise<{ txHash: string }>;
  /** Expiry only — a reject keeps the escrow funded for the retry. */
  refund(task: EscrowTask): Promise<{ txHash: string }>;
  status(task: EscrowTask): Promise<EscrowChainStatus>;
  /** Contract or account page on the explorer. */
  explorerUrl(task: EscrowTask): string;
}
