// Pure, client-safe status rules shared by polling, webhooks and the approval UI.
import type { PayoutItemStatus, PlanPartnerItem, PlanStatus } from "./domain";
import type { PayoutBatchStatus } from "./paypal";

export const NEEDS_ATTENTION: ReadonlySet<PayoutItemStatus> = new Set([
  "UNCLAIMED", "FAILED", "RETURNED", "ONHOLD", "BLOCKED", "REFUNDED", "REVERSED",
]);

/** Late reads must never undo a settled status with PENDING. Other transitions remain possible. */
export function mergeItemStatus(current: PayoutItemStatus | null, incoming: PayoutItemStatus): PayoutItemStatus {
  return incoming === "PENDING" && current !== null && current !== "PENDING" ? current : incoming;
}

/** A batch being SUCCESS does not mean its recipients received their individual payouts. */
export function planStatusFor(items: readonly PlanPartnerItem[], batchStatus?: PayoutBatchStatus): PlanStatus {
  if (batchStatus === "DENIED" || batchStatus === "CANCELED") return "needs_attention";
  if (!items.length || items.some((item) => item.payoutStatus === null || item.payoutStatus === "PENDING")) {
    return "payout_pending";
  }
  return items.every((item) => item.payoutStatus === "SUCCESS") ? "paid" : "needs_attention";
}
