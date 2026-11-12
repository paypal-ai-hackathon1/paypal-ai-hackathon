// Plain-language explanations of the household flags and the plan, written by AI.
//
// The model only sees household IDs, check results and the amounts code already calculated. No
// names, phone numbers or addresses are sent. Its text is shown as a note: it cannot add or remove
// a flag, exclude a household or change an amount. If AI fails, the template explanations stay.

import "server-only";
import { chatJson, DATA_POLICY, isRecord, type Validator } from "./ai";
import type { HouseholdFlag, Plan } from "./domain";
import type { CheckResult } from "./flags";
import { withTemplates } from "./flags";

export type PlanExplanation = {
  flags: HouseholdFlag[];
  summary: string;
  source: "ai" | "template";
  mock: boolean;
};

type AiAnswer = { summary: string; explanations: { householdId: string; kind: string; text: string }[] };

const MAX_TEXT = 400;

const validate: Validator<AiAnswer> = (value) => {
  if (!isRecord(value)) return { ok: false, error: "Reply with one JSON object." };
  if (typeof value.summary !== "string" || !value.summary.trim() || value.summary.length > 1200) {
    return { ok: false, error: "`summary` must be a non-empty string of at most 1200 characters." };
  }
  if (!Array.isArray(value.explanations)) return { ok: false, error: "`explanations` must be an array." };
  const explanations: AiAnswer["explanations"] = [];
  for (const e of value.explanations) {
    if (!isRecord(e) || typeof e.householdId !== "string" || typeof e.kind !== "string" || typeof e.text !== "string") {
      return { ok: false, error: 'Each explanation needs string "householdId", "kind" and "text".' };
    }
    if (!e.text.trim() || e.text.length > MAX_TEXT) {
      return { ok: false, error: `Each explanation "text" must be 1 to ${MAX_TEXT} characters.` };
    }
    explanations.push({ householdId: e.householdId, kind: e.kind, text: e.text.trim() });
  }
  return { ok: true, value: { summary: value.summary.trim(), explanations } };
};

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** What the plan summary says without AI. Built only from the plan's own numbers. */
export function templateSummary(plan: Plan, results: CheckResult[]): string {
  const households = plan.items.reduce((n, i) => n + i.householdIds.length, 0);
  const flagged = new Set(results.map((r) => r.householdId)).size;
  return (
    `This plan sends ${dollars(plan.totalCents)} to ${plan.items.length} local partners for ${households} households, ` +
    `under locked rule v${plan.ruleVersion}. ${flagged} households have review notes; none were excluded automatically.`
  );
}

const SYSTEM_PROMPT = `You help a relief reviewer in Vietnam understand a payout plan before they approve it. ${DATA_POLICY}

You get the plan's numbers and the results of automatic checks on households (IDs only).
Return: {"summary": "...", "explanations": [{"householdId": "...", "kind": "...", "text": "..."}]}
- summary: 2 or 3 plain English sentences on what will be paid, to how many partners and households, and what to check before approving.
- explanations: one per check result, in plain English, saying why it matters and what the reviewer could check. At most 2 sentences.
Rules: copy every amount exactly as given. Never suggest a different amount. Never say a household is fraudulent; say what to verify. Do not decide whether anyone is excluded.`;

/**
 * Explains the flags and the plan with AI. Always returns something: explanations the model did
 * not give, or a failed call, fall back to the templates.
 */
export async function explainPlan(plan: Plan, results: CheckResult[]): Promise<PlanExplanation> {
  const templates = withTemplates(results);
  const fallback = { flags: templates, summary: templateSummary(plan, results), source: "template" as const };

  const facts = {
    totalUsd: dollars(plan.totalCents),
    ruleVersion: plan.ruleVersion,
    partners: plan.items.map((i) => ({ partnerId: i.partnerId, households: i.householdIds.length, amountUsd: dollars(i.amountCents) })),
    excludedHouseholds: plan.excludedHouseholdIds.length,
    checks: results.map((r) => ({ householdId: r.householdId, kind: r.kind, relatedHouseholdIds: r.relatedHouseholdIds })),
  };

  const result = await chatJson({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `<data name="plan">\n${JSON.stringify(facts)}\n</data>` },
    ],
    validate,
    mock: { summary: fallback.summary, explanations: [] },
  });
  if (!result.ok) return { ...fallback, mock: result.mock };
  if (result.mock) return { ...fallback, mock: true };

  // The summary may only repeat amounts code calculated. Any other dollar figure means the model
  // made one up, so the template summary is used instead.
  const perHousehold = plan.items
    .filter((i) => i.householdIds.length > 0)
    .map((i) => dollars(Math.round(i.amountCents / i.householdIds.length)));
  const allowed = new Set([facts.totalUsd, ...facts.partners.map((p) => p.amountUsd), ...perHousehold]);
  const mentioned = result.value.summary.match(/\$\s?[\d,]+(?:\.\d+)?/g) ?? [];
  const summaryOk = mentioned.every((m) => {
    const n = Number(m.replace(/[$,\s]/g, ""));
    return [...allowed].some((a) => Number(a.replace(/[$,]/g, "")) === n);
  });

  const flags = templates.map((flag) => {
    const ai = result.value.explanations.find((e) => e.householdId === flag.householdId && e.kind === flag.kind);
    return ai ? { ...flag, explanation: ai.text, explanationSource: "ai" as const } : flag;
  });
  return { flags, summary: summaryOk ? result.value.summary : fallback.summary, source: "ai", mock: false };
}
