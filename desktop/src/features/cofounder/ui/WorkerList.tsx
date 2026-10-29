import * as React from "react";

import { formatWorkerCost } from "../functions";
import { useWorkerRunsQuery } from "../hooks";
import {
  workerEffectiveFailureReason,
  workerEffectiveStatus,
} from "../cofounderRecords";

const STATUS_LABELS = {
  running: "Running",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
} as const;

export function WorkerList({
  parentPubkey,
  parentName,
}: {
  parentPubkey: string | null;
  parentName: string;
}) {
  const runsQuery = useWorkerRunsQuery(parentPubkey);
  const runs = runsQuery.data ?? [];
  const [nowSeconds, setNowSeconds] = React.useState(() =>
    Math.floor(Date.now() / 1000),
  );
  const [openOutputs, setOpenOutputs] = React.useState<Set<string>>(
    () => new Set(),
  );
  const hasRunningRun = runs.some((run) => run.status === "running");

  React.useEffect(() => {
    if (!hasRunningRun) return;
    const interval = window.setInterval(
      () => setNowSeconds(Math.floor(Date.now() / 1000)),
      1_000,
    );
    return () => window.clearInterval(interval);
  }, [hasRunningRun]);

  if (!parentPubkey) {
    return (
      <section
        aria-labelledby="function-workers-title"
        className="team-card space-y-2 p-5 sm:p-6"
        data-testid="cofounder-worker-list"
      >
        <h2 className="text-base font-extrabold" id="function-workers-title">
          Workers under {parentName}
        </h2>
        <p className="text-sm text-muted-foreground">
          Workers appear here when this lead starts a job.
        </p>
      </section>
    );
  }

  if (runsQuery.isLoading) {
    return (
      <section
        aria-labelledby="function-workers-title"
        aria-live="polite"
        className="team-card space-y-2 p-5 sm:p-6"
        data-testid="cofounder-worker-list"
      >
        <h2 className="text-base font-extrabold" id="function-workers-title">
          Workers under {parentName}
        </h2>
        <p className="text-sm text-muted-foreground">Loading workers</p>
      </section>
    );
  }

  if (runsQuery.isError) {
    return (
      <section
        aria-labelledby="function-workers-title"
        className="team-card space-y-2 p-5 sm:p-6"
        data-testid="cofounder-worker-list"
      >
        <h2 className="text-base font-extrabold" id="function-workers-title">
          Workers under {parentName}
        </h2>
        <div role="alert">
          <p className="text-sm text-destructive">Workers could not load.</p>
          <button
            className="mt-3 rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            onClick={() => void runsQuery.refetch()}
            type="button"
          >
            Try again
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="function-workers-title"
      className="team-card"
      data-testid="cofounder-worker-list"
    >
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border p-5 sm:p-6">
        <div>
          <h2 className="text-base font-extrabold" id="function-workers-title">
            Workers under {parentName}
          </h2>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Nameless helpers for one job each. Not on your team, never send or
            spend.
          </p>
        </div>
      </div>
      {runs.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground sm:px-6">
          No workers yet.
        </p>
      ) : (
        <ul
          className="divide-y divide-border"
          data-testid="cofounder-worker-runs"
        >
          {runs.map((run) => {
            const status = workerEffectiveStatus(run, nowSeconds);
            const failureReason = workerEffectiveFailureReason(run, nowSeconds);
            const outputOpen = openOutputs.has(run.workerId);
            return (
              <li className="p-5 sm:p-6" key={run.workerId}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                  <span
                    aria-hidden="true"
                    className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"
                  >
                    <svg
                      aria-hidden="true"
                      fill="none"
                      height="1.25rem"
                      viewBox="0 0 24 24"
                      width="1.25rem"
                    >
                      <path
                        d="m8 8 4-3 4 3v8l-4 3-4-3V8Z"
                        stroke="currentColor"
                        strokeLinejoin="round"
                        strokeWidth="1.8"
                      />
                      <path
                        d="m8 8 4 3 4-3M12 11v8"
                        stroke="currentColor"
                        strokeLinejoin="round"
                        strokeWidth="1.8"
                      />
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-bold">{run.label}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {run.model}
                    </p>
                  </div>
                  <span
                    className="rounded-full bg-muted px-2.5 py-1 text-xs font-bold text-foreground"
                    data-testid={`cofounder-worker-status-${run.workerId}`}
                    data-status={status}
                  >
                    {STATUS_LABELS[status]}
                  </span>
                  <span className="min-w-20 text-right text-sm font-semibold text-muted-foreground">
                    {formatWorkerCost(run.costUsd)}
                  </span>
                  <button
                    aria-controls={`cofounder-worker-output-${run.workerId}`}
                    aria-expanded={outputOpen}
                    className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    onClick={() => {
                      setOpenOutputs((current) => {
                        const next = new Set(current);
                        if (next.has(run.workerId)) next.delete(run.workerId);
                        else next.add(run.workerId);
                        return next;
                      });
                    }}
                    type="button"
                  >
                    {outputOpen ? "Close output" : "Open output"}
                  </button>
                </div>
                {status === "failed" && failureReason ? (
                  <p className="mt-3 text-sm text-destructive">
                    {failureReason}
                  </p>
                ) : null}
                {outputOpen ? (
                  <div
                    className="mt-4 rounded-xl bg-muted/60 p-4"
                    data-testid={`cofounder-worker-output-${run.workerId}`}
                    id={`cofounder-worker-output-${run.workerId}`}
                  >
                    {run.outputText ? (
                      <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed">
                        {run.outputText}
                      </pre>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No output was recorded.
                      </p>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
