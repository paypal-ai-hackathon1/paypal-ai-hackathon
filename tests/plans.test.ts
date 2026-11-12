import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importWithEnv, queueFetch } from "./helpers";

type PlansModule = typeof import("@/lib/plans");
type StoreModule = typeof import("@/lib/store");
type PlansRoute = typeof import("@/app/api/plans/route");
type PlanRoute = typeof import("@/app/api/plans/[id]/route");
type ExcludeRoute = typeof import("@/app/api/plans/[id]/exclude/route");
type ApproveRoute = typeof import("@/app/api/plans/[id]/approve/route");

const SANDBOX = { PAYPAL_CLIENT_ID: "test-id", PAYPAL_CLIENT_SECRET: "test-secret" };
const RULE_ID = "rule-rain-150-v1";
const TOKEN = { body: { access_token: "tok", expires_in: 3600 } };
const BATCH_CREATED = { status: 201, body: { batch_header: { payout_batch_id: "BATCH-1", batch_status: "PENDING" } } };

/** Loads the plans module with the given env and starts from a fresh Yagi scenario. */
async function setup(env: Record<string, string> = {}) {
  const plans = await importWithEnv<PlansModule>("@/lib/plans", env);
  const store = (await import("@/lib/store")) as StoreModule;
  store.resetScenario();
  return { plans, store };
}

function payoutPosts(fetchMock: ReturnType<typeof queueFetch>) {
  return fetchMock.mock.calls.filter((call) => {
    const [url, init] = call as unknown as [string, RequestInit];
    return url.endsWith("/v1/payments/payouts") && init.method === "POST";
  });
}

function post(url: string, body: unknown) {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/** Holds a Payouts request open so tests can exercise other requests and resets during a send. */
function delayedPayout() {
  const response = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<void>();
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("/v1/oauth2/token")) return Response.json(TOKEN.body);
    started.resolve();
    return response.promise;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { response, started: started.promise, fetchMock };
}

// connection() needs a real Next.js request scope. Here it only has to resolve.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));

beforeEach(() => {
  // Keep expected error logs (PayPal failures, warnings) out of the test output.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createPlan", () => {
  it("builds a plan under review from the locked Yagi rule", async () => {
    const { plans } = await setup();

    const { plan, created } = plans.createPlan(RULE_ID);

    expect(created).toBe(true);
    expect(plan).toMatchObject({ ruleId: RULE_ID, ruleVersion: 1, status: "in_review", payoutBatchId: null });
    expect(plan.id).toMatch(/^plan-/);
    expect(plan.items.map((i) => [i.partnerId, i.householdIds.length, i.amountCents])).toEqual([
      ["partner-qn", 14, 28_000],
      ["partner-hp", 10, 20_000],
      ["partner-tb", 8, 16_000],
    ]);
    expect(plan.totalCents).toBe(64_000);
    expect(plan.planHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns the existing plan for the same rule instead of creating a second one", async () => {
    const { plans, store } = await setup();

    const first = plans.createPlan(RULE_ID);
    const again = plans.createPlan(RULE_ID);

    expect(again).toEqual({ plan: first.plan, created: false });
    expect(store.getStore().plans).toHaveLength(1);
  });

  it("refuses an unlocked rule, a rule that does not fire, and a plan over the cap", async () => {
    const { plans, store } = await setup();
    const rules = store.getStore().rules;
    const base = rules[0];
    store.getStore().rules = [
      { ...base, id: "rule-draft", lockedAt: null, lockedBy: null },
      { ...base, id: "rule-too-high", threshold: 999 },
      { ...base, id: "rule-too-rich", amountPerHouseholdCents: 10_000 },
    ];

    expect(() => plans.createPlan("rule-draft")).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => plans.createPlan("rule-too-high")).toThrow(expect.objectContaining({ status: 422 }));
    expect(() => plans.createPlan("rule-too-rich")).toThrow(expect.objectContaining({ status: 422 }));
    expect(() => plans.createPlan("rule-missing")).toThrow(expect.objectContaining({ status: 404 }));
    expect(store.getStore().plans).toEqual([]);
  });
});

