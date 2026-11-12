# Deploying the demo on Render

The hosted demo is one Render web service defined in [`render.yaml`](../render.yaml). It builds with `npm ci && npm run build`, starts with `npm start` on Node 22, and Render checks `/api/health`.

## First deploy

1. Sign in at [render.com](https://render.com) with GitHub. Give Render access to this repository.
2. **New → Blueprint**, pick this repository, and confirm the `early-relief` service.
3. Render asks for the secret values. Fill in the same values as `.env.local`:

   | Variable | Value |
   | --- | --- |
   | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | Sandbox app credentials |
   | `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | The AI provider. Set a monthly spending limit with the provider first |
   | `PARTNER_PAYPAL_EMAILS` | Three sandbox personal account emails, comma separated |
   | `PAYPAL_WEBHOOK_ID` | Leave empty for now (step 6) |

   Any value left empty runs that integration in mock mode.
4. Wait for the deploy to finish, then open `https://<service>.onrender.com/api/health`. It should show `"paypal":"sandbox"` and the AI mode you expect.
5. Run the full flow on the hosted URL: replay, review, exclude, approve, and watch the partner statuses reach "Received".
6. Optional, for webhooks:
   - In the PayPal developer dashboard, open the sandbox app and add a webhook at `https://<service>.onrender.com/api/webhooks/paypal` for the payout events.
   - Copy its webhook ID into `PAYPAL_WEBHOOK_ID` on Render and redeploy.
   - Polling keeps statuses up to date without it.

Every merge into `main` redeploys automatically.

## Things to know

- **One instance only.** Plans live in memory. Do not scale the service above one instance.
- **Restarts clear the demo.** A redeploy, a restart or a free instance going to sleep starts from a fresh scenario. Run the replay again; "Reset demo" does the same on purpose.
- **Free instances sleep** after about 15 minutes without traffic, and the first request then takes up to a minute. Open the site a minute before recording or judging.
- **Keep it running through Dec 15, 2026**, the end of judging, as the hackathon rules require.
- **Sandbox only.** `src/lib/paypal.ts` only calls `api-m.sandbox.paypal.com`, so no real money can move.
