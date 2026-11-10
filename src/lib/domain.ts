// Shared domain types for the relief flow: forecast -> locked rule -> plan -> approval -> payout
// -> partner confirmation -> callback checks -> donor report.
// Types only, no logic, so client components may import this file.
//
// Conventions:
// - Money is always an integer number of US cents (fields end in `Cents`). Convert to a
//   decimal string only at the PayPal boundary in src/lib/paypal.ts.
// - Timestamps are ISO 8601 strings. Fixtures use the Vietnam offset (+07:00).
// - IDs are strings with a readable prefix, e.g. "hh-qn-01", "partner-hp", "plan-…".

export const CURRENCY = "USD";

export type ScenarioId = string;

export type Province = {
  id: string;
  name: string; // English, e.g. "Quang Ninh"
  nameVi: string; // Vietnamese, e.g. "Quảng Ninh"
};

/** A weather bulletin pasted by the organizer. Fixture bulletins are simulated. */
export type Bulletin = {
  id: string;
  issuedAt: string;
  issuer: string;
  language: "vi";
  text: string;
  /** True unless `sourceUrl` points to the real published bulletin. */
  simulated: boolean;
  sourceUrl?: string;
};

/** Metrics a rule can test. Anything else is an unknown metric and must fail validation. */
export type ForecastMetric = "rain_24h_mm" | "wind_gust_kmh";

/** One forecast value for one province, as known at `issuedAt` (never observed data). */
export type ForecastPoint = {
  id: string;
  provinceId: string;
  metric: ForecastMetric;
  value: number;
  issuedAt: string;
  /** Start of the period the forecast is for. */
  validFrom: string;
  /** Hours between `issuedAt` and `validFrom`. */
  leadHours: number;
};

/**
 * A trigger rule. Drafts are unlocked; only a locked rule can start a plan.
 * A locked rule is never edited: a change creates a new version with the same `key`.
 */
export type Rule = {
  id: string; // unique per version, e.g. "rule-rain-150-v1"
  key: string; // shared by all versions of the same rule
  version: number;
  /** The organizer's original sentence the rule was drafted from. */
  sourceSentence: string;
  metric: ForecastMetric;
  /** The rule fires when the forecast value is greater than or equal to this. */
  threshold: number;
  /** Only forecasts issued at most this many hours ahead count. */
  maxLeadHours: number;
  provinceIds: string[];
  amountPerHouseholdCents: number;
  createdAt: string;
  lockedAt: string | null;
  lockedBy: string | null;
};

/** A local organisation that receives the payout and hands cash to households. */
export type Partner = {
  id: string;
  name: string;
  provinceId: string;
  contactName: string;
  /** Sandbox PayPal email from PARTNER_PAYPAL_EMAILS, or an @example.com fallback. */
  paypalEmail: string;
  /** Unguessable token for the partner's demo link. Regenerated on every scenario reset. */
  accessToken: string;
};

/** A registered household. All fixture households are fictional. */
export type Household = {
  id: string;
  partnerId: string;
  provinceId: string;
  headName: string;
  members: number;
  /** Raw phone number. Server-side only: API responses must mask it. */
  phone: string;
  address: string;
  registeredAt: string;
  /** One-time code the household shows when it receives cash. Unique across the scenario. */
  receiptCode: string;
};

/** Static, versioned fixture data. Runtime state lives in src/lib/store.ts. */
export type Scenario = {
  id: ScenarioId;
  name: string;
  description: string;
  /** Simulated "now" when the replay starts. */
  startsAt: string;
  provinces: Province[];
  partners: Omit<Partner, "paypalEmail" | "accessToken">[];
  households: Household[];
  forecast: ForecastPoint[];
  bulletins: Bulletin[];
  rules: Rule[];
};

/**
 * in_review       created from a locked rule, households can still be excluded
 * approved        approved by a person, the payout batch is not accepted yet (safe to retry)
 * payout_pending  PayPal accepted the batch, items are still settling
 * paid            every item reached SUCCESS
 * needs_attention at least one item is UNCLAIMED, FAILED, RETURNED, ONHOLD, BLOCKED, ...
 */
