import { useState } from "react";
import { Link } from "@tanstack/react-router";

import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";
import { TeamPage, TeamPageTitle } from "@/features/company-team/ui/TeamPage";
import { useCommunities } from "@/features/communities/useCommunities";

import {
  getCofounderNumbersFixture,
  type WeeklyReviewDecision,
} from "../cofounderNumbers";
import { FUNCTION_DETAILS } from "../functions";
import { useCofounderSettingsQuery } from "../hooks";

type DecisionState = "approved" | "hired" | "deferred" | "rejected";

function DecisionRow({
  canApprove,
  decision,
  onResolve,
  resolution,
}: {
  canApprove: boolean;
  decision: WeeklyReviewDecision;
  onResolve: (decision: WeeklyReviewDecision, state: DecisionState) => void;
  resolution: DecisionState | null;
}) {
  const [planOpen, setPlanOpen] = useState(false);
  const panelId = `weekly-review-decision-${decision.id}`;

  function resolve(state: DecisionState) {
    onResolve(decision, state);
  }

  return (
    <li
      className="flex flex-wrap items-center gap-3 border-t border-border py-3 first:border-0 first:pt-0 last:pb-0"
      data-testid={`weekly-review-decision-${decision.id}`}
    >
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-sm font-bold">{decision.title}</p>
        {resolution ? (
          <p className="mt-1 text-sm text-muted-foreground" role="status">
            {resolution === "approved"
              ? "Approved in this preview."
              : resolution === "hired"
                ? "Marked to hire in this preview."
                : resolution === "deferred"
                  ? "Marked not yet in this preview."
                  : "Rejected in this preview."}
          </p>
        ) : null}
      </div>

      {!resolution && canApprove && decision.kind === "plan" ? (
        <div className="flex flex-wrap gap-2">
          <button
            aria-controls={panelId}
            aria-expanded={planOpen}
            className="rounded-xl border border-border px-4 py-2 text-sm font-bold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            onClick={() => setPlanOpen((open) => !open)}
            type="button"
          >
            {planOpen ? "Close plan" : (decision.secondaryLabel ?? "Open plan")}
          </button>
          <button
            className="rounded-xl bg-foreground px-4 py-2 text-sm font-bold text-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            onClick={() => resolve("approved")}
            type="button"
          >
            {decision.primaryLabel}
          </button>
        </div>
      ) : null}

      {!resolution && canApprove && decision.kind === "hire" ? (
        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-xl bg-foreground px-4 py-2 text-sm font-bold text-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            onClick={() => resolve("hired")}
            type="button"
          >
            {decision.primaryLabel}
          </button>
          <button
            className="rounded-xl border border-border px-4 py-2 text-sm font-bold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            onClick={() => resolve("deferred")}
            type="button"
          >
            {decision.secondaryLabel ?? "Not yet"}
          </button>
        </div>
      ) : null}

      {!resolution && !canApprove ? (
        <span className="text-sm text-muted-foreground">
          Waiting for the owner to decide
        </span>
      ) : null}

      {decision.kind === "plan" && planOpen && !resolution ? (
        <div
          className="basis-full rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground"
          id={panelId}
        >
          {decision.detail}
          {canApprove ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="rounded-xl bg-foreground px-4 py-2 text-sm font-bold text-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                onClick={() => resolve("approved")}
                type="button"
              >
                Approve plan
              </button>
              <button
                className="rounded-xl border border-border px-4 py-2 text-sm font-bold text-destructive hover:bg-destructive/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                onClick={() => resolve("rejected")}
                type="button"
              >
                Reject plan
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function WeeklyReviewScreen() {
  const { activeCommunity } = useCommunities();
  const settingsQuery = useCofounderSettingsQuery(activeCommunity?.id ?? null);
  const membership = useMyRelayMembershipQuery();
  const canApprove =
    membership.data?.role === "owner" || membership.data?.role === "admin";
  const fixture = getCofounderNumbersFixture();
  const [resolutions, setResolutions] = useState<
    Partial<Record<string, DecisionState>>
  >({});

  function recordResolution(
    decision: WeeklyReviewDecision,
    state: DecisionState,
  ) {
    setResolutions((current) => ({ ...current, [decision.id]: state }));
  }

  if (settingsQuery.isLoading) {
    return (
      <TeamPage testId="cofounder-weekly-review" title="Weekly review">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          Loading the weekly review
        </p>
      </TeamPage>
    );
  }
  if (settingsQuery.isError) {
    return (
      <TeamPage testId="cofounder-weekly-review" title="Weekly review">
        <div role="alert" className="space-y-3">
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
  if (!settingsQuery.data?.settings.enabled) {
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

      {!fixture ? (
        <section className="team-card max-w-3xl p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <EmployeeAvatar className="size-11 rounded-xl" name="Scout" />
            <div>
              <h2 className="text-base font-extrabold">Scout</h2>
              <p className="text-sm text-muted-foreground">Chief of Staff</p>
            </div>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            No Friday review is available yet. It will appear here when
            scorecard numbers are connected.
          </p>
        </section>
      ) : (
        <div className="mx-auto w-full max-w-5xl space-y-5">
          <div className="flex items-center gap-3 py-2 text-center text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
            <span>{fixture.dateLabel}</span>
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
                <span className="text-sm text-muted-foreground">16:00</span>
              </div>
              <p className="mt-2 text-base">
                Your week in one card. Two decisions at the bottom.
              </p>

              <article
                aria-label={`Weekly review for ${fixture.rangeLabel}`}
                className="team-card mt-3 space-y-4 p-4 sm:p-5"
                data-testid="cofounder-weekly-review-card"
              >
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded-full bg-muted px-3 py-1 font-bold">
                    Weekly review
                  </span>
                  <span className="text-muted-foreground">
                    {fixture.rangeLabel}
                  </span>
                </div>

                <ul
                  aria-label="Numbers by function"
                  className="space-y-3 sm:hidden"
                >
                  {fixture.rows.map((row) => (
                    <li
                      className="border-b border-border pb-3 last:border-0 last:pb-0"
                      key={row.functionId}
                    >
                      <h3 className="text-sm font-extrabold">
                        {FUNCTION_DETAILS[row.functionId].name}
                      </h3>
                      <p className="mt-1 text-sm font-semibold text-muted-foreground">
                        {row.current}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-muted-foreground">
                        <span className="sr-only">
                          {row.direction === "down"
                            ? "Lower: "
                            : row.direction === "flat"
                              ? "No change: "
                              : "Higher: "}
                        </span>
                        <span className="font-extrabold">Change: </span>
                        {row.change}
                      </p>
                    </li>
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
                      {fixture.rows.map((row) => (
                        <tr
                          className="border-b border-border last:border-0"
                          key={row.functionId}
                        >
                          <th
                            className="py-2.5 pr-2 text-sm font-extrabold"
                            scope="row"
                          >
                            {FUNCTION_DETAILS[row.functionId].name}
                          </th>
                          <td className="py-2.5 pr-2 text-sm font-semibold text-muted-foreground">
                            {row.current}
                          </td>
                          <td
                            aria-label={`${row.direction === "down" ? "Lower" : row.direction === "flat" ? "No change" : "Higher"}: ${row.change}`}
                            className="py-2.5 text-sm font-semibold text-muted-foreground"
                          >
                            {row.change}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <section
                  aria-labelledby="weekly-review-worked-title"
                  className="space-y-1 rounded-2xl bg-emerald-500/10 p-4"
                >
                  <h3
                    className="text-2xs font-extrabold uppercase tracking-[0.12em] text-emerald-800 dark:text-emerald-300"
                    id="weekly-review-worked-title"
                  >
                    What worked
                  </h3>
                  <p className="text-sm font-bold">{fixture.worked}</p>
                </section>

                <section
                  aria-labelledby="weekly-review-change-title"
                  className="space-y-2 rounded-2xl bg-muted/70 p-4"
                >
                  <h3
                    className="text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground"
                    id="weekly-review-change-title"
                  >
                    What I’ll change
                  </h3>
                  <p className="text-sm">
                    <span className="font-bold">Missed: </span>
                    {fixture.missed}
                  </p>
                  <p className="text-sm font-semibold">
                    {fixture.proposedChange}
                  </p>
                </section>

                <section
                  aria-labelledby="weekly-review-needs-you-title"
                  className="space-y-1"
                >
                  <h3
                    className="pb-1 text-2xs font-extrabold uppercase tracking-[0.12em] text-muted-foreground"
                    id="weekly-review-needs-you-title"
                  >
                    Needs you ·{" "}
                    {
                      fixture.decisions.filter(
                        (decision) => !resolutions[decision.id],
                      ).length
                    }
                  </h3>
                  <ul
                    className="space-y-0"
                    data-testid="weekly-review-needs-you"
                  >
                    {fixture.decisions.map((decision) => (
                      <DecisionRow
                        canApprove={canApprove}
                        decision={decision}
                        key={decision.id}
                        onResolve={recordResolution}
                        resolution={resolutions[decision.id] ?? null}
                      />
                    ))}
                  </ul>
                </section>
              </article>
            </div>
          </div>
        </div>
      )}
    </TeamPage>
  );
}
