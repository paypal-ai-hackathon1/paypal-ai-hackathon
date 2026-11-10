// Central place for configuration. Server-only: never import this from a client component.

function read(name: string): string {
  return process.env[name]?.trim() ?? "";
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
    // Partners without one fall back to an @example.com address.
    paypalEmails: read("PARTNER_PAYPAL_EMAILS")
      .split(",")
      .map((email) => email.trim())
      .filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)),
  },
};

/** True when PayPal sandbox credentials are present. Otherwise PayPal calls are mocked. */
export const paypalConfigured = Boolean(env.paypal.clientId && env.paypal.clientSecret);

/** True when an AI key is present. Otherwise AI calls return a canned reply. */
export const aiConfigured = Boolean(env.ai.apiKey);
