import { afterEach, describe, expect, it, vi } from "vitest";
import { formatUsd, splitOnQuote } from "@/lib/format";
import { importWithEnv } from "./helpers";

type PlanReviewModule = typeof import("@/lib/plan-review");
type PlansModule = typeof import("@/lib/plans");
type StoreModule = typeof import("@/lib/store");

const RULE_ID = "rule-rain-150-v1";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function setup() {
  const review = await importWithEnv<PlanReviewModule>("@/lib/plan-review", {});
  const plans = (await import("@/lib/plans")) as PlansModule;
  const store = (await import("@/lib/store")) as StoreModule;
  store.resetScenario();
  return { review, plans, store };
}

describe("formatUsd", () => {
  it("formats integer cents as dollars", () => {
    expect(formatUsd(64000)).toBe("$640.00");
    expect(formatUsd(2005)).toBe("$20.05");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(123456789)).toBe("$1,234,567.89");
    expect(formatUsd(-150)).toBe("-$1.50");
  });
});

describe("splitOnQuote", () => {
  const text = "Bão số 3 đang mạnh lên.\nMưa lớn  từ 150-250 mm tại Quảng Ninh.";

  it("finds a quote, ignoring differences in whitespace", () => {
    expect(splitOnQuote(text, "Mưa lớn từ 150-250 mm")).toEqual({
      before: "Bão số 3 đang mạnh lên.\n",
      match: "Mưa lớn  từ 150-250 mm",
      after: " tại Quảng Ninh.",
    });
  });

  it("treats regex characters in the quote literally", () => {
    expect(splitOnQuote("Gió (cấp 12) mạnh.", "(cấp 12)")?.match).toBe("(cấp 12)");
    expect(splitOnQuote("Gió cấp 12 mạnh.", "cấp 1.")).toBeNull();
  });

  it("returns null for a changed, made-up or empty quote", () => {
    expect(splitOnQuote(text, "Mưa lớn từ 300 mm")).toBeNull();
    expect(splitOnQuote(text, "")).toBeNull();
    expect(splitOnQuote(text, null)).toBeNull();
  });
});

describe("getPlanReview", () => {
  it("returns the plan with its rule, provinces and bulletins in issue order", async () => {
    const { review, plans } = await setup();
    const { plan } = plans.createPlan(RULE_ID);

    const result = review.getPlanReview(plan.id);
    expect(result.plan.id).toBe(plan.id);
    expect(result.rule).toMatchObject({ id: RULE_ID, version: 1, threshold: 150, amountPerHouseholdCents: 2000 });
    expect(result.provinces.map((p) => p.id)).toEqual(expect.arrayContaining(["quang-ninh", "hai-phong", "thai-binh"]));
    expect(result.bulletins.length).toBeGreaterThan(0);
    const times = result.bulletins.map((b) => Date.parse(b.issuedAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(result.bulletins.every((b) => b.reading === null)).toBe(true);
  });

  it("never exposes phones, receipt codes, emails or tokens", async () => {
    const { review, plans } = await setup();
    const { plan } = plans.createPlan(RULE_ID);

    const json = JSON.stringify(review.getPlanReview(plan.id));
    expect(json).not.toMatch(/receiptCode|accessToken|paypalEmail|"phone"/);
  });

  it("attaches the latest reading of each bulletin", async () => {
    const { review, plans, store } = await setup();
    const { plan } = plans.createPlan(RULE_ID);
    const state = store.getStore();
    const bulletinId = state.bulletins[0].id;
    const field = { value: null, quote: null, status: "missing" as const };
    const reading = (readAt: string) => ({
      bulletinId,
      provinces: field,
      hazard: field,
      warningLevel: field,
      validTime: field,
      rainfall: field,
      wind: field,
      readAt,
      mock: true,
    });
    state.bulletinReadings = [reading("2024-09-05T12:00:00+07:00"), reading("2024-09-05T13:00:00+07:00")];

    const found = review.getPlanReview(plan.id).bulletins.find((b) => b.id === bulletinId);
    expect(found?.reading?.readAt).toBe("2024-09-05T13:00:00+07:00");
  });

  it("throws a 404 PlanError for an unknown plan", async () => {
    const { review, plans } = await setup();
    expect(() => review.getPlanReview("plan-missing")).toThrow(plans.PlanError);
  });
});

describe("planErrorMessage", () => {
  it("explains a 404 as a cleared demo plan and keeps the server message otherwise", async () => {
    const { planErrorMessage, STALE_PLAN_MESSAGE } = await import("@/lib/format");
    expect(planErrorMessage(404, "Unknown plan", "fallback")).toBe(STALE_PLAN_MESSAGE);
    expect(STALE_PLAN_MESSAGE).toMatch(/reset or restarted/);
    expect(planErrorMessage(409, "The plan changed after you opened it.", "fallback")).toBe(
      "The plan changed after you opened it.",
    );
    expect(planErrorMessage(500, undefined, "fallback")).toBe("fallback");
  });
});
