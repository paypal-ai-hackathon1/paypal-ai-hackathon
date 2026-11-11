import { describe, expect, it } from "vitest";
import type { PayoutItemStatus, PlanPartnerItem } from "@/lib/domain";
import { mergeItemStatus, NEEDS_ATTENTION, planStatusFor } from "@/lib/payout-status";

const item = (payoutStatus: PayoutItemStatus | null): PlanPartnerItem => ({
  partnerId: "partner-test", householdIds: ["hh-test"], amountCents: 2000, payoutItemId: null, payoutStatus,
});

describe("payout status rules", () => {
  it.each([...NEEDS_ATTENTION, "SUCCESS" as const])("never regresses %s to PENDING", (status) => {
    expect(mergeItemStatus(status, "PENDING")).toBe(status);
  });
  it("accepts initial and subsequent settled transitions", () => {
    expect(mergeItemStatus(null, "PENDING")).toBe("PENDING");
    expect(mergeItemStatus("PENDING", "SUCCESS")).toBe("SUCCESS");
    expect(mergeItemStatus("UNCLAIMED", "SUCCESS")).toBe("SUCCESS");
    expect(mergeItemStatus("SUCCESS", "REFUNDED")).toBe("REFUNDED");
  });
  it("waits for every item and never treats an empty batch as paid", () => {
    expect(planStatusFor([])).toBe("payout_pending");
    expect(planStatusFor([item(null)])).toBe("payout_pending");
    expect(planStatusFor([item("SUCCESS"), item("PENDING")], "SUCCESS")).toBe("payout_pending");
    expect(planStatusFor([item("SUCCESS"), item("SUCCESS")])).toBe("paid");
  });
  it.each([...NEEDS_ATTENTION])("shows settled %s as needing attention", (status) => {
    expect(planStatusFor([item("SUCCESS"), item(status)], "SUCCESS")).toBe("needs_attention");
  });
  it("surfaces a denied or canceled batch even if its items are pending", () => {
    expect(planStatusFor([item("PENDING")], "DENIED")).toBe("needs_attention");
    expect(planStatusFor([item("PENDING")], "CANCELED")).toBe("needs_attention");
  });
});
