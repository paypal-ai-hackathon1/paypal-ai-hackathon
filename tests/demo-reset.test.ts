import { afterEach, describe, expect, it, vi } from "vitest";
import { importWithEnv } from "./helpers";

type ResetRoute = typeof import("@/app/api/demo/reset/route");
type PlansModule = typeof import("@/lib/plans");
type StoreModule = typeof import("@/lib/store");

afterEach(() => {
  vi.unstubAllEnvs();
});

const post = (ip = "203.0.113.7") =>
  new Request("http://localhost/api/demo/reset", { method: "POST", headers: { "x-forwarded-for": ip } });

describe("POST /api/demo/reset", () => {
  it("clears plans and reloads the scenario, so the same rule can start a new plan", async () => {
    const route = await importWithEnv<ResetRoute>("@/app/api/demo/reset/route", {});
    const plans = (await import("@/lib/plans")) as PlansModule;
    const store = (await import("@/lib/store")) as StoreModule;
    store.resetScenario();

    const first = plans.createPlan("rule-rain-150-v1").plan;
    plans.excludeHousehold(first.id, "hh-qn-01");
    expect(store.getStore().plans).toHaveLength(1);

    const res = await route.POST(post());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, scenarioId: "yagi-2024" });
    expect(store.getStore().plans).toHaveLength(0);

    const second = plans.createPlan("rule-rain-150-v1");
    expect(second.created).toBe(true);
    expect(second.plan.id).not.toBe(first.id);
    expect(second.plan.totalCents).toBe(64000);
  });

  it("is rate limited", async () => {
    const route = await importWithEnv<ResetRoute>("@/app/api/demo/reset/route", {});
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await route.POST(post("198.51.100.9"))).status);
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses[5]).toBe(429);
  });
});
