import { approvePlan, planErrorResponse } from "@/lib/plans";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";

const PLAN_ID = /^plan-[a-z0-9]{1,40}$/;
const PLAN_HASH = /^[a-f0-9]{64}$/;
const MAX_NAME_CHARS = 80;
const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

// The one place money moves: a person approves the plan they reviewed and the Payouts batch is
// sent. There is no login in the demo, so the approver gives a name, which is recorded on the plan.
export async function POST(req: Request, ctx: RouteContext<"/api/plans/[id]/approve">) {
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

  const body = (await req.json().catch(() => ({}))) as { planHash?: unknown; approverName?: unknown };
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }
  const planHash = typeof body.planHash === "string" ? body.planHash.trim().toLowerCase() : "";
  if (!PLAN_HASH.test(planHash)) {
    return Response.json(
      { error: "planHash is required: send the planHash of the plan you reviewed" },
      { status: 400 },
    );
  }
  const approverName = typeof body.approverName === "string" ? body.approverName.trim() : "";
  if (!approverName) {
    return Response.json({ error: "approverName is required: the name of the person approving" }, { status: 400 });
  }
  if (approverName.length > MAX_NAME_CHARS) {
    return Response.json({ error: `approverName must be at most ${MAX_NAME_CHARS} characters` }, { status: 400 });
  }

  try {
    return Response.json({ plan: await approvePlan({ planId: id, planHash, approverName }) });
  } catch (err) {
    return planErrorResponse(err);
  }
}
