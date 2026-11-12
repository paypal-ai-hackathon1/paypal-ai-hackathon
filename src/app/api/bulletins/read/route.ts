import { readBulletin } from "@/lib/ai-bulletin";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";
import { getStore } from "@/lib/store";

const BULLETIN_ID = /^[a-z0-9-]{1,80}$/;
const MAX_TEXT_CHARS = 4000;
// Each call may cost an AI request, so this is stricter than the other routes.
const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

// Reads a bulletin with AI. Send { bulletinId } for a scenario bulletin (the reading is saved and
// shown on the review screen) or { text } for a bulletin the organizer pasted (returned only).
// The reading is evidence for the reviewer. It never starts a plan or changes an amount.
export async function POST(req: Request) {
  const rate = limiter(clientKey(req));
  if (!rate.ok) {
    return Response.json(
      { error: "Too many requests, try again shortly" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { bulletinId?: unknown; text?: unknown };
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }

  const provinceNames = getStore().provinces.map((p) => p.nameVi);
  let bulletinId: string;
  let text: string;

  if (typeof body.bulletinId === "string") {
    bulletinId = body.bulletinId.trim();
    const bulletin = BULLETIN_ID.test(bulletinId) ? getStore().bulletins.find((b) => b.id === bulletinId) : undefined;
    if (!bulletin) return Response.json({ error: "Unknown bulletin" }, { status: 404 });
    text = bulletin.text;
  } else if (typeof body.text === "string") {
    text = body.text.trim();
    if (!text) return Response.json({ error: "text is required" }, { status: 400 });
    if (text.length > MAX_TEXT_CHARS) {
      return Response.json({ error: `text must be at most ${MAX_TEXT_CHARS} characters` }, { status: 400 });
    }
    bulletinId = "pasted";
  } else {
    return Response.json({ error: "Send bulletinId, or the bulletin text as text" }, { status: 400 });
  }

  const result = await readBulletin({ bulletinId, text, provinceNames });
  if (!result.ok) return Response.json({ error: result.error }, { status: 502 });

  if (bulletinId !== "pasted") {
    // Read the store again after the await: a demo reset may have replaced it meanwhile.
    const store = getStore();
    if (store.bulletins.some((b) => b.id === bulletinId)) {
      store.bulletinReadings = [...store.bulletinReadings.filter((r) => r.bulletinId !== bulletinId), result.reading];
    }
  }
  return Response.json({ reading: result.reading });
}
