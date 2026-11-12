// Client-safe wording and polling rules for the approval and payout status screen.
import type { PayoutItemStatus, PlanStatus } from "./domain";
import { NEEDS_ATTENTION } from "./payout-status";

/** Plain-language label and explanation for each PayPal Payouts item status. */
export const PAYOUT_STATUS_TEXT: Record<PayoutItemStatus, { label: string; detail: string }> = {
  PENDING: { label: "Sending", detail: "PayPal accepted the payout and is processing it." },
  SUCCESS: { label: "Received", detail: "The money is in the partner's PayPal account." },
  UNCLAIMED: {
    label: "Not claimed",
    detail: "The partner has no PayPal account for this email yet. PayPal returns the money after 30 days.",
  },
  ONHOLD: { label: "On hold", detail: "PayPal is reviewing this payout. Nothing to do yet." },
  FAILED: { label: "Failed", detail: "PayPal could not send this payout. Check the partner's details." },
  RETURNED: { label: "Returned", detail: "The money came back because nobody claimed it in time." },
  BLOCKED: { label: "Blocked", detail: "PayPal blocked this payout. Contact PayPal support." },
  REFUNDED: { label: "Refunded", detail: "The payout was refunded to the sender." },
  REVERSED: { label: "Reversed", detail: "PayPal reversed this payout." },
};

export function payoutNeedsAttention(status: PayoutItemStatus | null): boolean {
  return status !== null && NEEDS_ATTENTION.has(status);
}

/** Only a plan whose payout is still on its way needs polling. Paid and needs-attention are final. */
export function shouldPoll(status: PlanStatus): boolean {
  return status === "payout_pending";
}

const FIRST_POLL_MS = 2_000;
const MAX_POLL_MS = 15_000;
/** About five minutes of polling. After that the screen offers a manual "Check again". */
export const MAX_POLLS = 30;

/** Waits 2 s, then grows by half each time, up to 15 s, so a slow sandbox is not hammered. */
export function pollDelayMs(attempt: number): number {
  return Math.min(MAX_POLL_MS, Math.round(FIRST_POLL_MS * 1.5 ** Math.max(0, attempt)));
}
