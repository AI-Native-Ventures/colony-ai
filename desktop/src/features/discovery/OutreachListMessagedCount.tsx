import type { OutreachListProgress } from "./outreachListProgress";

export function OutreachListMessagedCount({
  loading,
  progress,
  unavailableReason,
  testId,
}: {
  loading: boolean;
  progress: OutreachListProgress | null | undefined;
  unavailableReason: string | null;
  testId?: string;
}) {
  if (loading) {
    return (
      <span data-testid={testId}>
        Loading…<span className="sr-only"> WhatsApp contact status</span>
      </span>
    );
  }
  if (!progress) {
    return (
      <span data-testid={testId}>
        <span aria-hidden="true">-</span>
        <span className="sr-only">
          WhatsApp contact status is unavailable.{" "}
          {unavailableReason ?? "Try again later."}
        </span>
      </span>
    );
  }
  return (
    <span data-testid={testId}>
      {progress.messaged} of {progress.total}
      <span className="sr-only"> leads messaged</span>
    </span>
  );
}
