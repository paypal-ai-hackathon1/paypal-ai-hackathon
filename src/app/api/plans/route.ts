import { createPlan, planErrorResponse } from "@/lib/plans";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";

const RULE_ID = /^[a-z0-9-]{1,80}$/;
const limiter = createRateLimiter({ limit: 20, windowMs: 60_000 });

// Creates the payout plan for a locked rule, or returns the one that already exists.
export async function POST(req: Request) {
  const rate = limiter(clientKey(req));
  if (!rate.ok) {
    return Response.json(
      { error: "Too many requests, try again shortly" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { ruleId?: unknown };
  const ruleId = typeof body.ruleId === "string" ? body.ruleId.trim() : "";
  if (!RULE_ID.test(ruleId)) {
    return Response.json({ error: "ruleId is required, like rule-rain-150-v1" }, { status: 400 });
  }

  try {
    const { plan, created } = createPlan(ruleId);
    return Response.json({ plan }, { status: created ? 201 : 200 });
  } catch (err) {
    return planErrorResponse(err);
  }
}
