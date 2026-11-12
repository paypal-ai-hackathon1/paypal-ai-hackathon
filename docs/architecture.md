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

## Mock mode

Each integration checks for its own credentials. When they are missing:

| Integration | Behaviour without credentials |
| --- | --- |
| PayPal | `createOrder` returns a `MOCK-` id whose approve URL skips PayPal and goes straight to the return route; `captureOrder` returns `COMPLETED` |
| PayPal Payouts | `createPayoutBatch` returns a `MOCK-BATCH-` id; `getPayoutBatch` reports `PENDING` on the first read and `SUCCESS` after that |
| AI | `chat` echoes the prompt back with a `[mock AI]` prefix |

This keeps the app runnable for anyone who clones the repo without keys, including judges.
