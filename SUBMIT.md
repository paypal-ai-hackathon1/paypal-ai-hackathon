# Submission kit: PayPal AI Hackathon (Devpost)

Deadline: **Nov 12, 2026, 12:00 PM PST** (Nov 13, 03:00 AM Vietnam time).

Rules: https://paypalaihackathon.devpost.com/rules

All submission material must be in English. Copy the fields below into the Devpost form.

## A. Devpost fields

**Project name:** Early Relief

**Tagline:** Anticipatory flood cash for Vietnam: AI reads the warnings, code decides, a person approves once, PayPal Payouts pays local partners before the water arrives.

**Inspiration**

Typhoon Yagi made landfall in northern Vietnam on 7 September 2024. Heavy rain warnings were out days before, but cash aid usually reaches families weeks after a flood. Anticipatory action, paying a small amount on a trigger agreed in advance, lets families move belongings, buy food and leave in time. What stops organisers is trust and speed: who decided this province gets paid, can the trigger be changed afterwards, and how do you check long Vietnamese bulletins and household lists in a few hours? We wanted AI to make that faster without ever letting it decide who gets money.

**What it does**

Early Relief replays Typhoon Yagi with simulated data:

1. **Trigger (code):** a rule locked before the season, "$20 per registered household when the forecast made up to 48 hours ahead shows at least 150 mm of rain in 24 hours", is checked against each forecast. Quang Ninh and Hai Phong cross it 48 hours ahead, Thai Binh 24 hours ahead.
2. **Evidence (AI, checked by code):** AI reads each Vietnamese warning bulletin and returns provinces, hazard, warning level, valid time, rainfall and wind, each with a verbatim quote. Code checks every quote against the bulletin. A value whose quote is not in the text is marked "Check this"; a value the bulletin does not state stays empty.
3. **Amounts (code):** one payout line per local partner, households × the fixed amount, in integer cents. AI output never reaches this step.
4. **Review (person):** the review screen puts the locked rule, the forecasts against the threshold, the AI readings beside their source text, and every household with an Exclude button on one page. Totals are recalculated by the server.
5. **Approve once (person):** approval restates the total and sends a fingerprint (hash) of the exact plan reviewed. If the plan changed, PayPal is not called. A plan can only be paid once, and a plan over $1,000 is refused.
6. **Pay (PayPal Payouts):** one sandbox Payouts batch per plan, one item per partner. The screen shows the PayPal batch ID and each partner's status in plain language ("Sending", "Received", "Not claimed") until the money arrives.

Payouts go to registered partner organisations, which hand cash to households. That matches what Payouts is for and keeps it clear of person-to-person use.

**How we built it**

- Next.js 16 (App Router), TypeScript and Tailwind CSS 4, deployed as one Render web service.
- **PayPal products / APIs:**
  - **Payouts v1 (sandbox):** `createPayoutBatch` sends one batch per approved plan with the plan ID as `sender_batch_id`, so a retry cannot pay twice. `getPayoutBatch` reads per-partner item statuses, which the review screen polls with back-off until a final status.
  - **OAuth 2.0** client credentials, server side.
  - **Webhooks with postback signature verification** (optional): a verified payout event triggers a fresh batch read, so late refunds or reversals are recorded.
  - Orders v2 create and capture were built and tested in the foundation but are not in the relief flow.
- **AI models / services:**
  - **Meta Model API, `muse-spark-1.3`**, through its OpenAI-compatible chat completions endpoint. It reads Vietnamese bulletins into structured JSON with a quote per value. Any OpenAI-compatible model can be swapped in with `AI_BASE_URL` and `AI_MODEL`.
  - A `chatJson` helper validates every reply with a hand-written validator, retries once with the error, and fails closed. Bulletin text is wrapped as `<data>` with a policy that instructions inside it are ignored.
  - Without a key, a pattern-matching reader produces the same shape through the same quote check, so the demo works for anyone.
- **AI tools used to build it:** Claude Code and OpenAI Codex helped write code, tests and docs. Their commits carry `Co-authored-by` trailers. Every change went through a pull request with lint, typecheck, unit tests (184) and CI.
- **Sponsor tools:** none.

**Challenges we ran into**

- Keeping AI useful but powerless. We split the system so the rules engine has no AI imports, and every AI value must quote its source sentence and pass a code check before it is shown as confirmed.
- Paying exactly once. Double clicks, stale browser tabs, PayPal timeouts and retries all had to end in at most one batch. The plan hash, a shared in-flight approval, and the plan ID as `sender_batch_id` together cover those cases.
- Payout statuses arrive late and out of order. Polling and webhooks share one reconciliation path per plan, and a settled item never goes back to pending.
- Free AI models were rate limited upstream during testing, so the reader fails gracefully and the screen stays usable.

**Accomplishments we're proud of**

- The review screen: every number on it can be traced to a locked rule, a forecast, a quoted sentence or a person's action.
- A real sandbox Payouts batch, verified per partner, from one approval.
- It runs end to end with no keys at all, so anyone can clone it and try it.

**What we learned**

