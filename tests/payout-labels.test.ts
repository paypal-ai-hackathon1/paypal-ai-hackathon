import { describe, expect, it } from "vitest";
import type { PayoutItemStatus, PlanStatus } from "@/lib/domain";
import { MAX_POLLS, PAYOUT_STATUS_TEXT, payoutNeedsAttention, pollDelayMs, shouldPoll } from "@/lib/payout-labels";

const ALL_STATUSES: PayoutItemStatus[] = [
  "PENDING",
  "SUCCESS",
  "FAILED",
  "UNCLAIMED",
  "RETURNED",
  "ONHOLD",
  "BLOCKED",
  "REFUNDED",
  "REVERSED",
];

describe("PAYOUT_STATUS_TEXT", () => {
  it("has a plain-language label and explanation for every PayPal item status", () => {
    for (const status of ALL_STATUSES) {
      expect(PAYOUT_STATUS_TEXT[status].label).toMatch(/\S/);
      expect(PAYOUT_STATUS_TEXT[status].detail).toMatch(/\S/);
      expect(PAYOUT_STATUS_TEXT[status].label).not.toBe(status);
    }
  });
});

describe("payoutNeedsAttention", () => {
  it("flags statuses where money did not arrive, not pending or received ones", () => {
    expect(payoutNeedsAttention("UNCLAIMED")).toBe(true);
    expect(payoutNeedsAttention("FAILED")).toBe(true);
    expect(payoutNeedsAttention("SUCCESS")).toBe(false);
    expect(payoutNeedsAttention("PENDING")).toBe(false);
    expect(payoutNeedsAttention(null)).toBe(false);
  });
});

describe("shouldPoll", () => {
  it("polls only while the payout is on its way and stops at a final status", () => {
    const expected: Record<PlanStatus, boolean> = {
      in_review: false,
      approved: false,
      payout_pending: true,
      paid: false,
      needs_attention: false,
    };
    for (const [status, poll] of Object.entries(expected)) {
      expect(shouldPoll(status as PlanStatus)).toBe(poll);
    }
  });
});

describe("pollDelayMs", () => {
  it("starts at 2 s, grows, and never exceeds 15 s", () => {
    expect(pollDelayMs(0)).toBe(2000);
    expect(pollDelayMs(1)).toBe(3000);
    expect(pollDelayMs(2)).toBeGreaterThan(pollDelayMs(1));
    expect(pollDelayMs(MAX_POLLS)).toBe(15000);
    expect(pollDelayMs(-1)).toBe(2000);
  });
});
