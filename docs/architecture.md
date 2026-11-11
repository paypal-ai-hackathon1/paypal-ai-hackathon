# Architecture

> Update this file as the project grows. GitHub renders the Mermaid diagrams below.

## Components

```mermaid
flowchart LR
  Browser["Browser (Next.js page)"] -->|POST /api/ai| AiRoute["api/ai"]
  Browser -->|POST /api/paypal/orders| OrdersRoute["api/paypal/orders"]
  AiRoute --> AiLib["lib/ai.ts"] --> LLM["AI provider<br/>(OpenAI-compatible)"]
  OrdersRoute --> PayPalLib["lib/paypal.ts"] --> PayPal["PayPal REST API<br/>(sandbox)"]
  ReturnRoute["api/paypal/return"] --> PayPalLib
```

Secrets live only on the server (`src/lib/env.ts`). The browser never sees PayPal or AI keys.

## Payment flow

```mermaid
sequenceDiagram
  participant U as Buyer
  participant A as App (Next.js)
  participant P as PayPal sandbox

  U->>A: Click "Pay"
  A->>P: POST /v1/oauth2/token
  A->>P: POST /v2/checkout/orders (intent CAPTURE)
  P-->>A: order id + payer-action link
  A-->>U: Redirect to PayPal
  U->>P: Log in with sandbox buyer, approve
  P-->>U: Redirect to /api/paypal/return?token=<orderId>
  U->>A: GET /api/paypal/return
  A->>P: POST /v2/checkout/orders/{id}/capture
  P-->>A: COMPLETED
  A-->>U: Redirect to /?payment=completed
```

## Payout status delivery

The approval route records one Payouts batch ID on the plan. Both status delivery paths call `refreshPayoutStatus()` in `src/lib/plans.ts`:

```mermaid
flowchart LR
  Client["Client"] -->|GET /api/plans/id/status| Poll["Status route"]
  PayPal["PayPal sandbox"] -->|POST /api/webhooks/paypal| Verify["Postback signature verification"]
  Verify -->|verified event, deduplicated by ID| Refresh["Read current payout batch"]
  Poll --> Refresh
  Refresh --> PayPal
  Refresh --> Merge["Merge partner item statuses"] --> Store["In-memory plan"]
```

The webhook's status fields never set payment amounts or directly replace item statuses. A verified event prompts a fresh batch read, so delayed deliveries reconcile with current PayPal data. A settled item never regresses to `PENDING`, including when concurrent reads finish out of order. A batch-level `SUCCESS` does not imply that each partner received money.

Polling skips paid plans. Webhooks may refresh paid plans to record subsequent refunds or reversals. With no credentials, mock polling settles the plan without network access; webhook verification always fails closed. Webhook deduplication is bounded, shared through `globalThis`, and scoped to the current store state. A reset or restart clears it. This demo requires one server instance and does not persist its payment audit history.

## Mock mode

Each integration checks for its own credentials. When they are missing:

| Integration | Behaviour without credentials |
| --- | --- |
| PayPal | `createOrder` returns a `MOCK-` id whose approve URL skips PayPal and goes straight to the return route; `captureOrder` returns `COMPLETED` |
| PayPal Payouts | `createPayoutBatch` returns a `MOCK-BATCH-` id; `getPayoutBatch` reports `PENDING` on the first read and `SUCCESS` after that |
| AI | `chat` echoes the prompt back with a `[mock AI]` prefix |

This keeps the app runnable for anyone who clones the repo without keys, including judges.
