"use client";

import { useState } from "react";
import type { BulletinReading, HouseholdFlag, Plan, PublicHousehold, ReadingField } from "@/lib/domain";
import { formatUsd, planErrorMessage, splitOnQuote } from "@/lib/format";
import type { PlanReview, ReviewBulletin } from "@/lib/plan-review";
import { formatVietnamTime, METRIC_LABEL } from "@/lib/replay";
import { ApprovalPanel } from "./approval-panel";

const STATUS_LABEL: Record<Plan["status"], string> = {
  in_review: "In review",
  approved: "Approved",
  payout_pending: "Payout sent",
  paid: "Paid",
  needs_attention: "Needs attention",
};

const FLAG_LABEL: Record<HouseholdFlag["kind"], string> = {
  duplicate_phone: "Same phone as another household",
  duplicate_address: "Same address as another household",
  registration_spike: "Registered during a sudden spike",
};

export function PlanReviewScreen({ initial }: { initial: PlanReview }) {
  const [plan, setPlan] = useState(initial.plan);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [flags, setFlags] = useState(initial.flags);
  const [summary, setSummary] = useState<{ text: string; source: "ai" | "template"; mock: boolean } | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  const { rule, partners, households, provinces, bulletins } = initial;
  const flaggedCount = new Set(flags.map((f) => f.householdId)).size;

  async function explain() {
    setExplaining(true);
    setExplainError(null);
    try {
      const res = await fetch(`/api/plans/${plan.id}/explain`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        flags?: HouseholdFlag[];
        summary?: string;
        source?: "ai" | "template";
        mock?: boolean;
        error?: string;
      };
      if (!res.ok || !data.flags || !data.summary) {
        setExplainError(data.error ?? "Could not get an explanation. The notes below still apply.");
        return;
      }
      setFlags(data.flags);
      setSummary({ text: data.summary, source: data.source ?? "template", mock: Boolean(data.mock) });
    } catch {
      setExplainError("Network error. Try again.");
    } finally {
      setExplaining(false);
    }
  }
  const provinceName = (id: string) => provinces.find((p) => p.id === id)?.name ?? id;
  const flagsFor = (id: string) => flags.filter((f) => f.householdId === id);
  const editable = plan.status === "in_review";
  const householdCount = plan.items.reduce((n, item) => n + item.householdIds.length, 0);

  async function exclude(householdId: string) {
    setPendingId(householdId);
    setError(null);
    try {
      const res = await fetch(`/api/plans/${plan.id}/exclude`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ householdId }),
      });
      const data = (await res.json().catch(() => ({}))) as { plan?: Plan; error?: string };
      // Totals always come from the server, which recalculates them with the rules engine.
      if (data.plan) setPlan(data.plan);
      if (!res.ok) setError(planErrorMessage(res.status, data.error, "Could not exclude this household. Try again."));
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Payout plan</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Review before anything is paid</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Code decided which provinces qualify and how much each partner gets. AI only read the bulletins and
            flagged households to check. You can take households out before approving.
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm font-medium ${
            plan.status === "needs_attention" ? "bg-alert-soft text-alert" : "bg-accent-soft text-accent"
          }`}
        >
          {STATUS_LABEL[plan.status]}
        </span>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-8">
          {/* Why: the locked rule and the forecasts that crossed it */}
          <section aria-labelledby="why" className="flex flex-col gap-3">
            <h2 id="why" className="text-lg font-semibold">
              Why these provinces
            </h2>
            {rule ? (
              <div className="rounded-md border border-line bg-surface p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded bg-ok-soft px-2 py-0.5 font-semibold text-ok">Locked rule v{rule.version}</span>
                  {rule.lockedAt && (
                    <span className="text-muted">
                      Locked {formatVietnamTime(rule.lockedAt)}
                      {rule.lockedBy ? ` by ${rule.lockedBy}` : ""}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm">“{rule.sourceSentence}”</p>
              </div>
            ) : (
              <p className="text-sm text-alert">The rule behind this plan is no longer loaded.</p>
            )}
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full min-w-[420px] text-left text-sm">
                <thead className="bg-surface text-xs uppercase tracking-wider text-muted">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Province</th>
                    <th className="px-3 py-2 font-semibold">Forecast</th>
                    <th className="px-3 py-2 font-semibold">Threshold</th>
                    <th className="px-3 py-2 font-semibold">Issued ahead</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.triggers.map((t) => (
                    <tr key={t.provinceId} className="border-t border-line">
                      <td className="px-3 py-2 font-medium">{provinceName(t.provinceId)}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {t.value} {METRIC_LABEL[t.metric].unit}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted">
                        ≥ {t.threshold} {METRIC_LABEL[t.metric].unit}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-muted">{t.leadHours} h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted">
              Checked by code against the locked rule ({METRIC_LABEL[plan.triggers[0]?.metric ?? "rain_24h_mm"].name}
              ). AI output cannot add a province.
            </p>
          </section>

          {/* Evidence: what AI read, next to the sentence it came from */}
          <section aria-labelledby="evidence" className="flex flex-col gap-3">
            <h2 id="evidence" className="text-lg font-semibold">
              What AI read from the bulletins
            </h2>
            <p className="text-sm text-muted">
              Each value sits next to the sentence it was taken from. Values marked “Check this” did not match the
              source exactly and need a person to look. Readings are evidence only: they never change who is paid.
            </p>
            {bulletins.length === 0 ? (
              <p className="text-sm text-muted">No bulletins in this scenario.</p>
            ) : (
              bulletins.map((b) => <BulletinEvidence key={b.id} bulletin={b} />)
            )}
          </section>

          {/* Who: partners, households, flags and Exclude */}
          <section aria-labelledby="who" className="flex flex-col gap-3">
            <h2 id="who" className="text-lg font-semibold">
              Who gets paid
            </h2>
            {error && (
              <p role="alert" className="rounded-md bg-alert-soft px-3 py-2 text-sm text-alert">
                {error}
              </p>
            )}
            {!editable && (
              <p className="rounded-md bg-accent-soft px-3 py-2 text-sm">
                This plan is {STATUS_LABEL[plan.status].toLowerCase()}, so its households can no longer change.
              </p>
            )}
            <div className="flex flex-col gap-2 rounded-md border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">
                  <strong>{flaggedCount} households</strong> have review notes from automatic checks (same phone, same
                  address, registration bursts). Notes never exclude anyone: you decide.
                </p>
                <button
                  type="button"
                  onClick={explain}
                  disabled={explaining}
                  className="shrink-0 rounded-md border border-accent px-3 py-1 text-xs font-semibold text-accent disabled:opacity-50"
                >
                  {explaining ? "Explaining…" : summary ? "Explain again" : "Explain with AI"}
                </button>
              </div>
              {summary && (
                <p className="rounded-md bg-accent-soft px-3 py-2 text-sm">
                  {summary.text}{" "}
                  <span className="text-xs text-muted">
                    (
                    {summary.source === "ai"
                      ? "written by AI from IDs and amounts only; amounts are checked against the plan"
                      : summary.mock
                        ? "template: no AI key is set"
                        : "template: AI was unavailable"}
                    )
                  </span>
                </p>
              )}
              {explainError && (
                <p role="alert" className="text-xs text-alert">
                  {explainError}
                </p>
              )}
            </div>
            {partners.map((partner) => {
              const item = plan.items.find((i) => i.partnerId === partner.id);
              const included = households.filter((h) => item?.householdIds.includes(h.id));
              const excluded = households.filter(
                (h) => h.partnerId === partner.id && plan.excludedHouseholdIds.includes(h.id),
              );
              return (
                <article key={partner.id} className="rounded-md border border-line bg-surface">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-4">
                    <div>
                      <h3 className="font-semibold">{partner.name}</h3>
                      <p className="text-xs text-muted">
                        {provinceName(partner.provinceId)} · contact {partner.contactName}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold tabular-nums">{formatUsd(item?.amountCents ?? 0)}</p>
                      <p className="text-xs text-muted tabular-nums">
                        {included.length} × {formatUsd(rule?.amountPerHouseholdCents ?? 0)} · calculated by code
                      </p>
                    </div>
                  </div>
                  <ul className="divide-y divide-line">
                    {included.map((h) => (
                      <HouseholdRow
                        key={h.id}
                        household={h}
                        flags={flagsFor(h.id)}
                        editable={editable}
                        pending={pendingId === h.id}
                        disabled={pendingId !== null}
                        onExclude={() => exclude(h.id)}
                      />
                    ))}
                    {excluded.map((h) => (
                      <li key={h.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm text-muted">
                        <span className="line-through">{h.headName}</span>
                        <span className="text-xs">Excluded</span>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </section>
        </div>

        {/* Summary */}
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Plan total</p>
            <p className="text-3xl font-semibold tabular-nums" aria-live="polite">
              {formatUsd(plan.totalCents)}
            </p>
            <p className="text-sm text-muted">
              {householdCount} households through {plan.items.length} local partners. Calculated by code from the
              locked rule.
            </p>
            {plan.excludedHouseholdIds.length > 0 && (
              <p className="text-sm">{plan.excludedHouseholdIds.length} excluded by the reviewer.</p>
            )}
            <dl className="border-t border-line pt-3 text-xs text-muted">
              <dt className="font-semibold">Plan fingerprint</dt>
              <dd className="mt-1 break-all font-mono">{plan.planHash.slice(0, 16)}</dd>
              <dd className="mt-1">Approval must match this fingerprint, so you approve exactly what you see.</dd>
            </dl>
            <ApprovalPanel
              plan={plan}
              onPlan={setPlan}
              partnerName={(id) => partners.find((p) => p.id === id)?.name ?? id}
              ruleVersion={rule?.version ?? null}
              householdCount={householdCount}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

function HouseholdRow(props: {
  household: PublicHousehold;
  flags: HouseholdFlag[];
  editable: boolean;
  pending: boolean;
  disabled: boolean;
  onExclude: () => void;
}) {
  const { household: h, flags } = props;
  const flagged = flags.length > 0;
  return (
    <li className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between ${flagged ? "bg-alert-soft" : ""}`}>
      <div className="min-w-0 text-sm">
        <p className="font-medium">
          {h.headName} <span className="font-normal text-muted">· {h.members} people</span>
        </p>
        <p className="text-xs text-muted">
          {h.address} · {h.phoneMasked}
        </p>
        {flags.map((f) => (
          <p key={f.kind} className="mt-1 text-xs text-alert">
            <span className="font-semibold">{FLAG_LABEL[f.kind]}.</span> {f.explanation}
            <span className="text-muted"> ({f.explanationSource === "ai" ? "explained by AI" : "template"})</span>
          </p>
        ))}
      </div>
      {props.editable && (
        <button
          type="button"
          onClick={props.onExclude}
          disabled={props.disabled}
          className={`shrink-0 self-start rounded-md border px-3 py-1 text-xs font-semibold disabled:opacity-50 ${
            flagged ? "border-alert text-alert" : "border-line text-muted hover:text-foreground"
          }`}
        >
          {props.pending ? "Excluding…" : "Exclude"}
        </button>
      )}
    </li>
  );
}

