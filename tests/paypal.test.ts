import { afterEach, describe, expect, it, vi } from "vitest";
import { importWithEnv, queueFetch } from "./helpers";

type PayPalModule = typeof import("@/lib/paypal");

const SANDBOX = { PAYPAL_CLIENT_ID: "test-id", PAYPAL_CLIENT_SECRET: "test-secret" };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Keeps expected error logs out of the test output, and lets a test read what was logged. */
function silenceErrors() {
  return vi.spyOn(console, "error").mockImplementation(() => {});
}

describe("PayPal client in mock mode (no credentials)", () => {
  it("creates an order whose approve URL points back to the return route", async () => {
    const { createOrder } = await importWithEnv<PayPalModule>("@/lib/paypal", {});
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const order = await createOrder({
      amount: "1.00",
      returnUrl: "http://localhost:3000/api/paypal/return",
      cancelUrl: "http://localhost:3000/",
    });

    expect(order.mock).toBe(true);
    expect(order.id).toMatch(/^MOCK-/);
    expect(new URL(order.approveUrl).searchParams.get("token")).toBe(order.id);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("captures a mock order as COMPLETED without network calls", async () => {
    const { captureOrder } = await importWithEnv<PayPalModule>("@/lib/paypal", {});
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await captureOrder("MOCK-123");

    expect(result).toMatchObject({ id: "MOCK-123", status: "COMPLETED", mock: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("PayPal client with sandbox credentials", () => {
  it("authenticates, creates an order and returns the payer-action link", async () => {
    const { createOrder } = await importWithEnv<PayPalModule>("@/lib/paypal", SANDBOX);
    const fetchMock = queueFetch(
      { body: { access_token: "tok", expires_in: 3600 } },
      {
        body: {
          id: "ORDER-1",
          status: "PAYER_ACTION_REQUIRED",
          links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1" }],
        },
      },
    );

    const order = await createOrder({
      amount: "4.20",
      currency: "USD",
      returnUrl: "http://localhost:3000/api/paypal/return",
      cancelUrl: "http://localhost:3000/",
    });

    expect(order).toEqual({
      id: "ORDER-1",
      status: "PAYER_ACTION_REQUIRED",
      approveUrl: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1",
      mock: false,
    });

    const [authUrl] = fetchMock.mock.calls[0] as unknown as [string];
    expect(authUrl).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");

    const [orderUrl, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(orderUrl).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders");
    const body = JSON.parse(init.body as string);
    expect(body.intent).toBe("CAPTURE");
    expect(body.purchase_units[0].amount).toEqual({ currency_code: "USD", value: "4.20" });
  });

  it("surfaces PayPal errors instead of failing silently", async () => {
    const { createOrder } = await importWithEnv<PayPalModule>("@/lib/paypal", SANDBOX);
    silenceErrors();
    queueFetch({ status: 401, body: { error: "invalid_client" } });

    await expect(
      createOrder({ amount: "1.00", returnUrl: "http://x/r", cancelUrl: "http://x/c" }),
    ).rejects.toThrow(/PayPal auth failed \(401\)/);
  });
});

const RECIPIENTS = [
  { senderItemId: "partner-qn", email: "qn@example.com", amountCents: 1250 },
  { senderItemId: "partner-hp", email: "hp@example.com", amountCents: 8000 },
];

/** Plan IDs must be unique per test: mock batches live on globalThis and outlive a module reset. */
const planId = () => `plan-${crypto.randomUUID().slice(0, 12)}`;

describe("Payout amounts", () => {
  it("converts integer cents to PayPal's two-decimal strings", async () => {
    const { centsToAmount } = await importWithEnv<PayPalModule>("@/lib/paypal", {});
    expect(centsToAmount(1250)).toBe("12.50");
    expect(centsToAmount(2000)).toBe("20.00");
    expect(centsToAmount(5)).toBe("0.05");
    expect(centsToAmount(100001)).toBe("1000.01");
    expect(() => centsToAmount(12.5)).toThrow();
    expect(() => centsToAmount(-1)).toThrow();
  });

  it("reads PayPal's decimal strings back as cents", async () => {
    const { amountToCents } = await importWithEnv<PayPalModule>("@/lib/paypal", {});
    expect(amountToCents("12.50")).toBe(1250);
    expect(amountToCents("12.5")).toBe(1250);
    expect(amountToCents("7")).toBe(700);
    expect(() => amountToCents("1,00")).toThrow();
  });
});

describe("Payouts in mock mode (no credentials)", () => {
  it("creates a MOCK-BATCH- batch without network calls, once per plan", async () => {
    const { createPayoutBatch } = await importWithEnv<PayPalModule>("@/lib/paypal", {});
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const id = planId();

    const first = await createPayoutBatch({ planId: id, recipients: RECIPIENTS });
    const retry = await createPayoutBatch({ planId: id, recipients: RECIPIENTS });

    expect(first).toEqual({ batchId: `MOCK-BATCH-${id}`, senderBatchId: id, status: "PENDING", items: [], mock: true });
    expect(retry.batchId).toBe(first.batchId);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports PENDING on the first status read and SUCCESS after that", async () => {
    const { createPayoutBatch, getPayoutBatch } = await importWithEnv<PayPalModule>("@/lib/paypal", {});
    const { batchId } = await createPayoutBatch({ planId: planId(), recipients: RECIPIENTS });

    const firstRead = await getPayoutBatch(batchId);
    expect(firstRead.status).toBe("PENDING");
    expect(firstRead.items.map((i) => i.status)).toEqual(["PENDING", "PENDING"]);

    const secondRead = await getPayoutBatch(batchId);
    expect(secondRead.status).toBe("SUCCESS");
    expect(secondRead.items).toEqual([
      expect.objectContaining({ senderItemId: "partner-qn", amountCents: 1250, status: "SUCCESS", errorName: null }),
      expect.objectContaining({ senderItemId: "partner-hp", amountCents: 8000, status: "SUCCESS", errorName: null }),
    ]);
  });

  it("keeps mock batches across module copies, as separate routes would have", async () => {
    const first = await importWithEnv<PayPalModule>("@/lib/paypal", {});
    const { batchId } = await first.createPayoutBatch({ planId: planId(), recipients: RECIPIENTS });

    const second = await importWithEnv<PayPalModule>("@/lib/paypal", {});
    await expect(second.getPayoutBatch(batchId)).resolves.toMatchObject({ batchId, status: "PENDING" });
  });

  it("rejects bad input before anything is sent", async () => {
    const { createPayoutBatch } = await importWithEnv<PayPalModule>("@/lib/paypal", {});
    const ok = RECIPIENTS[0];

    await expect(createPayoutBatch({ planId: planId(), recipients: [] })).rejects.toThrow(/at least one/);
    await expect(
      createPayoutBatch({ planId: planId(), recipients: [{ ...ok, amountCents: 12.5 }] }),
    ).rejects.toThrow(/integer number of cents/);
    await expect(
      createPayoutBatch({ planId: planId(), recipients: [{ ...ok, amountCents: 0 }] }),
    ).rejects.toThrow(/integer number of cents/);
    await expect(
      createPayoutBatch({ planId: planId(), recipients: [{ ...ok, email: "not-an-email" }] }),
    ).rejects.toThrow(/Invalid payout email/);
    await expect(createPayoutBatch({ planId: "plan id with spaces", recipients: [ok] })).rejects.toThrow(/planId/);
    await expect(createPayoutBatch({ planId: "p".repeat(65), recipients: [ok] })).rejects.toThrow(/planId/);
  });

  it("reads a mock batch without network calls even when credentials are set", async () => {
    const mock = await importWithEnv<PayPalModule>("@/lib/paypal", {});
    const { batchId } = await mock.createPayoutBatch({ planId: planId(), recipients: RECIPIENTS });

    const sandbox = await importWithEnv<PayPalModule>("@/lib/paypal", SANDBOX);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(sandbox.getPayoutBatch(batchId)).resolves.toMatchObject({ batchId, mock: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("Payouts with sandbox credentials", () => {
  it("sends one batch keyed by the plan ID, with amounts as decimal strings", async () => {
    const { createPayoutBatch } = await importWithEnv<PayPalModule>("@/lib/paypal", SANDBOX);
    const id = planId();
    const fetchMock = queueFetch(
      { body: { access_token: "tok", expires_in: 3600 } },
      { status: 201, body: { batch_header: { payout_batch_id: "BATCH-1", batch_status: "PENDING" } } },
    );

    const batch = await createPayoutBatch({ planId: id, recipients: RECIPIENTS });

    expect(batch).toEqual({ batchId: "BATCH-1", senderBatchId: id, status: "PENDING", items: [], mock: false });

    const [url, init] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("https://api-m.sandbox.paypal.com/v1/payments/payouts");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["PayPal-Request-Id"]).toBe(id);

    const body = JSON.parse(init.body as string);
    expect(body.sender_batch_header.sender_batch_id).toBe(id);
    expect(body.items).toEqual([
      expect.objectContaining({
        recipient_type: "EMAIL",
        receiver: "qn@example.com",
        recipient_wallet: "PAYPAL",
        amount: { value: "12.50", currency: "USD" },
        sender_item_id: "partner-qn",
      }),
      expect.objectContaining({ amount: { value: "80.00", currency: "USD" }, sender_item_id: "partner-hp" }),
    ]);
  });

  it("sends the same PayPal-Request-Id when a plan's batch is retried", async () => {
    const { createPayoutBatch } = await importWithEnv<PayPalModule>("@/lib/paypal", SANDBOX);
    const id = planId();
    const created = { status: 201, body: { batch_header: { payout_batch_id: "BATCH-1", batch_status: "PENDING" } } };
    const fetchMock = queueFetch({ body: { access_token: "tok", expires_in: 3600 } }, created, created);

    await createPayoutBatch({ planId: id, recipients: RECIPIENTS });
    await createPayoutBatch({ planId: id, recipients: RECIPIENTS });

    const requestIds = fetchMock.mock.calls
      .slice(1)
      .map((call) => ((call as unknown as [string, RequestInit])[1].headers as Record<string, string>)["PayPal-Request-Id"]);
    expect(requestIds).toEqual([id, id]);
  });

  it("rejects a refused batch with PayPal's error name and logs the body instead of returning it", async () => {
    const { createPayoutBatch, PayPalError } = await importWithEnv<PayPalModule>("@/lib/paypal", SANDBOX);
    const logged = silenceErrors();
    queueFetch(
      { body: { access_token: "tok", expires_in: 3600 } },
      {
        status: 422,
        body: {
          name: "INSUFFICIENT_FUNDS",
          message: "Sender does not have sufficient funds. Please add funds and retry.",
          debug_id: "dbg-123",
        },
      },
    );

    const error = await createPayoutBatch({ planId: planId(), recipients: RECIPIENTS }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PayPalError);
    expect(error).toMatchObject({ status: 422, issue: "INSUFFICIENT_FUNDS", links: [] });
    expect((error as Error).message).not.toMatch(/sufficient funds|dbg-123/);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("dbg-123"));
  });

  it("returns the existing batch when PayPal refuses a reused sender_batch_id", async () => {
    const { createPayoutBatch } = await importWithEnv<PayPalModule>("@/lib/paypal", SANDBOX);
    silenceErrors();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const id = planId();
    const fetchMock = queueFetch(
      { body: { access_token: "tok", expires_in: 3600 } },
      {
        status: 400,
        body: {
          name: "USER_BUSINESS_ERROR",
          message: "Batch with given sender_batch_id already exists",
          links: [{ href: "https://api-m.sandbox.paypal.com/v1/payments/payouts/BATCH-1", rel: "self", method: "GET" }],
        },
      },
      {
        body: {
          batch_header: { payout_batch_id: "BATCH-1", batch_status: "PROCESSING", sender_batch_header: { sender_batch_id: id } },
          items: [
            {
              payout_item_id: "ITEM-1",
              transaction_status: "PENDING",
              payout_item: { sender_item_id: "partner-qn", amount: { value: "12.50", currency: "USD" } },
            },
          ],
        },
      },
    );

    const batch = await createPayoutBatch({ planId: id, recipients: RECIPIENTS });

    expect(batch).toMatchObject({ batchId: "BATCH-1", senderBatchId: id, status: "PROCESSING", mock: false });
    expect(batch.items).toHaveLength(1);
    const methods = fetchMock.mock.calls.slice(1).map((call) => (call as unknown as [string, RequestInit])[1].method ?? "GET");
    expect(methods).toEqual(["POST", "GET"]);
  });

  it("rethrows the refusal when the linked batch belongs to another plan", async () => {
    const { createPayoutBatch, PayPalError } = await importWithEnv<PayPalModule>("@/lib/paypal", SANDBOX);
    silenceErrors();
    queueFetch(
      { body: { access_token: "tok", expires_in: 3600 } },
      {
        status: 400,
        body: {
          name: "USER_BUSINESS_ERROR",
          links: [{ href: "https://api-m.sandbox.paypal.com/v1/payments/payouts/BATCH-OTHER", rel: "self" }],
        },
      },
      {
        body: {
          batch_header: {
            payout_batch_id: "BATCH-OTHER",
            batch_status: "SUCCESS",
            sender_batch_header: { sender_batch_id: "plan-someone-else" },
          },
          items: [],
        },
      },
    );

    const error = await createPayoutBatch({ planId: planId(), recipients: RECIPIENTS }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PayPalError);
    expect(error).toMatchObject({ status: 400, issue: "USER_BUSINESS_ERROR" });
  });

  it("treats unknown statuses as still in progress and logs them", async () => {
    const { getPayoutBatch } = await importWithEnv<PayPalModule>("@/lib/paypal", SANDBOX);
    const warned = vi.spyOn(console, "warn").mockImplementation(() => {});
    queueFetch(
      { body: { access_token: "tok", expires_in: 3600 } },
      {
        body: {
          batch_header: { payout_batch_id: "BATCH-N", batch_status: "SOMETHING_NEW" },
          items: [
            {
              payout_item_id: "ITEM-1",
              transaction_status: "ALSO_NEW",
              payout_item: { sender_item_id: "partner-qn", amount: { value: "1.00", currency: "USD" } },
            },
          ],
        },
      },
    );

    const batch = await getPayoutBatch("BATCH-N");

    expect(batch.status).toBe("PROCESSING");
    expect(batch.items[0].status).toBe("PENDING");
    expect(warned).toHaveBeenCalledTimes(2);
  });

  it("reads a denied batch", async () => {
    const { getPayoutBatch } = await importWithEnv<PayPalModule>("@/lib/paypal", SANDBOX);
    queueFetch(
      { body: { access_token: "tok", expires_in: 3600 } },
      { body: { batch_header: { payout_batch_id: "BATCH-D", batch_status: "DENIED" }, items: [] } },
    );

    await expect(getPayoutBatch("BATCH-D")).resolves.toMatchObject({ batchId: "BATCH-D", status: "DENIED", items: [] });
  });

  it("reads item status, amounts and error names back from a batch", async () => {
    const { getPayoutBatch } = await importWithEnv<PayPalModule>("@/lib/paypal", SANDBOX);
    const fetchMock = queueFetch(
      { body: { access_token: "tok", expires_in: 3600 } },
      {
        body: {
          batch_header: {
            payout_batch_id: "BATCH-1",
            batch_status: "SUCCESS",
            sender_batch_header: { sender_batch_id: "plan-abc" },
          },
          items: [
            {
              payout_item_id: "ITEM-1",
              transaction_status: "SUCCESS",
              payout_item: { sender_item_id: "partner-qn", amount: { value: "12.50", currency: "USD" } },
            },
            {
              payout_item_id: "ITEM-2",
              transaction_status: "UNCLAIMED",
              payout_item: { sender_item_id: "partner-hp", amount: { value: "80.00", currency: "USD" } },
              errors: { name: "RECEIVER_UNREGISTERED", message: "Receiver is unregistered" },
            },
          ],
        },
      },
    );

    const batch = await getPayoutBatch("BATCH-1");

    const [url] = fetchMock.mock.calls[1] as unknown as [string];
    expect(url).toBe("https://api-m.sandbox.paypal.com/v1/payments/payouts/BATCH-1");
    expect(batch).toEqual({
      batchId: "BATCH-1",
      senderBatchId: "plan-abc",
      status: "SUCCESS",
      items: [
        { payoutItemId: "ITEM-1", senderItemId: "partner-qn", amountCents: 1250, status: "SUCCESS", errorName: null },
        {
          payoutItemId: "ITEM-2",
          senderItemId: "partner-hp",
          amountCents: 8000,
          status: "UNCLAIMED",
          errorName: "RECEIVER_UNREGISTERED",
        },
      ],
      mock: false,
    });
  });
});
