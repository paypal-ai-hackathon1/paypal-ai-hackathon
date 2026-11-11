"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatVietnamTime, METRIC_LABEL, type Replay, type ReplayEvent } from "@/lib/replay";

const STEP_MS = 1800;

type ProvinceState = {
  value: number | null;
  leadHours: number | null;
  counts: boolean;
  triggered: boolean;
};

/** Plays the scenario one event at a time. Everything shown comes from the fixture, nothing is sent. */
export function ReplayTimeline({ replay }: { replay: Replay }) {
  const total = replay.events.length;
  const [shown, setShown] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Playback stops by itself at the last event: "running" is derived, not stored.
  const running = playing && shown < total;

  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => setShown((n) => Math.min(n + 1, total)), STEP_MS);
    return () => clearTimeout(timer);
  }, [running, shown, total]);

  const visible = replay.events.slice(0, shown);
  const started = shown > 0;
  const finished = shown >= total;
  const clock = started ? visible[visible.length - 1].at : replay.startsAt;
  const planEvent = visible.find((e) => e.kind === "plan");

  const provinces = new Map<string, ProvinceState>(
    replay.provinces.map((p) => [p.id, { value: null, leadHours: null, counts: false, triggered: false }]),
  );
  for (const event of visible) {
    if (event.kind !== "forecast") continue;
    for (const row of event.rows) {
      const state = provinces.get(row.provinceId);
      if (!state) continue;
      state.value = row.value;
      state.leadHours = row.leadHours;
      state.counts = row.counts;
      state.triggered ||= row.meetsRule;
    }
  }

  function start() {
    setShown(1);
    setPlaying(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">Replay · {replay.scenarioName}</p>
          <p className="font-mono text-2xl tabular-nums sm:text-3xl" aria-live="polite">
            {formatVietnamTime(clock)} <span className="text-base text-muted">Vietnam time</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!started || finished ? (
            <button
              type="button"
              onClick={start}
              className="rounded-md bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {finished ? "Replay again" : "Start Yagi replay"}
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                className="rounded-md border border-line bg-surface px-4 py-2.5 text-sm font-semibold hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {running ? "Pause" : "Resume"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPlaying(false);
                  setShown((n) => Math.min(n + 1, total));
                }}
                className="rounded-md border border-line bg-surface px-4 py-2.5 text-sm font-semibold hover:border-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Next step
              </button>
            </>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <ol className="flex min-w-0 flex-col gap-3" aria-label="Replay events" aria-live="polite">
          {!started && (
            <li className="rounded-md border border-dashed border-line p-5 text-sm text-muted">
              Start the replay to watch {total} events from 4 to 7 September 2024: forecasts checked against the
              locked rule, warning bulletins as they were issued, and the moment a payout plan is ready for review.
            </li>
          )}
          {visible.map((event, i) => (
            <EventCard key={event.id} event={event} latest={i === visible.length - 1} replay={replay} />
          ))}
        </ol>

        <aside className="flex min-w-0 flex-col gap-4">
          {replay.rule && (
            <div className="rounded-md border border-line bg-surface p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Locked rule · v{replay.rule.version}
              </p>
              <p className="mt-2 text-sm leading-relaxed">“{replay.rule.sourceSentence}”</p>
              {replay.rule.lockedAt && (
                <p className="mt-2 text-xs text-muted">Locked {formatVietnamTime(replay.rule.lockedAt)}, before the season</p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Provinces</p>
            {replay.provinces.map((p) => (
              <ProvinceBar key={p.id} name={p.name} nameVi={p.nameVi} state={provinces.get(p.id)!} replay={replay} />
            ))}
          </div>

          {planEvent && (
            <Link
              href="/review"
              className="rounded-md bg-accent px-4 py-3 text-center text-sm font-semibold text-accent-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Review the payout plan
            </Link>
          )}
        </aside>
      </div>
    </div>
  );
}

function ProvinceBar({
  name,
  nameVi,
  state,
  replay,
}: {
  name: string;
  nameVi: string;
  state: ProvinceState;
  replay: Replay;
}) {
  const rule = replay.rule;
  if (!rule) return null;
  const unit = METRIC_LABEL[rule.metric].unit;
  const scale = rule.threshold * 2;
  const fill = state.value === null ? 0 : Math.min(state.value / scale, 1) * 100;

  let status = "No forecast yet";
  if (state.value !== null) {
    if (state.triggered) status = "Rule met";
    else if (!state.counts) status = `Too far ahead (${state.leadHours} h)`;
    else status = `Below ${rule.threshold} ${unit}`;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium" lang="vi" title={name}>
          {nameVi}
        </span>
        <span className="font-mono tabular-nums">{state.value === null ? "–" : `${state.value} ${unit}`}</span>
      </div>
      <div className="relative h-2 rounded-full bg-accent-soft" aria-hidden="true">
        <div
          className={`h-2 rounded-full motion-safe:transition-[width] motion-safe:duration-500 ${state.triggered ? "bg-alert" : "bg-accent"}`}
          style={{ width: `${fill}%` }}
        />
        <div className="absolute top-[-3px] h-3.5 w-0.5 bg-foreground" style={{ left: "50%" }} />
      </div>
      <span className={`text-xs ${state.triggered ? "font-semibold text-alert" : "text-muted"}`}>{status}</span>
    </div>
  );
}

function EventCard({ event, latest, replay }: { event: ReplayEvent; latest: boolean; replay: Replay }) {
  const frame = `rounded-md border bg-surface p-4 ${latest ? "border-accent" : "border-line"}`;
  const time = <p className="font-mono text-xs tabular-nums text-muted">{formatVietnamTime(event.at)}</p>;

  if (event.kind === "forecast") {
    const metric = METRIC_LABEL[event.metric];
    const fired = event.rows.filter((r) => r.newlyTriggered);
    return (
      <li className={frame}>
        {time}
        <p className="mt-1 font-semibold">
          Forecast issued {event.leadHours} hours ahead · {metric.name.toLowerCase()}
        </p>
        <ul className="mt-3 grid gap-1.5 text-sm sm:grid-cols-3">
          {event.rows.map((r) => (
            <li
              key={r.provinceId}
              className={`flex items-baseline justify-between gap-2 rounded px-2.5 py-1.5 ${r.meetsRule ? "bg-alert-soft" : "bg-accent-soft"}`}
            >
              <span>{r.provinceName}</span>
              <span className="font-mono tabular-nums">
                {r.value} {metric.unit}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">
          {!event.rows.some((r) => r.counts)
            ? `Not counted: the rule only uses forecasts made up to ${replay.rule?.maxLeadHours} hours ahead.`
            : fired.length
              ? `Rule met for ${fired.map((r) => r.provinceName).join(" and ")}. Checked by code, not by AI.`
              : "No new province meets the rule."}
        </p>
      </li>
    );
  }

  if (event.kind === "bulletin") {
    return (
      <li className={frame}>
        {time}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <p className="font-semibold" lang="vi">
            {event.title}
          </p>
          {event.simulated && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">Simulated</span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted" lang="vi">
          {event.issuer}
        </p>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium text-accent">Read the bulletin (Vietnamese)</summary>
          <p className="mt-2 whitespace-pre-line leading-relaxed" lang="vi">
            {event.text}
          </p>
        </details>
        <p className="mt-3 text-sm text-muted">
          At review, AI reads this bulletin and quotes the exact sentence behind each value it reports.
        </p>
      </li>
    );
  }

  const names = event.provinceIds.map((id) => replay.provinces.find((p) => p.id === id)?.name ?? id);
  return (
    <li className={`${frame} bg-alert-soft`}>
      {time}
      <p className="mt-1 font-semibold">Payout plan ready for review</p>
      <p className="mt-1 text-sm">
        {names.join(", ")}: {event.householdCount} registered households through {event.partnerCount} local partners.
        Nothing is sent until an organizer approves it.
      </p>
      <Link href="/review" className="mt-3 inline-block text-sm font-semibold text-accent underline underline-offset-4">
        Review the payout plan
      </Link>
    </li>
  );
}
