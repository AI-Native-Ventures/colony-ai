import { useState } from "react";
import { Link } from "@tanstack/react-router";

import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";
import { TeamPage, TeamPageTitle } from "@/features/company-team/ui/TeamPage";
import { useCommunities } from "@/features/communities/useCommunities";

import { FUNCTION_DETAILS } from "../functions";
import { useCofounderSettingsQuery } from "../hooks";
import { numbersActions } from "../numbersActions";
import { useNumbersAction, useNumbersQuery } from "../numbersHooks";
import {
  METRIC_DETAILS,
  isImprovement,
  openDecisions,
  formatMetricValue,
} from "../numbersRecords";
import type {
  FunctionScorecardView,
  MetricReadingView,
  ReviewDecisionView,
  ReviewView,
} from "../numbersRecords";

type DecisionChoice = "approved" | "declined" | "deferred";

function formatDate(epochSeconds: number, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-GB", {
    ...options,
    timeZone: "UTC",
  }).format(new Date(epochSeconds * 1_000));
}

function reviewDateLabel(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function reviewRangeLabel(review: ReviewView): string {
  const start = new Date(review.windowStart * 1_000);
  const end = new Date(review.asOf * 1_000);
  const endMonth = formatDate(review.asOf, { month: "long" });
  if (
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth()
  ) {
    return `${start.getUTCDate()} to ${end.getUTCDate()} ${endMonth}`;
  }
  return `${formatDate(review.windowStart, { day: "numeric", month: "short" })} to ${formatDate(review.asOf, { day: "numeric", month: "short" })}`;
}

function currentNumbers(card: FunctionScorecardView, currency: string) {
  const metrics = card.metrics.map((reading) => {
    const detail = METRIC_DETAILS[reading.metric];
    const value = formatMetricValue(reading.value, detail.unit, currency);
    return `${detail.label}: ${value ?? "not stated"}`;
  });
  const notTracked = card.notTracked.map((item) => item.replaceAll("_", " "));
  if (notTracked.length > 0) {
    metrics.push(`Not tracked yet: ${notTracked.join(", ")}`);
  }
  return metrics.length > 0 ? metrics.join(" · ") : "No tracked measures";
}

function changeText(reading: MetricReadingView, currency: string): string {
  const detail = METRIC_DETAILS[reading.metric];
  if (reading.change === null) return `${detail.label}: no earlier figure`;
  if (reading.change === 0) return `${detail.label}: no change`;
  const amount = formatMetricValue(
    Math.abs(reading.change),
    detail.unit,
    currency,
  );
  const sign = reading.change > 0 ? "+" : "−";
  const result = isImprovement(reading);
  const movement =
    result === null ? "changed" : result ? "improved" : "worsened";
  return `${detail.label}: ${movement} ${sign}${amount ?? "not stated"}`;
}

function functionChanges(card: FunctionScorecardView, currency: string) {
  const changes = card.metrics.map((reading) => changeText(reading, currency));
  return changes.length > 0
    ? changes.join(" · ")
    : "No tracked changes to compare";
}

function FunctionRowContent({
  card,
  currency,
}: {
  card: FunctionScorecardView;
  currency: string;
}) {
  const name = FUNCTION_DETAILS[card.functionId].name;
  const current = currentNumbers(card, currency);
  const change = functionChanges(card, currency);
  return { name, current, change };
}

function MobileFunctionRow({
  card,
  currency,
}: {
  card: FunctionScorecardView;
  currency: string;
}) {
  const { name, current, change } = FunctionRowContent({ card, currency });
  return (
    <li className="border-b border-border pb-3 last:border-0 last:pb-0">
      <h3 className="text-sm font-extrabold">{name}</h3>
      <p className="mt-1 text-sm font-semibold text-muted-foreground">
        {current}
      </p>
      <p className="mt-1 text-sm font-semibold text-muted-foreground">
        <span className="font-extrabold">Change: </span>
        {change}
      </p>
    </li>
  );
}

function TableFunctionRow({
  card,
  currency,
}: {
  card: FunctionScorecardView;
  currency: string;
}) {
  const { name, current, change } = FunctionRowContent({ card, currency });
  return (
    <tr className="border-b border-border last:border-0">
      <th className="py-2.5 pr-2 text-sm font-extrabold" scope="row">
        {name}
      </th>
      <td className="py-2.5 pr-2 text-sm font-semibold text-muted-foreground">
        {current}
      </td>
      <td className="py-2.5 text-sm font-semibold text-muted-foreground">
        {change}
      </td>
    </tr>
  );
}

function DecisionRow({
  canDecide,
  decision,
  isPending,
  onChoose,
}: {
  canDecide: boolean;
  decision: ReviewDecisionView;
  isPending: boolean;
  onChoose: (decision: ReviewDecisionView, choice: DecisionChoice) => void;
}) {
  const stateLabel = {
    approved: "Approved",
    declined: "Declined",
    deferred: "Deferred",
    open: "Waiting for a decision",
  }[decision.state];

  return (
    <li
      className="flex flex-wrap items-center gap-3 border-t border-border py-3 first:border-0 first:pt-0 last:pb-0"
      data-testid={`weekly-review-decision-${decision.decisionId}`}
    >
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-bold">{decision.title}</p>
        {decision.detail ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {decision.detail}
          </p>
        ) : null}
        {decision.state !== "open" ? (
          <p className="mt-1 text-sm text-muted-foreground" role="status">
            {stateLabel}
            {decision.note ? ` · ${decision.note}` : ""}
          </p>
        ) : null}
      </div>
      {decision.state === "open" && canDecide ? (
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-xl bg-foreground px-4 py-2 text-sm font-bold text-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60"
            disabled={isPending}
            onClick={() => onChoose(decision, "approved")}
            type="button"
          >
            Yes
          </button>
          <button
            className="rounded-xl border border-border px-4 py-2 text-sm font-bold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60"
            disabled={isPending}
            onClick={() => onChoose(decision, "declined")}
            type="button"
          >
            No
          </button>
          <button
            className="rounded-xl border border-border px-4 py-2 text-sm font-bold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60"
            disabled={isPending}
            onClick={() => onChoose(decision, "deferred")}
            type="button"
          >
            Later
          </button>
        </div>
      ) : null}
      {decision.state === "open" && !canDecide ? (
        <span className="text-sm text-muted-foreground">
          Waiting for the owner to decide
        </span>
      ) : null}
    </li>
  );
}

