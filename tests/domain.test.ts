import { afterEach, describe, expect, it, vi } from "vitest";
import { yagi } from "@/data/scenarios/yagi";
import { importWithEnv } from "./helpers";

type StoreModule = typeof import("@/lib/store");

afterEach(() => {
  vi.unstubAllEnvs();
});

function duplicates(values: string[]): string[] {
  return values.filter((v, i) => values.indexOf(v) !== i);
}

describe("Yagi fixture integrity", () => {
  it("has 3 provinces, 3 partners and 14 / 10 / 8 households", () => {
    expect(yagi.provinces).toHaveLength(3);
    expect(yagi.partners).toHaveLength(3);
    const perProvince = Object.fromEntries(
      yagi.provinces.map((p) => [p.id, yagi.households.filter((h) => h.provinceId === p.id).length]),
    );
    expect(perProvince).toEqual({ "quang-ninh": 14, "hai-phong": 10, "thai-binh": 8 });
  });

  it("uses unique IDs across every kind of record", () => {
    const ids = [
      ...yagi.provinces,
      ...yagi.partners,
      ...yagi.households,
      ...yagi.forecast,
      ...yagi.bulletins,
      ...yagi.rules,
    ].map((r) => r.id);
    expect(duplicates(ids)).toEqual([]);
  });

  it("links every household to an existing partner in the same province", () => {
    const partners = new Map(yagi.partners.map((p) => [p.id, p]));
    const provinceIds = new Set(yagi.provinces.map((p) => p.id));

    for (const p of yagi.partners) expect(provinceIds.has(p.provinceId), p.id).toBe(true);
    for (const h of yagi.households) {
      expect(partners.get(h.partnerId)?.provinceId, h.id).toBe(h.provinceId);
    }
  });

  it("gives every household a unique receipt code", () => {
    expect(duplicates(yagi.households.map((h) => h.receiptCode))).toEqual([]);
  });

  it("only uses obviously fake phone numbers", () => {
    for (const h of yagi.households) expect(h.phone, h.id).toMatch(/^\+84 000 000 \d{3}$/);
  });

  it("keeps the planted cases the suspicious-household checks rely on", () => {
    const byId = new Map(yagi.households.map((h) => [h.id, h]));
    expect(byId.get("hh-qn-13")?.phone).toBe(byId.get("hh-qn-04")?.phone);
    expect(byId.get("hh-qn-14")?.address).toBe(byId.get("hh-qn-07")?.address);

    const spike = ["hh-hp-07", "hh-hp-08", "hh-hp-09", "hh-hp-10"].map((id) => Date.parse(byId.get(id)!.registeredAt));
    expect(Math.max(...spike) - Math.min(...spike)).toBeLessThan(60 * 60 * 1000);

    const otherPhones = duplicates(yagi.households.filter((h) => h.id !== "hh-qn-13").map((h) => h.phone));
    expect(otherPhones).toEqual([]);
  });

  it("marks bulletins as simulated unless a source is cited", () => {
    expect(yagi.bulletins).toHaveLength(3);
    for (const b of yagi.bulletins) expect(b.simulated || Boolean(b.sourceUrl), b.id).toBe(true);
  });

  it("stores money as integer cents", () => {
    for (const r of yagi.rules) {
      expect(Number.isInteger(r.amountPerHouseholdCents), r.id).toBe(true);
      expect(r.amountPerHouseholdCents).toBeGreaterThan(0);
    }
  });

  it("has forecasts for every province, metric and lead time, with lead hours matching the dates", () => {
    expect(yagi.forecast).toHaveLength(3 * 2 * 3);
    for (const f of yagi.forecast) {
      const hours = (Date.parse(f.validFrom) - Date.parse(f.issuedAt)) / 3_600_000;
      expect(hours, f.id).toBe(f.leadHours);
    }
  });

  it("crosses the 150 mm rule in Quang Ninh and Hai Phong at 48 h, but in Thai Binh only at 24 h", () => {
    // The demo story and the rules engine (#6) rely on this split; change both together.
    const rule = yagi.rules[0];
    const crossesAt = (provinceId: string) =>
      yagi.forecast
        .filter((f) => f.provinceId === provinceId && f.metric === rule.metric && f.value >= rule.threshold)
        .map((f) => f.leadHours)
        .sort((a, b) => b - a);

    expect(crossesAt("quang-ninh")).toEqual([48, 24]);
    expect(crossesAt("hai-phong")).toEqual([48, 24]);
    expect(crossesAt("thai-binh")).toEqual([24]);
    expect(rule.maxLeadHours).toBe(48);
  });

  it("names every province literally in the bulletins, so quotes can be checked (#11)", () => {
    const allText = yagi.bulletins.map((b) => b.text).join("\n");
    for (const p of yagi.provinces) expect(allText, p.nameVi).toContain(p.nameVi);
  });

  it("ships a locked rule that references real provinces", () => {
    const provinceIds = new Set(yagi.provinces.map((p) => p.id));
    for (const r of yagi.rules) {
      expect(r.lockedAt, r.id).not.toBeNull();
      expect(r.sourceSentence.length).toBeGreaterThan(0);
      for (const id of r.provinceIds) expect(provinceIds.has(id), id).toBe(true);
    }
  });
});

