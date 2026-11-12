"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Creates the payout plan for the locked rule (or gets the existing one) and opens its review page.
 * The server decides everything in the plan; this button only asks for it.
 */
export function StartReviewButton({ ruleId, className }: { ruleId: string; className: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleId }),
      });
      const data = (await res.json().catch(() => ({}))) as { plan?: { id: string }; error?: string };
      if (!res.ok || !data.plan) {
        setError(data.error ?? "Could not create the payout plan. Try again.");
        setBusy(false);
        return;
      }
      router.push(`/plans/${data.plan.id}`);
    } catch {
      setError("Network error. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button type="button" onClick={start} disabled={busy} className={`${className} disabled:opacity-60`}>
        {busy ? "Preparing the plan…" : "Review the payout plan"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-alert">
          {error}
        </p>
      )}
    </div>
  );
}
