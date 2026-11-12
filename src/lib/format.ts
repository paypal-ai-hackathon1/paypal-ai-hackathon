// Display helpers shared by server and client components. No env, no store: safe in "use client".

/** Integer cents to a US dollar label, e.g. 64000 -> "$640.00". */
export function formatUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

export type QuoteSplit = { before: string; match: string; after: string };

/**
 * Finds the quoted sentence inside the source text so the review screen can highlight it.
 * Matching ignores differences in whitespace, but nothing else: a quote the AI changed or made up
 * is not found, and the screen shows it as unverified. Returns null when there is no match.
 */
export function splitOnQuote(text: string, quote: string | null): QuoteSplit | null {
  const words = quote?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (words.length === 0) return null;
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const match = new RegExp(escaped.join("\\s+")).exec(text);
  if (!match) return null;
  return {
    before: text.slice(0, match.index),
    match: match[0],
    after: text.slice(match.index + match[0].length),
  };
}
