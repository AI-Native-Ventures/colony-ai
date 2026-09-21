import { Button } from "@/shared/ui/button";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";

export function NativeUnavailableScreen({
  body,
  onBack,
  onRetry,
  title = "This feature is not available yet",
  testId = "native-unavailable",
}: {
  body: string;
  onBack?: () => void;
  onRetry?: () => void;
  title?: string;
  testId?: string;
}) {
  return (
    <div
      className="buzz-onboarding-neutral-theme buzz-startup-shell flex min-h-dvh items-center justify-center bg-background px-4 py-8 text-foreground"
      data-testid={testId}
    >
      <StartupWindowDragRegion />
      <div className="relative flex w-full max-w-[500px] flex-col items-center text-center">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{body}</p>
        {onBack ? (
          <Button
            className="mt-8 h-10 w-full max-w-[300px]"
            onClick={onBack}
            type="button"
          >
            Return to onboarding
          </Button>
        ) : null}
        {onRetry ? (
          <Button
            className="mt-8 h-10 w-full max-w-[300px]"
            onClick={onRetry}
            type="button"
            variant={onBack ? "ghost" : "default"}
          >
            Try again
          </Button>
        ) : null}
      </div>
    </div>
  );
}
