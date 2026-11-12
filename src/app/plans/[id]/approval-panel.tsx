"use client";

import { useEffect, useRef, useState } from "react";
import type { Plan } from "@/lib/domain";
import { formatUsd, planErrorMessage } from "@/lib/format";
import { MAX_POLLS, PAYOUT_STATUS_TEXT, payoutNeedsAttention, pollDelayMs, shouldPoll } from "@/lib/payout-labels";

type Props = {
  plan: Plan;
  onPlan: (plan: Plan) => void;
  partnerName: (id: string) => string;
  ruleVersion: number | null;
  householdCount: number;
};

/**
 * The one place money moves. Approval restates what will be sent and sends the plan hash, so the
 * server refuses it if the plan changed. Afterwards it polls the payout status until it is final.
 */
export function ApprovalPanel({ plan, onPlan, partnerName, ruleVersion, householdCount }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [polls, setPolls] = useState(0);
  const [pollError, setPollError] = useState(false);
  // A ref, not state: it blocks a second click before React re-renders the disabled button.
  const inFlight = useRef(false);

  const canApprove = plan.status === "in_review" || plan.status === "approved";
  const retrying = plan.status === "approved";
  const polling = shouldPoll(plan.status) && polls < MAX_POLLS;

  useEffect(() => {
    if (!polling) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/plans/${plan.id}/status`, { cache: "no-store" });
        const data = (await res.json().catch(() => ({}))) as { plan?: Plan };
        if (cancelled) return;
        if (data.plan) onPlan(data.plan);
        setPollError(!res.ok);
      } catch {
        if (!cancelled) setPollError(true);
      } finally {
        if (!cancelled) setPolls((n) => n + 1);
      }
    }, pollDelayMs(polls));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [polling, polls, plan.id, onPlan]);

  async function approve(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${plan.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planHash: plan.planHash, approverName: name.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { plan?: Plan; error?: string };
      if (data.plan) onPlan(data.plan);
      if (res.ok) {
        setConfirming(false);
        setPolls(0);
      } else {
        setError(planErrorMessage(res.status, data.error, "The approval did not go through. Try again."));
        // A stale plan comes back with its new totals: close the form so the reviewer checks them.
        if (res.status === 409) setConfirming(false);
      }
    } catch {
      setError("Network error. The plan was not changed on this screen: reload it before trying again.");
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }

  if (canApprove) {
    return (
      <div className="flex flex-col gap-3 border-t border-line pt-3">
        {error && (
          <p role="alert" className="rounded-md bg-alert-soft px-3 py-2 text-sm text-alert">
            {error}
          </p>
        )}
        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={plan.totalCents <= 0}
            className="rounded-md bg-accent px-4 py-3 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50"
          >
            {retrying ? "Retry sending the payout" : `Approve and send ${formatUsd(plan.totalCents)}`}
          </button>
        ) : (
          <form onSubmit={approve} className="flex flex-col gap-3 rounded-md border border-accent p-3">
            <p className="text-sm">
              Send <strong className="tabular-nums">{formatUsd(plan.totalCents)}</strong> to{" "}
              <strong>{plan.items.length} local partners</strong> for {householdCount} households, under locked rule{" "}
              <strong>v{ruleVersion ?? "?"}</strong>.
            </p>
            <p className="text-xs text-muted">
              Fingerprint <span className="font-mono">{plan.planHash.slice(0, 16)}</span>. If anyone changed the plan
              since you opened it, PayPal is not called and you see the new totals.
            </p>
            <label className="flex flex-col gap-1 text-sm">
              Your name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={80}
                autoComplete="name"
                disabled={sending}
                className="rounded-md border border-line bg-background px-3 py-2"
              />
            </label>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={sending || !name.trim()}
                className="flex-1 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90 disabled:opacity-50"
              >
                {sending ? "Sending to PayPal…" : "Confirm and send"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={sending}
                className="rounded-md border border-line px-3 py-2 text-sm"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3" aria-live="polite">
      <p className="text-sm">
        Approved by <strong>{plan.approvedBy}</strong>
        {plan.approvedAt && <> at {new Date(plan.approvedAt).toLocaleString("en-GB", { timeZone: "Asia/Ho_Chi_Minh" })}</>}.
      </p>
      {plan.payoutBatchId && (
        <div className="text-xs">
          <p className="font-semibold text-muted">
            {plan.payoutBatchId.startsWith("MOCK-") ? "Mock payout batch (no PayPal key set)" : "PayPal sandbox batch ID"}
          </p>
          <p className="mt-1 break-all font-mono">{plan.payoutBatchId}</p>
        </div>
      )}
      <ul className="flex flex-col gap-2">
        {plan.items.map((item) => {
          const text = item.payoutStatus ? PAYOUT_STATUS_TEXT[item.payoutStatus] : PAYOUT_STATUS_TEXT.PENDING;
          const attention = payoutNeedsAttention(item.payoutStatus);
          const done = item.payoutStatus === "SUCCESS";
          return (
            <li
              key={item.partnerId}
              className={`rounded-md px-3 py-2 text-sm ${attention ? "border-2 border-alert bg-alert-soft" : done ? "bg-ok-soft" : "bg-background"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{partnerName(item.partnerId)}</span>
                <span className="tabular-nums">{formatUsd(item.amountCents)}</span>
              </div>
              <p className={`mt-1 text-xs font-semibold ${attention ? "text-alert" : done ? "text-ok" : "text-muted"}`}>
                {text.label}
              </p>
              <p className="text-xs text-muted">{text.detail}</p>
            </li>
          );
        })}
      </ul>
      {polling && <p className="text-xs text-muted">Checking PayPal for updates…</p>}
      {pollError && <p className="text-xs text-alert">Could not reach PayPal on the last check. Retrying.</p>}
      {shouldPoll(plan.status) && !polling && (
        <button
          type="button"
          onClick={() => setPolls(0)}
          className="self-start rounded-md border border-line px-3 py-1 text-xs font-semibold"
        >
          Check again
        </button>
      )}
    </div>
  );
}
