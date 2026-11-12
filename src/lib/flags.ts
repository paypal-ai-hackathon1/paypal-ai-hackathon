// Deterministic checks for households a reviewer should look at twice. Pure, no AI, no store.
//
// A flag is only a review note. It never excludes a household and never changes an amount:
// excluding stays a person's decision on the review screen.

import type { Household, HouseholdFlag, HouseholdFlagKind } from "./domain";

/** A spike is this many registrations or more for one partner within SPIKE_WINDOW_MS. */
export const SPIKE_MIN_COUNT = 3;
export const SPIKE_WINDOW_MS = 60 * 60 * 1000;

export type CheckResult = { householdId: string; kind: HouseholdFlagKind; relatedHouseholdIds: string[] };

const normalizePhone = (phone: string) => phone.replace(/\D/g, "");
const normalizeAddress = (address: string) =>
  address
    .normalize("NFC")
    .toLowerCase()
    .replace(/[.,;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function groupBy(households: Household[], key: (h: Household) => string, kind: HouseholdFlagKind): CheckResult[] {
  const groups = new Map<string, string[]>();
  for (const h of households) {
    const k = key(h);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), h.id]);
  }
  const results: CheckResult[] = [];
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) results.push({ householdId: id, kind, relatedHouseholdIds: ids.filter((other) => other !== id) });
  }
  return results;
}

/** Households registered by the same partner in a burst: SPIKE_MIN_COUNT or more within an hour. */
function registrationSpikes(households: Household[]): CheckResult[] {
  const byPartner = new Map<string, Household[]>();
  for (const h of households) byPartner.set(h.partnerId, [...(byPartner.get(h.partnerId) ?? []), h]);

  const flagged = new Map<string, Set<string>>();
  for (const list of byPartner.values()) {
    const sorted = [...list].sort((a, b) => Date.parse(a.registeredAt) - Date.parse(b.registeredAt));
    let start = 0;
    for (let end = 0; end < sorted.length; end++) {
      while (Date.parse(sorted[end].registeredAt) - Date.parse(sorted[start].registeredAt) > SPIKE_WINDOW_MS) start++;
      if (end - start + 1 < SPIKE_MIN_COUNT) continue;
      const burst = sorted.slice(start, end + 1).map((h) => h.id);
      for (const id of burst) {
        const set = flagged.get(id) ?? new Set<string>();
        for (const other of burst) if (other !== id) set.add(other);
        flagged.set(id, set);
      }
    }
  }
  return [...flagged].map(([householdId, related]) => ({
    householdId,
    kind: "registration_spike" as const,
    relatedHouseholdIds: [...related].sort(),
  }));
}

/** Runs every check. Results are sorted by household ID, then kind, so output is stable. */
export function checkHouseholds(households: Household[]): CheckResult[] {
  return [
    ...groupBy(households, (h) => normalizePhone(h.phone), "duplicate_phone"),
    ...groupBy(households, (h) => normalizeAddress(h.address), "duplicate_address"),
    ...registrationSpikes(households),
  ].sort((a, b) => a.householdId.localeCompare(b.householdId) || a.kind.localeCompare(b.kind));
}

/** The explanation shown when AI is not used or fails. It only restates the check result. */
export function templateExplanation(result: CheckResult): string {
  const others = result.relatedHouseholdIds.join(", ");
  switch (result.kind) {
    case "duplicate_phone":
      return `Registered with the same phone number as ${others}. Check that these are different families before paying both.`;
    case "duplicate_address":
      return `Registered at the same address as ${others}. It may be one family registered twice, or neighbours sharing a house.`;
    case "registration_spike":
      return `Registered by the same partner within one hour of ${others}. A sudden burst can be real outreach or padding: ask the partner how these families were found.`;
  }
}

export function withTemplates(results: CheckResult[]): HouseholdFlag[] {
  return results.map((r) => ({ ...r, explanation: templateExplanation(r), explanationSource: "template" as const }));
}
