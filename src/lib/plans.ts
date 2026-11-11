// Plan lifecycle: create a plan from a locked rule, let a person exclude households, and approve
// it once, which sends the Payouts batch. Server-only: it reads and writes the in-memory store.
//
// Amounts always come from src/lib/rules.ts, never from here or from AI. Approval is the only
// place money moves, and it is guarded three ways:
// - the approver sends the plan's current hash, so they approve exactly what they reviewed;
// - a plan is paid at most once: a later approval returns the first result, and approvals that
//   arrive together share one send;
// - a plan total above MAX_PLAN_TOTAL_CENTS is refused, so a public demo cannot drain the
//   sandbox balance.

import "server-only";
import { createHash } from "node:crypto";
import type {
  CallbackCheck,
  Confirmation,
  HouseholdFlag,
  Plan,
  PlanPartnerItem,
  PlanStatus,
  PublicHousehold,
  PublicPartner,
} from "./domain";
import { centsToAmount, createPayoutBatch, type PayoutBatch } from "./paypal";
import { calculatePlanItems, evaluateRule, planTotalCents, UnlockedRuleError } from "./rules";
import { getStore, newId, toPublicHousehold, type StoreState } from "./store";

/** The most a single plan may pay out: $1,000. The Yagi demo plan is $640. */
export const MAX_PLAN_TOTAL_CENTS = 100_000;

/** A request the plan routes must refuse. `message` is safe to show to the user. */
export class PlanError extends Error {
  constructor(
    readonly status: 404 | 409 | 422 | 502,
    message: string,
    /** The plan as it is now, when the client should reload it (e.g. after a stale hash). */
    readonly plan?: Plan,
  ) {
    super(message);
    this.name = "PlanError";
  }
}

/** Turns a PlanError into its JSON response. Anything else is logged and becomes a generic 500. */
export function planErrorResponse(err: unknown): Response {
  if (err instanceof PlanError) {
    return Response.json({ error: err.message, ...(err.plan ? { plan: err.plan } : {}) }, { status: err.status });
  }
  console.error(err);
  return Response.json({ error: "Something went wrong with this plan" }, { status: 500 });
}

/**
 * SHA-256 of what the approver agrees to: the rule version and every partner's households and
 * amount. Items and household IDs are sorted first, so the same plan always has the same hash.
 */
export function computePlanHash(plan: Pick<Plan, "ruleId" | "ruleVersion" | "items">): string {
  const items = plan.items
    .map((item) => ({
      partnerId: item.partnerId,
      householdIds: [...item.householdIds].sort(),
      amountCents: item.amountCents,
    }))
    .sort((a, b) => a.partnerId.localeCompare(b.partnerId));
  const payload = JSON.stringify({ ruleId: plan.ruleId, ruleVersion: plan.ruleVersion, items });
  return createHash("sha256").update(payload).digest("hex");
}

function findPlan(store: StoreState, planId: string): Plan {
  const plan = store.plans.find((p) => p.id === planId);
  if (!plan) throw new PlanError(404, "Unknown plan");
  return plan;
}

function savePlan(store: StoreState, plan: Plan): Plan {
  store.plans = store.plans.map((p) => (p.id === plan.id ? plan : p));
  return plan;
}

function overCapMessage(totalCents: number): string {
  return `This plan pays ${centsToAmount(totalCents)} USD, more than the demo limit of ${centsToAmount(MAX_PLAN_TOTAL_CENTS)} USD per plan.`;
}

/**
 * Creates the plan for a locked rule. A rule has at most one plan per scenario run: asking again
 * returns the existing plan, so a double click cannot produce two plans that pay the same
 * households.
 */
