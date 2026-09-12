const USDC_MAX_DECIMALS = 7; // Stellar asset precision

/** "0.50", "20.00" — at least 2 decimals, up to 7, trailing zeros trimmed. */
export function formatUsdc(amount: number | string): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "0.00";
  const trimmed = n.toFixed(USDC_MAX_DECIMALS).replace(/0+$/, "");
  const [whole, frac = ""] = trimmed.split(".");
  return `${whole}.${frac.padEnd(2, "0")}`;
}

/** "GABC…WXYZ" */
export function shortAddress(address: string): string {
  if (address.length <= 9) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

/** "9f3a…c21e" */
export function shortHash(hash: string): string {
  if (hash.length <= 9) return hash;
  return `${hash.slice(0, 4)}…${hash.slice(-4)}`;
}

/** "5.8 s" under ten seconds, "16 s" above. */
export function formatDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)} s`;
  return `${Math.round(s)} s`;
}
