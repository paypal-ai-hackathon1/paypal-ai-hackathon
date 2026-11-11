import { connection } from "next/server";
import { getPlanView, planErrorResponse } from "@/lib/plans";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";

const PLAN_ID = /^plan-[a-z0-9]{1,40}$/;
const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

// The plan with its partners, households (masked), review flags and confirmation counts.
export async function GET(req: Request, ctx: RouteContext<"/api/plans/[id]">) {
  await connection(); // the store changes at runtime: never prerender this at build time

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

  try {
    return Response.json(getPlanView(id));
  } catch (err) {
    return planErrorResponse(err);
  }
}
