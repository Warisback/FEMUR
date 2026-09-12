# Legwork

An AI agent posts real-world micro-tasks, a person does one from their phone, Claude verifies the photo, and escrowed USDC on Stellar testnet is released to them with a receipt.

The spec, architecture, design tokens and phase order live in `BUILD_PLAN.md`. Read it before doing anything, then work one phase at a time. This file is only the standing rules.

## Commands

`pnpm dev` · `pnpm typecheck` · `pnpm test` · `pnpm db:push` · `pnpm db:seed` · `pnpm stellar:setup` · `pnpm escrow:smoke` · `pnpm ai:eval` (hits the Claude API, not in CI) · `pnpm e2e`

## Non-negotiables

1. **Money.** Amounts, recipients and state transitions come from the database and `lib/tasks/machine.ts` — never from model output, never from request bodies. `release` is idempotent and can never run twice for a task (`release_tx` is written before submit and never retried).
2. **Keys.** `TREASURY_SECRET`, `OPS_SECRET`, `DEMO_WORKER_SECRET` exist only in server env. Worker secrets never leave the browser. Never log a secret, a signed XDR, or anything matching `S[A-Z0-9]{55}`.
3. **Chain access** goes through `lib/stellar/*` and `lib/escrow/*` only. No Horizon, RPC or Trustless Work calls from routes or components.
4. **Long work is a tick step** (BUILD_PLAN §3). No background loops, `setTimeout` jobs or queues. Each step finishes in under 10 s.
5. **Testnet only.** Boot asserts `NETWORK=testnet`. No mainnet URLs anywhere in the repo.
6. **Every Claude call uses structured outputs** and is still validated with zod. Model `claude-sonnet-5`; no `temperature`/`top_p`; verification runs with thinking disabled.
7. **UI uses only the tokens in BUILD_PLAN §4.** No new colours, fonts, shadows or gradients. Colour means escrow state and nothing else.
8. **Dependencies** stay within the stack list in BUILD_PLAN §3. Ask before adding one. Schema changes come with a migration and updated tests.

## Working rules

- Begin a phase by re-reading its section. End it with `pnpm typecheck && pnpm test` green, a commit `phase-N: <summary>`, and 3–6 lines in `NOTES.md`.
- If a feature isn't in BUILD_PLAN §2 "In", don't build it. Prefer deleting to adding.
- When an API or tool differs from the plan, edit `BUILD_PLAN.md` so it stays true. Don't work around it silently.
- Stop and ask when: a secret or paid account is needed; a step is over its timing budget by 2×; the Trustless Work API shape differs from §3; a design or product call isn't covered.
- Test on a real phone for anything under `app/work`.

## Where things are

- `app/work/*` worker (mobile) · `app/agent/*` console · `app/api/*` routes
- `lib/stellar` chain primitives · `lib/escrow` provider interface + `native.ts` + `trustlesswork.ts`
- `lib/ai` verification + mission drafting · `lib/tasks` state machine, tick, policy, metrics, expiry
- `lib/wallet/browser.ts` client-only keypair · `components/receipt.tsx` the one memorable element
- `scripts/*` setup, seed, smoke, eval, reset · `public/demo/*` fixture photos · `tests/unit`, `tests/e2e`

## External docs

Listed in BUILD_PLAN §9. Stellar context is available through the Raven MCP server once added; use it before writing Stellar code you're unsure about.
