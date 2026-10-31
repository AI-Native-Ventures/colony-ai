import { KeyRound } from "lucide-react";

import {
  KEY_RESCUE_BUTTON_LABEL,
  KEY_RESCUE_PENDING_LABEL,
  keyRescueCardState,
} from "@/features/agents/keyRescueModel";
import { useKeyRescue } from "@/features/agents/useKeyRescue";
import { Button } from "@/shared/ui/button";

/**
 * The one-time offer to move agent keys out of the old Mac Keychain, and what
 * is left to do if that did not work. Shown on the agents page, and in a
 * conversation with an agent that is locked (`scopePubkeys`).
 */
export function KeyRescueCard({
  scopePubkeys,
  className,
}: {
  scopePubkeys?: readonly string[];
  className?: string;
}) {
  const { status, justMoved, isMoving, moveFailed, rescue } = useKeyRescue();
  const state = keyRescueCardState(status, {
    scopePubkeys: scopePubkeys ?? null,
    justMoved,
  });
  if (state.kind === "hidden") return null;

  return (
    <div
      className={`flex items-start gap-3 rounded-2xl border border-colony-border bg-colony-wash px-4 py-3.5 text-sm text-colony-muted ${className ?? ""}`}
      data-state={state.kind}
      data-testid="key-rescue-card"
    >
      <KeyRound aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 space-y-2">
        {state.kind === "offer" ? (
          <>
            <p>{state.text}</p>
            <Button
              data-testid="key-rescue-move"
              disabled={isMoving}
              onClick={() => rescue()}
              size="sm"
              type="button"
            >
              {isMoving ? KEY_RESCUE_PENDING_LABEL : KEY_RESCUE_BUTTON_LABEL}
            </Button>
            {moveFailed ? (
              <p role="alert">Colony could not start the move. Try again.</p>
            ) : null}
          </>
        ) : null}
        {state.kind === "done" ? <p>{state.text}</p> : null}
        {state.kind === "failed" ? (
          <>
            <p>{state.headline}</p>
            <p data-testid="key-rescue-agents">
              Not moved: {state.agentNames.join(", ")}.
            </p>
            <p>{state.guidance}</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
