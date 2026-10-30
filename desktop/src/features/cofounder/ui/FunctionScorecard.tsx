import type { FunctionId } from "../cofounderRecords";
import { METRIC_DETAILS, formatMetricValue } from "../numbersRecords";
import type { FunctionScorecardView } from "../numbersRecords";

function humanizeNotTracked(name: string): string {
  return name
    .replaceAll("_", " ")
    .replace(/^./, (first) => first.toUpperCase());
}

export function FunctionScorecard({
  functionId,
  isLoading,
  card,
  currency,
  loadError,
  refreshError,
  onRetryLoad,
  onRetryRefresh,
  isRefreshing,
}: {
  functionId: FunctionId;
  isLoading: boolean;
  card: FunctionScorecardView | null;
  currency: string;
  loadError: boolean;
  refreshError: boolean;
  onRetryLoad: () => void;
  onRetryRefresh: () => void;
  isRefreshing: boolean;
}) {
  return (
    <section
      aria-labelledby={`function-scorecard-title-${functionId}`}
      className="team-card space-y-4 p-5 sm:p-6"
      data-testid="cofounder-scorecard"
    >
      <h2
        className="text-base font-extrabold"
        id={`function-scorecard-title-${functionId}`}
      >
        Scorecard
      </h2>
      {loadError ? (
        <div className="space-y-2" role="alert">
          <p className="text-sm text-destructive">
            The scorecard could not load.
          </p>
          <button
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            onClick={onRetryLoad}
            type="button"
          >
            Try again
          </button>
        </div>
      ) : card && card.metrics.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {card.metrics.map((reading) => {
            const detail = METRIC_DETAILS[reading.metric];
            const value = formatMetricValue(
              reading.value,
              detail.unit,
              currency,
            );
            return (
              <li
                className="flex min-h-20 flex-col justify-center gap-1 rounded-xl bg-muted/70 p-3"
                key={reading.metric}
              >
                <span className="text-lg font-extrabold leading-tight">
                  {value ?? "Not stated"}
                </span>
                <span className="text-sm font-semibold text-muted-foreground">
                  {detail.label}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p aria-live="polite" className="text-sm text-muted-foreground">
          {isLoading
            ? "Loading scorecard numbers"
            : "No scorecard numbers have been recorded for this function yet."}
        </p>
      )}
      {card && card.notTracked.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Not tracked yet: {card.notTracked.map(humanizeNotTracked).join(", ")}
        </p>
      ) : null}
      {refreshError ? (
        <div className="flex flex-wrap items-center gap-3" role="alert">
          <p className="text-sm text-destructive">
            The scorecard could not refresh.
          </p>
          <button
            className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-60"
            disabled={isRefreshing}
            onClick={onRetryRefresh}
            type="button"
          >
            Try again
          </button>
        </div>
      ) : null}
    </section>
  );
}
