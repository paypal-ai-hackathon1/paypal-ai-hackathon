// In-memory demo store. Server-only: it reads env and holds partner tokens and raw phone numbers.
//
// The state lives on globalThis so that every route sees the same data, even if the bundler
// or dev-mode reloads give a route its own copy of this module. One instance only: a restart or
// a second server process starts from a fresh scenario.
//
// Call it from route handlers, or from components that have awaited connection(). Otherwise a
// prerender at build time would freeze the partner emails read from env.

import { randomBytes, randomUUID } from "node:crypto";
import { DEFAULT_SCENARIO_ID, scenarios } from "@/data/scenarios";
import type {
  BulletinReading,
  CallbackCheck,
  Confirmation,
  Household,
  Partner,
  Plan,
  Province,
  Rule,
  Scenario,
  ScenarioId,
} from "./domain";
import { env } from "./env";

export type StoreState = {
  scenarioId: ScenarioId;
  scenario: Scenario;
  provinces: Province[];
  partners: Partner[];
  households: Household[];
  rules: Rule[];
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
    scenario: seed,
    provinces: seed.provinces,
    partners: seed.partners.map((partner, i) => ({
      ...partner,
      paypalEmail: emails[i] ?? `${partner.id}@example.com`,
      accessToken: randomBytes(24).toString("base64url"),
    })),
    households: seed.households,
    rules: seed.rules,
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
