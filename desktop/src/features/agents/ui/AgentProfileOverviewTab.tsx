import { ArrowRight, Hash } from "lucide-react";

import { friendlyAgentLastError } from "@/features/agents/lib/friendlyAgentLastError";
import type { useActiveAgentTurns } from "@/features/agents/activeAgentTurnsStore";
import type { ManagedAgent } from "@/shared/api/types";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { PanelSectionGroup } from "@/shared/ui/PanelSectionGroup";
import type { AgentProfileTab } from "./AgentProfileView";

export function OverviewTab({
  activeTurns,
  agent,
  channelOptions,
  channelError,
  channelsLoading,
  description,
  harnessLabel,
  onOpenChannel,
  onTabChange,
  providerLabel,
}: {
  activeTurns: ReturnType<typeof useActiveAgentTurns>;
  agent: ManagedAgent;
  channelOptions: Array<{ id: string; name: string }>;
  channelError: Error | null;
  channelsLoading: boolean;
  description: string | null;
  harnessLabel: string;
  onOpenChannel: (channelId: string) => void;
  onTabChange: (tab: AgentProfileTab) => void;
  providerLabel: string;
}) {
  return (
    <div className="space-y-5" data-testid="agent-overview">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Overview</h2>
      </div>
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
      <div className="grid gap-10 lg:grid-cols-2">
        <section className="min-w-0" aria-labelledby="agent-overview-config">
          <h3 className="mb-2 text-sm font-semibold" id="agent-overview-config">
            Configuration
          </h3>
          <div className="divide-y divide-border/55">
            <OverviewRow label="Harness" value={harnessLabel} />
            <OverviewRow label="Provider" value={providerLabel} />
            <OverviewRow label="Model" value={agent.model ?? "Not reported"} />
            <OverviewRow
              label="Runs on"
              value={
                agent.backend.type === "local"
                  ? "This Mac"
                  : agent.backend.id || "Remote host"
              }
            />
            <OverviewRow
              label="Last activity"
              value={formatActivityTime(agent.lastStartedAt)}
            />
          </div>
          <Button
            className="mt-3 px-0 text-xs text-[#2655a0] dark:text-[#adbfdf]"
            onClick={() => onTabChange("model-runtime")}
            size="sm"
            type="button"
            variant="link"
          >
            Inspect configuration{" "}
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Button>
        </section>

        <section
          className="min-w-0"
          aria-labelledby="agent-overview-membership"
        >
          <h3
            className="mb-2 text-sm font-semibold"
            id="agent-overview-membership"
          >
            Where this agent works
          </h3>
          {channelsLoading ? (
            <p className="py-2 text-sm text-muted-foreground">
              Loading channel membership…
            </p>
          ) : channelError ? (
            <p className="py-2 text-sm text-destructive" role="alert">
              Channel membership could not be loaded: {channelError.message}
            </p>
          ) : channelOptions.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              No channel memberships are reported.
            </p>
          ) : (
            <div>
              {channelOptions.map((channel) => (
                <button
                  className="flex min-h-10 w-full items-center gap-2 py-2 text-left text-sm text-foreground hover:text-primary"
                  key={channel.id}
                  onClick={() => onOpenChannel(channel.id)}
                  type="button"
                >
                  <Hash
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {channel.name}
                  </span>
                  <ArrowRight
                    aria-hidden="true"
                    className="size-3 text-muted-foreground"
                  />
                </button>
              ))}
            </div>
          )}
          <h3 className="mb-1 mt-4 text-sm font-semibold">
            Who can give instructions
          </h3>
          <p className="text-sm text-muted-foreground">
            {accessLabel(agent.respondTo)}
            {agent.respondTo === "allowlist"
              ? ` · ${agent.respondToAllowlist.length} selected people`
              : ""}
          </p>
          <Button
            className="mt-2 px-0 text-xs text-[#2655a0] dark:text-[#adbfdf]"
            onClick={() => onTabChange("tools-access")}
            size="sm"
            type="button"
            variant="link"
          >
            Tools & access{" "}
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Button>
        </section>
      </div>

      <section aria-labelledby="agent-overview-current-work">
        <div className="flex items-center justify-between gap-3">
          <h3
            className="text-sm font-semibold"
            id="agent-overview-current-work"
          >
            Current work
          </h3>
          <Button
            className="px-0 text-xs text-[#2655a0] dark:text-[#adbfdf]"
            onClick={() => onTabChange("activity")}
            size="sm"
            type="button"
            variant="link"
          >
            Activity log <ArrowRight aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
        {activeTurns.length === 0 ? (
          <p className="mt-2 min-h-[3.875rem] rounded-lg border border-dashed border-border/70 px-0 py-5 text-sm text-muted-foreground">
            No work is currently assigned to this agent.
          </p>
        ) : (
          <div className="mt-2 divide-y divide-border/55 rounded-lg border border-border/60 px-3">
            {activeTurns.map((turn) => {
              const channel = channelOptions.find(
                (candidate) => candidate.id === turn.channelId,
              );
              return (
                <button
                  className="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left text-sm"
                  key={turn.channelId}
                  onClick={() => onOpenChannel(turn.channelId)}
                  type="button"
                >
                  <span className="truncate">
                    #{channel?.name ?? turn.channelId.slice(0, 8)}
                  </span>
                  <Badge>Working</Badge>
                </button>
              );
            })}
          </div>
        )}
      </section>
      {friendlyAgentLastError(agent.lastError, agent.lastErrorCode)?.copy ? (
        <PanelSectionGroup title="Last error">
          <p className="whitespace-pre-wrap px-4 py-3 text-sm text-destructive">
            {friendlyAgentLastError(agent.lastError, agent.lastErrorCode)?.copy}
          </p>
        </PanelSectionGroup>
      ) : null}
    </div>
  );
}

function OverviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid min-h-11 grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)] items-center gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

export function accessLabel(mode: ManagedAgent["respondTo"]) {
  switch (mode) {
    case "owner-only":
      return "Only me";
    case "allowlist":
      return "Selected people";
    case "anyone":
      return "Anyone in this space";
  }
}

function formatActivityTime(value: string | null) {
  if (!value) return "Not reported";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not reported"
    : new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(date);
}
