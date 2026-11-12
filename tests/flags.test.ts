import { afterEach, describe, expect, it, vi } from "vitest";
import { yagi } from "@/data/scenarios/yagi";
import type { Household } from "@/lib/domain";
import { checkHouseholds, templateExplanation, withTemplates } from "@/lib/flags";
import { importWithEnv, queueFetch } from "./helpers";

type AiFlagsModule = typeof import("@/lib/ai-flags");
type PlansModule = typeof import("@/lib/plans");
type StoreModule = typeof import("@/lib/store");
type ExplainRoute = typeof import("@/app/api/plans/[id]/explain/route");

const KEYS = { AI_API_KEY: "sk-test", AI_BASE_URL: "https://example.test/v1", AI_MODEL: "some-model" };
const reply = (content: unknown) => ({ body: { choices: [{ message: { content: JSON.stringify(content) } }] } });

const base: Household = {
  id: "hh-x-01",
  partnerId: "p1",
  provinceId: "x",
  headName: "A",
  members: 3,
  phone: "+84 000 000 001",
  address: "Tổ 1, khu A",
  registeredAt: "2024-03-01T09:00:00+07:00",
  receiptCode: "X-1",
};
const hh = (n: number, overrides: Partial<Household> = {}): Household => ({
  ...base,
  id: `hh-x-0${n}`,
  phone: `+84 000 000 00${n}`,
  address: `Tổ ${n}, khu A`,
  registeredAt: `2024-0${n}-01T09:00:00+07:00`,
  ...overrides,
});
const keys = (results: { householdId: string; kind: string }[]) => results.map((r) => `${r.householdId}:${r.kind}`);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("checkHouseholds", () => {
  it("flags the same phone number, ignoring spaces and formatting", () => {
    const results = checkHouseholds([hh(1), hh(2, { phone: "+84000000001" }), hh(3)]);
    expect(results).toEqual([
      { householdId: "hh-x-01", kind: "duplicate_phone", relatedHouseholdIds: ["hh-x-02"] },
      { householdId: "hh-x-02", kind: "duplicate_phone", relatedHouseholdIds: ["hh-x-01"] },
    ]);
  });

  it("flags the same address, ignoring case, spacing and punctuation", () => {
    const results = checkHouseholds([hh(1), hh(2, { address: "tổ 1  khu A." }), hh(3)]);
    expect(keys(results)).toEqual(["hh-x-01:duplicate_address", "hh-x-02:duplicate_address"]);
  });

  it("flags three or more registrations by one partner within an hour, not two", () => {
    const at = (time: string) => ({ registeredAt: `2024-09-06T${time}:00+07:00` });
    expect(checkHouseholds([hh(1, at("21:00")), hh(2, at("21:30"))])).toEqual([]);

    const burst = checkHouseholds([hh(1, at("21:00")), hh(2, at("21:20")), hh(3, at("21:50")), hh(4, at("23:30"))]);
    expect(keys(burst)).toEqual(["hh-x-01:registration_spike", "hh-x-02:registration_spike", "hh-x-03:registration_spike"]);
    expect(burst[0].relatedHouseholdIds).toEqual(["hh-x-02", "hh-x-03"]);

    // The same times split across two partners is not a spike.
    expect(checkHouseholds([hh(1, at("21:00")), hh(2, { ...at("21:20"), partnerId: "p2" }), hh(3, at("21:50"))])).toEqual([]);
  });

  it("finds exactly the planted cases in the Yagi households", () => {
    expect(keys(checkHouseholds(yagi.households))).toEqual([
      "hh-hp-07:registration_spike",
      "hh-hp-08:registration_spike",
      "hh-hp-09:registration_spike",
      "hh-hp-10:registration_spike",
      "hh-qn-04:duplicate_phone",
      "hh-qn-07:duplicate_address",
      "hh-qn-13:duplicate_phone",
      "hh-qn-14:duplicate_address",
    ]);
  });

  it("gives every flag a template explanation", () => {
    const flags = withTemplates(checkHouseholds(yagi.households));
    for (const f of flags) {
      expect(f.explanationSource).toBe("template");
      expect(f.explanation).toBe(templateExplanation(f));
      for (const id of f.relatedHouseholdIds) expect(f.explanation).toContain(id.slice(0, 5));
    }
  });
});

