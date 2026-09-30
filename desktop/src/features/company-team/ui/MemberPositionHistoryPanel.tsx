import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { useMemberPositionHistoryQuery } from "../teamRelay";
import type { MemberPositionActionKind } from "../teamModels";

function actionLabel(action: MemberPositionActionKind) {
  switch (action) {
    case "set_title":
      return "Title changed";
    case "set_manager":
      return "Reporting line changed";
    case "set_position":
      return "Position changed";
    case "pause":
      return "Employee paused";
    case "terminate":
      return "Employee terminated";
    case "rehire":
      return "Employee rehired";
  }
}

export function MemberPositionHistoryPanel({
  memberPubkey,
}: {
  memberPubkey: string;
}) {
  const historyQuery = useMemberPositionHistoryQuery(memberPubkey);

  return (
    <section data-testid="company-member-position-history">
      <h2 className="mb-5 text-base font-semibold">
        Configuration and lifecycle history
      </h2>
      {historyQuery.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          Loading company history
        </p>
      ) : historyQuery.isError ? (
        <Alert>
          <AlertTitle>Could not load company history</AlertTitle>
          <AlertDescription>
            A connection failure is not an empty history.
          </AlertDescription>
          <Button
            className="mt-3"
            onClick={() => void historyQuery.refetch()}
            size="sm"
            type="button"
            variant="outline"
          >
            Retry history
          </Button>
        </Alert>
      ) : historyQuery.data?.length ? (
        <ol className="divide-y divide-border rounded-lg border border-border">
          {historyQuery.data.map(({ action, event }) => (
            <li className="px-4 py-4" key={event.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-sm font-medium">
                  {actionLabel(action.action)}
                </p>
                <time
                  className="text-xs text-muted-foreground"
                  dateTime={new Date(event.created_at * 1_000).toISOString()}
                >
                  {new Intl.DateTimeFormat(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(event.created_at * 1_000))}
                </time>
              </div>
              {action.title ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  {action.title}
                </p>
              ) : null}
              {action.reason ? (
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                  {action.reason}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">
          No company position changes have been recorded.
        </p>
      )}
    </section>
  );
}