describe("computePlanHash", () => {
  it("ignores item and household order but changes with any amount or household", async () => {
    const { plans } = await setup();
    const { plan } = plans.createPlan(RULE_ID);

    const shuffled = {
      ...plan,
      items: [...plan.items].reverse().map((i) => ({ ...i, householdIds: [...i.householdIds].reverse() })),
    };
    expect(plans.computePlanHash(shuffled)).toBe(plan.planHash);

    const moreMoney = { ...plan, items: plan.items.map((i, n) => (n === 0 ? { ...i, amountCents: i.amountCents + 1 } : i)) };
    expect(plans.computePlanHash(moreMoney)).not.toBe(plan.planHash);

    const newVersion = { ...plan, ruleVersion: 2 };
    expect(plans.computePlanHash(newVersion)).not.toBe(plan.planHash);
  });
});

describe("excludeHousehold", () => {
  it("recalculates through the rules engine and changes the hash", async () => {
    const { plans } = await setup();
    const { plan } = plans.createPlan(RULE_ID);

    const updated = plans.excludeHousehold(plan.id, "hh-qn-13");

    expect(updated.excludedHouseholdIds).toEqual(["hh-qn-13"]);
    expect(updated.items[0].householdIds).not.toContain("hh-qn-13");
    expect(updated.items[0].amountCents).toBe(26_000);
    expect(updated.totalCents).toBe(62_000);
    expect(updated.planHash).not.toBe(plan.planHash);
  });

  it("changes nothing when the household is already excluded, and refuses one not in the plan", async () => {
    const { plans } = await setup();
    const { plan } = plans.createPlan(RULE_ID);

    const once = plans.excludeHousehold(plan.id, "hh-qn-13");
    expect(plans.excludeHousehold(plan.id, "hh-qn-13")).toEqual(once);
    expect(() => plans.excludeHousehold(plan.id, "hh-xx-99")).toThrow(expect.objectContaining({ status: 404 }));
  });

  it("is refused once the plan is approved", async () => {
    const { plans } = await setup();
    const { plan } = plans.createPlan(RULE_ID);
    await plans.approvePlan({ planId: plan.id, planHash: plan.planHash, approverName: "Lan" });

    expect(() => plans.excludeHousehold(plan.id, "hh-qn-13")).toThrow(expect.objectContaining({ status: 409 }));
  });
});

