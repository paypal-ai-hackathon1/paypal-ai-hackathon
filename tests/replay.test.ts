import { describe, expect, it } from "vitest";
import { yagi } from "@/data/scenarios/yagi";
import { buildReplay, formatVietnamTime, type ReplayEvent } from "@/lib/replay";

type ForecastEvent = Extract<ReplayEvent, { kind: "forecast" }>;

function forecastAt(events: ReplayEvent[], leadHours: number): ForecastEvent {
  const event = events.find((e): e is ForecastEvent => e.kind === "forecast" && e.leadHours === leadHours);
  if (!event) throw new Error(`No forecast event at ${leadHours}h`);
  return event;
}

function rowsBy(event: ForecastEvent) {
  return Object.fromEntries(event.rows.map((r) => [r.provinceId, r]));
}

describe("buildReplay with the Yagi fixture", () => {
  const replay = buildReplay(yagi);

  it("lists events in time order", () => {
    const times = replay.events.map((e) => Date.parse(e.at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("includes every bulletin with its first line as the title", () => {
    const bulletins = replay.events.filter((e) => e.kind === "bulletin");
    expect(bulletins).toHaveLength(yagi.bulletins.length);
    expect(bulletins[0]).toMatchObject({ title: "TIN BÃO TRÊN BIỂN ĐÔNG (CƠN BÃO SỐ 3 - YAGI)", simulated: true });
  });

  it("ignores 72-hour forecasts because the rule only counts 48 hours ahead", () => {
    const rows = forecastAt(replay.events, 72).rows;
    expect(rows.every((r) => !r.counts && !r.meetsRule && !r.newlyTriggered)).toBe(true);
  });

  it("triggers Quang Ninh and Hai Phong at 48 hours, but not Thai Binh at 140 mm", () => {
    const rows = rowsBy(forecastAt(replay.events, 48));
    expect(rows["quang-ninh"]).toMatchObject({ value: 180, meetsRule: true, newlyTriggered: true });
    expect(rows["hai-phong"]).toMatchObject({ value: 160, meetsRule: true, newlyTriggered: true });
    expect(rows["thai-binh"]).toMatchObject({ value: 140, counts: true, meetsRule: false });
  });

  it("adds Thai Binh at 24 hours without re-triggering the others", () => {
    const rows = rowsBy(forecastAt(replay.events, 24));
    expect(rows["thai-binh"]).toMatchObject({ value: 170, newlyTriggered: true });
    expect(rows["quang-ninh"]).toMatchObject({ meetsRule: true, newlyTriggered: false });
    expect(rows["hai-phong"]).toMatchObject({ meetsRule: true, newlyTriggered: false });
  });

  it("marks the plan ready once, with every triggered province", () => {
    const plans = replay.events.filter((e) => e.kind === "plan");
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      at: "2024-09-06T19:00:00+07:00",
      provinceIds: ["quang-ninh", "hai-phong", "thai-binh"],
      householdCount: 32,
      partnerCount: 3,
    });
  });

  it("exposes the locked rule with its original sentence", () => {
    expect(replay.rule).toMatchObject({ id: "rule-rain-150-v1", threshold: 150, maxLeadHours: 48 });
    expect(replay.rule?.sourceSentence).toContain("150 mm");
  });
});

describe("buildReplay without a locked rule", () => {
  it("shows bulletins only, and never a plan", () => {
    const scenario = structuredClone(yagi);
    scenario.rules = scenario.rules.map((r) => ({ ...r, lockedAt: null, lockedBy: null }));
    const replay = buildReplay(scenario);

    expect(replay.rule).toBeNull();
    expect(replay.events.every((e) => e.kind === "bulletin")).toBe(true);
  });
});

describe("formatVietnamTime", () => {
  it("formats in Vietnam time whatever offset the input uses", () => {
    expect(formatVietnamTime("2024-09-05T19:00:00+07:00")).toBe("5 Sep 2024, 19:00");
    expect(formatVietnamTime("2024-09-06T22:30:00Z")).toBe("7 Sep 2024, 05:30");
  });
});