export function createPlan(ruleId: string, now: Date = new Date()): { plan: Plan; created: boolean } {
  const store = getStore();
  const rule = store.rules.find((r) => r.id === ruleId);
  if (!rule) throw new PlanError(404, "Unknown rule");

  const existing = store.plans.find((p) => p.ruleId === rule.id);
  if (existing) return { plan: existing, created: false };

  let triggers;
  try {
    triggers = evaluateRule(rule, store.forecast);
  } catch (err) {
    if (err instanceof UnlockedRuleError) {
      throw new PlanError(409, "This rule is not locked yet. A person must lock it before it can start a plan.");
    }
    throw err;
  }
  if (triggers.length === 0) {
    throw new PlanError(422, "No forecast meets this rule yet, so there is nothing to pay.");
  }

  const items = calculatePlanItems({ rule, triggers, households: store.households });
  const totalCents = planTotalCents(items);
  if (totalCents > MAX_PLAN_TOTAL_CENTS) throw new PlanError(422, overCapMessage(totalCents));

  const plan: Plan = {
    id: newId("plan"),
    scenarioId: store.scenarioId,
    ruleId: rule.id,
    ruleVersion: rule.version,
    triggers,
    status: "in_review",
    items,
    excludedHouseholdIds: [],
    totalCents,
    planHash: computePlanHash({ ruleId: rule.id, ruleVersion: rule.version, items }),
    createdAt: now.toISOString(),
    approvedBy: null,
    approvedAt: null,
    payoutBatchId: null,
  };
  store.plans = [...store.plans, plan];
  return { plan, created: true };
}

export type PlanView = {
  plan: Plan;
  /** Partners with a payout line or an excluded household in this plan. No email or token. */
  partners: PublicPartner[];
  /** Households in the plan, excluded ones included. Masked phone, no receipt code. */
  households: PublicHousehold[];
  /** Review notes from the suspicious-household checks (#13). Empty until those checks exist. */
  flags: HouseholdFlag[];
  counts: {
    householdsConfirmed: number;
    callbacksSampled: number;
    callbackMismatches: number;
  };
};

/** Everything the review screen needs about one plan, with server-only fields left out. */
export function getPlanView(planId: string): PlanView {
  const store = getStore();
  const plan = findPlan(store, planId);

  const householdIds = new Set([...plan.items.flatMap((i) => i.householdIds), ...plan.excludedHouseholdIds]);
  const households = store.households.filter((h) => householdIds.has(h.id));
  const partnerIds = new Set(households.map((h) => h.partnerId));
  const confirmations: Confirmation[] = store.confirmations.filter((c) => c.planId === plan.id);
  const callbacks: CallbackCheck[] = store.callbackChecks.filter((c) => c.planId === plan.id);

  return {
    plan,
    partners: store.partners
      .filter((p) => partnerIds.has(p.id))
      .map(({ id, name, provinceId, contactName }) => ({ id, name, provinceId, contactName })),
    households: households.map(toPublicHousehold),
    flags: [],
    counts: {
      householdsConfirmed: new Set(confirmations.map((c) => c.householdId)).size,
      callbacksSampled: callbacks.length,
      callbackMismatches: callbacks.filter((c) => c.result === "mismatch").length,
    },
  };
}

/**
 * Takes one household out of a plan under review and recalculates the amounts through the rules
 * engine, which changes the plan hash. Excluding a household twice changes nothing.
 */
export function excludeHousehold(planId: string, householdId: string): Plan {
  const store = getStore();
  const plan = findPlan(store, planId);

  if (plan.status !== "in_review") {
    throw new PlanError(409, "This plan is already approved, so its households can no longer change.", plan);
  }
  if (plan.excludedHouseholdIds.includes(householdId)) return plan;
  if (!plan.items.some((item) => item.householdIds.includes(householdId))) {
    throw new PlanError(404, "This household is not in the plan");
  }

  const rule = store.rules.find((r) => r.id === plan.ruleId);
  if (!rule) throw new PlanError(409, "The rule behind this plan is no longer loaded. Reset the demo and start again.");

  const excludedHouseholdIds = [...plan.excludedHouseholdIds, householdId];
  const items = calculatePlanItems({ rule, triggers: plan.triggers, households: store.households, excludedHouseholdIds });

  return savePlan(store, {
    ...plan,
    items,
    excludedHouseholdIds,
    totalCents: planTotalCents(items),
    planHash: computePlanHash({ ruleId: plan.ruleId, ruleVersion: plan.ruleVersion, items }),
  });
}

