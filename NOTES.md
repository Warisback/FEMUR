# Notes

## Phases 4–7 (2026-09-23)

- Worker app, console, landing and director are built. The Playwright golden path passes: a real browser goes link → wallet → claim → photo → Gemini verify → **paid receipt in 41.6 s**, against real testnet and the real model.
- Two live failures during e2e were the system working correctly: a Gemini 503 routed to needs_review (then resolver-approve → paid, proving the human path), and the duplicate-photo check rejected the byte-identical test image (tests now jitter the colour). verify retries transient 429/503 twice before falling back to review.
- Console drives all progress via POST /api/tasks/tick-all every 2 s (sequential on purpose — parallel chain steps would race TREASURY's sequence number). Gate: middleware + /agent/unlock cookie; scripts use the x-admin-passcode header.
- Demo worker is provisioned by stellar:setup (secret in .env, onboarded on-chain, is_demo row). Director simulate actions need the five fixture photos in public/demo/ — still on the human.
- Not done (needs the human): Vercel deploy + Turso + Blob token (Phase 7), real-phone test of /work over mobile data, fixture photos + `pnpm ai:eval`, three live demo rehearsals, the fallback video, Trustless Work spike (API key).
- /dev/ui deleted per Phase 7; components live in real pages now.

### Before the demo

1. If testnet reset since last time: `pnpm stellar:setup`, re-fund TREASURY at https://faucet.circle.com (address printed by setup).
2. `pnpm db:push && pnpm db:seed` for a clean board; confirm `ESCROW_PROVIDER=native` in .env.
3. `pnpm dev`, open /agent (passcode in .env), test one task end to end — or run `pnpm flow:smoke` / `pnpm e2e` as the one-command health check.
4. Phone on mobile data, laptop tethered. ⌘⇧D in the console opens the director.

## Provider swap + first live end-to-end (2026-09-23)

- AI provider is now the Gemini API (`@google/genai`), per the user's key — a free-tier key: Pro-class models have zero quota (429 limit:0) and 3.7/3.8-flash shed load, so `VERIFY_MODEL=gemini-3.6-flash` is the best reliable model. Raise it when billing exists. Structured outputs via responseJsonSchema + zod; photos inline base64.
- TREASURY funded (20 USDC). `escrow:smoke` passes both paths. Fixed a real bug it caught: `DecoratedSignature.signature` is an xdr object that `Keypair.verify` takes as-is — wrapping in `Buffer.from` threw and read as "unsigned".
- **Full flow through the API passes live** (`pnpm flow:smoke`, dev server running): onboard 9.0 s (over the 8 s budget — testnet ledger close; revisit if it worsens), claim→funded 13.3 s total, and submit→paid **22.5 s** (budget ≤ 25 s) with Gemini genuinely verifying the photo.
- Before the demo: dev server + `pnpm flow:smoke` is the one-command health check of chain + model + API together.

## Phase 3

- Verification + mission drafting are built with the SDK's `messages.parse()` + `zodOutputFormat` (structured outputs AND zod validation in one call — the plan's `output_config.format` json_schema shape is what it produces underneath). `extracted` travels as a key/value array on the wire (structured outputs want closed object shapes) and is folded to a Record for storage.
- Decision rule, duplicate check and budget clamping are pure and unit-tested (decide(), clampDraft()); the model's verdict is stored for comparison only. Verify runs thinking-disabled on claude-sonnet-5, 25 s timeout, URL image with base64 fallback (local /uploads files always go base64 — Anthropic can't fetch localhost).
- **Blocked on the human:** ANTHROPIC_API_KEY (nothing AI runs without it) and the five fixture photos in public/demo/ for `pnpm ai:eval`. Until the key exists, every submission routes to needs_review with a verify_failed event — resolvable from the console, so the flow still demos.
- `outputFileTracingIncludes` ships the prompt .md files with Vercel bundles — check it survives the Phase 7 deploy.

## Phase 2

- Full data layer, state machine, tick engine and API are in, 65 unit tests green. Live-checked: seed → GET /api/tasks (6 open) → claim correctly policy-blocked with "treasury holds 0 USDC < reward 0.5".
- tick is split pure/impure: nextStep + runStep are pure (tested with fake provider/Horizon per the plan); tickTask does lock/persist. Verify is an injected dependency — until Phase 3 it throws, which by design routes submissions to needs_review with a verify_failed event.
- The double-pay guard is tested three ways: nextStep never re-selects release once release_tx is set, a forced re-run is a no-op, and for native escrow the account only ever holds one reward, so the network itself rejects a second release.
- Claim is made atomic with a conditional UPDATE (status='open'); a lost race is a 409. If escrow funding fails the task reverts to open with a network_rejected event.
- resolve is gated by ADMIN_PASSCODE (header or cookie) until the Phase 5 middleware; blob storage falls back to public/uploads when BLOB_READ_WRITE_TOKEN is unset so the flow works with no Vercel account.
- The full open→paid API run still needs faucet USDC (see Phase 1 note).

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
