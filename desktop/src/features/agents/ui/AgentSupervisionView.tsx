import * as React from "react";
import { ArrowUpRight } from "lucide-react";

import { useActiveAgentTurnsByChannel } from "@/features/agents/activeAgentTurnsStore";
import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { ManagedAgentSessionPanel } from "@/features/agents/ui/ManagedAgentSessionPanel";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import type { ManagedAgent } from "@/shared/api/types";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { PageHeader } from "@/shared/ui/PageHeader";

export function AgentSupervisionView({
  channelId,
  agentPubkey,
  onSelectTrace,
}: {
  channelId?: string;
  agentPubkey?: string;
  onSelectTrace: (channelId: string, agentPubkey: string) => void;
}) {
  const { goAgents, goChannel } = useAppNavigation();
  const managedAgentsQuery = useManagedAgentsQuery();
  const channelsQuery = useChannelsQuery();
  const activeTurns = useActiveAgentTurnsByChannel();
  const agents = managedAgentsQuery.data ?? [];
  const channels = channelsQuery.data ?? [];
  const selectedTurn = activeTurns.find((turn) => turn.channelId === channelId);
  const activeRows = React.useMemo(
    () =>
      activeTurns.flatMap((turn) =>
        turn.agentPubkeys.flatMap((pubkey) => {
          const agent = agents.find(
            (candidate) =>
              candidate.pubkey.toLowerCase() === pubkey.toLowerCase(),
          );
          return agent ? [{ turn, turnAgent: agent }] : [];
        }),
      ),
    [activeTurns, agents],
  );
  const selectedAgent = selectedTurn
    ? agents.find(
        (agent) =>
          agent.pubkey.toLowerCase() === agentPubkey?.toLowerCase() &&
          selectedTurn.agentPubkeys.some(
            (pubkey) => pubkey.toLowerCase() === agent.pubkey.toLowerCase(),
          ),
      )
    : undefined;
  const firstTrace = React.useMemo(() => {
    const turn = activeTurns[0];
    const agent = agents.find(
      (candidate) =>
        candidate.pubkey.toLowerCase() === turn?.agentPubkeys[0]?.toLowerCase(),
    );
    return turn && agent ? { channelId: turn.channelId, agent } : null;
  }, [activeTurns, agents]);
  const visibleChannelId = selectedTurn
    ? selectedTurn.channelId
    : firstTrace?.channelId;
  const visibleAgent: ManagedAgent | undefined = selectedTurn
    ? (selectedAgent ??
      agents.find(
        (candidate) =>
          candidate.pubkey.toLowerCase() ===
          selectedTurn.agentPubkeys[0]?.toLowerCase(),
      ))
    : firstTrace?.agent;

  return (
    <div
      className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8"
      data-testid="agent-supervision"
    >
      <PageHeader
        action={
          <Button
            onClick={() => void goAgents()}
            size="sm"
            type="button"
            variant="outline"
          >
            Directory
          </Button>
        }
        description="Live channel and thread work reported by managed agents."
        title="Agent work"
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]">
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">
              Active sessions
            </h2>
            <Badge variant="secondary">{activeRows.length}</Badge>
          </div>
          {managedAgentsQuery.isLoading || channelsQuery.isLoading ? (
            <p className="rounded-xl border border-border/70 bg-background/70 px-4 py-6 text-sm text-muted-foreground">
              Loading active sessions…
            </p>
          ) : managedAgentsQuery.error || channelsQuery.error ? (
            <p
              className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              role="alert"
            >
              {managedAgentsQuery.error instanceof Error
                ? managedAgentsQuery.error.message
                : channelsQuery.error instanceof Error
                  ? channelsQuery.error.message
                  : "Active sessions could not be loaded."}
            </p>
          ) : activeRows.length === 0 ? (
            <div className="rounded-xl border border-border/70 bg-background/70 px-4 py-8 text-center">
              <p className="text-sm font-medium">
                No active sessions in this view.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border/55 overflow-hidden rounded-xl border border-border/70 bg-background/70">
              {activeRows.map(({ turn, turnAgent }) => {
                const channel = channels.find(
                  (candidate) => candidate.id === turn.channelId,
                );
                const selected =
                  turn.channelId === visibleChannelId &&
                  turnAgent.pubkey === visibleAgent?.pubkey;
                return (
                  <button
                    aria-current={selected ? "true" : undefined}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                    key={`${turn.channelId}:${turnAgent.pubkey}`}
                    onClick={() =>
                      onSelectTrace(turn.channelId, turnAgent.pubkey)
                    }
                    type="button"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {turnAgent.name}
                      </span>
                      <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                        #{channel?.name ?? turn.channelId.slice(0, 8)}
                      </span>
                    </span>
                    <Badge>Working</Badge>
                    <ArrowUpRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="min-w-0 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">
                Session trace
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {visibleAgent && visibleChannelId
                  ? `${visibleAgent.name} · ${channels.find((channel) => channel.id === visibleChannelId)?.name ?? visibleChannelId.slice(0, 8)}`
                  : "Select active work to inspect its trace."}
              </p>
            </div>
            {visibleChannelId ? (
              <Button
                onClick={() => void goChannel(visibleChannelId)}
                size="sm"
                type="button"
                variant="ghost"
              >
                Open channel
              </Button>
            ) : null}
          </div>
          {visibleAgent && visibleChannelId ? (
            <ManagedAgentSessionPanel
              agent={visibleAgent}
              channelId={visibleChannelId}
              emptyDescription="No activity is available for this channel."
              showRaw={false}
            />
          ) : (
            <div className="min-h-64 rounded-xl border border-border/70 bg-background/70 px-5 py-10 text-center">
              <p className="text-sm text-muted-foreground">
                No session trace is available.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