function ReviewLines({
  id,
  title,
  lines,
  emptyLabel,
  tone,
}: {
  id: string;
  title: string;
  lines: string[];
  emptyLabel: string;
  tone: "worked" | "missed";
}) {
  const titleClass =
    tone === "worked"
      ? "text-emerald-800 dark:text-emerald-300"
      : "text-destructive";
  const cardClass = tone === "worked" ? "bg-emerald-500/10" : "bg-muted/70";
  return (
    <section
      aria-labelledby={id}
      className={`space-y-2 rounded-2xl p-4 ${cardClass}`}
    >
      <h3
        className={`text-2xs font-extrabold uppercase tracking-[0.12em] ${titleClass}`}
        id={id}
      >
        {title}
      </h3>
      {lines.length > 0 ? (
        <ul className="space-y-1">
          {(() => {
            const seen = new Map<string, number>();
            return lines.map((line) => {
              const occurrence = seen.get(line) ?? 0;
              seen.set(line, occurrence + 1);
              return (
                <li className="text-sm font-bold" key={`${line}-${occurrence}`}>
                  {line}
                </li>
              );
            });
          })()}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      )}
    </section>
  );
}

function messageFor(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The decision could not be saved.";
}

export function WeeklyReviewScreen() {
  const { activeCommunity } = useCommunities();
  const settingsQuery = useCofounderSettingsQuery(activeCommunity?.id ?? null);
  const enabled = settingsQuery.data?.settings.enabled === true;
  const numbers = useNumbersQuery(enabled);
  const membership = useMyRelayMembershipQuery();
  const canDecide =
    membership.data?.role === "owner" || membership.data?.role === "admin";
  const action = useNumbersAction();
  const [actionError, setActionError] = useState<string | null>(null);
  const review = numbers.data?.reviews[0] ?? null;
  const openCount = review ? openDecisions(review).length : 0;

  async function chooseDecision(
    decision: ReviewDecisionView,
    choice: DecisionChoice,
  ) {
    if (!review || !canDecide) return;
    setActionError(null);
    try {
      await action.mutateAsync(
        numbersActions.decide(review, decision.decisionId, choice),
      );
    } catch (error) {
      setActionError(messageFor(error));
    }
  }

  if (settingsQuery.isLoading) {
    return (
      <TeamPage testId="cofounder-weekly-review" title="Weekly review">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          Loading company settings
        </p>
      </TeamPage>
    );
  }
  if (settingsQuery.isError) {
    return (
      <TeamPage testId="cofounder-weekly-review" title="Weekly review">
        <div className="space-y-3" role="alert">
          <TeamPageTitle>Weekly review</TeamPageTitle>
          <p className="text-sm text-destructive">
            The weekly review could not load.
          </p>
          <button
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            onClick={() => void settingsQuery.refetch()}
            type="button"
          >
            Try again
          </button>
        </div>
      </TeamPage>
    );
  }
  if (!enabled) {
    return (
      <TeamPage testId="cofounder-weekly-review" title="Weekly review">
        <div className="space-y-3">
          <TeamPageTitle>Weekly review</TeamPageTitle>
          <p className="text-sm text-muted-foreground">
            Co-founder mode is off for {activeCommunity?.name ?? "this company"}
            .
          </p>
          <Link
            className="inline-flex items-center rounded-xl border border-border px-4 py-2 text-sm font-bold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            to="/settings"
          >
            Open settings
          </Link>
        </div>
      </TeamPage>
    );
  }

  return (
    <TeamPage testId="cofounder-weekly-review" title="Weekly review">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="team-head-copy">
          <TeamPageTitle>Weekly review</TeamPageTitle>
          <p className="team-subtitle">Your week in one card.</p>
        </div>
        <Link
          className="inline-flex h-11 items-center rounded-xl border border-border px-4 text-sm font-bold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          to="/company/map"
        >
          Company map
        </Link>
      </header>

      {numbers.isLoading ? (
        <p aria-live="polite" className="text-sm text-muted-foreground">
          Loading the weekly review
        </p>
      ) : numbers.isError ? (
        <div className="space-y-3" role="alert">
          <p className="text-sm text-destructive">
            The weekly review could not load.
          </p>
          <button
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            onClick={() => void numbers.refetch()}
            type="button"
          >
            Try again
          </button>
        </div>
      ) : !review ? (
        <section className="team-card max-w-3xl p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <EmployeeAvatar className="size-11 rounded-xl" name="Scout" />
            <div>
              <h2 className="text-base font-extrabold">Scout</h2>
              <p className="text-sm text-muted-foreground">Chief of Staff</p>
            </div>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            No Friday review is available yet. Scout will post one after the
            next Friday review window.
          </p>
        </section>
      ) : (
        <div className="mx-auto w-full max-w-5xl space-y-5">
          <div className="flex items-center gap-3 py-2 text-center text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
            <span>{reviewDateLabel(review.reviewDate)}</span>
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
          </div>

          <div className="flex items-start gap-3">
            <EmployeeAvatar
              className="size-10 shrink-0 rounded-xl"
              name="Scout"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h2 className="text-base font-extrabold">Scout</h2>
                <span className="text-sm text-muted-foreground">
                  Chief of Staff
                </span>
                <span className="text-sm text-muted-foreground">
                  {formatDate(review.annotatedAt ?? review.createdAt, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <p className="mt-2 text-base">Your week in one card.</p>

              <article
                aria-label={`Weekly review ending ${review.reviewDate}`}
                className="team-card mt-3 space-y-4 p-4 sm:p-5"
                data-testid="cofounder-weekly-review-card"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-full bg-muted px-3 py-1 font-bold">
                    Weekly review
                  </span>
                  <span
                    className="text-muted-foreground"
                    data-testid="weekly-review-window"
                  >
                    {reviewRangeLabel(review)}
                  </span>
                </div>

                <ul
                  aria-label="Numbers by function"
                  className="space-y-3 sm:hidden"
                >
                  {review.functions.map((card) => (
                    <MobileFunctionRow
                      card={card}
                      currency={review.currency}
                      key={card.functionId}
                    />
                  ))}
                </ul>
                <div className="hidden sm:block">
                  <table
                    aria-label="Numbers by function"
                    className="w-full table-fixed text-left"
                  >
                    <thead>
                      <tr className="border-b border-border text-2xs font-extrabold uppercase tracking-wide text-muted-foreground">
                        <th className="w-1/4 pb-2 pr-2" scope="col">
                          Function
                        </th>
                        <th className="w-[42%] pb-2 pr-2" scope="col">
                          This week
                        </th>
                        <th className="w-[33%] pb-2" scope="col">
                          Change
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {review.functions.map((card) => (
                        <TableFunctionRow
                          card={card}
                          currency={review.currency}
                          key={card.functionId}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>

                <ReviewLines
                  emptyLabel="No wins have been added to this review yet."
                  id="weekly-review-worked-title"
                  lines={review.wins}
                  title="What worked"
                  tone="worked"
                />
                <ReviewLines
                  emptyLabel="No misses have been added to this review yet."
                  id="weekly-review-missed-title"
                  lines={review.misses}
                  title="What missed"
                  tone="missed"
                />

                <section
                  aria-labelledby="weekly-review-needs-you-title"
                  className="space-y-1"
                >
                  <h3
                    className="pb-1 text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground"
                    id="weekly-review-needs-you-title"
                  >
                    Needs you · {openCount}
                  </h3>
                  {actionError ? (
                    <p className="text-sm text-destructive" role="alert">
                      {actionError}
                    </p>
                  ) : null}
                  {review.decisions.length > 0 ? (
                    <ul
                      className="space-y-0"
                      data-testid="weekly-review-needs-you"
                    >
                      {review.decisions.map((decision) => (
                        <DecisionRow
                          canDecide={canDecide}
                          decision={decision}
                          isPending={action.isPending}
                          key={decision.decisionId}
                          onChoose={chooseDecision}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No decisions need you today.
                    </p>
                  )}
                </section>
              </article>
            </div>
          </div>
        </div>
      )}
    </TeamPage>
  );
}
