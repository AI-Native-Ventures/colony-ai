import { CircleAlert } from "lucide-react";

import { retryAgentStart } from "@/features/agents/agentStartWatch";
import {
  type AgentWorkingIndicatorState,
  formatWorkingIndicatorLabel,
  workingIndicatorAnchor,
} from "@/features/channels/lib/agentWorkingIndicator";
import { formatElapsedClock } from "@/features/agents/ui/agentSessionUtils";
import type { UserProfileLookup } from "@/features/profile/lib/identity";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { cn } from "@/shared/lib/cn";
import { useNow } from "@/shared/lib/useNow";
import { Shimmer } from "@/shared/ui/Shimmer";

const MAX_AVATARS = 3;

function WorkingTimer({ anchorAt }: { anchorAt: number }) {
  const now = useNow(1000);
  return (
    <span
      className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground"
      data-testid="agent-working-indicator-timer"
    >
      {formatElapsedClock(now - anchorAt)}
    </span>
  );
}

/**
 * The one-line notice above the composer: the agent's picture, "Scout is
 * working…" (or "Scout is starting…" before it picked the mention up) and how
 * long it has been going, or a plain note that it stopped or never answered.
 * Visual only, apart from the retry button on the "never answered" note.
 * Screen readers get `AgentWorkingAnnouncer`, which speaks once per change
 * instead of once per tick.
 */
export function AgentWorkingIndicatorRow({
  className,
  profiles,
  state,
  testId,
}: {
  className?: string;
  profiles?: UserProfileLookup;
  state: AgentWorkingIndicatorState;
  testId: string;
}) {
  if (state.kind === "hidden") {
    return null;
  }
  const isStalled = state.kind === "stalled";
  const isError = state.kind === "error" || isStalled;
  const anchorAt = workingIndicatorAnchor(state);

  return (
    <div
      // The retry button must stay reachable, so the stalled note is the one
      // state that is not hidden from assistive tech; its text is hidden
      // instead, because the announcer already speaks it.
      aria-hidden={isStalled ? undefined : "true"}
      className={cn("flex min-w-0 items-center gap-2", className)}
      data-state={state.kind}
      data-testid={testId}
    >
      {isError ? (
        <CircleAlert
          className="size-4 shrink-0 text-destructive"
          data-testid="agent-working-indicator-error-icon"
        />
      ) : (
        <span className="flex shrink-0 items-center">
          {state.agents.slice(0, MAX_AVATARS).map((agent, index) => (
            <ProfileAvatar
              avatarUrl={
                profiles?.[agent.pubkey.toLowerCase()]?.avatarUrl ?? null
              }
              pubkey={agent.pubkey}
              className={cn(
                "size-5 text-3xs ring-1 ring-background",
                index > 0 && "-ml-1.5",
              )}
              iconClassName="size-3"
              key={agent.pubkey}
              label={agent.name}
              shape="squircle"
              testId={`agent-working-indicator-avatar-${agent.pubkey}`}
            />
          ))}
        </span>
      )}
      <p
        aria-hidden={isStalled ? "true" : undefined}
        className={cn(
          "min-w-0 truncate text-xs font-medium",
          isError ? "text-destructive" : "text-muted-foreground",
        )}
        data-testid="agent-working-indicator-label"
      >
        {isError ? (
          formatWorkingIndicatorLabel(state)
        ) : (
          <Shimmer className="[&.buzz-shimmer]:text-foreground/70">
            {formatWorkingIndicatorLabel(state)}
          </Shimmer>
        )}
      </p>
      {isStalled ? (
        <button
          aria-label={`Try starting ${state.agents.map((agent) => agent.name).join(" and ")} again`}
          className="inline-flex h-6 shrink-0 items-center rounded-colony-menu-item px-2 text-xs font-semibold text-colony-accent-ink underline-offset-2 hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40"
          data-testid="agent-working-indicator-retry"
          onClick={() => {
            for (const agent of state.agents) {
              retryAgentStart(agent.pubkey);
            }
          }}
          type="button"
        >
          Try again
        </button>
      ) : null}
      {anchorAt !== null ? <WorkingTimer anchorAt={anchorAt} /> : null}
    </div>
  );
}

/**
 * Always mounted, so the text appearing is announced politely once. The text
 * carries no timer; it changes only when the set of agents or the state does.
 */
export function AgentWorkingAnnouncer({
  state,
}: {
  state: AgentWorkingIndicatorState;
}) {
  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className="sr-only"
      data-testid="agent-working-announcer"
      role="status"
    >
      {formatWorkingIndicatorLabel(state)}
    </div>
  );
}