const READING_FIELDS: { key: keyof Omit<BulletinReading, "bulletinId" | "readAt" | "mock">; label: string }[] = [
  { key: "provinces", label: "Provinces" },
  { key: "hazard", label: "Hazard" },
  { key: "warningLevel", label: "Warning level" },
  { key: "validTime", label: "Valid time" },
  { key: "rainfall", label: "Rainfall" },
  { key: "wind", label: "Wind" },
];

function BulletinEvidence({ bulletin }: { bulletin: ReviewBulletin }) {
  const [reading, setReading] = useState(bulletin.reading);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function read() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/bulletins/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bulletinId: bulletin.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { reading?: BulletinReading; error?: string };
      if (res.ok && data.reading) setReading(data.reading);
      else setError(data.error ?? "The AI reading failed. Read the bulletin text directly.");
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const readButton = (
    <button
      type="button"
      onClick={read}
      disabled={busy}
      className="self-start rounded-md border border-accent px-3 py-1 text-xs font-semibold text-accent disabled:opacity-50"
    >
      {busy ? "Reading…" : reading ? "Read again" : "Read with AI"}
    </button>
  );

  return (
    <article className="grid gap-4 rounded-md border border-line bg-surface p-4 md:grid-cols-2">
      <div className="min-w-0">
        <p className="text-xs text-muted">
          {bulletin.issuer} · {formatVietnamTime(bulletin.issuedAt)}
          {bulletin.simulated && " · simulated text"}
        </p>
        <p lang="vi" className="mt-2 whitespace-pre-line text-sm leading-relaxed">
          {bulletin.text}
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        {reading ? (
          <dl className="flex flex-col gap-2">
            {READING_FIELDS.map(({ key, label }) => (
              <ReadingValue key={key} label={label} field={reading[key]} source={bulletin.text} />
            ))}
            {reading.mock && (
              <p className="text-xs text-muted">Sample reading by pattern matching: no AI key is set.</p>
            )}
          </dl>
        ) : (
          <p className="rounded-md border border-dashed border-line p-3 text-sm text-muted">
            Not read by AI yet. The source text is shown so a person can read it directly.
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-alert">
            {error}
          </p>
        )}
        {readButton}
      </div>
    </article>
  );
}

