import { cn } from "@/shared/lib/cn";
import { channelChrome } from "@/shared/layout/chromeLayout";

export function DayDivider({
  label,
  sticky = true,
  testId = "message-timeline-day-divider",
}: {
  label: string;
  sticky?: boolean;
  testId?: string;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        "pointer-events-none flex items-center gap-3.5 bg-colony-surface",
        sticky && cn("sticky z-20", channelChrome.stickyTimelineTop),
      )}
      data-testid={testId}
      data-day-label={label}
    >
      <span aria-hidden className="h-px flex-1 bg-colony-border" />
      <p className="c3c-day-label relative z-10 shrink-0">{label}</p>
      <span aria-hidden className="h-px flex-1 bg-colony-border" />
    </section>
  );
}
