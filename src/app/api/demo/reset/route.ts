import { clientKey, createRateLimiter } from "@/lib/rate-limit";
import { resetScenario } from "@/lib/store";

const limiter = createRateLimiter({ limit: 5, windowMs: 60_000 });

// Starts the demo over: plans, confirmations and callback checks are cleared and the scenario
// fixture is reloaded. There is no login in the demo, so anyone can reset it; it only touches
// simulated data. A payout already sent to the PayPal sandbox stays there, and its plan ID is
// never reused, so a new plan cannot collide with it.
export async function POST(req: Request) {
  const rate = limiter(clientKey(req));
  if (!rate.ok) {
    return Response.json(
      { error: "Too many resets, try again shortly" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
    );
  }

  const state = resetScenario();
  return Response.json({ ok: true, scenarioId: state.scenarioId });
}
