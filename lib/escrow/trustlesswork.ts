import type { EscrowProvider } from "./provider";

/**
 * Primary provider per BUILD_PLAN §3 — Soroban escrow via the Trustless Work
 * REST API. NOT YET IMPLEMENTED: the Phase 1 spike needs a Trustless Work API
 * key (Stop & ask) to confirm endpoint paths and field names against testnet
 * before this is written. Until then every method fails fast and loudly;
 * run with ESCROW_PROVIDER=native.
 */
function notImplemented(): never {
  throw new Error(
    "Trustless Work provider is not implemented yet (waiting on an API key — see NOTES.md). Set ESCROW_PROVIDER=native.",
  );
}

export const trustlessWorkProvider: EscrowProvider = {
  name: "trustlesswork",
  create: notImplemented,
  approve: notImplemented,
  release: notImplemented,
  refund: notImplemented,
  status: notImplemented,
  explorerUrl: notImplemented,
};
