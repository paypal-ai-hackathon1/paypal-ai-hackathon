import { afterEach, describe, expect, it, vi } from "vitest";
import { yagi } from "@/data/scenarios/yagi";
import type { ForecastPoint, Household, Rule } from "@/lib/domain";
import {
  calculatePlanItems,
  evaluateRule,
  forecastMeetsRule,
  lockRule,
  newRuleVersion,
  planTotalCents,
  RuleAlreadyLockedError,
  UnlockedRuleError,
} from "@/lib/rules";
import { importWithEnv } from "./helpers";

const rule: Rule = yagi.rules[0];
const unlocked: Rule = { ...rule, id: "rule-rain-150-v2", version: 2, lockedAt: null, lockedBy: null };

function point(overrides: Partial<ForecastPoint>): ForecastPoint {
  return {
    id: "fc-test",
    provinceId: "quang-ninh",
    metric: "rain_24h_mm",
    value: 150,
    issuedAt: "2024-09-05T19:00:00+07:00",
    validFrom: "2024-09-07T19:00:00+07:00",
    leadHours: 48,
    ...overrides,
  };
}

describe("forecastMeetsRule", () => {
  it("fires at exactly the threshold and above, not just below", () => {
    expect(forecastMeetsRule(rule, point({ value: 149.9 }))).toBe(false);
    expect(forecastMeetsRule(rule, point({ value: 150 }))).toBe(true);
    expect(forecastMeetsRule(rule, point({ value: 151 }))).toBe(true);
  });

  it("ignores forecasts issued too far ahead, other metrics and other provinces", () => {
    expect(forecastMeetsRule(rule, point({ value: 400, leadHours: 72 }))).toBe(false);
    expect(forecastMeetsRule(rule, point({ value: 400, metric: "wind_gust_kmh" }))).toBe(false);
    expect(forecastMeetsRule(rule, point({ value: 400, provinceId: "ha-noi" }))).toBe(false);
  });
});

describe("evaluateRule", () => {
  it("fires for every Yagi province, each on its earliest qualifying forecast", () => {
    const triggers = evaluateRule(rule, yagi.forecast);
    expect(triggers.map((t) => [t.provinceId, t.value, t.leadHours])).toEqual([
      ["quang-ninh", 180, 48],
      ["hai-phong", 160, 48],
      ["thai-binh", 170, 24],
    ]);
    expect(triggers.every((t) => t.threshold === 150)).toBe(true);
  });

  it("returns no triggers when nothing reaches the threshold", () => {
    expect(evaluateRule(rule, [point({ value: 100 })])).toEqual([]);
  });

  it("rejects an unlocked rule", () => {
    expect(() => evaluateRule(unlocked, yagi.forecast)).toThrow(UnlockedRuleError);
  });
});

describe("calculatePlanItems", () => {
  const triggers = evaluateRule(rule, yagi.forecast);

  it("pays each partner 20 dollars per household, and the total is the sum of the items", () => {
    const items = calculatePlanItems({ rule, triggers, households: yagi.households });
    expect(items.map((i) => [i.partnerId, i.householdIds.length, i.amountCents])).toEqual([
      ["partner-qn", 14, 28_000],
      ["partner-hp", 10, 20_000],
      ["partner-tb", 8, 16_000],
    ]);
    expect(planTotalCents(items)).toBe(64_000);
    expect(items.every((i) => i.payoutItemId === null && i.payoutStatus === null)).toBe(true);
  });

  it("leaves out excluded households and recalculates", () => {
    const items = calculatePlanItems({
      rule,
      triggers,
      households: yagi.households,
      excludedHouseholdIds: ["hh-qn-13", "hh-qn-14"],
    });
    const qn = items.find((i) => i.partnerId === "partner-qn")!;
    expect(qn.householdIds).not.toContain("hh-qn-13");
    expect(qn.amountCents).toBe(24_000);
    expect(planTotalCents(items)).toBe(60_000);
  });

  it("only pays provinces that triggered, and drops partners with no households left", () => {
    const qnOnly = triggers.filter((t) => t.provinceId === "quang-ninh");
    const items = calculatePlanItems({ rule, triggers: qnOnly, households: yagi.households });
    expect(items.map((i) => i.partnerId)).toEqual(["partner-qn"]);

    const allExcluded = yagi.households.filter((h) => h.partnerId === "partner-qn").map((h) => h.id);
    expect(calculatePlanItems({ rule, triggers: qnOnly, households: yagi.households, excludedHouseholdIds: allExcluded })).toEqual([]);
  });

  it("rejects an unlocked rule and a non-integer amount", () => {
    expect(() => calculatePlanItems({ rule: unlocked, triggers, households: yagi.households })).toThrow(UnlockedRuleError);
    const bad = { ...rule, amountPerHouseholdCents: 20.5 };
    expect(() => calculatePlanItems({ rule: bad, triggers, households: [] as Household[] })).toThrow(/invalid amount/);
  });
});

describe("rule versions", () => {
  it("locks a draft once and refuses to lock it again", () => {
    const locked = lockRule(unlocked, "Organizer", new Date("2024-06-30T10:00:00Z"));
    expect(locked).toMatchObject({ lockedAt: "2024-06-30T10:00:00.000Z", lockedBy: "Organizer" });
    expect(unlocked.lockedAt).toBeNull();
    expect(() => lockRule(locked, "Someone else")).toThrow(RuleAlreadyLockedError);
  });

  it("creates a new unlocked version instead of editing a locked rule", () => {
    const next = newRuleVersion(rule, { threshold: 120 });
    expect(next).toMatchObject({ id: "rule-rain-150-v2", key: rule.key, version: 2, threshold: 120, lockedAt: null });
    expect(rule.threshold).toBe(150);
  });
});

describe("POST /api/rules/[id]/lock", () => {
  type LockRoute = typeof import("@/app/api/rules/[id]/lock/route");
  type StoreModule = typeof import("@/lib/store");

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function setup() {
    const store = await importWithEnv<StoreModule>("@/lib/store", {});
    const state = store.resetScenario();
    state.rules.push(newRuleVersion(state.rules[0], { threshold: 120 }));
    const { POST } = await importWithEnv<LockRoute>("@/app/api/rules/[id]/lock/route", {});
    const call = (id: string, body: unknown) =>
      POST(
        new Request(`http://localhost:3000/api/rules/${id}/lock`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id }) },
      );
    return { call, store };
  }

  it("locks a draft rule and records who locked it", async () => {
    const { call, store } = await setup();
    const res = await call("rule-rain-150-v2", { lockedBy: "  Demo organizer  " });
    expect(res.status).toBe(200);
    const { rule: locked } = await res.json();
    expect(locked).toMatchObject({ id: "rule-rain-150-v2", lockedBy: "Demo organizer" });
    expect(store.getStore().rules.find((r) => r.id === "rule-rain-150-v2")?.lockedAt).not.toBeNull();
  });

  it("refuses to lock an already locked rule", async () => {
    const { call } = await setup();
    expect((await call("rule-rain-150-v1", { lockedBy: "Someone" })).status).toBe(409);
  });

  it("validates the name and the rule id", async () => {
    const { call } = await setup();
    expect((await call("rule-rain-150-v2", {})).status).toBe(400);
    expect((await call("rule-rain-150-v2", { lockedBy: "x".repeat(81) })).status).toBe(400);
    expect((await call("no-such-rule", { lockedBy: "Someone" })).status).toBe(404);
    expect((await call("../etc", { lockedBy: "Someone" })).status).toBe(404);
  });
});
