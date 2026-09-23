import { Keypair, Memo, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  BASE_FEE_STROOPS,
  NETWORK_PASSPHRASE,
  toStellarAmount,
  TX_TIMEOUT_SECONDS,
  usdcAsset,
} from "./config";
import { loadAccount, submitWithRetry } from "./horizon";

/** Simple USDC payment where the sender is also the fee payer. */
export async function payUsdc(opts: {
  from: Keypair;
  to: string;
  amount: number | string;
  memo?: string;
}): Promise<{ hash: string }> {
  return submitWithRetry({
    source: opts.from.publicKey(),
    build: (account) => {
      const builder = new TransactionBuilder(account, {
        fee: BASE_FEE_STROOPS,
        networkPassphrase: NETWORK_PASSPHRASE,
      }).addOperation(
        Operation.payment({
          destination: opts.to,
          asset: usdcAsset(),
          amount: toStellarAmount(opts.amount),
        }),
      );
      if (opts.memo) builder.addMemo(Memo.text(opts.memo.slice(0, 28)));
      const tx = builder.setTimeout(TX_TIMEOUT_SECONDS).build();
      tx.sign(opts.from);
      return tx;
    },
  });
}

/** "0" when the account has no USDC trustline. */
export async function getUsdcBalance(accountId: string): Promise<string> {
  const usdc = usdcAsset();
  const account = await loadAccount(accountId);
  const line = account.balances.find(
    (b) =>
      (b.asset_type === "credit_alphanum4" || b.asset_type === "credit_alphanum12") &&
      b.asset_code === usdc.getCode() &&
      b.asset_issuer === usdc.getIssuer(),
  );
  return line ? line.balance : "0";
}

export async function getXlmBalance(accountId: string): Promise<string> {
  const account = await loadAccount(accountId);
  const line = account.balances.find((b) => b.asset_type === "native");
  return line ? line.balance : "0";
}