- PayPal's pages list Vietnam as eligible for Payouts ("send, receive and withdraw") in USD, with withdrawal to a local bank for a fee. We have **not** tested a real Vietnam-registered account; everything ran on the sandbox, and live relief use would need PayPal's approval. Details and sources are in `docs/payouts-spike.md`.
- A batch-level `SUCCESS` does not mean each recipient was paid. Only item statuses tell you that.
- Asking a model for quotes, then checking them in code, is a cheap and effective guard against invented values.

**What's next**

- Partner confirmation page with one-time receipt codes, and sampled phone callbacks.
- Duplicate and spike checks on household lists, with AI-written explanations for reviewers.
- A donor report whose numbers are checked against recorded payouts.
- Live forecast data instead of the replay, and a pilot with a Vietnamese relief organisation.

**Built with (tags):** nextjs, react, typescript, tailwindcss, paypal, paypal-payouts, meta-model-api, llm, vitest, render

**Links:**
- Public repo: https://github.com/paypal-ai-hackathon1/paypal-ai-hackathon
- Hosted demo: https://early-relief.onrender.com
- YouTube video: https://youtu.be/uHITj_zxDDo

**Testing instructions**

Open the hosted demo, press **Start Yagi replay**, then **Review the payout plan**. On the review screen, try **Read with AI**, **Exclude** a household, then **Approve and send** with any name. Watch each partner reach "Received" and note the PayPal sandbox batch ID. **Reset demo** starts over. No login or key is needed. To run locally: `npm install && npm run dev`; every key is optional and missing ones run in mock mode (see README).

**Existed before Oct 1, 2026?** No, this is a new project.

## B. Demo video script (target 2:45, hard cap 2:59)

Record on the hosted demo with real sandbox keys. Open the site a minute early (free instances sleep), press **Reset demo** first, and cut the wait while the AI reads a bulletin (20 to 30 s). No music, or only royalty-free music.

| Time | On screen | Voice-over |
| --- | --- | --- |
| 0:00–0:15 | Home page hero, then the Yagi replay paused at 5 Sep | "In September 2024, Typhoon Yagi hit northern Vietnam. Warnings came days early, but cash aid usually arrives weeks after the flood. Early Relief gets money to families before the water arrives." |
| 0:15–0:35 | Locked rule card, press Start, forecasts arrive, province bars cross the threshold | "Before the season, an organiser locks a rule: $20 per household when the 48-hour forecast shows 150 mm of rain. Code checks every forecast. Quang Ninh and Hai Phong cross it two days ahead, Thai Binh one day ahead." |
| 0:35–0:45 | Plan ready, press Review the payout plan | "The plan is ready, but nothing is paid until a person reviews it." |
| 0:45–1:25 | Review screen: press Read with AI, values appear beside the bulletin, hover a quote | "AI reads the official Vietnamese bulletin and returns each value with the exact sentence it came from. Code checks every quote against the text. If the AI invents something, it shows up as Check this. If the bulletin doesn't say, it stays empty. The AI never decides who is paid." |
| 1:25–1:45 | Partner cards, Exclude one household, totals drop | "Amounts are calculated by code: households times $20 per local partner. The reviewer can exclude a household, and the server recalculates the total and the plan's fingerprint." |
| 1:45–2:20 | Approve and send, confirmation, type name, confirm, batch ID appears, statuses go Sending to Received | "Approval restates the total and sends the fingerprint of exactly this plan. If anything changed, PayPal is never called, and a plan can only be paid once. PayPal Payouts sends one sandbox batch, one payment per partner. Here is the batch ID, and each partner's money arriving." |
| 2:20–2:40 | Architecture diagram from `docs/architecture.md` ("Who decides what" table) | "AI reads, code decides, a person approves, PayPal pays. We paid partners rather than households because PayPal lists Vietnam as eligible to receive Payouts in USD. We tested on the sandbox only." |
| 2:40–2:50 | Repo page | "Next: partner receipt codes, household checks and donor reports. The code is open source. Thank you." |

## C. Pre-submission checklist

Requirements from the official rules:

- [x] Uses at least one PayPal technology meaningfully (Payouts on the sandbox)
- [x] Uses AI meaningfully (bulletin reader with code-checked quotes)
- [ ] Working build: hosted demo URL in README and Devpost
- [x] Repo is public, contains all source, assets and instructions
- [ ] Open source license visible in the repo's About section (check the GitHub sidebar shows MIT)
- [ ] Video under 3 minutes, public on YouTube, shows the project running with a real sandbox payout
- [x] Text description explains features and functionality (section A)
- [x] Tools section names every AI model/service and how it is used
- [x] Everything in English

Before submitting:

- [ ] `npm run check:sandbox` passes with the credentials used on Render
- [ ] Full flow tested on the hosted demo, not only on localhost, ending in "Received" for every partner
- [ ] Hosted demo and video links filled in here and in README
- [ ] AI provider key has a spending limit
- [ ] No secrets committed (`git log -p | grep -iE "secret|api_key|sk-"` shows nothing sensitive)
- [ ] Form submitted before Nov 13, 03:00 Vietnam time
- [ ] Repo owner tags the submitted commit: `git tag submission && git push origin submission`
- [ ] Hosted demo stays up through Dec 15, 2026
