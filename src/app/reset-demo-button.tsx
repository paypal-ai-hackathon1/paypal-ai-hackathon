"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Clears every plan and starts the demo from a fresh scenario, then goes back to the replay. */
export function ResetDemoButton({ className }: { className: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reset() {
    if (!window.confirm("Start the demo over? Every plan and approval in this demo is cleared.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Could not reset the demo. Try again.");
        return;
      }
      router.push("/#replay");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button type="button" onClick={reset} disabled={busy} className={`${className} disabled:opacity-60`}>
        {busy ? "Resetting…" : "Reset demo"}
      </button>
      {error && (
        <span role="alert" className="text-xs text-alert">
          {error}
        </span>
      )}
    </span>
  );
}
