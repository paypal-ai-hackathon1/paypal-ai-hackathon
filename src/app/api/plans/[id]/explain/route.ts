import { explainPlan } from "@/lib/ai-flags";
import { getPlanChecks, planErrorResponse } from "@/lib/plans";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";

const PLAN_ID = /^plan-[a-z0-9]{1,40}$/;
// Each call may cost an AI request.
const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

// AI explains the household flags and summarizes the plan. Only IDs, check results and amounts
// are sent to the model. The answer is a note for the reviewer: it changes nothing in the plan.
export async function POST(req: Request, ctx: RouteContext<"/api/plans/[id]/explain">) {
  const rate = limiter(clientKey(req));
  if (!rate.ok) {
    return Response.json(
      { error: "Too many requests, try again shortly" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
    );
  }

  const { id } = await ctx.params;
  if (!PLAN_ID.test(id)) return Response.json({ error: "Unknown plan" }, { status: 404 });

  try {
    const { plan, results } = getPlanChecks(id);
    return Response.json(await explainPlan(plan, results));
  } catch (err) {
    return planErrorResponse(err);
  }
}