describe("explainPlan", () => {
  async function setup(env: Record<string, string>) {
    const ai = await importWithEnv<AiFlagsModule>("@/lib/ai-flags", env);
    const plans = (await import("@/lib/plans")) as PlansModule;
    const store = (await import("@/lib/store")) as StoreModule;
    store.resetScenario();
    const { plan } = plans.createPlan("rule-rain-150-v1");
    return { ai, ...plans.getPlanChecks(plan.id) };
  }

  it("uses templates without a key, with no network access", async () => {
    const { ai, plan, results } = await setup({});
    vi.stubGlobal("fetch", vi.fn());

    const out = await ai.explainPlan(plan, results);
    expect(out).toMatchObject({ source: "template", mock: true });
    expect(out.summary).toContain("$640.00");
    expect(out.flags.every((f) => f.explanationSource === "template")).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends only IDs, check results and amounts, never names, phones or addresses", async () => {
    const { ai, plan, results } = await setup(KEYS);
    const fetchMock = queueFetch(reply({ summary: "This plan sends $640.00 to 3 partners.", explanations: [] }));

    await ai.explainPlan(plan, results);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = init.body as string;
    expect(body).toContain("hh-qn-13");
    expect(body).toContain("$640.00");
    expect(body).not.toMatch(/Trịnh Văn Phúc|\+84|Cửa Gió|QN-5D3K/);
  });

  it("uses AI explanations where given and keeps templates for the rest", async () => {
    const { ai, plan, results } = await setup(KEYS);
    queueFetch(
      reply({
        summary: "This plan sends $640.00 to 3 local partners for 32 households. Check the 8 notes first.",
        explanations: [{ householdId: "hh-qn-13", kind: "duplicate_phone", text: "Shares a phone with hh-qn-04. Call both." }],
      }),
    );

    const out = await ai.explainPlan(plan, results);
    expect(out.source).toBe("ai");
    expect(out.summary).toContain("Check the 8 notes");
    const qn13 = out.flags.find((f) => f.householdId === "hh-qn-13");
    expect(qn13).toMatchObject({ explanationSource: "ai", explanation: "Shares a phone with hh-qn-04. Call both." });
    expect(out.flags.find((f) => f.householdId === "hh-qn-04")?.explanationSource).toBe("template");
    // AI cannot add or remove flags.
    expect(out.flags).toHaveLength(results.length);
  });

  it("replaces a summary that invents an amount with the template", async () => {
    const { ai, plan, results } = await setup(KEYS);
    queueFetch(reply({ summary: "This plan sends $6,400.00 to 3 partners.", explanations: [] }));

    const out = await ai.explainPlan(plan, results);
    expect(out.summary).not.toContain("6,400");
    expect(out.summary).toContain("$640.00");
  });

  it("falls back to templates when the AI provider fails", async () => {
    const { ai, plan, results } = await setup(KEYS);
    vi.spyOn(console, "error").mockImplementation(() => {});
    queueFetch({ status: 500, body: { error: "down" } });

    const out = await ai.explainPlan(plan, results);
    expect(out).toMatchObject({ source: "template", mock: false });
    expect(out.flags).toHaveLength(results.length);
  });
});

describe("POST /api/plans/[id]/explain", () => {
  it("explains a plan in mock mode, changes nothing, and 404s for an unknown plan", async () => {
    const route = await importWithEnv<ExplainRoute>("@/app/api/plans/[id]/explain/route", {});
    const plans = (await import("@/lib/plans")) as PlansModule;
    const store = (await import("@/lib/store")) as StoreModule;
    store.resetScenario();
    const { plan } = plans.createPlan("rule-rain-150-v1");
    const req = () => new Request("http://localhost/x", { method: "POST", headers: { "x-forwarded-for": "203.0.113.40" } });

    const res = await route.POST(req(), { params: Promise.resolve({ id: plan.id }) });
    expect(res.status).toBe(200);
    expect((await res.json()).flags).toHaveLength(8);
    expect(plans.getPlanView(plan.id).plan).toEqual(plan);

    expect((await route.POST(req(), { params: Promise.resolve({ id: "plan-missing" }) })).status).toBe(404);
    expect((await route.POST(req(), { params: Promise.resolve({ id: "../x" }) })).status).toBe(404);
  });
});
