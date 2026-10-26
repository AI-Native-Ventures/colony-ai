import { RefreshCw, WifiOff } from "lucide-react";

/** Retryable terminal failure for a channel history load with no cached rows. */
export function MessageTimelineErrorCard({
  onRetry,
}: {
  onRetry?: () => void;
}) {
  return (
    <div
      className="my-auto flex flex-col items-center gap-2 rounded-[calc(18*var(--colony-px))] border-[1.5px] border-dashed border-[var(--colony-danger-line)] bg-[var(--colony-danger-surface)] px-[calc(22*var(--colony-px))] py-7 text-center"
      data-testid="message-timeline-error"
      role="alert"
    >
      <span className="grid size-[calc(44*var(--colony-px))] place-items-center rounded-[calc(13*var(--colony-px))] bg-colony-danger-bg text-colony-danger">
        <WifiOff aria-hidden className="size-[calc(20*var(--colony-px))]" />
      </span>
      <p className="c3c-empty-title mt-1 !text-[length:var(--text-base)]">
        Couldn&apos;t load messages
      </p>
      <p className="c3c-empty-text !text-[length:calc(15*var(--colony-px))]">
        The channel history didn&apos;t load. Check your connection and try
        again.
      </p>
      {onRetry ? (
        <button
          className="c3c-button mt-2 inline-flex h-10 items-center gap-2 rounded-[calc(11*var(--colony-px))] bg-[var(--colony-overlay)] px-4 text-colony-fg shadow-[0_0_0_1px_hsl(var(--colony-border-strong))] transition-colors hover:bg-colony-wash"
          data-testid="message-timeline-retry"
          onClick={onRetry}
          type="button"
        >
          <RefreshCw aria-hidden className="size-[calc(15*var(--colony-px))]" />
          Retry
        </button>
      ) : null}
    </div>
  );
}
