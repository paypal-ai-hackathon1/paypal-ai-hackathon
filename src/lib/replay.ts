// Builds the landing page's replay timeline from a scenario fixture: forecasts checked against the
// locked rule, bulletins as they were issued, and the moment a payout plan becomes ready.
// Pure and client-safe: no env, no store, no AI. It only decides what to show on the timeline.
// The plan itself (households, amounts) is created by the plan routes and the rules engine.

import type { ForecastMetric, Rule, Scenario } from "./domain";

export type ForecastRow = {
  provinceId: string;
  provinceName: string;
  value: number;
  leadHours: number;
  /** False when the forecast was issued further ahead than the rule allows. */
  counts: boolean;
  /** The forecast counts and reaches the rule's threshold. */
  meetsRule: boolean;
  /** First forecast that met the rule for this province. */
  newlyTriggered: boolean;
};

export type ReplayEvent =
  | { kind: "forecast"; id: string; at: string; leadHours: number; metric: ForecastMetric; rows: ForecastRow[] }
  | { kind: "bulletin"; id: string; at: string; issuer: string; title: string; text: string; simulated: boolean }
  | { kind: "plan"; id: string; at: string; provinceIds: string[]; householdCount: number; partnerCount: number };

export type ReplayRule = Pick<
  Rule,
  "id" | "version" | "sourceSentence" | "metric" | "threshold" | "maxLeadHours" | "provinceIds" | "lockedAt" | "lockedBy"
>;

export type Replay = {
  scenarioId: string;
  scenarioName: string;
  description: string;
  startsAt: string;
  /** The locked rule the replay checks forecasts against, or null when the scenario has none. */
  rule: ReplayRule | null;
  provinces: { id: string; name: string; nameVi: string }[];
  events: ReplayEvent[];
};

const KIND_ORDER: Record<ReplayEvent["kind"], number> = { bulletin: 0, forecast: 1, plan: 2 };

export function buildReplay(scenario: Scenario): Replay {
  // Only a locked rule can start a plan, so unlocked drafts never appear on the timeline.
  const lockedRule = scenario.rules.find((r) => r.lockedAt !== null) ?? null;
  const provinceOrder = new Map(scenario.provinces.map((p, i) => [p.id, i]));
  const provinceName = new Map(scenario.provinces.map((p) => [p.id, p.name]));

  const events: ReplayEvent[] = scenario.bulletins.map((b) => ({
    kind: "bulletin",
    id: b.id,
    at: b.issuedAt,
    issuer: b.issuer,
    title: b.text.split("\n")[0].trim(),
    text: b.text,
    simulated: b.simulated,
  }));

  if (lockedRule) {
    const points = scenario.forecast.filter(
      (f) => f.metric === lockedRule.metric && lockedRule.provinceIds.includes(f.provinceId),
    );
    const issuedTimes = [...new Set(points.map((p) => p.issuedAt))].sort((a, b) => Date.parse(a) - Date.parse(b));
    const triggered = new Set<string>();
    let lastTriggerAt: string | null = null;

    for (const at of issuedTimes) {
      const batch = points
        .filter((p) => p.issuedAt === at)
        .sort((a, b) => (provinceOrder.get(a.provinceId) ?? 0) - (provinceOrder.get(b.provinceId) ?? 0));

      const rows = batch.map((p): ForecastRow => {
        const counts = p.leadHours <= lockedRule.maxLeadHours;
        const meetsRule = counts && p.value >= lockedRule.threshold;
        const newlyTriggered = meetsRule && !triggered.has(p.provinceId);
        if (newlyTriggered) triggered.add(p.provinceId);
        return {
          provinceId: p.provinceId,
          provinceName: provinceName.get(p.provinceId) ?? p.provinceId,
          value: p.value,
          leadHours: p.leadHours,
          counts,
          meetsRule,
          newlyTriggered,
        };
      });

      if (rows.some((r) => r.newlyTriggered)) lastTriggerAt = at;
      events.push({ kind: "forecast", id: `forecast-${at}`, at, leadHours: batch[0].leadHours, metric: lockedRule.metric, rows });
    }

    if (lastTriggerAt) {
      const provinceIds = scenario.provinces.map((p) => p.id).filter((id) => triggered.has(id));
      events.push({
        kind: "plan",
        id: "plan-ready",
        at: lastTriggerAt,
        provinceIds,
        householdCount: scenario.households.filter((h) => triggered.has(h.provinceId)).length,
        partnerCount: scenario.partners.filter((p) => triggered.has(p.provinceId)).length,
      });
    }
  }

  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    description: scenario.description,
    startsAt: scenario.startsAt,
    rule: lockedRule && {
      id: lockedRule.id,
      version: lockedRule.version,
      sourceSentence: lockedRule.sourceSentence,
      metric: lockedRule.metric,
      threshold: lockedRule.threshold,
      maxLeadHours: lockedRule.maxLeadHours,
      provinceIds: lockedRule.provinceIds,
      lockedAt: lockedRule.lockedAt,
      lockedBy: lockedRule.lockedBy,
    },
    provinces: scenario.provinces,
    events,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * "2024-09-05T19:00:00+07:00" -> "5 Sep 2024, 19:00" in Vietnam time.
 * Written by hand instead of Intl so server and browser always render the same text.
 */
export function formatVietnamTime(iso: string): string {
  const d = new Date(Date.parse(iso) + VIETNAM_OFFSET_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export const METRIC_LABEL: Record<ForecastMetric, { name: string; unit: string }> = {
  rain_24h_mm: { name: "Rain in 24 hours", unit: "mm" },
  wind_gust_kmh: { name: "Wind gusts", unit: "km/h" },
};
