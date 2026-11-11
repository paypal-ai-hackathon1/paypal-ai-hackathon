// Deterministic rules engine: decides which provinces a locked rule covers and how much each
// partner receives. Pure functions only. No AI imports are allowed in this file: AI output can
// never change a threshold or an amount.

import type { ForecastPoint, Household, PlanPartnerItem, PlanTrigger, Rule } from "./domain";

/** Thrown when an unlocked (draft) rule is used to start a plan. Routes map it to 409. */
export class UnlockedRuleError extends Error {
  constructor(ruleId: string) {
    super(`Rule ${ruleId} is not locked. Only locked rules can start a plan.`);
    this.name = "UnlockedRuleError";
  }
}

/** Thrown when someone tries to lock a rule that is already locked. Routes map it to 409. */
export class RuleAlreadyLockedError extends Error {
  constructor(ruleId: string) {
    super(`Rule ${ruleId} is already locked. Create a new version to change it.`);
    this.name = "RuleAlreadyLockedError";
  }
}

export function isLocked(rule: Rule): boolean {
  return rule.lockedAt !== null;
}

/**
 * True when this forecast counts for the rule and reaches its threshold:
 * same metric, a province the rule covers, issued at most `maxLeadHours` ahead, value >= threshold.
 */
export function forecastMeetsRule(rule: Rule, point: ForecastPoint): boolean {
  return (
    point.metric === rule.metric &&
    rule.provinceIds.includes(point.provinceId) &&
    point.leadHours <= rule.maxLeadHours &&
    point.value >= rule.threshold
  );
}

/**
 * The provinces a locked rule fires for, one trigger per province: the earliest-issued forecast
 * that met the rule. Provinces are returned in the rule's own order.
 */
export function evaluateRule(rule: Rule, forecast: ForecastPoint[]): PlanTrigger[] {
  if (!isLocked(rule)) throw new UnlockedRuleError(rule.id);

  const triggers: PlanTrigger[] = [];
  for (const provinceId of rule.provinceIds) {
    const first = forecast
      .filter((p) => p.provinceId === provinceId && forecastMeetsRule(rule, p))
      .sort((a, b) => Date.parse(a.issuedAt) - Date.parse(b.issuedAt) || a.id.localeCompare(b.id))[0];
    if (!first) continue;
    triggers.push({
      provinceId,
      forecastPointId: first.id,
      metric: first.metric,
      value: first.value,
      threshold: rule.threshold,
      leadHours: first.leadHours,
    });
  }
  return triggers;
}

/**
 * One payout line per partner: the households in triggered provinces, minus excluded ones, times
 * the rule's fixed amount. Partners with no remaining households get no line.
 */
export function calculatePlanItems(input: {
  rule: Rule;
  triggers: PlanTrigger[];
  households: Household[];
  excludedHouseholdIds?: string[];
}): PlanPartnerItem[] {
  const { rule, triggers, households } = input;
  if (!isLocked(rule)) throw new UnlockedRuleError(rule.id);
  if (!Number.isSafeInteger(rule.amountPerHouseholdCents) || rule.amountPerHouseholdCents <= 0) {
    throw new Error(`Rule ${rule.id} has an invalid amount: ${rule.amountPerHouseholdCents}`);
  }

  const triggered = new Set(triggers.map((t) => t.provinceId));
  const excluded = new Set(input.excludedHouseholdIds ?? []);
  const byPartner = new Map<string, string[]>();

  for (const h of households) {
    if (!triggered.has(h.provinceId) || excluded.has(h.id)) continue;
    const ids = byPartner.get(h.partnerId) ?? [];
    ids.push(h.id);
    byPartner.set(h.partnerId, ids);
  }

  return [...byPartner].map(([partnerId, householdIds]) => ({
    partnerId,
    householdIds,
    amountCents: householdIds.length * rule.amountPerHouseholdCents,
    payoutItemId: null,
    payoutStatus: null,
  }));
}

export function planTotalCents(items: PlanPartnerItem[]): number {
  return items.reduce((sum, item) => sum + item.amountCents, 0);
}

/** Returns a locked copy of a draft rule. Throws if it is already locked: locked rules never change. */
export function lockRule(rule: Rule, lockedBy: string, now: Date = new Date()): Rule {
  if (isLocked(rule)) throw new RuleAlreadyLockedError(rule.id);
  return { ...rule, lockedAt: now.toISOString(), lockedBy };
}

/**
 * A new unlocked version of a rule with some fields changed. The key stays the same, the version
 * goes up by one, and the old version is left untouched.
 */
export function newRuleVersion(
  rule: Rule,
  changes: Partial<Pick<Rule, "sourceSentence" | "metric" | "threshold" | "maxLeadHours" | "provinceIds" | "amountPerHouseholdCents">>,
  now: Date = new Date(),
): Rule {
  const version = rule.version + 1;
  return {
    ...rule,
    ...changes,
    id: `${rule.key}-v${version}`,
    version,
    createdAt: now.toISOString(),
    lockedAt: null,
    lockedBy: null,
  };
}
