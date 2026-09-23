# Notes

## Phase 1

- Stellar foundation + native escrow are built and unit-tested (21 tests). TREASURY/OPS exist on testnet with USDC trustlines; `stellar:setup` is idempotent and rewrites `.env` with generated secrets.
- **Blocked on the human:** TREASURY has 0 USDC — fund via https://faucet.circle.com (Stellar testnet) then run `pnpm escrow:smoke` and `pnpm escrow:smoke -refund`. Also still waiting on a Trustless Work API key; `trustlesswork.ts` fails fast until the spike happens. `ESCROW_PROVIDER=native` everywhere for now.
- Native escrow keys are derived (HMAC of task id keyed by treasury seed), never stored. Release/refund txs: TREASURY is tx source (pays the fee), escrow account is the payment op source.
- SDK v17 gotchas hit: `tx.hash()` is a `Uint8Array`, `AccountResponse` no longer satisfies `Account`, XDR round-trips amounts as 7-decimal strings ("0" → "0.0000000").
- tsx added (dev-only) to run `scripts/*.ts`; scripts use `main()` wrappers because tsx treats .ts as CJS (no top-level await) without `"type": "module"`.

## Phase 0

- Node wasn't on this machine; portable Node 24.21.0 LTS now lives at `%LOCALAPPDATA%\Programs\nodejs` (added to the user PATH), pnpm 12.4.1 via corepack. New terminals pick it up; already-open ones won't.
- pnpm 12 blocks dependency postinstall scripts by default — approvals live in `pnpm-workspace.yaml` (`allowBuilds`), not package.json.
- shadcn v4 changed under us: components are Base UI (base-nova preset), not Radix, and `cn` comes from the `cn` package. Fine for button/dialog/sheet/badge.
- Stayed strictly inside the §4 tokens, so the receipt is paper-on-paper with a line border and line-coloured perforation dots. If it doesn't pop on the projector, the call to make before Phase 4 is whether receipt paper gets its own white token.
- `.env` is local-only: `NETWORK=testnet`, `ESCROW_PROVIDER=native` (no Trustless Work key yet), secrets blank until Phase 1.
- Before the demo: nothing yet — chain work starts in Phase 1.

## Dev environment (this machine)

- The repo lives inside OneDrive, which was syncing/scanning all 62k node_modules files (OneDrive had burned 13+ h of CPU). Fix: `node_modules` and `.next` are NTFS junctions to `C:\Users\yussu\dev\femur-cache` — OneDrive can't follow junctions. Turbopack needs `TURBOPACK_ROOT=C:\Users\yussu` in `.env` for this (wired in next.config.ts; unset in prod). If node_modules ever looks broken: `pnpm install` repairs it.
- The durable fix is moving the repo out of OneDrive (it's on GitHub now, so OneDrive sync is redundant and it risks corrupting `.git`). If moved, delete the junctions and the TURBOPACK_ROOT line first, then `pnpm install`.
- Port 3000 is often taken by other local apps (Codex-run projects); `next dev` auto-picks 3002+. Check the port the terminal prints before opening the browser.
- Added `viewport: { colorScheme: "light", themeColor: "#f6f5f0" }` so dark-mode browsers don't flash a black canvas while loading.
