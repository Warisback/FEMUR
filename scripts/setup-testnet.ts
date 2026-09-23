/**
 * Idempotent testnet setup (BUILD_PLAN Phase 1):
 *  - create or load TREASURY and OPS from env (generated keys are written to .env)
 *  - Friendbot both accounts if they don't exist
 *  - add the USDC trustline to both
 *  - print addresses, balances, explorer links and faucet instructions
 *
 * Safe to re-run any time, especially after a testnet reset.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Keypair, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import {
  BASE_FEE_STROOPS,
  FRIENDBOT_URL,
  NETWORK_PASSPHRASE,
  TX_TIMEOUT_SECONDS,
  usdcAsset,
} from "../lib/stellar/config";
import { explorerUrl } from "../lib/stellar/explorer";
import { horizon, submitWithRetry } from "../lib/stellar/horizon";
import { getUsdcBalance, getXlmBalance } from "../lib/stellar/payments";

const ENV_PATH = new URL("../.env", import.meta.url);

function upsertEnvVar(name: string, value: string) {
  let text = "";
  try {
    text = readFileSync(ENV_PATH, "utf8");
  } catch {
    // no .env yet — create one
  }
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  const next = pattern.test(text)
    ? text.replace(pattern, line)
    : `${text.trimEnd()}\n${line}\n`;
  writeFileSync(ENV_PATH, next);
}

function loadOrCreateKeypair(envName: string): { kp: Keypair; created: boolean } {
  const secret = process.env[envName];
  if (secret) return { kp: Keypair.fromSecret(secret), created: false };
  const kp = Keypair.random();
  upsertEnvVar(envName, kp.secret());
  return { kp, created: true };
}

async function accountExists(publicKey: string): Promise<boolean> {
  try {
    await horizon.loadAccount(publicKey);
    return true;
  } catch {
    return false;
  }
}

async function friendbot(publicKey: string) {
  const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(publicKey)}`);
  if (!res.ok && res.status !== 400) {
    throw new Error(`Friendbot failed for ${publicKey}: ${res.status} ${await res.text()}`);
  }
}

async function ensureUsdcTrustline(kp: Keypair): Promise<boolean> {
  const balance = await getUsdcBalance(kp.publicKey()).catch(() => null);
  if (balance !== null && balance !== "0") return false;
  const account = await horizon.loadAccount(kp.publicKey());
  const usdc = usdcAsset();
  const hasLine = account.balances.some(
    (b) =>
      (b.asset_type === "credit_alphanum4" || b.asset_type === "credit_alphanum12") &&
      b.asset_code === usdc.getCode() &&
      b.asset_issuer === usdc.getIssuer(),
  );
  if (hasLine) return false;
  await submitWithRetry({
    source: kp.publicKey(),
    build: (acc) => {
      const tx = new TransactionBuilder(acc, {
        fee: BASE_FEE_STROOPS,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(Operation.changeTrust({ asset: usdc }))
        .setTimeout(TX_TIMEOUT_SECONDS)
        .build();
      tx.sign(kp);
      return tx;
    },
  });
  return true;
}

async function setupAccount(label: string, envName: string) {
  const { kp, created } = loadOrCreateKeypair(envName);
  const pub = kp.publicKey();
  if (created) console.log(`${label}: generated new keypair, secret written to .env`);

  if (!(await accountExists(pub))) {
    console.log(`${label}: funding via Friendbot…`);
    await friendbot(pub);
  }
  const addedTrustline = await ensureUsdcTrustline(kp);
  if (addedTrustline) console.log(`${label}: added USDC trustline`);

  const [xlm, usdc] = await Promise.all([getXlmBalance(pub), getUsdcBalance(pub)]);
  console.log(`${label}: ${pub}`);
  console.log(`  XLM ${xlm} · USDC ${usdc}`);
  console.log(`  ${explorerUrl("account", pub)}`);
  return { pub, usdc };
}

async function main() {
  const treasury = await setupAccount("TREASURY", "TREASURY_SECRET");
  await setupAccount("OPS", "OPS_SECRET");

  if (Number(treasury.usdc) === 0) {
    console.log("\nTREASURY holds no USDC yet. Fund it with testnet USDC:");
    console.log("  1. Open https://faucet.circle.com");
    console.log("  2. Pick USDC on Stellar Testnet");
    console.log(`  3. Paste the TREASURY address: ${treasury.pub}`);
    console.log("  (10 USDC per request; ~20 USDC covers the demo mission)");
  } else {
    console.log(`\nTREASURY is funded with ${treasury.usdc} USDC — ready for pnpm escrow:smoke.`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
