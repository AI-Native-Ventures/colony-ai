import { friendlyAgentLastError } from "@/features/agents/lib/friendlyAgentLastError";
import type { ActiveTurnSummary } from "@/features/agents/activeAgentTurnsStore";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import type { Channel, ManagedAgent } from "@/shared/api/types";
import { HashIcon, PrivateChannelIcon } from "@/shared/ui/colonyIcons";
import { AgentStatusChip } from "./AgentStatusChip";
import { formatStartedAt } from "./agentPageModel";

export type AgentChannelOption = {
  id: string;
  name: string;
  visibility?: Channel["visibility"];
};

function accessLabel(mode: ManagedAgent["respondTo"]) {
  switch (mode) {
    case "owner-only":
      return "You and admins";
    case "allowlist":
      return "Selected people";
    case "anyone":
      return "Anyone in this space";
  }
}

function PeopleChips({ pubkeys }: { pubkeys: readonly string[] }) {
  const profiles = useUsersBatchQuery([...pubkeys], {
    enabled: pubkeys.length > 0,
  });
  return (
    <div className="agents-c3-people">
      {pubkeys.map((pubkey) => {
        const profile = profiles.data?.profiles[pubkey.toLowerCase()];
        const name = profile?.displayName?.trim() || "Teammate";
        return (
          <span className="agents-c3-person" key={pubkey}>
            <span aria-hidden="true" className="agents-c3-person-avatar">
              <ProfileAvatar
                avatarUrl={profile?.avatarUrl ?? null}
                className="size-full"
                label={name}
                pubkey={pubkey}
                shape={profile?.isAgent ? "squircle" : "circle"}
              />
            </span>
            {name}
          </span>
        );
      })}
    </div>
  );
}

/** Simple work, access and support information for the agent profile. */
export function AgentPageOverview({
  activeTurns,
  agent,
  channelError,
  channelOptions,
  channelsLoading,
  onOpenChannel,
}: {
  activeTurns: readonly ActiveTurnSummary[];
  agent: ManagedAgent;
  channelError: Error | null;
  channelOptions: readonly AgentChannelOption[];
  channelsLoading: boolean;
  onOpenChannel: (channelId: string) => void;
}) {
  const lastError = friendlyAgentLastError(
    agent.lastError,
    agent.lastErrorCode,
  );
  const isScout = agent.personaId === "builtin:fizz";

  return (
    <div className="agents-c3-stack" data-testid="agent-overview">
      <div className="agents-c3-grid2">
        <section
          aria-labelledby="current-work"
          className="agents-c3-card"
          data-gap="10"
        >
          <h2 className="agents-c3-eyebrow" id="current-work">
            Working on
          </h2>
          {channelsLoading && activeTurns.length === 0 ? (
            <p className="agents-c3-quiet" role="status">
              Loading current work…
            </p>
          ) : channelError && activeTurns.length > 0 ? (
            <p className="agents-c3-err" role="alert">
              Current work could not be loaded: {channelError.message}
            </p>
          ) : activeTurns.length === 0 ? (
            <p className="agents-c3-quiet">Nothing in progress right now.</p>
          ) : (
            activeTurns.map((turn) => {
              const channel = channelOptions.find(
                (candidate) => candidate.id === turn.channelId,
              );
              return (
                <button
                  className="agents-c3-work"
                  key={turn.channelId}
                  onClick={() => onOpenChannel(turn.channelId)}
                  type="button"
                >
                  <span className="agents-c3-work-text">
                    <span className="agents-c3-work-title">
                      {channel?.visibility === "private" ? (
                        <PrivateChannelIcon size={16} />
                      ) : (
                        <HashIcon size={16} />
                      )}
                      {channel?.name ?? turn.channelId.slice(0, 8)}
                    </span>
                    <span className="agents-c3-work-meta">
                      Started {formatStartedAt(turn.anchorAt)}
                    </span>
                  </span>
                  <AgentStatusChip label="Working" />
                </button>
              );
            })
          )}
        </section>

        <section aria-labelledby="who" className="agents-c3-card" data-gap="10">
          <h2 className="agents-c3-eyebrow" id="who">
            Who can give instructions
          </h2>
          <span className="agents-c3-strong">
            {accessLabel(agent.respondTo)}
          </span>
          {agent.respondTo === "allowlist" &&
          agent.respondToAllowlist.length > 0 ? (
            <PeopleChips pubkeys={agent.respondToAllowlist} />
          ) : null}
        </section>
      </div>

      <div className="agents-c3-grid2">
        <section
          aria-labelledby="last-error"
          className="agents-c3-card"
          data-testid="agent-last-error"
        >
          <h2 className="agents-c3-eyebrow" id="last-error">
            Last problem
          </h2>
          {lastError?.copy ? (
            <p className="agents-c3-err">{lastError.copy}</p>
          ) : (
            <p className="agents-c3-quiet">No problem reported.</p>
          )}
        </section>

        {isScout ? (
          <section
            aria-labelledby="scout-team"
            className="agents-c3-card"
            data-gap="10"
          >
            <h2 className="agents-c3-eyebrow" id="scout-team">
              Always on your team
            </h2>
            <p className="agents-c3-body">
              Scout is your Chief of Staff. Scout can be paused but not removed.
            </p>
          </section>
        ) : null}
      </div>
    </div>
  );
}
