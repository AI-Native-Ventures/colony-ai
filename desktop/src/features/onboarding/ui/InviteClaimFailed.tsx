import { PrimaryButton } from "./OnboardingScenePrimitives";

/**
 * Failed invite claim, shown after setup when the workspace could not be
 * joined. It always has a way out: back to the person's own workspace, or on
 * with setup when they have none. A retry is offered only when one can help.
 */
export function InviteClaimFailed({
  canRetry,
  hasWorkspace,
  message,
  onLeave,
  onRetry,
}: {
  canRetry: boolean;
  hasWorkspace: boolean;
  message: string;
  onLeave: () => void;
  onRetry: () => void;
}) {
  const leaveLabel = hasWorkspace ? "Back to my workspace" : "Continue setup";
  return (
    <div data-testid="invite-claim-failed">
      <h2>That invite didn’t work.</h2>
      <p className="lede">{message}</p>
      {canRetry ? (
        <>
          <PrimaryButton onClick={onRetry} testId="invite-claim-retry">
            Try again
          </PrimaryButton>
          <button
            className="secondary full"
            data-testid="invite-claim-leave"
            onClick={onLeave}
            type="button"
          >
            {leaveLabel}
          </button>
        </>
      ) : (
        <PrimaryButton onClick={onLeave} testId="invite-claim-leave">
          {leaveLabel}
        </PrimaryButton>
      )}
    </div>
  );
}
