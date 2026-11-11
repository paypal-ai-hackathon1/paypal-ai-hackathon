import type { PayoutItemStatus, Plan } from "@/lib/domain";
import { importWithEnv } from "./helpers";

export const WEBHOOK_KEYS = {
  PAYPAL_CLIENT_ID: "test-id", PAYPAL_CLIENT_SECRET: "test-secret", PAYPAL_WEBHOOK_ID: "WEBHOOK-TEST",
};
export const AUTH = { body: { access_token: "test-token", expires_in: 3600 } };
export const VERIFIED = { body: { verification_status: "SUCCESS" } };
export const SIGNATURE_HEADERS = {
  "paypal-transmission-id": "transmission-test", "paypal-transmission-time": "2026-11-11T12:00:00Z",
  "paypal-transmission-sig": "test-signature", "paypal-cert-url": "https://api-m.sandbox.paypal.com/cert/test",
  "paypal-auth-algo": "SHA256withRSA",
};

/** Starts with a recorded batch, so tests exercise status reads without sending any payments. */
export async function setupPayout(vars: Record<string, string> = WEBHOOK_KEYS) {
  const plans = await importWithEnv<typeof import("@/lib/plans")>("@/lib/plans", vars);
  const store = await import("@/lib/store");
  store.resetScenario();
  const created = plans.createPlan("rule-rain-150-v1").plan;
  const plan: Plan = { ...created, status: "payout_pending", payoutBatchId: "BATCH-TEST",
    items: created.items.map((item) => ({ ...item, payoutStatus: "PENDING" })) };
  store.getStore().plans = [plan];
  return { plans, store, plan };
}

export function batchBody(plan: Plan, statuses: PayoutItemStatus[] = ["SUCCESS", "SUCCESS", "SUCCESS"], status = "SUCCESS") {
  return {
    batch_header: { payout_batch_id: plan.payoutBatchId, batch_status: status,
      sender_batch_header: { sender_batch_id: plan.id } },
    items: plan.items.map((item, i) => ({
      payout_item_id: `ITEM-${i}`, transaction_status: statuses[i],
      payout_item: { sender_item_id: item.partnerId, amount: { value: (item.amountCents / 100).toFixed(2), currency: "USD" } },
    })),
  };
}

export function webhookBody(id: string, eventType = "PAYMENT.PAYOUTS-ITEM.SUCCEEDED", batchId = "BATCH-TEST") {
  return JSON.stringify({ id, event_type: eventType, resource: { payout_batch_id: batchId, transaction_status: "SUCCESS" } });
}
