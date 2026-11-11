import { excludeHousehold, planErrorResponse } from "@/lib/plans";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";

const PLAN_ID = /^plan-[a-z0-9]{1,40}$/;
const HOUSEHOLD_ID = /^[a-z0-9-]{1,40}$/;
const limiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

// A reviewer takes one household out of a plan before approval. Amounts are recalculated by the
// rules engine and the plan gets a new hash.
export async function POST(req: Request, ctx: RouteContext<"/api/plans/[id]/exclude">) {
  const rate = limiter(clientKey(req));
  if (!rate.ok) {
    return Response.json(
      { error: "Too many requests, try again shortly" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
    );
  }

  const { id } = await ctx.params;
  if (!PLAN_ID.test(id)) {
    return Response.json({ error: "Unknown plan" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { householdId?: unknown };
  const householdId = typeof body.householdId === "string" ? body.householdId.trim() : "";
  if (!HOUSEHOLD_ID.test(householdId)) {
    return Response.json({ error: "householdId is required, like hh-qn-13" }, { status: 400 });
  }

  try {
    return Response.json({ plan: excludeHousehold(id, householdId) });
  } catch (err) {
    return planErrorResponse(err);
  }
}
