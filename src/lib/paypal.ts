// Thin wrapper over the PayPal REST API (sandbox).
// Falls back to a mock when credentials are missing, so the app still runs for judges without keys.

import { CURRENCY, type PayoutItemStatus } from "./domain";
import { env, paypalConfigured } from "./env";

/**
 * A failed PayPal call. The message carries the HTTP status and PayPal's error name only:
 * the response body is written to the server log, so a route that shows the message by
 * mistake still leaks nothing.
 */
export class PayPalError extends Error {
  constructor(
    readonly status: number,
    /** PayPal's error name, e.g. INSUFFICIENT_FUNDS or invalid_client, when the body had one. */
    readonly issue: string | null,
    message: string,
    /** URLs from the error's `links`, e.g. the original batch when a sender_batch_id was reused. */
    readonly links: string[] = [],
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

/** Logs the upstream body and turns the response into a PayPalError without it. */
async function toPayPalError(res: Response, what: string): Promise<PayPalError> {
  const text = await res.text();
  console.error(`${what} failed (${res.status}): ${text}`);

  let issue: string | null = null;
  let links: string[] = [];
  try {
    const body = JSON.parse(text) as { name?: unknown; error?: unknown; links?: unknown };
    if (typeof body.name === "string") issue = body.name;
    else if (typeof body.error === "string") issue = body.error;
    if (Array.isArray(body.links)) {
      links = body.links.flatMap((link: { href?: unknown }) => (typeof link?.href === "string" ? [link.href] : []));
    }
  } catch {
    // Not JSON: the status alone has to do.
  }
  return new PayPalError(res.status, issue, `${what} failed (${res.status})${issue ? `: ${issue}` : ""}`, links);
}

export type CreatedOrder = {
  id: string;
  status: string;
  approveUrl: string;
  mock: boolean;
};

export type CapturedOrder = {
  id: string;
  status: string;
  amount?: { currency_code: string; value: string };
  payerEmail?: string;
  mock: boolean;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const basic = Buffer.from(`${env.paypal.clientId}:${env.paypal.clientSecret}`).toString("base64");
  const res = await fetch(`${env.paypal.baseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  if (!res.ok) {
    throw await toPayPalError(res, "PayPal auth");
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

async function paypalFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${env.paypal.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw await toPayPalError(res, `PayPal ${init.method ?? "GET"} ${path}`);
  }
  return (await res.json()) as T;
}

type PayPalLink = { href: string; rel: string };

export async function createOrder(input: {
  amount: string;
  currency?: string;
  description?: string;
  returnUrl: string;
  cancelUrl: string;
}): Promise<CreatedOrder> {
  const currency = input.currency ?? "USD";

  if (!paypalConfigured) {
    const id = `MOCK-${Date.now()}`;
    const url = new URL(input.returnUrl);
    url.searchParams.set("token", id);
    return { id, status: "PAYER_ACTION_REQUIRED", approveUrl: url.toString(), mock: true };
  }

  const order = await paypalFetch<{ id: string; status: string; links: PayPalLink[] }>(
    "/v2/checkout/orders",
    {
      method: "POST",
      headers: { "PayPal-Request-Id": crypto.randomUUID() },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: { currency_code: currency, value: input.amount },
            description: input.description,
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: input.returnUrl,
              cancel_url: input.cancelUrl,
              user_action: "PAY_NOW",
              shipping_preference: "NO_SHIPPING",
            },
          },
        },
      }),
    },
  );

  const approve = order.links.find((l) => l.rel === "payer-action" || l.rel === "approve");
  if (!approve) throw new Error(`PayPal order ${order.id} has no approval link`);

  return { id: order.id, status: order.status, approveUrl: approve.href, mock: false };
}

export async function captureOrder(orderId: string): Promise<CapturedOrder> {
  if (!paypalConfigured || orderId.startsWith("MOCK-")) {
    return {
      id: orderId,
      status: "COMPLETED",
      amount: { currency_code: "USD", value: "1.00" },
      payerEmail: "buyer@example.com",
      mock: true,
    };
  }

  const data = await paypalFetch<{
    id: string;
    status: string;
    payer?: { email_address?: string };
    purchase_units?: { payments?: { captures?: { amount: { currency_code: string; value: string } }[] } }[];
  }>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    headers: { "PayPal-Request-Id": `capture-${orderId}` },
  });

  return {
    id: data.id,
    status: data.status,
    amount: data.purchase_units?.[0]?.payments?.captures?.[0]?.amount,
    payerEmail: data.payer?.email_address,
    mock: false,
  };
}

// --- Payouts -------------------------------------------------------------------------------
// One batch per approved plan, one item per partner. Amounts live in the app as integer cents
// and become PayPal's decimal strings only here.

export type PayoutBatchStatus = "PENDING" | "PROCESSING" | "SUCCESS" | "DENIED" | "CANCELED";

export type PayoutRecipient = {
  /** Our reference for the line, e.g. the partner ID. Sent as sender_item_id. */
  senderItemId: string;
  email: string;
  amountCents: number;
};

export type PayoutBatchItem = {
  payoutItemId: string;
  senderItemId: string;
  amountCents: number;
  status: PayoutItemStatus;
  /** PayPal's error name for this item, e.g. RECEIVER_UNREGISTERED for an unclaimed payout. */
  errorName: string | null;
};

export type PayoutBatch = {
  batchId: string;
  senderBatchId: string;
  status: PayoutBatchStatus;
  /** Empty for a batch just created: PayPal lists items only when the batch is read back. */
  items: PayoutBatchItem[];
  mock: boolean;
};

// Records rather than arrays, so TypeScript fails the build if a status is added to the type
// and forgotten here.
const BATCH_STATUSES: Record<PayoutBatchStatus, true> = {
  PENDING: true,
  PROCESSING: true,
  SUCCESS: true,
  DENIED: true,
  CANCELED: true,
};
const ITEM_STATUSES: Record<PayoutItemStatus, true> = {
  PENDING: true,
  SUCCESS: true,
  FAILED: true,
  UNCLAIMED: true,
  RETURNED: true,
  ONHOLD: true,
  BLOCKED: true,
  REFUNDED: true,
  REVERSED: true,
};

/** Integer cents to the decimal string PayPal expects: 1250 -> "12.50". */
export function centsToAmount(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error(`Amount must be a non-negative integer number of cents, got ${cents}`);
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** PayPal's decimal string back to integer cents: "12.50" -> 1250. */
export function amountToCents(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error(`Unexpected PayPal amount: ${value}`);
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

function batchStatus(value: unknown): PayoutBatchStatus {
  if (typeof value === "string" && Object.hasOwn(BATCH_STATUSES, value)) return value as PayoutBatchStatus;
  // Treat anything new as still in progress, so callers keep polling instead of stopping early.
  console.warn(`Unknown PayPal payout batch status: ${String(value)}`);
  return "PROCESSING";
}

function itemStatus(value: unknown): PayoutItemStatus {
  if (typeof value === "string" && Object.hasOwn(ITEM_STATUSES, value)) return value as PayoutItemStatus;
  console.warn(`Unknown PayPal payout item status: ${String(value)}`);
  return "PENDING";
}

function checkBatchInput(planId: string, recipients: PayoutRecipient[]) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(planId)) throw new Error("planId must be 1-64 letters, digits, - or _");
  if (recipients.length === 0) throw new Error("A payout batch needs at least one recipient");
  for (const r of recipients) {
    if (!r.senderItemId) throw new Error("Every payout recipient needs a senderItemId");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email)) throw new Error(`Invalid payout email for ${r.senderItemId}`);
    if (!Number.isSafeInteger(r.amountCents) || r.amountCents <= 0) {
      throw new Error(`Payout amount for ${r.senderItemId} must be a positive integer number of cents`);
    }
  }
}

// Mock batches live on globalThis for the same reason as the store: the approve route creates
// a batch and the status route reads it, and each route may get its own copy of this module.
type MockBatch = { senderBatchId: string; recipients: PayoutRecipient[]; reads: number };
const MOCK_KEY = Symbol.for("paypal-ai-hackathon.mock-payouts");
const mockHolder = globalThis as typeof globalThis & { [MOCK_KEY]?: Map<string, MockBatch> };
const mockBatches = () => (mockHolder[MOCK_KEY] ??= new Map<string, MockBatch>());

/** The batch ID in a link like https://api-m.sandbox.paypal.com/v1/payments/payouts/<id>. */
function batchIdFromLink(href: string): string | null {
  try {
    return /^\/v1\/payments\/payouts\/([^/]+)$/.exec(new URL(href).pathname)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Sends one Payouts batch, using the plan ID as the sender_batch_id and the PayPal-Request-Id.
 *
 * PayPal refuses a sender_batch_id it has seen in the last 30 days, so a plan can never be paid
 * twice. The refusal links to the original batch: when a retry hits it (say the first call timed
 * out after PayPal had already accepted the batch), this reads that batch back and returns it,
 * so the caller still learns the batch ID.
 */
export async function createPayoutBatch(input: {
  planId: string;
  recipients: PayoutRecipient[];
  /** Shown to each recipient with the payout. */
  note?: string;
}): Promise<PayoutBatch> {
  checkBatchInput(input.planId, input.recipients);

  if (!paypalConfigured) {
    // A second call for the same plan gets the batch already made, like the real path below.
    const batchId = `MOCK-BATCH-${input.planId}`;
    if (!mockBatches().has(batchId)) {
      mockBatches().set(batchId, {
        senderBatchId: input.planId,
        recipients: structuredClone(input.recipients),
        reads: 0,
      });
    }
    return { batchId, senderBatchId: input.planId, status: "PENDING", items: [], mock: true };
  }

  const note = input.note ?? "Anticipatory relief payout. Please hand cash to the registered households.";
  let data: { batch_header: { payout_batch_id: string; batch_status: string } };
  try {
    data = await paypalFetch("/v1/payments/payouts", {
      method: "POST",
      headers: { "PayPal-Request-Id": input.planId },
      body: JSON.stringify({
        sender_batch_header: {
          sender_batch_id: input.planId,
          email_subject: "You have a relief payout",
          email_message: "A relief payout has been sent to your PayPal account ahead of a forecast storm.",
        },
        items: input.recipients.map((r) => ({
          recipient_type: "EMAIL",
          receiver: r.email,
          recipient_wallet: "PAYPAL",
          amount: { value: centsToAmount(r.amountCents), currency: CURRENCY },
          note,
          sender_item_id: r.senderItemId,
        })),
      }),
    });
  } catch (err) {
    const existing = err instanceof PayPalError ? await findExistingBatch(err, input.planId) : null;
    if (!existing) throw err;
    console.warn(`Payout batch for ${input.planId} already exists as ${existing.batchId}; returning it`);
    return existing;
  }

  return {
    batchId: data.batch_header.payout_batch_id,
    senderBatchId: input.planId,
    status: batchStatus(data.batch_header.batch_status),
    items: [],
    mock: false,
  };
}

/** The batch a refusal links to, if it really belongs to this plan. Otherwise null. */
async function findExistingBatch(err: PayPalError, planId: string): Promise<PayoutBatch | null> {
  for (const href of err.links) {
    const batchId = batchIdFromLink(href);
    if (!batchId) continue;
    try {
      const batch = await getPayoutBatch(batchId);
      if (batch.senderBatchId === planId) return batch;
    } catch {
      // Unreadable: fall through and report the original error.
    }
  }
  return null;
}

/** Reads a batch and its items. In mock mode the first read is PENDING and every later one SUCCESS. */
export async function getPayoutBatch(batchId: string): Promise<PayoutBatch> {
  if (!paypalConfigured || batchId.startsWith("MOCK-BATCH-")) {
    const batch = mockBatches().get(batchId);
    if (!batch) throw new PayPalError(404, "RESOURCE_NOT_FOUND", "Mock payout batch not found");
    batch.reads += 1;
    const status = batch.reads === 1 ? "PENDING" : "SUCCESS";
    return {
      batchId,
      senderBatchId: batch.senderBatchId,
      status,
      items: batch.recipients.map((r, i) => ({
        payoutItemId: `MOCK-ITEM-${batch.senderBatchId}-${i + 1}`,
        senderItemId: r.senderItemId,
        amountCents: r.amountCents,
        status,
        errorName: null,
      })),
      mock: true,
    };
  }

  const data = await paypalFetch<{
    batch_header: { payout_batch_id: string; batch_status: string; sender_batch_header?: { sender_batch_id?: string } };
    items?: {
      payout_item_id: string;
      transaction_status: string;
      payout_item: { sender_item_id?: string; amount: { value: string; currency: string } };
      errors?: { name?: string };
    }[];
  }>(`/v1/payments/payouts/${encodeURIComponent(batchId)}`);

  return {
    batchId: data.batch_header.payout_batch_id,
    senderBatchId: data.batch_header.sender_batch_header?.sender_batch_id ?? "",
    status: batchStatus(data.batch_header.batch_status),
    items: (data.items ?? []).map((item) => ({
      payoutItemId: item.payout_item_id,
      senderItemId: item.payout_item.sender_item_id ?? "",
      amountCents: amountToCents(item.payout_item.amount.value),
      status: itemStatus(item.transaction_status),
      errorName: item.errors?.name ?? null,
    })),
    mock: false,
  };
}
