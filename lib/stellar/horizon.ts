import { Account, Horizon, Transaction } from "@stellar/stellar-sdk";
import { HORIZON_URL } from "./config";

export const horizon = new Horizon.Server(HORIZON_URL);

export interface ResultCodes {
  transaction?: string;
  operations?: string[];
}

/** Human-readable mapping of the Horizon result codes we can act on. */
export const RESULT_CODE_MESSAGES: Record<string, string> = {
  tx_bad_seq: "sequence number was stale (another transaction got in first)",
  tx_too_late: "transaction expired before it reached the ledger",
  tx_too_early: "transaction submitted before its time bounds",
  tx_insufficient_fee: "fee too low for current network traffic",
  tx_insufficient_balance: "source account cannot cover the fee",
  tx_bad_auth: "missing or invalid signature",
  tx_no_source_account: "source account does not exist (testnet may have reset)",
  tx_failed: "one of the operations failed",
  op_underfunded: "not enough of the asset in the paying account",
  op_no_destination: "destination account does not exist",
  op_no_trust: "destination has no trustline for the asset",
  op_src_no_trust: "source has no trustline for the asset",
  op_line_full: "destination trustline is full",
  op_low_reserve: "not enough XLM to meet the reserve",
  op_already_exists: "account already exists",
  op_malformed: "operation was malformed",
  op_no_issuer: "asset issuer does not exist",
  op_not_authorized: "not authorized to hold the asset",
  op_bad_auth: "operation is missing a required signature",
};

export function mapResultCodes(codes: ResultCodes | undefined): string {
  if (!codes) return "transaction rejected by the network";
  const parts: string[] = [];
  if (codes.transaction && codes.transaction !== "tx_failed") {
    parts.push(RESULT_CODE_MESSAGES[codes.transaction] ?? codes.transaction);
  }
  for (const op of codes.operations ?? []) {
    if (op === "op_success") continue;
    parts.push(RESULT_CODE_MESSAGES[op] ?? op);
  }
  if (parts.length === 0 && codes.transaction) {
    parts.push(RESULT_CODE_MESSAGES[codes.transaction] ?? codes.transaction);
  }
  return parts.join("; ") || "transaction rejected by the network";
}

export class ChainError extends Error {
  readonly codes: ResultCodes | undefined;
  constructor(message: string, codes?: ResultCodes) {
    super(message);
    this.name = "ChainError";
    this.codes = codes;
  }
  has(code: string): boolean {
    return (
      this.codes?.transaction === code ||
      (this.codes?.operations ?? []).includes(code)
    );
  }
}

// Horizon error payloads are untyped in the SDK; dig carefully.
export function extractResultCodes(err: unknown): ResultCodes | undefined {
  const data = (err as { response?: { data?: { extras?: { result_codes?: ResultCodes } } } })
    ?.response?.data;
  return data?.extras?.result_codes;
}

export async function loadAccount(accountId: string) {
  try {
    return await horizon.loadAccount(accountId);
  } catch (err) {
    if ((err as { response?: { status?: number } })?.response?.status === 404) {
      throw new ChainError(
        `Account ${accountId.slice(0, 4)}… not found on testnet (has the testnet reset? run pnpm stellar:setup)`,
      );
    }
    throw err;
  }
}

/** Submit a built, signed transaction. The hash is knowable before calling this. */
export async function submit(tx: Transaction): Promise<{ hash: string }> {
  const hash = Buffer.from(tx.hash()).toString("hex");
  try {
    await horizon.submitTransaction(tx);
    return { hash };
  } catch (err) {
    const codes = extractResultCodes(err);
    throw new ChainError(mapResultCodes(codes), codes);
  }
}

/**
 * Load the source account, build, submit — retrying once on tx_bad_seq /
 * tx_too_late with a fresh sequence number. `build` must return a signed tx.
 */
export async function submitWithRetry(opts: {
  source: string;
  build: (account: Account) => Transaction;
  attempts?: number;
}): Promise<{ hash: string }> {
  const attempts = opts.attempts ?? 2;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    const response = await loadAccount(opts.source);
    const account = new Account(opts.source, response.sequence);
    const tx = opts.build(account);
    try {
      return await submit(tx);
    } catch (err) {
      lastError = err;
      const retryable =
        err instanceof ChainError && (err.has("tx_bad_seq") || err.has("tx_too_late"));
      if (!retryable) throw err;
    }
  }
  throw lastError;
}

export type TxStatus = "success" | "failed" | "not_found";

export async function getTransactionStatus(hash: string): Promise<TxStatus> {
  try {
    const tx = await horizon.transactions().transaction(hash).call();
    return tx.successful ? "success" : "failed";
  } catch (err) {
    if ((err as { response?: { status?: number } })?.response?.status === 404) {
      return "not_found";
    }
    throw err;
  }
}

/** Blocking confirm for scripts. Route code uses getTransactionStatus per tick instead. */
export async function waitForTransaction(
  hash: string,
  timeoutMs = 30_000,
  intervalMs = 1_500,
): Promise<TxStatus> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await getTransactionStatus(hash);
    if (status !== "not_found") return status;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return "not_found";
}