describe("approvePlan", () => {
  it("records the approver and sends the batch (mock mode)", async () => {
    const { plans } = await setup();
    const { plan } = plans.createPlan(RULE_ID);

    const approved = await plans.approvePlan({
      planId: plan.id,
      planHash: plan.planHash,
      approverName: "Lan",
      now: new Date("2026-11-11T10:00:00Z"),
    });

    expect(approved).toMatchObject({
      status: "payout_pending",
      approvedBy: "Lan",
      approvedAt: "2026-11-11T10:00:00.000Z",
      payoutBatchId: `MOCK-BATCH-${plan.id}`,
    });
    expect(approved.items.every((i) => i.payoutStatus === "PENDING")).toBe(true);
  });

  it("refuses a stale hash with the current plan and sends nothing", async () => {
    const { plans } = await setup(SANDBOX);
    const fetchMock = queueFetch();
    const { plan } = plans.createPlan(RULE_ID);
    const changed = plans.excludeHousehold(plan.id, "hh-qn-13");

    const error = await plans
      .approvePlan({ planId: plan.id, planHash: plan.planHash, approverName: "Lan" })
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 409, plan: changed });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(plans.getPlanView(plan.id).plan.status).toBe("in_review");
  });

  it("never sends a second batch for a second approval", async () => {
    const { plans } = await setup(SANDBOX);
    const fetchMock = queueFetch(TOKEN, BATCH_CREATED);
    const { plan } = plans.createPlan(RULE_ID);
    const input = { planId: plan.id, planHash: plan.planHash, approverName: "Lan" };

    const first = await plans.approvePlan(input);
    const second = await plans.approvePlan({ ...input, approverName: "Someone else" });

    expect(second).toEqual(first);
    expect(second.approvedBy).toBe("Lan");
    expect(payoutPosts(fetchMock)).toHaveLength(1);
  });

  it.each(["payout_pending", "paid", "needs_attention"] as const)(
    "the approve route rejects an obsolete hash when the plan is %s",
    async (status) => {
      const { plans, store } = await setup(SANDBOX);
      const fetchMock = queueFetch(TOKEN, BATCH_CREATED);
      const original = plans.createPlan(RULE_ID).plan;
      const revised = plans.excludeHousehold(original.id, "hh-qn-13");
      const sent = await plans.approvePlan({ planId: original.id, planHash: revised.planHash, approverName: "Lan" });
      store.getStore().plans = [{ ...sent, status }];
      const { POST } = await importWithEnv<ApproveRoute>("@/app/api/plans/[id]/approve/route", SANDBOX);
      const url = `http://localhost/api/plans/${original.id}/approve`;

      const stale = await POST(post(url, { planHash: original.planHash, approverName: "Stale reviewer" }), ctx(original.id));
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({ plan: { planHash: revised.planHash, status } });

      const repeat = await POST(post(url, { planHash: revised.planHash, approverName: "Other reviewer" }), ctx(original.id));
      expect(repeat.status).toBe(200);
      expect(await repeat.json()).toMatchObject({ plan: { payoutBatchId: sent.payoutBatchId, approvedBy: "Lan", status } });
      expect(payoutPosts(fetchMock)).toHaveLength(1);
    },
  );

  it("sends one batch when two approvals arrive together", async () => {
    const { plans } = await setup(SANDBOX);
    const fetchMock = queueFetch(TOKEN, BATCH_CREATED);
    const { plan } = plans.createPlan(RULE_ID);
    const input = { planId: plan.id, planHash: plan.planHash, approverName: "Lan" };

    const [a, b] = await Promise.all([plans.approvePlan(input), plans.approvePlan(input)]);

    expect(a).toEqual(b);
    expect(a.payoutBatchId).toBe("BATCH-1");
    expect(payoutPosts(fetchMock)).toHaveLength(1);
  });

  it("refuses a stale hash even while another approval is sending", async () => {
    const { plans } = await setup(SANDBOX);
    const { plan } = plans.createPlan(RULE_ID);
    const pending = delayedPayout();
    const first = plans.approvePlan({ planId: plan.id, planHash: plan.planHash, approverName: "Lan" });
    await pending.started;

    await expect(plans.approvePlan({ planId: plan.id, planHash: "0".repeat(64), approverName: "Other" }))
      .rejects.toMatchObject({ status: 409 });

    pending.response.resolve(Response.json(BATCH_CREATED.body));
    await expect(first).resolves.toMatchObject({ payoutBatchId: "BATCH-1", approvedBy: "Lan" });
    expect(pending.fetchMock).toHaveBeenCalledTimes(2); // one authentication and one send
  });

  it.each(["accepted", "network failure"])("returns 409 after a reset during a send: %s", async (outcome) => {
    const { plans, store } = await setup(SANDBOX);
    const { plan } = plans.createPlan(RULE_ID);
    const pending = delayedPayout();
    const result = plans.approvePlan({ planId: plan.id, planHash: plan.planHash, approverName: "Lan" })
      .catch((error: unknown) => error);
    await pending.started;
    store.resetScenario();

    if (outcome === "accepted") pending.response.resolve(Response.json(BATCH_CREATED.body));
    else pending.response.reject(new TypeError("Network request failed"));

    expect(await result).toMatchObject({ status: 409, message: expect.stringContaining("Check PayPal") });
    expect(store.getStore().plans).toEqual([]);
    expect(pending.fetchMock).toHaveBeenCalledTimes(2);
    expect(plans.createPlan(RULE_ID).plan.id).not.toBe(plan.id);
  });

  it("recovers the same batch after the first send times out", async () => {
    const { plans } = await setup(SANDBOX);
    const { plan } = plans.createPlan(RULE_ID);
    const input = { planId: plan.id, planHash: plan.planHash, approverName: "Lan" };
    const pending = delayedPayout();
    const first = plans.approvePlan(input).catch((error: unknown) => error);
    await pending.started;
    pending.response.reject(new TypeError("Network request failed"));
    expect(await first).toMatchObject({ status: 502, plan: { status: "approved", payoutBatchId: null } });

    const retry = queueFetch(
      { status: 400, body: { name: "USER_BUSINESS_ERROR", links: [
        { href: "https://api-m.sandbox.paypal.com/v1/payments/payouts/BATCH-RECOVERED" },
      ] } },
      { body: { batch_header: { payout_batch_id: "BATCH-RECOVERED", batch_status: "PROCESSING",
        sender_batch_header: { sender_batch_id: plan.id } }, items: [] } },
    );
    await expect(plans.approvePlan(input)).resolves.toMatchObject({ payoutBatchId: "BATCH-RECOVERED" });
    const [, request] = retry.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(request.body as string).sender_batch_header.sender_batch_id).toBe(plan.id);
    expect((request.headers as Record<string, string>)["PayPal-Request-Id"]).toBe(plan.id);
    expect(payoutPosts(retry)).toHaveLength(1);
  });

  it("keeps the plan approved when PayPal refuses, and sends again on the next approval", async () => {
    const { plans } = await setup(SANDBOX);
    queueFetch(TOKEN, { status: 422, body: { name: "INSUFFICIENT_FUNDS", message: "Sender does not have sufficient funds" } });
    const { plan } = plans.createPlan(RULE_ID);
    const input = { planId: plan.id, planHash: plan.planHash, approverName: "Lan" };

    const error = await plans.approvePlan(input).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 502, plan: { status: "approved", payoutBatchId: null } });
    expect((error as Error).message).not.toMatch(/sufficient funds/);

    queueFetch(BATCH_CREATED);
    await expect(plans.approvePlan(input)).resolves.toMatchObject({ status: "payout_pending", payoutBatchId: "BATCH-1" });
  });

  it("refuses a plan with every household excluded", async () => {
    const { plans } = await setup();
    const { plan } = plans.createPlan(RULE_ID);
    let current = plan;
    for (const id of plan.items.flatMap((i) => i.householdIds)) current = plans.excludeHousehold(plan.id, id);

    expect(current.totalCents).toBe(0);
    await expect(
      plans.approvePlan({ planId: plan.id, planHash: current.planHash, approverName: "Lan" }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("refuses a plan over the cap even if it got into the store", async () => {
    const { plans, store } = await setup();
    const { plan } = plans.createPlan(RULE_ID);
    const items = plan.items.map((i) => ({ ...i, amountCents: 50_000 }));
    const inflated = { ...plan, items, totalCents: 150_000, planHash: plans.computePlanHash({ ...plan, items }) };
    store.getStore().plans = [inflated];

    await expect(
      plans.approvePlan({ planId: plan.id, planHash: inflated.planHash, approverName: "Lan" }),
    ).rejects.toMatchObject({ status: 422 });
  });
});

describe("getPlanView", () => {
  it("returns partners and households without server-only fields", async () => {
    const { plans } = await setup();
    const { plan } = plans.createPlan(RULE_ID);
    plans.excludeHousehold(plan.id, "hh-qn-13");

    const view = plans.getPlanView(plan.id);
    const json = JSON.stringify(view);

    expect(view.partners.map((p) => p.id)).toEqual(["partner-qn", "partner-hp", "partner-tb"]);
    expect(view.households).toHaveLength(32); // excluded households stay visible
    expect(view.flags.map((f) => `${f.householdId}:${f.kind}`)).toContain("hh-qn-13:duplicate_phone");
    expect(view.counts).toEqual({ householdsConfirmed: 0, callbacksSampled: 0, callbackMismatches: 0 });
    expect(json).not.toMatch(/"phone"|receiptCode|paypalEmail|accessToken|@example\.com|QN-7K2P/);
  });
});

describe("plan routes", () => {
  it.each([null, [], "text", 123, true])("rejects non-object JSON bodies: %j", async (body) => {
    const { plans } = await setup();
    const { plan } = plans.createPlan(RULE_ID);
    const create = (await importWithEnv<PlansRoute>("@/app/api/plans/route", {})).POST;
    const exclude = (await importWithEnv<ExcludeRoute>("@/app/api/plans/[id]/exclude/route", {})).POST;
    const approve = (await importWithEnv<ApproveRoute>("@/app/api/plans/[id]/approve/route", {})).POST;
    expect((await create(post("http://localhost/api/plans", body))).status).toBe(400);
    expect((await exclude(post("http://localhost/exclude", body), ctx(plan.id))).status).toBe(400);
    expect((await approve(post("http://localhost/approve", body), ctx(plan.id))).status).toBe(400);
    expect(plans.getPlanView(plan.id).plan.status).toBe("in_review");
  });

  it("rejects malformed JSON without changing the plan", async () => {
    const { plans } = await setup();
    const { plan } = plans.createPlan(RULE_ID);
    const create = (await importWithEnv<PlansRoute>("@/app/api/plans/route", {})).POST;
    const exclude = (await importWithEnv<ExcludeRoute>("@/app/api/plans/[id]/exclude/route", {})).POST;
    const approve = (await importWithEnv<ApproveRoute>("@/app/api/plans/[id]/approve/route", {})).POST;
    const badRequest = () => new Request("http://localhost/api/plans", { method: "POST", body: "{" });
    expect((await create(badRequest())).status).toBe(400);
    expect((await exclude(badRequest(), ctx(plan.id))).status).toBe(400);
    expect((await approve(badRequest(), ctx(plan.id))).status).toBe(400);
    expect(plans.getPlanView(plan.id).plan.status).toBe("in_review");
  });

  it("POST /api/plans validates input, creates once, then returns the same plan", async () => {
    await setup();
    const { POST } = await importWithEnv<PlansRoute>("@/app/api/plans/route", {});

    expect((await POST(post("http://localhost/api/plans", { ruleId: "Bad Id!" }))).status).toBe(400);
    expect((await POST(post("http://localhost/api/plans", { ruleId: "rule-missing" }))).status).toBe(404);

    const created = await POST(post("http://localhost/api/plans", { ruleId: RULE_ID }));
    const again = await POST(post("http://localhost/api/plans", { ruleId: RULE_ID }));
    expect(created.status).toBe(201);
    expect(again.status).toBe(200);
    expect((await again.json()).plan.id).toBe((await created.json()).plan.id);
  });

  it("GET /api/plans/[id] returns the view, and 404 for unknown or malformed ids", async () => {
    const { plans } = await setup();
    const { plan } = plans.createPlan(RULE_ID);
    const { GET } = await importWithEnv<PlanRoute>("@/app/api/plans/[id]/route", {});
    const get = (id: string) => GET(new Request(`http://localhost/api/plans/${id}`), ctx(id));

    const ok = await get(plan.id);
    expect(ok.status).toBe(200);
    expect((await ok.json()).plan.id).toBe(plan.id);
    expect((await get("plan-doesnotexist")).status).toBe(404);
    expect((await get("../etc")).status).toBe(404);
  });

  it("POST exclude and approve: validation, stale hash, approval and a repeat approval", async () => {
    const { plans } = await setup();
    const { plan } = plans.createPlan(RULE_ID);
    const exclude = (await importWithEnv<ExcludeRoute>("@/app/api/plans/[id]/exclude/route", {})).POST;
    const approve = (await importWithEnv<ApproveRoute>("@/app/api/plans/[id]/approve/route", {})).POST;
    const url = `http://localhost/api/plans/${plan.id}`;

    expect((await exclude(post(`${url}/exclude`, {}), ctx(plan.id))).status).toBe(400);
    const excluded = await exclude(post(`${url}/exclude`, { householdId: "hh-qn-13" }), ctx(plan.id));
    const newHash = (await excluded.json()).plan.planHash;
    expect(newHash).not.toBe(plan.planHash);

    expect((await approve(post(`${url}/approve`, { approverName: "Lan" }), ctx(plan.id))).status).toBe(400);
    expect((await approve(post(`${url}/approve`, { planHash: newHash }), ctx(plan.id))).status).toBe(400);

    const stale = await approve(post(`${url}/approve`, { planHash: plan.planHash, approverName: "Lan" }), ctx(plan.id));
    expect(stale.status).toBe(409);
    const staleBody = await stale.json();
    expect(staleBody.error).toMatch(/changed/);
    expect(staleBody.plan.planHash).toBe(newHash);

    const ok = await approve(post(`${url}/approve`, { planHash: newHash, approverName: "Lan" }), ctx(plan.id));
    const repeat = await approve(post(`${url}/approve`, { planHash: newHash, approverName: "Lan" }), ctx(plan.id));
    expect(ok.status).toBe(200);
    expect(repeat.status).toBe(200);
    const okPlan = (await ok.json()).plan;
    expect(okPlan.status).toBe("payout_pending");
    expect((await repeat.json()).plan.payoutBatchId).toBe(okPlan.payoutBatchId);

    const late = await exclude(post(`${url}/exclude`, { householdId: "hh-qn-04" }), ctx(plan.id));
    expect(late.status).toBe(409);
  });
});
