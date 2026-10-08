import { Button } from "@/shared/ui/button";

export type WorkAreaTabNoticeState =
  | "loading"
  | "empty"
  | "denied"
  | "failed"
  | "unlisted";

/**
 * The one centered message every data-backed dock tab uses for the states that
 * have no content: loading, empty, denied, failed. Plain words only; the raw
 * relay text never reaches this component. A failure or denial offers Retry,
 * and a failure is announced because the person is waiting on it.
 */
export function WorkAreaTabNotice({
  state,
  title,
  body,
  testId,
  onRetry,
}: {
  state: WorkAreaTabNoticeState;
  title: string;
  body?: string;
  testId: string;
  onRetry?: () => void;
}) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
      data-state={state}
      data-testid={testId}
      role={state === "failed" ? "alert" : "status"}
    >
      <p className="text-sm font-medium">{title}</p>
      {body ? (
        <p className="max-w-sm text-sm text-muted-foreground">{body}</p>
      ) : null}
      {onRetry ? (
        <Button
          className="mt-2"
          data-testid={`${testId}-retry`}
          onClick={onRetry}
          size="sm"
          type="button"
          variant="outline"
        >
          Retry
        </Button>
      ) : null}
    </div>
  );
}
