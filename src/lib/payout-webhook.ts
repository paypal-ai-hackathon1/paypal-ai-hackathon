import "server-only";
import { env, paypalConfigured } from "./env";
import { verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADERS } from "./paypal";
import { refreshPayoutStatus } from "./plans";
import { getStore, type StoreState } from "./store";

export class WebhookError extends Error {
  constructor(readonly status: 400 | 413 | 503, message: string) {
    super(message);
    this.name = "WebhookError";
  }
}

type DeliveryCache = { done: Set<string>; pending: Map<string, Promise<boolean>> };
const KEY = Symbol.for("paypal-ai-hackathon.payout-webhooks");
const holder = globalThis as typeof globalThis & { [KEY]?: WeakMap<StoreState, DeliveryCache> };

function deliveries(state: StoreState): DeliveryCache {
  const states = (holder[KEY] ??= new WeakMap());
  let cache = states.get(state);
  if (!cache) {
    cache = { done: new Set(), pending: new Map() };
    states.set(state, cache);
  }
  return cache;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Verify once per delivery, then reconcile with PayPal's current batch instead of stale event data. */
export async function handlePayoutWebhook(rawBody: string, headers: Headers): Promise<{ ignored: boolean }> {
  if (!paypalConfigured || !env.paypal.webhookId) throw new WebhookError(400, "PayPal webhooks are not configured");
  if (!WEBHOOK_SIGNATURE_HEADERS.every((name) => headers.get(name)?.trim())) {
    throw new WebhookError(400, "Missing PayPal signature headers");
  }
  let event: unknown;
  try { event = JSON.parse(rawBody); } catch { throw new WebhookError(400, "Invalid webhook JSON"); }
  if (!isRecord(event) || typeof event.id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(event.id)
    || typeof event.event_type !== "string" || !isRecord(event.resource)) {
    throw new WebhookError(400, "Invalid webhook event");
  }
  const { id, event_type: eventType, resource } = event;

  const state = getStore();
  const cache = deliveries(state);
  if (cache.done.has(id)) return { ignored: true };
  const pending = cache.pending.get(id);
  if (pending) { await pending; return { ignored: true }; }

  const process = async (): Promise<boolean> => {
    if (!(await verifyWebhookSignature(rawBody, headers))) throw new WebhookError(400, "Invalid PayPal signature");
    if (getStore() !== state) throw new WebhookError(503, "The demo was reset. Retry this webhook.");
    if (!/^PAYMENT\.(PAYOUTSBATCH|PAYOUTS-ITEM)\./.test(eventType)) return true;
    const batchHeader = isRecord(resource.batch_header) ? resource.batch_header : {};
    const batchId = resource.payout_batch_id ?? batchHeader.payout_batch_id;
    if (typeof batchId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(batchId)) {
      throw new WebhookError(400, "Missing payout batch ID");
    }
    const plan = getStore().plans.find((entry) => entry.payoutBatchId === batchId);
    if (!plan) return true; // A verified event for another app/demo batch needs no work here.
    await refreshPayoutStatus(plan.id, { force: true });
    return false;
  };

  const work = process();
  cache.pending.set(id, work);
  try {
    const ignored = await work;
    // Keep deduplication bounded. A reset gets its own cache; old states can be garbage-collected.
    if (cache.done.size >= 5_000) cache.done.delete(cache.done.values().next().value!);
    cache.done.add(id);
    return { ignored };
  } finally {
    cache.pending.delete(id); // Failed deliveries are not marked done and can be retried.
  }
}
