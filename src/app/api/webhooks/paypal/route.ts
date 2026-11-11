import { handlePayoutWebhook, WebhookError } from "@/lib/payout-webhook";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";

const MAX_BODY_BYTES = 64 * 1024;
const limiter = createRateLimiter({ limit: 300, windowMs: 60_000 });

async function readBody(req: Request): Promise<string> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new WebhookError(413, "Webhook body exceeds 64 KiB");
      }
      chunks.push(value);
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    } catch {
      throw new WebhookError(400, "Webhook body must be valid UTF-8");
    }
  } finally {
    reader.releaseLock();
  }
}

export async function POST(req: Request) {
  const rate = limiter(clientKey(req));
  if (!rate.ok) {
    return Response.json({ error: "Too many requests, try again shortly" }, {
      status: 429, headers: { "Retry-After": String(rate.retryAfterSec) },
    });
  }
  try {
    const result = await handlePayoutWebhook(await readBody(req), req.headers);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof WebhookError) return Response.json({ error: error.message }, { status: error.status });
    console.error(error);
    return Response.json({ error: "PayPal webhook processing failed. Retry shortly." }, { status: 502 });
  }
}
