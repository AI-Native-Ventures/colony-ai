import { friendlyAgentLastError } from "@/features/agents/lib/friendlyAgentLastError";
import type { ActiveTurnSummary } from "@/features/agents/activeAgentTurnsStore";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import type { Channel, ManagedAgent } from "@/shared/api/types";
import { HashIcon, PrivateChannelIcon } from "@/shared/ui/colonyIcons";
import { AgentStatusChip } from "./AgentStatusChip";
import {
  formatLastActivity,
  formatStartedAt,
  personInitials,
} from "./agentPageModel";

export type AgentChannelOption = {
  id: string;
  name: string;
  visibility?: Channel["visibility"];
};

function accessLabel(mode: ManagedAgent["respondTo"]) {
  switch (mode) {
    case "owner-only":
      return "Only me";
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
              {profile?.avatarUrl ? (
                <img
                  alt=""
                  referrerPolicy="no-referrer"
                  src={profile.avatarUrl}
                />
              ) : (
                personInitials(name)
              )}
            </span>
            {name}
          </span>
        );
      })}
    </div>
  );
}

/** The overview cards of the single agent page (`AgentProfile.dc.html`). */
export function AgentPageOverview({
  activeTurns,
  agent,
  channelError,
  channelOptions,
  channelsLoading,
  description,
  harnessLabel,
  onOpenChannel,
  providerLabel,
}: {
  activeTurns: readonly ActiveTurnSummary[];
  agent: ManagedAgent;
  channelError: Error | null;
  channelOptions: readonly AgentChannelOption[];
  channelsLoading: boolean;
  description: string | null;
  harnessLabel: string;
  onOpenChannel: (channelId: string) => void;
  providerLabel: string;
}) {
  const lastError = friendlyAgentLastError(
    agent.lastError,
    agent.lastErrorCode,
  );
  const tiles: Array<[string, string, boolean]> = [
    ["Harness", harnessLabel, harnessLabel === "Not reported"],
    ["Provider", providerLabel, providerLabel === "Not reported"],
    ["Model", agent.model ?? "Not reported", !agent.model],
    [
      "Runs on",
      agent.backend.type === "local"
        ? "This Mac"
        : agent.backend.id || "Remote host",
      false,
    ],
    [
      "Last activity",
      formatLastActivity(agent.lastStartedAt),
      !agent.lastStartedAt,
    ],
  ];

  return (
    <div className="agents-c3-stack" data-testid="agent-overview">
      {description ? (
        <section aria-labelledby="about" className="agents-c3-card">
          <h2 className="agents-c3-eyebrow" id="about">
            About
          </h2>
          <p className="agents-c3-body">{description}</p>
        </section>
      ) : null}

      <section
        aria-labelledby="config"
        className="agents-c3-card"
        data-gap="12"
      >
        <div className="agents-c3-card-head">
          <h2 className="agents-c3-eyebrow" id="config">
            Configuration
          </h2>
        </div>
        <dl className="agents-c3-tiles">
          {tiles.map(([label, value, muted]) => (
            <div className="agents-c3-tile" key={label}>
              <dt>{label}</dt>
              <dd data-muted={muted ? "true" : undefined}>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="agents-c3-grid2">
        <section
          aria-labelledby="where"
          className="agents-c3-card"
          data-gap="10"
        >
          <h2 className="agents-c3-eyebrow" id="where">
            Where this agent works
          </h2>
          {channelsLoading ? (
            <p className="agents-c3-quiet">Loading channel membership…</p>
          ) : channelError ? (
            <p className="agents-c3-err" role="alert">
              Channel membership could not be loaded: {channelError.message}
            </p>
          ) : channelOptions.length === 0 ? (
            <p className="agents-c3-quiet">
              No channel memberships are reported.
            </p>
          ) : (
            channelOptions.map((channel) => (
              <button
                className="agents-c3-channel"
                key={channel.id}
                onClick={() => onOpenChannel(channel.id)}
                type="button"
              >
                {channel.visibility === "private" ? (
                  <PrivateChannelIcon size={17} />
                ) : (
                  <HashIcon size={17} />
                )}
                {channel.name}
              </button>
            ))
          )}
        </section>

        <section aria-labelledby="who" className="agents-c3-card" data-gap="10">
          <h2 className="agents-c3-eyebrow" id="who">
            Who can give instructions
          </h2>
          <span className="agents-c3-strong">
            {accessLabel(agent.respondTo)}
            {agent.respondTo === "allowlist"
              ? ` · ${agent.respondToAllowlist.length}`
              : ""}
          </span>
          {agent.respondTo === "allowlist" &&
          agent.respondToAllowlist.length > 0 ? (
            <PeopleChips pubkeys={agent.respondToAllowlist} />
          ) : null}
        </section>
      </div>

      <section
        aria-labelledby="current-work"
        className="agents-c3-card"
        data-gap="10"
      >
        <h2 className="agents-c3-eyebrow" id="current-work">
          Current work
        </h2>
        {activeTurns.length === 0 ? (
          <p className="agents-c3-quiet">
            No work is currently assigned to this agent.
          </p>
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
                    #{channel?.name ?? turn.channelId.slice(0, 8)}
                  </span>
                  <span className="agents-c3-work-meta">
                    started {formatStartedAt(turn.anchorAt)}
                  </span>
                </span>
                <AgentStatusChip label="Working" />
              </button>
            );
          })
        )}
      </section>

      <section
        aria-labelledby="last-error"
        className="agents-c3-card"
        data-testid="agent-last-error"
      >
        <h2 className="agents-c3-eyebrow" id="last-error">
          Last error
        </h2>
        {lastError?.copy ? (
          <p className="agents-c3-err">{lastError.copy}</p>
        ) : (
          <span className="agents-c3-ok">
            <svg
              aria-hidden="true"
              fill="none"
              height="16"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="3"
              viewBox="0 0 24 24"
              width="16"
            >
              <path d="m5 12 5 5 9-10" />
            </svg>
            No errors reported
          </span>
        )}
      </section>
    </div>
  );
}