describe("store", () => {
  it("falls back to @example.com partner emails without PARTNER_PAYPAL_EMAILS", async () => {
    const { resetScenario } = await importWithEnv<StoreModule>("@/lib/store", { PARTNER_PAYPAL_EMAILS: "" });
    const state = resetScenario("yagi-2024");

    expect(state.partners.map((p) => p.paypalEmail)).toEqual([
      "partner-qn@example.com",
      "partner-hp@example.com",
      "partner-tb@example.com",
    ]);
  });

  it("assigns PARTNER_PAYPAL_EMAILS in partner order, and an invalid entry keeps its slot", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { resetScenario } = await importWithEnv<StoreModule>("@/lib/store", {
      PARTNER_PAYPAL_EMAILS: " a@sandbox.test , not-an-email, c@sandbox.test",
    });
    const state = resetScenario();

    // The bad middle entry must not shift c@ onto the Hai Phong partner.
    expect(state.partners.map((p) => [p.id, p.paypalEmail])).toEqual([
      ["partner-qn", "a@sandbox.test"],
      ["partner-hp", "partner-hp@example.com"],
      ["partner-tb", "c@sandbox.test"],
    ]);
    expect(warn).toHaveBeenCalledWith("PARTNER_PAYPAL_EMAILS: 1 invalid entry ignored");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("not-an-email");
    warn.mockRestore();
  });

  it("empties runtime state on reset", async () => {
    const { getStore, resetScenario } = await importWithEnv<StoreModule>("@/lib/store", {});
    resetScenario();
    const s = getStore();
    s.plans.push({ id: "plan-x" } as never);
    s.confirmations.push({ id: "conf-x" } as never);
    s.callbackChecks.push({ id: "cb-x" } as never);
    s.bulletinReadings.push({ bulletinId: "b" } as never);

    const fresh = resetScenario();
    expect([fresh.plans, fresh.confirmations, fresh.callbackChecks, fresh.bulletinReadings]).toEqual([[], [], [], []]);
  });

  it("loads every fixture collection, each from one source", async () => {
    const { resetScenario } = await importWithEnv<StoreModule>("@/lib/store", {});
    const state = resetScenario();

    expect(state).toMatchObject({ scenarioId: "yagi-2024", scenarioName: yagi.name, startsAt: yagi.startsAt });
    expect(state.forecast).toEqual(yagi.forecast);
    expect(state.bulletins).toEqual(yagi.bulletins);
    expect(state).not.toHaveProperty("scenario");
  });

  it("masks phones and hides receipt codes in the public household shape", async () => {
    const { maskPhone, resetScenario, toPublicHousehold } = await importWithEnv<StoreModule>("@/lib/store", {});
    const household = resetScenario().households.find((h) => h.id === "hh-qn-04")!;
    const shown = toPublicHousehold(household);

    expect(shown.phoneMasked).toBe("+84 *** *** 104");
    expect(shown).not.toHaveProperty("phone");
    expect(shown).not.toHaveProperty("receiptCode");
    expect(JSON.stringify(shown)).not.toContain(household.receiptCode);
    expect(maskPhone("12")).toBe("***");
  });

  it("gives partners long, distinct tokens that change on every reset", async () => {
    const { resetScenario } = await importWithEnv<StoreModule>("@/lib/store", {});
    const first = resetScenario().partners.map((p) => p.accessToken);
    const second = resetScenario().partners.map((p) => p.accessToken);

    expect(duplicates(first)).toEqual([]);
    for (const token of first) expect(token.length).toBeGreaterThanOrEqual(32);
    expect(second.some((t) => first.includes(t))).toBe(false);
  });

  it("shares one state on globalThis, even across separate module instances", async () => {
    const a = await importWithEnv<StoreModule>("@/lib/store", {});
    a.resetScenario();
    a.getStore().households.pop();

    const b = await importWithEnv<StoreModule>("@/lib/store", {});
    expect(b).not.toBe(a);
    expect(b.getStore().households).toHaveLength(31);
  });

  it("resets to a fresh copy without touching the fixture", async () => {
    const { getStore, resetScenario } = await importWithEnv<StoreModule>("@/lib/store", {});
    resetScenario();
    getStore().households.length = 0;
    getStore().rules[0].threshold = 1;

    const state = resetScenario();
    expect(state.households).toHaveLength(32);
    expect(state.rules[0].threshold).toBe(150);
    expect(yagi.households).toHaveLength(32);
  });

  it("rejects an unknown scenario", async () => {
    const { resetScenario } = await importWithEnv<StoreModule>("@/lib/store", {});
    expect(() => resetScenario("no-such-scenario")).toThrow(/Unknown scenario/);
  });

  it("creates IDs that do not repeat", async () => {
    const { newId } = await importWithEnv<StoreModule>("@/lib/store", {});
    const ids = Array.from({ length: 1000 }, () => newId("plan"));
    expect(duplicates(ids)).toEqual([]);
    expect(ids[0]).toMatch(/^plan-[0-9a-f]{12}$/);
  });
});
