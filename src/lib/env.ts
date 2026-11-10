// Central place for configuration. Server-only: never import this from a client component.
// The "server-only" import turns an accidental client import into a build error.
import "server-only";

function read(name: string): string {
  return process.env[name]?.trim() ?? "";
}

/**
 * Comma-separated emails, one slot per partner in partner order. An invalid entry keeps its slot
 * as "" (that partner falls back to @example.com), so the entries after it stay with the right
 * partner. Logs how many were invalid, never the values.
 */
function readEmailList(name: string): string[] {
  const raw = read(name);
  if (!raw) return [];
  const entries = raw.split(",").map((entry) => entry.trim());
  const emails = entries.map((entry) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry) ? entry : ""));
  const invalid = emails.filter((email) => !email).length;
  if (invalid) console.warn(`${name}: ${invalid} invalid entr${invalid === 1 ? "y" : "ies"} ignored`);
  return emails;
}

export const env = {
  paypal: {
    clientId: read("PAYPAL_CLIENT_ID"),
    clientSecret: read("PAYPAL_CLIENT_SECRET"),
    // Only the sandbox is allowed for this hackathon.
    baseUrl: "https://api-m.sandbox.paypal.com",
  },
  ai: {
    // Any OpenAI-compatible chat completions endpoint works here.
    baseUrl: read("AI_BASE_URL") || "https://api.openai.com/v1",
    apiKey: read("AI_API_KEY"),
    model: read("AI_MODEL") || "gpt-4o-mini",
  },
  partners: {
    // Optional sandbox personal account emails for the demo partners, in partner order.
    // Partners without one ("" or missing) fall back to an @example.com address.
    paypalEmails: readEmailList("PARTNER_PAYPAL_EMAILS"),
  },
};

/** True when PayPal sandbox credentials are present. Otherwise PayPal calls are mocked. */
export const paypalConfigured = Boolean(env.paypal.clientId && env.paypal.clientSecret);

/** True when an AI key is present. Otherwise AI calls return a canned reply. */
export const aiConfigured = Boolean(env.ai.apiKey);
