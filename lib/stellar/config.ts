import { Asset, Keypair, Networks } from "@stellar/stellar-sdk";

// Server-side only. Never import from client components — explorer.ts is the
// one browser-safe module in this folder.

if (process.env.NETWORK !== "testnet") {
  throw new Error(
    `Legwork runs on Stellar testnet only. Set NETWORK=testnet in the environment (got "${process.env.NETWORK ?? "unset"}").`,
  );
}

export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const HORIZON_URL = "https://horizon-testnet.stellar.org";
export const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
export const FRIENDBOT_URL = "https://friendbot.stellar.org";

/** Max fee per operation, in stroops. */
export const BASE_FEE_STROOPS = "1000";

/** Transactions are valid for 5 minutes. */
export const TX_TIMEOUT_SECONDS = 300;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Run pnpm stellar:setup or fill in .env.`);
  }
  return value;
}

export function usdcAsset(): Asset {
  return new Asset(requireEnv("USDC_CODE"), requireEnv("USDC_ISSUER"));
}

export function treasuryKeypair(): Keypair {
  return Keypair.fromSecret(requireEnv("TREASURY_SECRET"));
}

export function opsKeypair(): Keypair {
  return Keypair.fromSecret(requireEnv("OPS_SECRET"));
}

/** "0.50" | 0.5 → "0.5" — Stellar amount string, max 7 decimals. */
export function toStellarAmount(amount: number | string): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid Stellar amount: ${amount}`);
  }
  return n.toFixed(7).replace(/\.?0+$/, "");
}
