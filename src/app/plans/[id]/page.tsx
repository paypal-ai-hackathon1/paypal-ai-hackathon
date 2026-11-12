import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { getPlanReview } from "@/lib/plan-review";
import { PlanError } from "@/lib/plans";
import { ResetDemoButton } from "../../reset-demo-button";
import { SITE_NAME } from "../../site";
import { PlanReviewScreen } from "./plan-review";

export const metadata: Metadata = { title: `Review payout plan · ${SITE_NAME}` };

// Not async: the plan ID is read inside the Suspense boundary, so the page shell still prerenders.
export default function PlanPage({ params }: PageProps<"/plans/[id]">) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Link href="/" className="font-semibold">
            {SITE_NAME}
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/#replay" className="text-sm text-muted underline underline-offset-4 hover:text-foreground">
              Back to the replay
            </Link>
            <ResetDemoButton className="rounded-md border border-line px-3 py-1 text-sm text-muted hover:text-foreground" />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <Suspense fallback={<ReviewSkeleton />}>{params.then(({ id }) => <Review id={id} />)}</Suspense>
      </main>
    </div>
  );
}

async function Review({ id }: { id: string }) {
  await connection(); // the plan lives in the runtime store: never prerender it
  const review = loadReview(id);
  return review ? <PlanReviewScreen initial={review} /> : <PlanMissing />;
}

/** The plan's review data, or null when no plan has this ID. */
function loadReview(id: string) {
  try {
    return getPlanReview(id);
  } catch (err) {
    if (err instanceof PlanError && err.status === 404) return null;
    throw err;
  }
}

function PlanMissing() {
  return (
    <div className="mx-auto max-w-lg rounded-md border border-line bg-surface p-6 text-center">
      <h1 className="text-lg font-semibold">This plan is not loaded</h1>
      <p className="mt-2 text-sm text-muted">
        Demo plans live in memory, so a server restart or a demo reset clears them. Run the replay again to create a
        new plan.
      </p>
      <Link
        href="/#replay"
        className="mt-4 inline-block rounded-md bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground hover:opacity-90"
      >
        Go to the replay
      </Link>
    </div>
  );
}

function ReviewSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the plan" className="flex animate-pulse flex-col gap-4">
      <div className="h-8 w-64 rounded bg-surface" />
      <div className="h-32 rounded-md bg-surface" />
      <div className="h-64 rounded-md bg-surface" />
    </div>
  );
}
