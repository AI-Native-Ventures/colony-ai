import type * as React from "react";
import { FirstRunButton } from "./firstRunControls";
import { FirstRunHead } from "./FirstRunFrame";

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
    <div
      className="c3fr-form"
      data-testid="invite-claim-failed"
      style={{ "--c3fr-gap": 22 } as React.CSSProperties}
    >
      <FirstRunHead
        lede={message}
        title={
          canRetry ? "We couldn’t join just yet." : "That invite didn’t work."
        }
      />
      {canRetry ? (
        <>
          <FirstRunButton
            data-testid="invite-claim-retry"
            kind="primary"
            onClick={onRetry}
          >
            Try again
          </FirstRunButton>
          <FirstRunButton data-testid="invite-claim-leave" onClick={onLeave}>
            {leaveLabel}
          </FirstRunButton>
        </>
      ) : (
        <FirstRunButton
          data-testid="invite-claim-leave"
          kind="primary"
          onClick={onLeave}
        >
          {leaveLabel}
        </FirstRunButton>
      )}
    </div>
  );
}
