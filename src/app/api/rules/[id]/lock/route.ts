import { clientKey, createRateLimiter } from "@/lib/rate-limit";
import { lockRule } from "@/lib/rules";
import { getStore } from "@/lib/store";

const MAX_NAME_CHARS = 80;
const RULE_ID = /^[a-z0-9-]{1,80}$/;
const limiter = createRateLimiter({ limit: 20, windowMs: 60_000 });

// A person locks a reviewed draft rule. Locked rules never change: a change is a new version.
export async function POST(req: Request, ctx: RouteContext<"/api/rules/[id]/lock">) {
  const rate = limiter(clientKey(req));
  if (!rate.ok) {
    return Response.json(
      { error: "Too many requests, try again shortly" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
    );
  }

  const { id } = await ctx.params;
  if (!RULE_ID.test(id)) {
    return Response.json({ error: "Unknown rule" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { lockedBy?: unknown };
  const lockedBy = typeof body.lockedBy === "string" ? body.lockedBy.trim() : "";
  if (!lockedBy) {
    return Response.json({ error: "lockedBy is required: the name of the person locking the rule" }, { status: 400 });
  }
  if (lockedBy.length > MAX_NAME_CHARS) {
    return Response.json({ error: `lockedBy must be at most ${MAX_NAME_CHARS} characters` }, { status: 400 });
  }

  // Read the store after the awaits above: a scenario reset replaces the whole state.
  const store = getStore();
  const rule = store.rules.find((r) => r.id === id);
  if (!rule) {
    return Response.json({ error: "Unknown rule" }, { status: 404 });
  }
  if (rule.lockedAt !== null) {
    return Response.json(
      { error: "This rule is already locked. Create a new version to change it.", rule },
      { status: 409 },
    );
  }

  const locked = lockRule(rule, lockedBy);
  store.rules = store.rules.map((r) => (r.id === id ? locked : r));
  return Response.json({ rule: locked });
}
