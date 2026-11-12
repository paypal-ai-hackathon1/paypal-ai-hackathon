# Early Relief

[![CI](https://github.com/DucPhamNgoc08/paypal-ai-hackathon/actions/workflows/ci.yml/badge.svg)](https://github.com/DucPhamNgoc08/paypal-ai-hackathon/actions/workflows/ci.yml)

**Get cash to families before the flood, not after it.**

Early Relief is anticipatory flood cash for Vietnam. A weather forecast crosses a rule that was locked before the season, AI reads the official Vietnamese warning bulletins and quotes its sources, a person reviews and approves the plan once, and **PayPal Payouts** sends the money to local partner organisations, who hand it to registered households before the water arrives.

Entry for the [PayPal AI Hackathon 2026](https://paypalaihackathon.devpost.com/).

- **Hosted demo:** _link added after deploy_
- **Video (under 3 min):** _link added after upload_

The demo replays **Typhoon Yagi** (September 2024, northern Vietnam) with simulated forecasts, bulletins, partners and households. Everything runs on the **PayPal sandbox**; no real money moves.

## The problem

Typhoon Yagi made landfall in northern Vietnam on 7 September 2024. Warnings of very heavy rain were issued days before, yet cash aid usually reaches families weeks after a flood, when the damage is done. Anticipatory action, paying a little money *before* a disaster on a pre-agreed trigger, is known to protect more for less, but organisers struggle with three things:

1. **Trust in the trigger.** Who decided this province gets paid, and was it changed after the fact?
2. **Speed with checks.** Bulletins are long Vietnamese text, household lists contain duplicates, and there are hours, not weeks.
3. **Getting money out.** Paying hundreds of households one by one is slow; local partners need a single, traceable payment.

## What it does

| Step | Who decides | What happens |
| --- | --- | --- |
| 1. Trigger | **Code** | A rule locked before the season ("$20 per household when the 48-hour forecast shows at least 150 mm of rain in 24 hours") is checked against each forecast. Quang Ninh and Hai Phong cross it 48 hours ahead, Thai Binh 24 hours ahead. |
| 2. Evidence | **AI**, checked by code | AI reads each Vietnamese warning bulletin and returns provinces, hazard, warning level, valid time, rainfall and wind, each with a verbatim quote. Code checks every quote against the bulletin; anything it cannot find is marked "Check this", anything the bulletin does not say stays empty. |
| 3. Amounts | **Code** | One payout line per partner: households × the rule's fixed amount, in integer cents. AI output never reaches this step. |
| 4. Review | **A person** | The review screen shows the rule, the forecasts against the threshold, the AI readings beside their source text, and every household with an Exclude button. Totals are recalculated by the server. |
| 5. Approve | **A person**, once | Approval restates the total and carries a fingerprint (hash) of the exact plan reviewed. If anything changed, PayPal is not called. A plan can only be paid once. |
| 6. Pay | **PayPal Payouts** | One sandbox Payouts batch per plan, one item per partner. The screen shows the batch ID and each partner's status in plain language until the money is received. |

## Try it

1. Open the hosted demo, or follow the local setup instructions below.
2. Press **Start Yagi replay** and watch forecasts and bulletins arrive. When the plan is ready, press **Review the payout plan**.
3. On the review screen, press **Read with AI** on a bulletin and compare each value with the highlighted quote.
4. **Exclude** a household and watch the partner total and plan total drop.
5. **Approve and send**, type your name, and confirm. Watch each partner go from "Sending" to "Received" and note the PayPal sandbox batch ID.
6. **Reset demo** starts over with a fresh scenario.

No account or key is needed to try the hosted demo. Locally, the app runs without any keys in mock mode (see below).

## Verified on the PayPal sandbox

| Date | What was tested | Result |
| --- | --- | --- |
| 2026-11-10 | OAuth token carries the Payouts scope | OK |
| 2026-11-10 | $1.00 Payouts batch to a sandbox personal account (`npm run check:payouts`) | Item `SUCCESS` within 120 s |
| 2026-11-10 | Payout to an address with no PayPal account | Item `UNCLAIMED` (`RECEIVER_UNREGISTERED`), funds return after 30 days |
| 2026-11-12 | Full flow in the app: create plan, exclude, stale-hash approval refused (409), approval, polling to `paid` | OK in mock mode; repeated on the hosted sandbox build before recording |

### Can partners in Vietnam receive PayPal Payouts?

PayPal's own pages list Vietnam as eligible for Payouts with "send, receive and withdraw", in USD (VND is not a PayPal API currency), with withdrawal to a local bank for a fee. That is why Early Relief pays **registered partner organisations**, not individual households. **We have not tested this with a real Vietnam-registered account**: everything here runs on the sandbox, and live use would need PayPal's approval. Details and sources: [docs/payouts-spike.md](docs/payouts-spike.md).

## How PayPal is used

| PayPal product / API | Where it is used | Why |
| --- | --- | --- |
| OAuth 2.0 client credentials | `src/lib/paypal.ts` | Server-side access token |
| **Payouts v1** (sandbox) | `src/lib/paypal.ts` (`createPayoutBatch`, `getPayoutBatch`), `src/lib/plans.ts` | One batch per approved plan, one item per partner. The plan ID is the `sender_batch_id`, so a retry cannot pay twice. Item statuses are polled and shown per partner |
| Webhooks + postback verification (optional) | `src/app/api/webhooks/paypal/route.ts`, `src/lib/payout-webhook.ts` | Verified payout events trigger a fresh batch read, so late refunds or reversals are recorded |
| Orders API v2 (sandbox) | `src/lib/paypal.ts`, `src/app/api/paypal/*` | Create and capture a payment. Built in the foundation and tested; not part of the relief flow shown in the demo |

## How AI is used

| Model / AI service | Where it is used | Why |
| --- | --- | --- |
| **Meta Model API, `muse-spark-1.3`** (any OpenAI-compatible model works, set by `AI_BASE_URL` / `AI_MODEL`) | `src/lib/ai-bulletin.ts`, `POST /api/bulletins/read` | Reads Vietnamese warning bulletins into provinces, hazard, warning level, valid time, rainfall and wind, each with a verbatim quote. Code checks every quote against the bulletin. Readings are evidence for the reviewer and never change who is paid |
| Same model, structured output | `chatJson` in `src/lib/ai.ts` | JSON checked by a hand-written validator, one retry with the error, then a fallback. Bulletin text is wrapped as `<data>` so instructions inside it are ignored |
| No key: pattern-matching reader | `mockReading` in `src/lib/ai-bulletin.ts` | Judges without a key still see evidence, through the same quote check |

On the 3 sample bulletins, `muse-spark-1.3` returned 16 values, all with quotes found verbatim in the text and none invented; it left 2 fields empty where the bulletin gave no clear value.

**AI tools used to build this:** Claude Code and OpenAI Codex helped write code, tests and docs. Commits they contributed to carry a `Co-authored-by` trailer. Every change went through a pull request, lint, typecheck, 184 unit tests and CI.

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
      bulletins/read/route.ts      AI reads a bulletin; every quote is checked against the text
      demo/reset/route.ts          start the demo over from a fresh scenario
      plans/[id]/explain/route.ts  AI explains the household flags and summarizes the plan
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
    ai-bulletin.ts            bulletin reader: AI values with verbatim quotes, checked by code
    payout-labels.ts          plain-language payout statuses and polling rules
    flags.ts                  household checks: same phone, same address, registration bursts
    ai-flags.ts               AI explains the flags and the plan from IDs and amounts only
tests/                        unit tests (no network)
scripts/check-sandbox.mjs     verifies real PayPal sandbox + AI credentials
scripts/check-payouts.mjs     sends a test Payouts batch on the sandbox
docs/                         architecture, deploy and design notes
render.yaml                   Render Blueprint for the hosted demo (one instance)
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

### Mock mode and keys

Every key is optional. Whatever is missing runs in mock mode, shown by a yellow badge in the header:

| Missing | What happens instead |
| --- | --- |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | Payouts return a `MOCK-BATCH-` ID; the first status read is pending, the next is received |
| `AI_API_KEY` | Bulletins are read by a pattern-matching reader, through the same quote check, and labeled as a sample |

To use the real sandbox, create an app in the [PayPal developer dashboard](https://developer.paypal.com/dashboard/applications/sandbox) and copy its client ID and secret. Its default **business** sandbox account sends the payouts. For `PARTNER_PAYPAL_EMAILS`, copy three **personal** sandbox account emails from **Sandbox accounts** in the same dashboard; without them, payouts go to `@example.com` addresses and end as "Not claimed". Judges do not need a PayPal login: the demo pays partners, so no buyer account is involved.

To host it yourself, see [docs/deploy.md](docs/deploy.md) (one Render web service).

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
