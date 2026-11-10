// In-memory demo store. Server-only: it reads env and holds partner tokens and raw phone numbers.
//
// The state lives on globalThis so that every route sees the same data, even if the bundler
// or dev-mode reloads give a route its own copy of this module. One instance only: a restart or
// a second server process starts from a fresh scenario.
//
// Usage rules:
// - Call it from route handlers, or from components that have awaited connection(). Otherwise a
//   prerender at build time would freeze the partner emails read from env.
// - Call getStore() again after every await. resetScenario() replaces the whole state, so a
//   reference kept across an await may point at a state that is no longer current.
// - Never return Household or Partner objects as they are. Use toPublicHousehold() and
//   PublicPartner so phones, receipt codes and tokens stay on the server.

import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { DEFAULT_SCENARIO_ID, scenarios } from "@/data/scenarios";
import type {
  Bulletin,
  BulletinReading,
  CallbackCheck,
  Confirmation,
  ForecastPoint,
  Household,
  Partner,
  Plan,
  Province,
  PublicHousehold,
  Rule,
  ScenarioId,
} from "./domain";
import { env } from "./env";

export type StoreState = {
  scenarioId: ScenarioId;
  scenarioName: string;
  /** Simulated "now" when the replay starts. */
  startsAt: string;
  // Loaded from the scenario fixture on every reset.
  provinces: Province[];
  partners: Partner[];
  households: Household[];
  rules: Rule[];
  forecast: ForecastPoint[];
  bulletins: Bulletin[];
  // Created while the demo runs, emptied on every reset.
  plans: Plan[];
  bulletinReadings: BulletinReading[];
  confirmations: Confirmation[];
  callbackChecks: CallbackCheck[];
};

const GLOBAL_KEY = Symbol.for("paypal-ai-hackathon.store");
const holder = globalThis as typeof globalThis & { [GLOBAL_KEY]?: StoreState };

function buildState(scenarioId: ScenarioId): StoreState {
  const scenario = scenarios[scenarioId];
  if (!scenario) throw new Error(`Unknown scenario: ${scenarioId}`);

  // Copy the fixture so runtime changes never leak back into it.
  const seed = structuredClone(scenario);
  const emails = env.partners.paypalEmails;

  return {
    scenarioId,
    scenarioName: seed.name,
    startsAt: seed.startsAt,
    provinces: seed.provinces,
    partners: seed.partners.map((partner, i) => ({
      ...partner,
      paypalEmail: emails[i] || `${partner.id}@example.com`,
      accessToken: randomBytes(24).toString("base64url"),
    })),
    households: seed.households,
    rules: seed.rules,
    forecast: seed.forecast,
    bulletins: seed.bulletins,
    plans: [],
    bulletinReadings: [],
    confirmations: [],
    callbackChecks: [],
  };
}

/** Current state, created from the default scenario on first use. */
export function getStore(): StoreState {
  holder[GLOBAL_KEY] ??= buildState(DEFAULT_SCENARIO_ID);
  return holder[GLOBAL_KEY];
}

/** Throws away all runtime state (plans, confirmations, ...) and reloads the scenario fixture. */
export function resetScenario(id: ScenarioId = DEFAULT_SCENARIO_ID): StoreState {
  holder[GLOBAL_KEY] = buildState(id);
  return holder[GLOBAL_KEY];
}

/**
 * A new ID that is unique across runs, e.g. "plan-1f0c9a7e2b4d".
 * Plan IDs become the PayPal sender_batch_id, and PayPal rejects a reused one, so a replay
 * after a restart must never reuse an ID.
 */
export function newId(prefix: string): string {
  return `${prefix}-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** Keeps the country code and the last 3 digits: "+84 000 000 104" -> "+84 *** *** 104". */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "***";
  const country = phone.trim().startsWith("+") ? `+${digits.slice(0, 2)} ` : "";
  return `${country}*** *** ${digits.slice(-3)}`;
}

/** The household as an API response may show it: masked phone, no receipt code. */
export function toPublicHousehold(household: Household): PublicHousehold {
  return {
    id: household.id,
    partnerId: household.partnerId,
    provinceId: household.provinceId,
    headName: household.headName,
    members: household.members,
    address: household.address,
    registeredAt: household.registeredAt,
    phoneMasked: maskPhone(household.phone),
  };
}
