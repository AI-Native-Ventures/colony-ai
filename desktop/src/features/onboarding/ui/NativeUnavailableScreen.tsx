import { FirstRunButton } from "./firstRunControls";
import { AlertIcon } from "./firstRunIcons";
import { StartupProblem } from "./StartupProblem";

export function NativeUnavailableScreen({
  body,
  details,
  onBack,
  onRetry,
  title = "This feature is not available yet",
  testId = "native-unavailable",
}: {
  body: string;
  /** The raw error, shown behind "Technical details" when there is one. */
  details?: string | null;
  onBack?: () => void;
  onRetry?: () => void;
  title?: string;
  testId?: string;
}) {
  return (
    <StartupProblem
      actions={
        <>
          {onRetry ? (
            <FirstRunButton
              kind="primary"
              onClick={onRetry}
              size="small"
              type="button"
            >
              Try again
            </FirstRunButton>
          ) : null}
          {onBack ? (
            <FirstRunButton
              kind={onRetry ? "secondary" : "primary"}
              onClick={onBack}
              size="small"
              type="button"
            >
              Return to onboarding
            </FirstRunButton>
          ) : null}
        </>
      }
      body={body}
      details={details}
      icon={<AlertIcon size={22} />}
      testId={testId}
      title={title}
      tone="bad"
    />
  );
}
