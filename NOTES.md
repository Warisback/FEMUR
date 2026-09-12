# Notes

## Phase 0

- Node wasn't on this machine; portable Node 24.21.0 LTS now lives at `%LOCALAPPDATA%\Programs\nodejs` (added to the user PATH), pnpm 12.4.1 via corepack. New terminals pick it up; already-open ones won't.
- pnpm 12 blocks dependency postinstall scripts by default — approvals live in `pnpm-workspace.yaml` (`allowBuilds`), not package.json.
- shadcn v4 changed under us: components are Base UI (base-nova preset), not Radix, and `cn` comes from the `cn` package. Fine for button/dialog/sheet/badge.
- Stayed strictly inside the §4 tokens, so the receipt is paper-on-paper with a line border and line-coloured perforation dots. If it doesn't pop on the projector, the call to make before Phase 4 is whether receipt paper gets its own white token.
- `.env` is local-only: `NETWORK=testnet`, `ESCROW_PROVIDER=native` (no Trustless Work key yet), secrets blank until Phase 1.
- Before the demo: nothing yet — chain work starts in Phase 1.