function ReadingValue({ label, field, source }: { label: string; field: ReadingField<string | string[]>; source: string }) {
  const value = Array.isArray(field.value) ? field.value.join(", ") : field.value;
  const split = splitOnQuote(source, field.quote);
  // A field only counts as confirmed when its quote really appears in the bulletin.
  const status = field.status === "ok" && !split ? "needs_review" : field.status;

  if (status === "missing") {
    return (
      <div className="rounded-md px-3 py-2 text-sm">
        <dt className="text-xs text-muted">{label}</dt>
        <dd className="text-muted">Not in this bulletin</dd>
      </div>
    );
  }

  const review = status === "needs_review";
  return (
    <div className={`rounded-md px-3 py-2 text-sm ${review ? "border-2 border-dashed border-alert bg-alert-soft" : "bg-ok-soft"}`}>
      <dt className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted">{label}</span>
        <span className={`font-semibold ${review ? "text-alert" : "text-ok"}`}>{review ? "Check this" : "Quote found"}</span>
      </dt>
      <dd className="font-medium">{value ?? "—"}</dd>
      {field.quote && (
        <dd lang="vi" className="mt-1 text-xs text-muted">
          {split ? (
            <>
              “<mark className="bg-transparent font-medium text-foreground">{split.match}</mark>”
            </>
          ) : (
            <>“{field.quote}” (not found in the bulletin)</>
          )}
        </dd>
      )}
    </div>
  );
}
