import type { ScorecardMetric } from "../cofounderNumbers";
import type { FunctionId } from "../cofounderRecords";

export function FunctionScorecard({
  functionId,
  fixtureAvailable,
  metrics,
  note,
}: {
  functionId: FunctionId;
  fixtureAvailable: boolean;
  metrics: ScorecardMetric[] | undefined;
  note: string | undefined;
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
      {metrics && metrics.length > 0 ? (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {metrics.map((metric) => (
            <li
              className="flex min-h-20 flex-col justify-center gap-1 rounded-xl bg-muted/70 p-3"
              key={metric.label}
            >
              <span className="text-lg font-extrabold leading-tight">
                {metric.value}
              </span>
              <span className="text-sm font-semibold text-muted-foreground">
                {metric.label}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {fixtureAvailable
            ? "No scorecard numbers have been recorded for this function yet."
            : "Scorecard numbers will appear when tracking is connected."}
        </p>
      )}
      {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
    </section>
  );
}
