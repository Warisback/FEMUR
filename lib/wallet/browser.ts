// Client-only. The worker's keypair lives in localStorage and never leaves
// the phone (CLAUDE.md non-negotiable 2). Browser signing uses
// @stellar/stellar-base only — no SDK, no network access from here.
import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-base";

const STORAGE_KEY = "legwork.wallet.v1";

// Testnet only (boot asserts NETWORK=testnet server-side).
const PASSPHRASE = Networks.TESTNET;

interface StoredWallet {
  publicKey: string;
  secret: string;
}

function read(): StoredWallet | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredWallet;
    return parsed.publicKey && parsed.secret ? parsed : null;
  } catch {
    return null;
  }
}

/** Create on first visit, load thereafter. Returns the public key. */
export function ensureWallet(): string {
  const existing = read();
  if (existing) return existing.publicKey;
  const kp = Keypair.random();
  const wallet: StoredWallet = { publicKey: kp.publicKey(), secret: kp.secret() };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(wallet));
  return wallet.publicKey;
}

export function walletAddress(): string | null {
  return read()?.publicKey ?? null;
}

/** Countersign a server-built envelope (sponsored onboarding). */
export function signXdr(xdr: string): string {
  const wallet = read();
  if (!wallet) throw new Error("no wallet on this device yet");
  const tx = TransactionBuilder.fromXDR(xdr, PASSPHRASE);
  tx.sign(Keypair.fromSecret(wallet.secret));
  return tx.toXDR();
}
