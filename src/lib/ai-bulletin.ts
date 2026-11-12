// Reads a Vietnamese weather bulletin with AI and returns each value with the sentence it came from.
//
// The AI never decides anything here. Code checks every quote against the bulletin: a value whose
// quote is not in the text is marked needs_review, and an empty value stays missing. A reading is
// evidence for the reviewer only. Nothing in the plan, the rules or the amounts reads it.

import "server-only";
import { asData, chatJson, DATA_POLICY, isRecord, type Validator } from "./ai";
import type { BulletinReading, ReadingField } from "./domain";
import { splitOnQuote } from "./format";

export const READING_KEYS = ["provinces", "hazard", "warningLevel", "validTime", "rainfall", "wind"] as const;
export type ReadingKey = (typeof READING_KEYS)[number];

/** What the model returns: a value and a quote per field. Status is decided by code, not the model. */
export type RawReading = {
  provinces: { value: string[] | null; quote: string | null };
} & { [K in Exclude<ReadingKey, "provinces">]: { value: string | null; quote: string | null } };

const MAX_FIELD_CHARS = 600;

const short = (v: unknown) => typeof v === "string" && v.length <= MAX_FIELD_CHARS;

export const validateRawReading: Validator<RawReading> = (value) => {
  if (!isRecord(value)) return { ok: false, error: "Reply with one JSON object." };
  const out: Record<string, { value: unknown; quote: string | null }> = {};
  for (const key of READING_KEYS) {
    const field = value[key];
    if (!isRecord(field)) return { ok: false, error: `\`${key}\` must be an object with "value" and "quote".` };
    const quote = field.quote ?? null;
    if (quote !== null && !short(quote)) return { ok: false, error: `\`${key}.quote\` must be a string or null.` };
    let v = field.value ?? null;
    if (key === "provinces") {
      if (v !== null && !(Array.isArray(v) && v.every(short))) {
        return { ok: false, error: "`provinces.value` must be an array of province names or null." };
      }
      if (Array.isArray(v) && v.length === 0) v = null;
    } else if (v !== null && !short(v)) {
      return { ok: false, error: `\`${key}.value\` must be a string or null.` };
    }
    if (typeof v === "string" && !v.trim()) v = null;
    out[key] = { value: v, quote: typeof quote === "string" && quote.trim() ? quote : null };
  }
  return { ok: true, value: out as RawReading };
};

function checkField<T>(field: { value: T | null; quote: string | null }, text: string): ReadingField<T> {
  if (field.value === null) return { value: null, quote: null, status: "missing" };
  const found = field.quote !== null && splitOnQuote(text, field.quote) !== null;
  return { value: field.value, quote: field.quote, status: found ? "ok" : "needs_review" };
}

/** Turns the model's answer into a reading. Every quote is checked against the bulletin text. */
export function checkReading(
  raw: RawReading,
  input: { bulletinId: string; text: string; mock: boolean; now?: Date },
): BulletinReading {
  const { text } = input;
  return {
    bulletinId: input.bulletinId,
    provinces: checkField(raw.provinces, text),
    hazard: checkField(raw.hazard, text),
    warningLevel: checkField(raw.warningLevel, text),
    validTime: checkField(raw.validTime, text),
    rainfall: checkField(raw.rainfall, text),
    wind: checkField(raw.wind, text),
    readAt: (input.now ?? new Date()).toISOString(),
    mock: input.mock,
  };
}

const sentences = (text: string) =>
  text
    .split(/\n|(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * The reading used when no AI key is set. It is built with plain pattern matching, so judges
 * without a key still see realistic evidence, and it goes through the same quote check.
 */
export function mockReading(text: string, provinceNames: string[]): RawReading {
  const all = sentences(text);
  const find = (re: RegExp) => all.find((s) => re.test(s)) ?? null;
  const pick = (sentence: string | null, re: RegExp) => (sentence ? (sentence.match(re)?.[0] ?? null) : null);

  const rainSentence = find(/mưa[^.]*\d+\s*-\s*\d+\s*mm/i);
  const windSentence = find(/sức gió mạnh nhất/i);
  const levelSentence = find(/cấp độ rủi ro/i);
  const timeSentence = find(/(từ|dự báo|trưa|chiều|đêm)[^.]*\d{2}\/\d{1,2}/i);
  const named = provinceNames.filter((name) => text.includes(name));
  const provinceSentence = all.find((s) => named.length > 0 && named.every((n) => s.includes(n))) ?? null;
  const title = all[0] ?? null;

  return {
    provinces: { value: named.length ? named : null, quote: provinceSentence },
    hazard: { value: title && /bão/i.test(title) ? "Typhoon (bão)" : null, quote: title },
    warningLevel: { value: pick(levelSentence, /cấp\s*\d+/i), quote: levelSentence },
    validTime: { value: pick(timeSentence, /(từ [^,]*?\d{2}\/\d{1,2}[^,]*?\d{2}\/\d{1,2})|(\d{2}\/\d{1,2})/i), quote: timeSentence },
    rainfall: { value: pick(rainSentence, /\d+\s*-\s*\d+\s*mm/i), quote: rainSentence },
    wind: { value: pick(windSentence, /cấp\s*\d+(\s*\([^)]*km\/h\))?/i), quote: windSentence },
  };
}

const SYSTEM_PROMPT = `You read Vietnamese weather bulletins for a flood relief team. ${DATA_POLICY}

Return this JSON object, with every key present:
{"provinces":{"value":["Province name", ...] or null,"quote":"..." or null},
 "hazard":{"value":"short English label" or null,"quote":"..." or null},
 "warningLevel":{"value":"e.g. cấp 4" or null,"quote":"..." or null},
 "validTime":{"value":"the period the warning covers, as written" or null,"quote":"..." or null},
 "rainfall":{"value":"amount as written, e.g. 150-250 mm" or null,"quote":"..." or null},
 "wind":{"value":"as written, e.g. cấp 12-13 (118-149 km/h)" or null,"quote":"..." or null}}

Rules:
- "quote" must be copied character for character from the bulletin: one sentence or part of one. Do not translate, fix or shorten words inside it.
- Use Vietnamese province names exactly as they appear in the bulletin.
- If the bulletin does not state a value, set both "value" and "quote" to null. Never guess or infer.`;

/** Reads one bulletin. Without an AI key it returns the pattern-matched mock reading. */
export async function readBulletin(input: {
  bulletinId: string;
  text: string;
  provinceNames: string[];
  now?: Date;
}): Promise<{ ok: true; reading: BulletinReading } | { ok: false; error: string }> {
  const result = await chatJson({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: asData("bulletin", input.text) },
    ],
    validate: validateRawReading,
    mock: mockReading(input.text, input.provinceNames),
  });
  if (!result.ok) return { ok: false, error: "The AI reading failed. Read the bulletin text directly." };
  return {
    ok: true,
    reading: checkReading(result.value, { bulletinId: input.bulletinId, text: input.text, mock: result.mock, now: input.now }),
  };
}
