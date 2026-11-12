// Everything the plan review screen shows, gathered on the server in one call.
// Server-only: it reads the in-memory store. Households and partners come from getPlanView(),
// which already leaves out phones, receipt codes, emails and tokens.

import "server-only";
import type { Bulletin, BulletinReading, Province, Rule } from "./domain";
import { getPlanView, type PlanView } from "./plans";
import { getStore } from "./store";

/** The rule behind the plan, without anything the screen does not need. */
export type ReviewRule = Pick<
  Rule,
  | "id"
  | "version"
  | "sourceSentence"
  | "metric"
  | "threshold"
  | "maxLeadHours"
  | "amountPerHouseholdCents"
  | "lockedAt"
  | "lockedBy"
>;

/** A bulletin with the latest AI reading of it, or null until the bulletin reader (#11) has run. */
export type ReviewBulletin = Bulletin & { reading: BulletinReading | null };

export type PlanReview = PlanView & {
  rule: ReviewRule | null;
  provinces: Province[];
  bulletins: ReviewBulletin[];
};

/** Throws PlanError(404) for an unknown plan, like getPlanView(). */
export function getPlanReview(planId: string): PlanReview {
  const view = getPlanView(planId);
  const store = getStore();
  const rule = store.rules.find((r) => r.id === view.plan.ruleId);

  return {
    ...view,
    rule: rule
      ? {
          id: rule.id,
          version: rule.version,
          sourceSentence: rule.sourceSentence,
          metric: rule.metric,
          threshold: rule.threshold,
          maxLeadHours: rule.maxLeadHours,
          amountPerHouseholdCents: rule.amountPerHouseholdCents,
          lockedAt: rule.lockedAt,
          lockedBy: rule.lockedBy,
        }
      : null,
    provinces: store.provinces,
    bulletins: [...store.bulletins]
      .sort((a, b) => Date.parse(a.issuedAt) - Date.parse(b.issuedAt))
      .map((bulletin) => ({
        ...bulletin,
        reading: store.bulletinReadings.findLast((r) => r.bulletinId === bulletin.id) ?? null,
      })),
  };
}
