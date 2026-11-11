import { Suspense } from "react";
import { connection } from "next/server";
import { yagi } from "@/data/scenarios/yagi";
import { aiConfigured, env, paypalConfigured } from "@/lib/env";
import { buildReplay } from "@/lib/replay";
import { ReplayTimeline } from "./replay-timeline";
import { SITE_NAME } from "./site";

function Badge({ live, label }: { live: boolean; label: string }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
        live
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
          : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
      }`}
    >
      {label}
    </span>
  );
}

// Reads env at request time so the badge reflects the deployed config, not the build machine.
async function IntegrationBadge({ kind }: { kind: "paypal" | "ai" }) {
  await connection();
  if (kind === "paypal") {
    return <Badge live={paypalConfigured} label={paypalConfigured ? "PayPal sandbox" : "PayPal mock"} />;
  }
  return <Badge live={aiConfigured} label={aiConfigured ? `AI ${env.ai.model}` : "AI mock"} />;
}

async function PaymentBanner({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const params = await searchParams;
  const payment = typeof params.payment === "string" ? params.payment : undefined;
  if (!payment) return null;
  const order = typeof params.order === "string" ? params.order : undefined;

  return (
    <div className="rounded-md border border-line bg-surface p-3 text-sm">
      Payment result: <strong>{payment}</strong>
      {order && <> · order {order}</>}
      {params.mock === "1" && <> · mock</>}
    </div>
  );
}

const STEPS = [
  {
    actor: "Code",
    title: "A forecast crosses a locked rule",
    text: "Before the season, the organizer writes rules like “150 mm of rain forecast up to 48 hours ahead”. Code checks every forecast against them.",
  },
  {
    actor: "AI",
    title: "AI reads the warnings and checks the list",
    text: "It reads Vietnamese bulletins, quoting the sentence behind each value, and flags households that look duplicated.",
  },
  {
    actor: "Person",
    title: "An organizer approves once",
    text: "Amounts come from code. The organizer sees AI output beside its source, removes doubtful records, and approves the exact plan.",
  },
  {
    actor: "PayPal",
    title: "PayPal Payouts pays local partners",
    text: "One batch pays each partner for its households. Partners confirm every cash handout with a receipt code.",
  },
  {
    actor: "Checks",
    title: "Independent callbacks and a donor report",
    text: "A random sample of households is called back, and donors get a report whose numbers all come from recorded data.",
  },
];

const AUDIENCES = [
  {
    who: "Relief organizers",
    need: "Release money days before landfall without losing control: every payout traces to a locked rule and one human approval.",
  },
  {
    who: "Local partner groups",
    need: "Receive funds in their PayPal account ahead of the storm and record each handout from a phone, even with poor signal.",
  },
  {
    who: "Donors",
    need: "See where the money went, how many families confirmed receipt, and what the independent callbacks found.",
  },
];

export default function Home({ searchParams }: PageProps<"/">) {
  const replay = buildReplay(yagi);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-4 pb-20 pt-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-lg font-semibold tracking-tight">{SITE_NAME}</p>
        <div className="flex flex-wrap gap-2">
          <Suspense fallback={null}>
            <IntegrationBadge kind="paypal" />
          </Suspense>
          <Suspense fallback={null}>
            <IntegrationBadge kind="ai" />
          </Suspense>
        </div>
      </header>

      <Suspense fallback={null}>
        <PaymentBanner searchParams={searchParams} />
      </Suspense>

      <section className="flex max-w-3xl flex-col gap-5">
        <p className="text-sm font-semibold uppercase tracking-wider text-accent">
          Anticipatory cash for flood-prone communities in Vietnam
        </p>
        <h1 className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
          Get cash to families before the flood, not after it.
        </h1>
        <p className="text-lg leading-relaxed text-muted">
          Relief money often arrives after the water has gone down, when families have already sold livestock or borrowed
          to get through. {SITE_NAME} pays local partners through PayPal as soon as a forecast crosses a rule the
          organizer locked before the season. AI reads the warnings and checks the household list. A person approves
          every payout.
        </p>
        <a
          href="#replay"
          className="self-start rounded-md bg-accent px-5 py-3 text-sm font-semibold text-accent-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Watch it work on Typhoon Yagi
        </a>
      </section>

      <section id="replay" className="flex scroll-mt-6 flex-col gap-4">
        <h2 className="text-2xl font-semibold tracking-tight">Replay: Typhoon Yagi, September 2024</h2>
        <p className="max-w-3xl text-muted">
          Yagi reached the Quang Ninh and Hai Phong coast on 7 September 2024. The storm and its timing are real. The
          forecasts, bulletins, partners and households in this replay are simulated, and PayPal runs on its sandbox, so
          no real money moves.
        </p>
        <ReplayTimeline replay={replay} />
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex flex-col gap-2 border-t-2 border-accent pt-3">
              <p className="font-mono text-xs uppercase tracking-wider text-muted">
                {i + 1} · {step.actor}
              </p>
              <h3 className="font-semibold leading-snug">{step.title}</h3>
              <p className="text-sm leading-relaxed text-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-2xl font-semibold tracking-tight">Who it is for</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {AUDIENCES.map((a) => (
            <div key={a.who} className="flex flex-col gap-2 rounded-md border border-line bg-surface p-5">
              <h3 className="font-semibold">{a.who}</h3>
              <p className="text-sm leading-relaxed text-muted">{a.need}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-line pt-6 text-sm text-muted">
        Built for the PayPal AI Hackathon 2026. Sandbox only: no real money moves, and every household in the demo is
        fictional.
      </footer>
    </main>
  );
}