// Approvals in flight, by plan ID. On globalThis for the same reason as the store: each route
// may load its own copy of this module.
const SENDING_KEY = Symbol.for("paypal-ai-hackathon.plan-approvals");
const sendingHolder = globalThis as typeof globalThis & { [SENDING_KEY]?: Map<string, Promise<Plan>> };
const sending = () => (sendingHolder[SENDING_KEY] ??= new Map<string, Promise<Plan>>());

/**
 * Approves a plan and sends its Payouts batch.
 *
 * - A plan under review needs its current hash. A stale hash is refused with the current plan.
 * - A plan already sent (or settled) is returned as it is: nothing is sent again.
 * - A plan approved earlier whose send failed is sent again. The plan ID is the PayPal
 *   sender_batch_id, so PayPal cannot pay it twice.
 */
export async function approvePlan(input: {
  planId: string;
  planHash: string;
  approverName: string;
  now?: Date;
}): Promise<Plan> {
  const inFlight = sending().get(input.planId);
  if (inFlight) return inFlight;

  const store = getStore();
  const plan = findPlan(store, input.planId);

  if (plan.status !== "in_review" && plan.status !== "approved") return plan;
  if (input.planHash !== plan.planHash) {
    throw new PlanError(409, "The plan changed after you opened it. Check the new totals and approve again.", plan);
  }
  if (plan.items.length === 0 || plan.totalCents <= 0) {
    throw new PlanError(422, "Every household was excluded, so there is nothing to pay.", plan);
  }
  if (plan.totalCents > MAX_PLAN_TOTAL_CENTS) throw new PlanError(422, overCapMessage(plan.totalCents), plan);

  if (plan.status === "in_review") {
    savePlan(store, {
      ...plan,
      status: "approved",
      approvedBy: input.approverName,
      approvedAt: (input.now ?? new Date()).toISOString(),
    });
  }

  const send = sendPayout(input.planId).finally(() => sending().delete(input.planId));
  sending().set(input.planId, send);
  return send;
}

async function sendPayout(planId: string): Promise<Plan> {
  const before = getStore();
  const plan = findPlan(before, planId);
  const recipients = plan.items.map((item) => {
    const partner = before.partners.find((p) => p.id === item.partnerId);
    if (!partner) throw new PlanError(409, "A partner in this plan is no longer loaded. Reset the demo and start again.");
    return { senderItemId: partner.id, email: partner.paypalEmail, amountCents: item.amountCents };
  });

  let batch: PayoutBatch;
  try {
    batch = await createPayoutBatch({ planId, recipients });
  } catch (err) {
    console.error(err);
    throw new PlanError(
      502,
      "PayPal did not accept the payout. The plan stays approved: approve again to retry, it cannot be paid twice.",
      findPlan(getStore(), planId),
    );
  }

  // Read the store again: a scenario reset may have replaced it while PayPal answered.
  const store = getStore();
  const current = store.plans.find((p) => p.id === planId);
  if (!current) {
    console.error(`Payout batch ${batch.batchId} was sent for plan ${planId}, but the demo was reset meanwhile`);
    throw new PlanError(409, "The demo was reset while the payout was being sent. Start the replay again.");
  }

  const status: PlanStatus = batch.status === "DENIED" || batch.status === "CANCELED" ? "needs_attention" : "payout_pending";
  const items: PlanPartnerItem[] = current.items.map((item) => {
    // A batch recovered after a retry already lists its items; a new batch does not yet.
    const sent = batch.items.find((i) => i.senderItemId === item.partnerId);
    return { ...item, payoutItemId: sent?.payoutItemId ?? null, payoutStatus: sent?.status ?? "PENDING" };
  });
  return savePlan(store, { ...current, status, items, payoutBatchId: batch.batchId });
}
