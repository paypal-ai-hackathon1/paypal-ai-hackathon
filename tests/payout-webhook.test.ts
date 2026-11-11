import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { importWithEnv, queueFetch } from "./helpers";
import { AUTH, batchBody, setupPayout, SIGNATURE_HEADERS, VERIFIED, WEBHOOK_KEYS, webhookBody } from "./payout-helpers";

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const headers = () => new Headers(SIGNATURE_HEADERS);

async function setup() {
  const data = await setupPayout();
  const webhook = await import("@/lib/payout-webhook");
  return { ...data, ...webhook };
}

describe("webhook signature verification", () => {
  it("posts the original event JSON and all verification headers only to the sandbox", async () => {
    const paypal = await importWithEnv<typeof import("@/lib/paypal")>("@/lib/paypal", WEBHOOK_KEYS);
    const raw = '{ "id":"WH-TEST", "value":1e2, "text":"\\u0061" }';
    const fetchMock = queueFetch(AUTH, VERIFIED);
    expect(await paypal.verifyWebhookSignature(raw, headers())).toBe(true);
    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature");
    expect(init.body).toContain(`"webhook_event":${raw}`);
    expect(JSON.parse(init.body as string)).toMatchObject({ webhook_id: "WEBHOOK-TEST",
      transmission_id: SIGNATURE_HEADERS["paypal-transmission-id"],
      transmission_time: SIGNATURE_HEADERS["paypal-transmission-time"],
      transmission_sig: SIGNATURE_HEADERS["paypal-transmission-sig"],
      cert_url: SIGNATURE_HEADERS["paypal-cert-url"], auth_algo: "SHA256withRSA" });
    expect(paypal.isPayoutItemStatus("SUCCESS")).toBe(true);
    expect(paypal.isPayoutItemStatus("UNKNOWN")).toBe(false);
  });
  it("never accepts a webhook in mock mode or without a webhook ID", async () => {
    for (const vars of [{}, { ...WEBHOOK_KEYS, PAYPAL_WEBHOOK_ID: "" }]) {
      const paypal = await importWithEnv<typeof import("@/lib/paypal")>("@/lib/paypal", vars);
      const fetchMock = queueFetch();
      expect(await paypal.verifyWebhookSignature("{}", headers())).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });
});

describe("payout webhooks", () => {
  it("verifies an item event, reads current statuses, then ignores a duplicate", async () => {
    const { handlePayoutWebhook, store, plan } = await setup();
    const fetchMock = queueFetch(AUTH, VERIFIED, { body: batchBody(plan) });
    const body = webhookBody("WH-ITEM");
    expect(await handlePayoutWebhook(body, headers())).toEqual({ ignored: false });
    expect(store.getStore().plans[0].status).toBe("paid");
    expect(await handlePayoutWebhook(body, headers())).toEqual({ ignored: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("coalesces concurrent copies of a delivery into one verification and batch read", async () => {
    const { handlePayoutWebhook, plan } = await setup();
    const fetchMock = queueFetch(AUTH, VERIFIED, { body: batchBody(plan) });
    const body = webhookBody("WH-CONCURRENT");
    const results = await Promise.all([handlePayoutWebhook(body, headers()), handlePayoutWebhook(body, headers())]);
    expect(results).toEqual([{ ignored: false }, { ignored: true }]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("rejects a failed signature without changing anything", async () => {
    const { handlePayoutWebhook, store, plan } = await setup();
    const fetchMock = queueFetch(AUTH, { body: { verification_status: "FAILURE" } });
    await expect(handlePayoutWebhook(webhookBody("WH-BAD"), headers())).rejects.toMatchObject({ status: 400 });
    expect(store.getStore().plans[0]).toEqual(plan);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("rejects malformed events and missing headers without calling PayPal", async () => {
    const { handlePayoutWebhook } = await setup();
    const fetchMock = queueFetch();
    for (const raw of ["{", "null", "[]", "{}", '{"id":"WH-X","event_type":"PAYMENT.PAYOUTSBATCH.SUCCESS","resource":null}']) {
      await expect(handlePayoutWebhook(raw, headers())).rejects.toMatchObject({ status: 400 });
    }
    await expect(handlePayoutWebhook(webhookBody("WH-X"), new Headers())).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("retries the same event after reconciliation fails", async () => {
    const { handlePayoutWebhook, store, plan } = await setup();
    queueFetch(AUTH, VERIFIED, { status: 500, body: { message: "private detail" } });
    const body = webhookBody("WH-RETRY");
    await expect(handlePayoutWebhook(body, headers())).rejects.toMatchObject({ status: 502 });
    expect(store.getStore().plans[0]).toEqual(plan);
    const retry = queueFetch(VERIFIED, { body: batchBody(plan) });
    expect(await handlePayoutWebhook(body, headers())).toEqual({ ignored: false });
    expect(store.getStore().plans[0].status).toBe("paid");
    expect(retry).toHaveBeenCalledTimes(2);
  });
  it("handles batch events without assuming batch SUCCESS means every item succeeded", async () => {
    const { handlePayoutWebhook, store, plan } = await setup();
    queueFetch(AUTH, VERIFIED, { body: batchBody(plan, ["UNCLAIMED", "SUCCESS", "SUCCESS"]) });
    const event = JSON.stringify({ id: "WH-BATCH", event_type: "PAYMENT.PAYOUTSBATCH.SUCCESS",
      resource: { batch_header: { payout_batch_id: "BATCH-TEST" } } });
    await handlePayoutWebhook(event, headers());
    expect(store.getStore().plans[0].status).toBe("needs_attention");
  });
  it("uses current PayPal state for an out-of-order event and handles a refund after paid", async () => {
    const { handlePayoutWebhook, store, plan } = await setup();
    queueFetch(AUTH, VERIFIED, { body: batchBody(plan) }, VERIFIED,
      { body: batchBody(plan, ["REFUNDED", "SUCCESS", "SUCCESS"]) });
    const late = webhookBody("WH-LATE", "PAYMENT.PAYOUTS-ITEM.UNCLAIMED")
      .replace('"transaction_status":"SUCCESS"', '"transaction_status":"PENDING"');
    await handlePayoutWebhook(late, headers());
    expect(store.getStore().plans[0].status).toBe("paid");
    await handlePayoutWebhook(webhookBody("WH-REFUND", "PAYMENT.PAYOUTS-ITEM.REFUNDED"), headers());
    expect(store.getStore().plans[0].status).toBe("needs_attention");
    expect(store.getStore().plans[0].items[0].payoutStatus).toBe("REFUNDED");
  });
  it("acknowledges verified events outside the active demo without a batch read", async () => {
    const { handlePayoutWebhook, store, plan } = await setup();
    const fetchMock = queueFetch(AUTH, VERIFIED, VERIFIED);
    expect(await handlePayoutWebhook(webhookBody("WH-OTHER", undefined, "BATCH-OTHER"), headers())).toEqual({ ignored: true });
    expect(await handlePayoutWebhook(webhookBody("WH-ORDER", "CHECKOUT.ORDER.APPROVED"), headers())).toEqual({ ignored: true });
    expect(store.getStore().plans[0]).toEqual(plan);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("does not apply an event if the scenario resets during verification", async () => {
    const { handlePayoutWebhook, store } = await setup();
    const gate = Promise.withResolvers<Response>();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/v1/oauth2/token")) return Response.json(AUTH.body);
      store.resetScenario(); return gate.promise;
    }));
    const work = handlePayoutWebhook(webhookBody("WH-RESET"), headers()).catch((err: unknown) => err);
    gate.resolve(Response.json(VERIFIED.body));
    expect(await work).toMatchObject({ status: 503 });
    expect(store.getStore().plans).toEqual([]);
  });
});

describe("POST /api/webhooks/paypal", () => {
  it("returns 400 without configuration and 413 for an oversized UTF-8 stream", async () => {
    const route = await importWithEnv<typeof import("@/app/api/webhooks/paypal/route")>("@/app/api/webhooks/paypal/route", {});
    const request = (body: string) => new Request("http://localhost/api/webhooks/paypal", { method: "POST", body });
    expect((await route.POST(request(webhookBody("WH-MOCK")))).status).toBe(400);
    // Under 64K characters, but above 64 KiB when encoded as UTF-8.
    expect((await route.POST(request("雨".repeat(25_000)))).status).toBe(413);
  });
  it("returns 200 only after processing and generic 502 on an upstream error", async () => {
    const { plan } = await setupPayout();
    const route = await importWithEnv<typeof import("@/app/api/webhooks/paypal/route")>(
      "@/app/api/webhooks/paypal/route", WEBHOOK_KEYS);
    const request = (id: string) => new Request("http://localhost/api/webhooks/paypal", {
      method: "POST", headers: SIGNATURE_HEADERS, body: webhookBody(id),
    });
    queueFetch(AUTH, VERIFIED, { body: batchBody(plan) }, { status: 500, body: { message: "private detail" } });
    expect((await route.POST(request("WH-ROUTE"))).status).toBe(200);
    const failure = await route.POST(request("WH-UPSTREAM"));
    expect(failure.status).toBe(502);
    expect(await failure.text()).not.toContain("private detail");
  });
});
