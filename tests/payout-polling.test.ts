import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PayoutItemStatus } from "@/lib/domain";
import { importWithEnv, queueFetch } from "./helpers";
import { AUTH, batchBody, setupPayout, WEBHOOK_KEYS } from "./payout-helpers";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()), connection: async () => {},
}));
beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** Holds the first batch read open and tracks overlap; later reads see the supplied current state. */
function holdFirstBatch(nextBatch: ReturnType<typeof batchBody>) {
  const first = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<void>();
  let reads = 0;
  let active = 0;
  let maxActive = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/v1/oauth2/token")) return Response.json(AUTH.body);
    active++;
    maxActive = Math.max(maxActive, active);
    try {
      if (reads++ === 0) { started.resolve(); return await first.promise; }
      return Response.json(nextBatch);
    } finally {
      active--;
    }
  }));
  return { first, started: started.promise, stats: () => ({ reads, maxActive }) };
}

describe("payout polling", () => {
  it("settles using polling alone in mock mode, then stops calling PayPal", async () => {
    const { plans, store } = await setupPayout({});
    store.resetScenario();
    const plan = plans.createPlan("rule-rain-150-v1").plan;
    await plans.approvePlan({ planId: plan.id, planHash: plan.planHash, approverName: "Tester" });
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    expect((await plans.refreshPayoutStatus(plan.id)).status).toBe("payout_pending");
    expect((await plans.refreshPayoutStatus(plan.id)).status).toBe("paid");
    expect((await plans.refreshPayoutStatus(plan.id)).status).toBe("paid");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not read a plan that has not sent a batch", async () => {
    const { plans, store, plan } = await setupPayout();
    store.getStore().plans = [{ ...plan, status: "in_review", payoutBatchId: null }];
    const fetchMock = queueFetch();
    expect((await plans.refreshPayoutStatus(plan.id)).status).toBe("in_review");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("stops polling a paid sandbox plan without making another network request", async () => {
    const { plans, store, plan } = await setupPayout();
    store.getStore().plans = [{ ...plan, status: "paid" }];
    const fetchMock = queueFetch();
    expect((await plans.refreshPayoutStatus(plan.id)).status).toBe("paid");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("serializes concurrent reads for the same plan and settles the latest state", async () => {
    const { plans, store, plan } = await setupPayout();
    const held = holdFirstBatch(batchBody(plan));
    const early = plans.refreshPayoutStatus(plan.id);
    await held.started;
    const late = plans.refreshPayoutStatus(plan.id);
    await new Promise<void>((resolve) => setImmediate(resolve));
    held.first.resolve(Response.json(batchBody(plan, ["PENDING", "PENDING", "PENDING"], "PROCESSING")));
    expect((await early).status).toBe("payout_pending");
    expect((await late).status).toBe("paid");
    expect(held.stats()).toEqual({ reads: 2, maxActive: 1 });
    expect(store.getStore().plans[0].items.every((item) => item.payoutStatus === "SUCCESS")).toBe(true);
  });
  it.each([
    { name: "refunded item", currentStatus: "SUCCESS", currentItems: ["REFUNDED", "SUCCESS", "SUCCESS"],
      earlierStatus: "SUCCESS", earlierItems: ["SUCCESS", "SUCCESS", "SUCCESS"] },
    { name: "denied batch", currentStatus: "DENIED", currentItems: ["PENDING", "PENDING", "PENDING"],
      earlierStatus: "PROCESSING", earlierItems: ["PENDING", "PENDING", "PENDING"] },
  ])("preserves a $name when a webhook follows an in-flight poll across module copies", async (scenario) => {
    const { plans, store, plan } = await setupPayout();
    const held = holdFirstBatch(batchBody(plan, scenario.currentItems as PayoutItemStatus[], scenario.currentStatus));
    const poll = plans.refreshPayoutStatus(plan.id);
    await held.started;
    const webhookPlans = await importWithEnv<typeof import("@/lib/plans")>("@/lib/plans", WEBHOOK_KEYS);
    const webhook = webhookPlans.refreshPayoutStatus(plan.id, { force: true });
    await new Promise<void>((resolve) => setImmediate(resolve));
    held.first.resolve(Response.json(batchBody(plan, scenario.earlierItems as PayoutItemStatus[], scenario.earlierStatus)));
    await Promise.all([poll, webhook]);
    expect({ ...held.stats(), status: store.getStore().plans[0].status })
      .toEqual({ reads: 2, maxActive: 1, status: "needs_attention" });
    expect(store.getStore().plans[0].items.map((item) => item.payoutStatus)).toEqual(scenario.currentItems);
  });
  it("runs a queued refresh after the previous read fails", async () => {
    const { plans, plan } = await setupPayout();
    const held = holdFirstBatch(batchBody(plan));
    const failed = plans.refreshPayoutStatus(plan.id).catch((error: unknown) => error);
    await held.started;
    const queued = plans.refreshPayoutStatus(plan.id, { force: true });
    await new Promise<void>((resolve) => setImmediate(resolve));
    held.first.reject(new TypeError("Network request failed"));
    expect(await failed).toMatchObject({ status: 502 });
    expect((await queued).status).toBe("paid");
    expect(held.stats()).toEqual({ reads: 2, maxActive: 1 });
  });
  it("keeps reads for different plans independent", async () => {
    const { plans, store, plan } = await setupPayout();
    const other = { ...plan, id: store.newId("plan"), payoutBatchId: "BATCH-OTHER" };
    store.getStore().plans.push(other);
    const held = holdFirstBatch(batchBody(other));
    const first = plans.refreshPayoutStatus(plan.id);
    await held.started;
    try {
      const second = plans.refreshPayoutStatus(other.id);
      await vi.waitFor(() => expect(held.stats().reads).toBe(2));
      expect((await second).status).toBe("paid");
      expect(held.stats().maxActive).toBe(2);
    } finally {
      held.first.resolve(Response.json(batchBody(plan)));
      await first;
    }
  });
  it("rejects queued reads after a reset without another PayPal request", async () => {
    const { plans, store, plan } = await setupPayout();
    const held = holdFirstBatch(batchBody(plan));
    const first = plans.refreshPayoutStatus(plan.id).catch((error: unknown) => error);
    await held.started;
    const queued = plans.refreshPayoutStatus(plan.id, { force: true }).catch((error: unknown) => error);
    store.resetScenario();
    held.first.resolve(Response.json(batchBody(plan)));
    expect(await first).toMatchObject({ status: 409 });
    expect(await queued).toMatchObject({ status: 409 });
    expect(held.stats()).toEqual({ reads: 1, maxActive: 1 });
    expect(store.getStore().plans).toEqual([]);
  });
  it("maps by partner ID and preserves settled items when a late read says PENDING", async () => {
    const { plans, plan } = await setupPayout();
    const settled = batchBody(plan, ["UNCLAIMED", "SUCCESS", "SUCCESS"]);
    settled.items.reverse();
    queueFetch(AUTH, { body: settled }, { body: batchBody(plan, ["PENDING", "SUCCESS", "SUCCESS"]) });
    const first = await plans.refreshPayoutStatus(plan.id);
    const late = await plans.refreshPayoutStatus(plan.id);
    expect(first.items[0]).toMatchObject({ partnerId: "partner-qn", payoutStatus: "UNCLAIMED", payoutItemId: "ITEM-0" });
    expect(late.items[0].payoutStatus).toBe("UNCLAIMED");
    expect(late.status).toBe("needs_attention");
  });
  it("keeps missing items pending rather than falsely marking a partial batch paid", async () => {
    const { plans, plan } = await setupPayout();
    const partial = batchBody(plan); partial.items.pop();
    queueFetch(AUTH, { body: partial });
    expect((await plans.refreshPayoutStatus(plan.id)).status).toBe("payout_pending");
  });
  it("returns a generic 502 and preserves the plan when PayPal fails", async () => {
    const { plans, store, plan } = await setupPayout();
    queueFetch(AUTH, { status: 500, body: { message: "private upstream detail" } });
    const error = await plans.refreshPayoutStatus(plan.id).catch((err: unknown) => err);
    expect(error).toMatchObject({ status: 502 });
    expect((error as Error).message).not.toContain("private upstream detail");
    expect(store.getStore().plans[0]).toEqual(plan);
  });
  it("refuses a batch belonging to another plan without applying its status", async () => {
    const { plans, store, plan } = await setupPayout();
    const wrong = batchBody(plan); wrong.batch_header.sender_batch_header.sender_batch_id = "plan-other";
    queueFetch(AUTH, { body: wrong });
    await expect(plans.refreshPayoutStatus(plan.id)).rejects.toMatchObject({ status: 502 });
    expect(store.getStore().plans[0]).toEqual(plan);
  });
  it("does not write status into a scenario reset during the request", async () => {
    const { plans, store, plan } = await setupPayout();
    const gate = Promise.withResolvers<Response>();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/v1/oauth2/token")) return Response.json(AUTH.body);
      store.resetScenario(); return gate.promise;
    }));
    const reading = plans.refreshPayoutStatus(plan.id).catch((err: unknown) => err);
    gate.resolve(Response.json(batchBody(plan)));
    expect(await reading).toMatchObject({ status: 409 });
    expect(store.getStore().plans).toEqual([]);
  });
  it("the status route returns { plan } and settles a mock batch", async () => {
    const { plans, store } = await setupPayout({});
    store.resetScenario();
    const plan = plans.createPlan("rule-rain-150-v1").plan;
    await plans.approvePlan({ planId: plan.id, planHash: plan.planHash, approverName: "Tester" });
    const route = await importWithEnv<typeof import("@/app/api/plans/[id]/status/route")>(
      "@/app/api/plans/[id]/status/route", {});
    const get = () => route.GET(new Request("http://localhost/status"), { params: Promise.resolve({ id: plan.id }) });
    const first = await get();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ plan: { id: plan.id, status: "payout_pending" } });
    expect(await (await get()).json()).toMatchObject({ plan: { id: plan.id, status: "paid" } });
  });
  it("the status route validates IDs and uses a per-IP rate limit", async () => {
    const { plan } = await setupPayout();
    const route = await importWithEnv<typeof import("@/app/api/plans/[id]/status/route")>(
      "@/app/api/plans/[id]/status/route", {});
    const get = (id: string) => route.GET(new Request("http://localhost/status"), { params: Promise.resolve({ id }) });
    expect((await get("Bad Id")).status).toBe(404);
    expect((await get("plan-unknown")).status).toBe(404);
    // The mock batch does not exist, so a valid plan exposes a generic upstream error.
    expect((await get(plan.id)).status).toBe(502);
    for (let i = 3; i < 120; i++) await get("bad");
    const limited = await get("bad");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).not.toBeNull();
  });
});
