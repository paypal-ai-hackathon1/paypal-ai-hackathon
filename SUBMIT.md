# Submission kit: PayPal AI Hackathon (Devpost)

Deadline: **Nov 12, 2026, 12:00 PM PST** (Nov 13, 03:00 AM Vietnam time). Aim to submit by Nov 11.

Rules: https://paypalaihackathon.devpost.com/rules

## A. Devpost fields

All submission material must be in English.

**Project name:**

**Tagline (one line):**

**Inspiration:**

**What it does:**

**How we built it:**
- PayPal products / APIs used, and where:
- AI model(s) / services used, and how:
- Sponsor tools used (if any):

**Challenges we ran into:**

**Accomplishments we're proud of:**

**What we learned:**

**What's next:**

**Built with (tags):** nextjs, typescript, paypal, ...

**Links:**
- Public repo:
- Hosted demo:
- YouTube video:

**Testing instructions** (also in README): how to run, sandbox buyer account, any keys judges need.

**If the project existed before Oct 1, 2026:** explain what was significantly changed during the hackathon. (N/A: new project.)

## B. Demo video plan (target 2:45, hard cap 2:59)

Judges are not required to watch past 3:00. No copyrighted music.

| Time | What is on screen | What is said |
| --- | --- | --- |
| 0:00–0:20 | The problem, shown concretely | Who has it, why it hurts |
| 0:20–0:35 | Product name + one-line pitch | |
| 0:35–2:10 | Live end-to-end flow on the real build, including a PayPal sandbox payment | Narrate what the AI does and what PayPal does |
| 2:10–2:35 | Architecture slide (from docs/architecture.md) | PayPal + AI integration points |
| 2:35–2:45 | What's next, repo link | |

## C. Pre-submission checklist

Requirements from the official rules:

- [ ] Uses at least one PayPal technology meaningfully (sandbox)
- [ ] Uses AI meaningfully
- [ ] Working build: hosted demo URL **or** complete setup instructions in README
- [ ] Repo is public, contains all source, assets and instructions
- [ ] Open source license visible in the repo's About section
- [ ] Video under 3 minutes, public on YouTube, shows the project running
- [ ] Text description explains features and functionality
- [ ] Tools section names every AI model/service and how it is used
- [ ] Everything in English

README sections to add back once the idea is chosen:

- [ ] Project name and one-line pitch as the title
- [ ] Demo: hosted URL and YouTube link
- [ ] The problem, and why existing tools (including PayPal's own) don't solve it
- [ ] What it does: the core flow, step by step
- [ ] Test accounts for judges (sandbox buyer email/password)
- [ ] Verified on the PayPal sandbox: date and what was tested
- [ ] Sponsor tools used, and which sponsor prize each targets
- [ ] AI tools used to build this (coding assistants etc.)
- [ ] What's next

Extra checks:

- [ ] `npm run check:sandbox` passes with real credentials
- [ ] Full flow tested on the hosted demo, not only on localhost
- [ ] Polling alone brings an approved sandbox payout to its per-partner terminal status
- [ ] A real signed sandbox webhook reaches the hosted demo; postback verification is not tested with simulator messages
- [ ] With `PAYPAL_WEBHOOK_ID` empty, mock polling still works and incoming webhooks cannot change a plan
- [ ] Sandbox buyer test account listed in README
- [ ] No secrets committed (`git log -p | grep -i secret` returns nothing sensitive)
- [ ] README "Verified on the PayPal sandbox" section has a date
- [ ] Sponsor prize mapping filled in, if targeting a sponsor prize