export type PlanStatus = "in_review" | "approved" | "payout_pending" | "paid" | "needs_attention";

/** PayPal Payouts item `transaction_status` values. */
export type PayoutItemStatus =
  | "PENDING"
  | "SUCCESS"
  | "FAILED"
  | "UNCLAIMED"
  | "RETURNED"
  | "ONHOLD"
  | "BLOCKED"
  | "REFUNDED"
  | "REVERSED";

/** Why a province is in the plan: the forecast that crossed the rule's threshold. */
export type PlanTrigger = {
  provinceId: string;
  forecastPointId: string;
  metric: ForecastMetric;
  value: number;
  threshold: number;
  leadHours: number;
};

/** One payout line: everything a single partner receives for its households. */
export type PlanPartnerItem = {
  partnerId: string;
  householdIds: string[];
  amountCents: number;
  payoutItemId: string | null;
  payoutStatus: PayoutItemStatus | null;
};

export type Plan = {
  id: string; // unique per run, also used as the PayPal sender_batch_id
  scenarioId: ScenarioId;
  ruleId: string;
  ruleVersion: number;
  triggers: PlanTrigger[];
  status: PlanStatus;
  items: PlanPartnerItem[];
  excludedHouseholdIds: string[];
  totalCents: number;
  /** SHA-256 of the items and rule version. Approval must send the current hash. */
  planHash: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  payoutBatchId: string | null;
};

/**
 * One value the AI read from a bulletin, with the verbatim sentence it came from.
 * ok: the quote appears literally in the bulletin. needs_review: it does not, or it looks wrong.
 * missing: the bulletin does not say, so the value stays empty.
 */
export type ReadingField<T> = {
  value: T | null;
  quote: string | null;
  status: "ok" | "needs_review" | "missing";
};

/** Evidence for the reviewer. A reading never starts a plan or changes an amount. */
export type BulletinReading = {
  bulletinId: string;
  provinces: ReadingField<string[]>;
  hazard: ReadingField<string>;
  warningLevel: ReadingField<string>;
  validTime: ReadingField<string>;
  /** As written, e.g. "150-250 mm". Bulletins give ranges, so this is text, not a number. */
  rainfall: ReadingField<string>;
  wind: ReadingField<string>;
  readAt: string;
  mock: boolean;
};

export type HouseholdFlagKind = "duplicate_phone" | "duplicate_address" | "registration_spike";

/** A review note from the deterministic checks. Flags never exclude a household by themselves. */
export type HouseholdFlag = {
  householdId: string;
  kind: HouseholdFlagKind;
  relatedHouseholdIds: string[];
  explanation: string;
  explanationSource: "ai" | "template";
};

/** A partner's report that a household received its cash, proven by the receipt code. */
export type Confirmation = {
  id: string;
  planId: string;
  partnerId: string;
  householdId: string;
  confirmedAt: string;
};

export type CallbackResult = "reached" | "not_reached" | "mismatch";

/** A server-sampled phone check of a confirmed household. `result` is null until recorded. */
export type CallbackCheck = {
  id: string;
  planId: string;
  householdId: string;
  result: CallbackResult | null;
  checkedAt: string | null;
  checkedBy: string | null;
  note: string | null;
};

/** Figures built by code. The narrative may only use numbers that appear here. */
export type DonorReportFacts = {
  planId: string;
  currency: typeof CURRENCY;
  totalSentCents: number;
  partnersPaid: number;
  partnersTotal: number;
  householdsPlanned: number;
  householdsConfirmed: number;
  householdsUnconfirmed: number;
  callbacksSampled: number;
  callbacksReached: number;
  callbacksNotReached: number;
  callbackMismatches: number;
};

export type DonorReport = {
  facts: DonorReportFacts;
  narrative: string;
  narrativeSource: "ai" | "template";
  generatedAt: string;
};
