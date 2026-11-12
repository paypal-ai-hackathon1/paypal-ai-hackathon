# PayPal AI Hackathon 2026

[![CI](https://github.com/DucPhamNgoc08/paypal-ai-hackathon/actions/workflows/ci.yml/badge.svg)](https://github.com/DucPhamNgoc08/paypal-ai-hackathon/actions/workflows/ci.yml)

Work-in-progress entry for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) (Oct–Nov 2026).

The product idea is not public yet. This repository currently holds the foundation: a Next.js app with the PayPal sandbox and an AI model wired in end to end, tests, and CI.

## What works today

- **Landing page and Typhoon Yagi replay:** the home page explains the product and replays September 2024 step by step: forecasts checked against the locked rule, simulated warning bulletins, and the moment a payout plan is ready for review.
- **PayPal checkout (sandbox):** create an order, send the buyer to PayPal to approve it, capture the payment on return.
- **AI chat endpoint:** sends a prompt to any OpenAI-compatible chat completions API and returns the reply.
- **Runs without keys:** each integration falls back to mock mode when its credentials are missing, shown by a yellow badge on the home page.

## How PayPal is used

| PayPal product / API | Where it is used | Why |
| --- | --- | --- |
| OAuth 2.0 client credentials | `src/lib/paypal.ts` | Server-side access token |
| Orders API v2 (sandbox) | `src/lib/paypal.ts` | Create and capture payments |
| Payouts v1 (sandbox) | `src/lib/paypal.ts` (`createPayoutBatch`, `getPayoutBatch`) | Send one batch per approved plan, one item per partner, and read each item's status. The plan ID is the `sender_batch_id`, so a retry cannot pay twice |

## How AI is used

| Model / AI service | Where it is used | Why |
| --- | --- | --- |
| Any OpenAI-compatible model, set by `AI_MODEL` | `src/lib/ai.ts`, `src/app/api/ai/route.ts` | Chat completions behind a server-side route |
| Same model, structured output | `chatJson` in `src/lib/ai.ts` | Every AI feature gets JSON checked by a hand-written validator, with one retry and a template fallback. Outside text is wrapped as data so instructions inside it are ignored |

## Architecture

Diagrams of the components and the payment flow: [docs/architecture.md](docs/architecture.md).

```
src/
  app/
    page.tsx                  landing page
    replay-timeline.tsx       step-by-step scenario replay (client)
    start-review-button.tsx   creates the plan for the locked rule and opens its review
    plans/[id]/               plan review: rule and forecasts, AI readings beside their source
                              text, per-partner totals, flagged households and Exclude,
                              then one-time approval and live payout status per partner
    api/
      health/route.ts         which integrations are live (no secrets)
      ai/route.ts             AI endpoint
      paypal/orders/route.ts  create a PayPal order
      paypal/return/route.ts  PayPal redirects here, payment is captured
      rules/[id]/lock/route.ts  a person locks a reviewed draft rule
      plans/route.ts            create the payout plan for a locked rule
      plans/[id]/route.ts       read a plan with its partners, households (masked) and counts
      plans/[id]/exclude/route.ts  take a household out of a plan under review
      plans/[id]/approve/route.ts  approve once and send the Payouts batch
      plans/[id]/status/route.ts   poll PayPal and reconcile each partner's status
      webhooks/paypal/route.ts     verify PayPal events and refresh their batch
  data/scenarios/             replay fixtures (Typhoon Yagi, simulated households)
  lib/
    env.ts                    config + mock-mode detection
    domain.ts                 shared domain types (money in integer cents)
    store.ts                  in-memory demo store on globalThis, resetScenario()
    paypal.ts                 PayPal REST client (sandbox)
    ai.ts                     OpenAI-compatible chat client
    rate-limit.ts             per-IP rate limiting for public API routes
    rules.ts                  deterministic rules engine: triggers and payout amounts, no AI
    replay.ts                 builds the replay timeline from a scenario fixture
    plans.ts                  plan lifecycle: create, exclude, approve once (plan hash, cap)
    payout-status.ts          client-safe status merging and needs-attention statuses
    payout-webhook.ts         verified, deduplicated payout event handling
    plan-review.ts            everything the review screen shows, gathered on the server
    format.ts                 client-safe money and quote-matching helpers
    payout-labels.ts          plain-language payout statuses and polling rules
tests/                        unit tests (no network)
scripts/check-sandbox.mjs     verifies real PayPal sandbox + AI credentials
scripts/check-payouts.mjs     sends a test Payouts batch on the sandbox
docs/                         architecture and design notes
SUBMIT.md                     Devpost submission kit and checklist
.github/workflows/ci.yml      CI: lint, typecheck, tests and build on every push
.husky/                       git hooks: lint on commit, typecheck + tests on push
AGENTS.md, CLAUDE.md          workflow and rules for contributors and AI coding agents
```

## Getting started

### Prerequisites

- Node.js 22.9 or newer
- Optional: a free [PayPal Developer](https://developer.paypal.com/) account (sandbox)
- Optional: an API key for any OpenAI-compatible AI provider

### Run it

```bash
git clone https://github.com/DucPhamNgoc08/paypal-ai-hackathon.git
cd paypal-ai-hackathon
npm install
cp .env.example .env.local   # optional, fill in keys
npm run dev
```

Open http://localhost:3000.

### Useful commands

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests, no network or keys needed |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run check:sandbox` | Calls the real PayPal sandbox and AI provider with the keys in `.env.local` and prints a sandbox approval link |
| `npm run check:payouts -- --email <sandbox email>` | Sends a $1.00 sandbox Payouts batch and waits for its status. See [docs/payouts-spike.md](docs/payouts-spike.md) |

## Payout status and webhooks

After approval, call `GET /api/plans/<id>/status`. It returns `{ plan }`, checks each partner's payout, and works without a webhook. In mock mode, the first status read is `payout_pending` and the next is `paid`.

- While any item is pending, the plan stays `payout_pending`. The UI can highlight individual attention statuses using `NEEDS_ATTENTION` from `src/lib/payout-status.ts`.
- All items must be `SUCCESS` for the plan to become `paid`; a batch-level `SUCCESS` alone is insufficient. Settled non-success items, or a denied/canceled batch, produce `needs_attention`.
- Polling stops fetching paid plans. A later verified webhook can still record refunds or reversals. Without webhooks, late changes after `paid` require checking the PayPal sandbox directly.
- Status reads run one at a time for each plan, shared across polling and webhooks. A webhook waits for an in-flight poll and then performs a fresh read, so an old response cannot overwrite a refund or denied batch. Different plans remain independent; a failed read does not block retries, and a reset rejects queued reads with 409.

Webhooks are optional:

1. Deploy one server instance with a public HTTPS URL.
2. In the sandbox app's PayPal developer dashboard, register `https://<your-host>/api/webhooks/paypal`. Subscribe to the [Payouts batch and item events](https://developer.paypal.com/payouts/webhooks/).
3. Set `PAYPAL_WEBHOOK_ID` to that registration's ID, alongside the sandbox client credentials. Keep it empty to use polling alone.
4. Trigger a real sandbox Payouts batch and verify delivery. PayPal's [webhook simulator does not support postback signature verification](https://developer.paypal.com/api/rest/webhooks/rest/), so simulator messages are not proof that this path works.

`POST /api/webhooks/paypal` verifies the original event with PayPal before changing a plan, then reads the current batch using the same reconciliation as polling. This avoids trusting stale event status fields. Failed verification returns 400; transient upstream failures return 502 so delivery can retry. Completed event IDs are deduplicated, including concurrent deliveries. Deduplication is bounded and lives in memory for the current scenario; resets and restarts clear it. Bodies are limited to 64 KiB of UTF-8 bytes.

## Development workflow

Every change goes through a short-lived branch and a pull request into `main`, with Conventional Commit messages and squash merges. Git hooks lint each commit and run typecheck and tests before each push; CI repeats the full check on GitHub. The full rules, written for both humans and AI coding agents, are in [AGENTS.md](AGENTS.md).

## Security and scope

- Runs against the **PayPal sandbox only**. No real money moves.
- PayPal and AI keys are read on the server (`src/lib/env.ts`) and never sent to the browser.
- `.env.local` is git-ignored; only `.env.example` with empty values is committed.
- Captures send a `PayPal-Request-Id` derived from the order id, so retrying a capture does not charge twice.
- API routes validate input (amount range, currency code, prompt length) and apply a per-IP rate limit, so a public demo cannot be used to burn the AI key. The limit is in-memory, so on serverless hosts it is best-effort.
- Error responses do not echo upstream error bodies; details go to the server log.
- Approval is the only step that moves money. The approver must send the hash of the plan they reviewed, a plan is paid at most once (a repeat or simultaneous approval sends nothing new), and a plan over $1,000 is refused so a public demo cannot drain the sandbox balance.
- **No login in the demo:** anyone with the URL can approve a plan. The approver types a name, which is recorded on the plan. A real deployment needs authentication in front of the approve route.
- Plan mutation routes reject malformed or non-object JSON with 400. A stale plan hash is rejected before, during and after payout submission; matching approval retries return the existing result without sending again.
- If the demo is reset while a payout request is in flight, approval returns 409. Check the PayPal sandbox before starting a new replay: resetting the in-memory store does not cancel a payout already accepted by PayPal.

## License

[MIT](LICENSE)
