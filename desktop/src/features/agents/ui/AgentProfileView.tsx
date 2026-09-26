import * as React from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Clock3,
  Ellipsis,
  FileText,
  Hash,
  List,
  LockKeyhole,
  MessageSquare,
  Settings,
  Square,
  Users,
} from "lucide-react";

import { ownsAuthorAgent } from "@/features/profile/lib/identity";
import { useUserProfileQuery } from "@/features/profile/hooks";
import { useIdentityArchive } from "@/features/identity-archive/hooks";
import { friendlyAgentLastError } from "@/features/agents/lib/friendlyAgentLastError";
import { useIsManagedAgent } from "@/features/agent-memory/hooks";
import { MemorySection } from "@/features/agent-memory/ui/MemorySection";
import { useActiveAgentTurns } from "@/features/agents/activeAgentTurnsStore";
import { runtimeForAgent } from "@/features/agents/agentDirectoryModel";
import {
  useAcpRuntimesQuery,
  useAgentConfigSurface,
  useRelayAgentsQuery,
  useUpdateManagedAgentMutation,
} from "@/features/agents/hooks";
import { useChannelsQuery } from "@/features/channels/hooks";
import { ManagedAgentSessionPanel } from "@/features/agents/ui/ManagedAgentSessionPanel";
import { AgentConfigPanel } from "@/features/agents/ui/AgentConfigPanel";
import { ArchiveConfirmDialog } from "@/features/profile/ui/ArchiveConfirmDialog";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { AgentPersona, ManagedAgent } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { SectionHeader } from "@/shared/ui/PageHeader";
import { PanelSectionGroup } from "@/shared/ui/PanelSectionGroup";
import { Badge } from "@/shared/ui/badge";
import { providerDisplayLabel } from "./agentConfigOptions";

export type AgentProfileTab =
  | "overview"
  | "model-runtime"
  | "instructions"
  | "tools-access"
  | "activity"
  | "advanced"
  | "memory";

const PROFILE_TABS: Array<{ id: AgentProfileTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "model-runtime", label: "Model & runtime" },
  { id: "instructions", label: "Instructions" },
  { id: "tools-access", label: "Tools & access" },
  { id: "activity", label: "Activity" },
  { id: "advanced", label: "Advanced" },
  { id: "memory", label: "Memory" },
];

const PROFILE_TAB_ICONS: Record<AgentProfileTab, typeof Users> = {
  overview: Users,
  "model-runtime": Settings,
  instructions: FileText,
  "tools-access": LockKeyhole,
  activity: Clock3,
  advanced: List,
  memory: BookOpen,
};

export function parseAgentProfileTab(
  value: string | null | undefined,
): AgentProfileTab {
  return PROFILE_TABS.some((tab) => tab.id === value)
    ? (value as AgentProfileTab)
    : "overview";
}

export function AgentProfileView({
  agent,
  personas,
  tab,
  onTabChange,
  onBack,
  onMessage,
  onOpenChannel,
  onRestartAgent,
  onStopAgent,
  isActionPending,
}: {
  agent: ManagedAgent;
  personas: readonly AgentPersona[];
  tab: AgentProfileTab;
  onTabChange: (tab: AgentProfileTab) => void;
  onBack: () => void;
  onMessage: (pubkey: string) => Promise<void>;
  onOpenChannel: (channelId: string) => void;
  onRestartAgent: (pubkey: string) => void;
  onStopAgent: (pubkey: string) => void;
  isActionPending: boolean;
}) {
  const runtimesQuery = useAcpRuntimesQuery({ enabled: true });
  const runtimeConfigQuery = useAgentConfigSurface(
    tab === "model-runtime" ? agent.pubkey : null,
  );
  const channelsQuery = useChannelsQuery({
    enabled: tab === "activity" || tab === "overview",
  });
  const relayAgentsQuery = useRelayAgentsQuery({
    enabled: tab === "activity" || tab === "overview",
  });
  const activeTurns = useActiveAgentTurns(agent.pubkey);
  const managedOwner = useIsManagedAgent(agent.pubkey);
  const identity = useIdentityQuery();
  const profileQuery = useUserProfileQuery(agent.pubkey);
  const ownerProfileQuery = useUserProfileQuery(
    profileQuery.data?.ownerPubkey ?? undefined,
  );
  const refreshedSummaryPubkey = React.useRef<string | null>(null);
  const archive = useIdentityArchive(agent.pubkey);
  const [archiveDialogOpen, setArchiveDialogOpen] = React.useState(false);
  const [isOpeningMessage, setIsOpeningMessage] = React.useState(false);
  const [messageError, setMessageError] = React.useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = React.useState<
    string | null
  >(null);

  const runtimes = runtimesQuery.data ?? [];
  const runtime = runtimeForAgent(agent, runtimes);
  const linkedPersona = personas.find(
    (persona) => persona.id === agent.personaId,
  );
  const activeChannelIds = activeTurns.map((turn) => turn.channelId);
  const relayAgent = relayAgentsQuery.data?.find(
    (candidate) =>
      candidate.pubkey.toLowerCase() === agent.pubkey.toLowerCase(),
  );
  const channelIds = Array.from(
    new Set([...(relayAgent?.channelIds ?? []), ...activeChannelIds]),
  );
  const channelOptions = channelIds.map((channelId) => ({
    id: channelId,
    name:
      channelsQuery.data?.find((channel) => channel.id === channelId)?.name ??
      channelId.slice(0, 8),
  }));
  const currentChannelId = channelOptions.some(
    (channel) => channel.id === selectedChannelId,
  )
    ? selectedChannelId
    : (activeChannelIds[0] ?? channelOptions[0]?.id ?? null);
  const viewerIsOwner =
    managedOwner === true ||
    ownsAuthorAgent(profileQuery.data, identity.data?.pubkey);
  const role = profileQuery.data?.about?.trim() || null;
  const ownerName = ownerProfileQuery.data?.displayName?.trim() || null;
  const description = linkedPersona?.description?.trim() || null;
  const presenceLabel =
    relayAgent?.status === "online"
      ? "Online"
      : relayAgent?.status === "away"
        ? "Away"
        : relayAgent?.status === "offline"
          ? "Offline"
          : "Unknown";

  React.useEffect(() => {
    const pubkey = agent.pubkey.toLowerCase();
    if (
      profileQuery.data?.hasProfileEvent !== false ||
      refreshedSummaryPubkey.current === pubkey
    ) {
      return;
    }

    refreshedSummaryPubkey.current = pubkey;
    void profileQuery.refetch();
  }, [agent.pubkey, profileQuery.data?.hasProfileEvent, profileQuery.refetch]);

  const profileStatus =
    activeTurns.length > 0
      ? "Working"
      : agent.status === "running" || agent.status === "deployed"
        ? "Idle"
        : agent.status === "not_deployed"
          ? "Not deployed"
          : agent.status;
  const canStop = agent.status === "running" || agent.status === "deployed";

  async function openMessage() {
    setIsOpeningMessage(true);
    setMessageError(null);
    try {
      await onMessage(agent.pubkey);
    } catch (error) {
      setMessageError(
        error instanceof Error ? error.message : "Could not open a message.",
      );
    } finally {
      setIsOpeningMessage(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="agent-profile">
      <header className="border-b border-border/60">
        <div className="flex min-h-[5.5rem] flex-wrap items-center justify-between gap-4 px-[1.875rem] py-[1.4375rem]">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              aria-label="Back to directory"
              className="size-7 shrink-0"
              onClick={onBack}
              size="icon"
              type="button"
              variant="ghost"
            >
              <ArrowLeft aria-hidden="true" className="size-3.5" />
            </Button>
            {agent.avatarUrl ? (
              <img
                alt=""
                aria-hidden="true"
                className="size-[2.6875rem] shrink-0 rounded-xl object-cover"
                src={agent.avatarUrl}
              />
            ) : (
              <div
                aria-hidden="true"
                className="flex size-[2.6875rem] shrink-0 items-center justify-center rounded-xl bg-muted text-lg font-medium text-muted-foreground"
              >
                {(agent.name || "?").slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold leading-tight tracking-tight text-foreground">
                {agent.name || "Unnamed agent"}
              </h1>
              {role || ownerName ? (
                <p className="truncate text-xs text-muted-foreground">
                  {role}
                  {role && ownerName ? " · " : ""}
                  {ownerName}
                </p>
              ) : null}
            </div>
            <Badge
              className="ml-1 shrink-0 rounded-[5px] border border-[#dce9df] bg-[#edf4ef] px-2 py-0.5 text-2xs font-medium normal-case tracking-normal text-[#507d69] dark:border-[#3c5445] dark:bg-[#25392e] dark:text-[#9ebda8]"
              variant={profileStatus === "Working" ? "default" : "success"}
            >
              {profileStatus}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button
              className="h-7 px-2.5 text-xs"
              disabled={isOpeningMessage}
              onClick={() => void openMessage()}
              size="sm"
              type="button"
              variant="outline"
            >
              <MessageSquare aria-hidden="true" className="size-3.5" />
              {isOpeningMessage ? "Opening…" : "Message"}
            </Button>
            <Button
              className="h-7 px-2.5 text-xs"
              disabled={!canStop || isActionPending}
              onClick={() => onStopAgent(agent.pubkey)}
              size="sm"
              type="button"
              variant="outline"
            >
              <Square aria-hidden="true" className="size-3.5" />
              Stop agent
            </Button>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="More agent actions"
                  className="size-7"
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Ellipsis aria-hidden="true" className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {archive.canArchive && archive.isArchived !== undefined ? (
                  <DropdownMenuItem
                    disabled={archive.isPending}
                    onSelect={() =>
                      archive.isArchived
                        ? void archive.unarchive()
                        : setArchiveDialogOpen(true)
                    }
                  >
                    {archive.isArchived ? (
                      <ArchiveRestore aria-hidden="true" />
                    ) : (
                      <Archive aria-hidden="true" />
                    )}
                    {archive.isArchived ? "Unarchive agent" : "Archive agent"}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {messageError ? (
          <p
            className="px-5 pb-3 text-sm text-destructive sm:px-8"
            role="alert"
          >
            {messageError}
          </p>
        ) : null}
      </header>

      {agent.needsRestart ? (
        <div className="flex items-center gap-2 border-b border-border/60 bg-primary/10 px-8 py-2.5 text-sm text-primary">
          <span>Saved changes apply on the next start.</span>
          {agent.backend.type === "local" ? (
            <Button
              className="ml-auto h-auto px-0 text-sm"
              disabled={isActionPending}
              onClick={() => onRestartAgent(agent.pubkey)}
              size="sm"
              type="button"
              variant="link"
            >
              Restart agent
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[11.875rem_minmax(0,1fr)]">
        <nav
          aria-label="Agent profile sections"
          className="flex flex-col border-b border-border/60 p-3 md:border-b-0 md:border-r md:px-3.5 md:pb-5 md:pt-[1.875rem]"
        >
          <div className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
            {PROFILE_TABS.map((profileTab) => {
              const Icon = PROFILE_TAB_ICONS[profileTab.id];
              return (
                <button
                  aria-current={tab === profileTab.id ? "page" : undefined}
                  className={`flex shrink-0 items-center gap-2.5 rounded-md px-[0.8125rem] py-2.5 text-left text-xs transition-colors md:w-full ${
                    tab === profileTab.id
                      ? "bg-[#e7f0fe] font-medium text-[#2655a0] dark:bg-[#2b3547] dark:text-[#adbfdf]"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                  }`}
                  key={profileTab.id}
                  onClick={() => onTabChange(profileTab.id)}
                  type="button"
                >
                  <Icon aria-hidden="true" className="size-4 shrink-0" />
                  {profileTab.label}
                </button>
              );
            })}
          </div>
          <div className="mt-auto hidden px-[0.8125rem] pb-0 pt-[1.375rem] text-2xs text-muted-foreground md:block">
            <p>
              {agent.backend.type === "local"
                ? "Managed on this Mac"
                : "Not managed on this device"}
            </p>
            <p className="mt-2">Presence: {presenceLabel}</p>
          </div>
        </nav>
        <main
          className="min-h-0 min-w-0 overflow-y-auto p-5 sm:p-8 lg:px-[2.375rem] lg:py-[1.875rem]"
          data-testid="agent-profile-content"
        >
          <div className="max-w-[58.75rem]">
            {tab === "overview" ? (
              <OverviewTab
                agent={agent}
                activeTurns={activeTurns}
                channelOptions={channelOptions}
                channelsLoading={
                  channelsQuery.isLoading || relayAgentsQuery.isLoading
                }
                channelError={
                  channelsQuery.error instanceof Error
                    ? channelsQuery.error
                    : relayAgentsQuery.error instanceof Error
                      ? relayAgentsQuery.error
                      : null
                }
                description={description}
                harnessLabel={runtime?.label ?? "Not reported"}
                onOpenChannel={onOpenChannel}
                onTabChange={onTabChange}
                providerLabel={
                  agent.provider
                    ? providerDisplayLabel(agent.provider)
                    : "Not reported"
                }
              />
            ) : null}
            {tab === "model-runtime" ? (
              <ModelRuntimeTab
                agent={agent}
                runtimeLabel={runtime?.label ?? "Not reported"}
                runtimeAvailability={
                  runtimesQuery.isLoading
                    ? "loading"
                    : runtimesQuery.isError
                      ? "error"
                      : runtime
                        ? runtime.availability
                        : "unknown"
                }
                authStatus={runtime?.authStatus.status ?? "unknown"}
                runtimeConfig={runtimeConfigQuery.data}
                isLoading={runtimeConfigQuery.isLoading}
                error={
                  runtimeConfigQuery.error instanceof Error
                    ? runtimeConfigQuery.error
                    : null
                }
              />
            ) : null}
            {tab === "instructions" ? (
              <InstructionsTab
                agent={agent}
                canEdit={agent.personaId === null}
                instruction={
                  agent.systemPrompt ?? linkedPersona?.systemPrompt ?? null
                }
                ownerName={ownerName}
                key={agent.pubkey}
              />
            ) : null}
            {tab === "tools-access" ? <ToolsAccessTab agent={agent} /> : null}
            {tab === "activity" ? (
              <ActivityTab
                agent={agent}
                activeChannelIds={activeChannelIds}
                channelOptions={channelOptions}
                currentChannelId={currentChannelId}
                isLoading={
                  channelsQuery.isLoading || relayAgentsQuery.isLoading
                }
                onChannelChange={setSelectedChannelId}
              />
            ) : null}
            {tab === "advanced" ? (
              <AdvancedTab
                agent={agent}
                runtimeLabel={runtime?.label ?? "Not reported"}
              />
            ) : null}
            {tab === "memory" ? (
              <MemoryTab
                agentPubkey={agent.pubkey}
                isOwner={viewerIsOwner}
                isOwnerLoading={
                  managedOwner === undefined && profileQuery.isLoading
                }
              />
            ) : null}
          </div>
        </main>
      </div>

      <ArchiveConfirmDialog
        isBot
        isPending={archive.isPending}
        onConfirm={archive.archive}
        onOpenChange={setArchiveDialogOpen}
        open={archiveDialogOpen}
      />
    </div>
  );
}

function OverviewTab({
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

function ModelRuntimeTab({
  agent,
  runtimeLabel,
  runtimeAvailability,
  authStatus,
  runtimeConfig,
  isLoading,
  error,
}: {
  agent: ManagedAgent;
  runtimeLabel: string;
  runtimeAvailability: string;
  authStatus: string;
  runtimeConfig: ReturnType<typeof useAgentConfigSurface>["data"];
  isLoading: boolean;
  error: Error | null;
}) {
  const effectiveModel = runtimeConfig?.normalized.model?.value?.trim() || null;
  const effectiveProvider =
    runtimeConfig?.normalized.provider?.value?.trim() || null;
  const isObservedConfig =
    runtimeConfig !== undefined && !runtimeConfig.isPreSpawn;
  const requestedSource =
    agent.modelSource === "definition"
      ? "Agent definition"
      : agent.modelSource === "global"
        ? "Global defaults"
        : agent.modelSource === "instance_legacy"
          ? "Agent record"
          : "Not reported";

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <PanelSectionGroup title="Model selection">
        <InfoRow
          label="Requested model"
          value={agent.model ?? "Not reported"}
        />
        <InfoRow label="Requested value source" value={requestedSource} />
        <InfoRow
          label="Effective model"
          value={
            isLoading
              ? "Loading"
              : isObservedConfig && effectiveModel
                ? effectiveModel
                : "Not reported"
          }
        />
        <InfoRow
          label="Effective provider"
          value={
            isLoading
              ? "Loading"
              : isObservedConfig && effectiveProvider
                ? providerDisplayLabel(effectiveProvider)
                : "Not reported"
          }
        />
        {error ? (
          <p className="px-4 py-3 text-sm text-destructive" role="alert">
            {error.message}
          </p>
        ) : null}
        {runtimeConfig?.isPreSpawn ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            The agent has not reported an effective model for a running session.
          </p>
        ) : null}
      </PanelSectionGroup>
      <PanelSectionGroup title="Harness and account">
        <InfoRow label="Harness" value={runtimeLabel} />
        <InfoRow label="Harness availability" value={runtimeAvailability} />
        <InfoRow
          label="Harness authentication"
          value={authStatusLabel(authStatus)}
        />
        <InfoRow
          label="Provider route"
          value={
            agent.provider
              ? providerDisplayLabel(agent.provider)
              : "Not reported"
          }
        />
        <p className="px-4 py-3 text-sm text-muted-foreground">
          Harness authentication and provider funding are separate. The
          available runtime data does not report a credit balance or
          subscription allowance.
        </p>
      </PanelSectionGroup>
      <div className="lg:col-span-2">
        <PanelSectionGroup title="Reported runtime values">
          <InfoRow
            label="Thinking effort"
            value={reportedValue(
              runtimeConfig,
              "thinkingEffort",
              isObservedConfig,
              isLoading,
            )}
          />
          <InfoRow
            label="Maximum output tokens"
            value={reportedValue(
              runtimeConfig,
              "maxOutputTokens",
              isObservedConfig,
              isLoading,
            )}
          />
          <InfoRow
            label="Context limit"
            value={reportedValue(
              runtimeConfig,
              "contextLimit",
              isObservedConfig,
              isLoading,
            )}
          />
        </PanelSectionGroup>
      </div>
    </div>
  );
}

function InstructionsTab({
  agent,
  canEdit,
  instruction,
  ownerName,
}: {
  agent: ManagedAgent;
  canEdit: boolean;
  instruction: string | null;
  ownerName: string | null;
}) {
  const updateMutation = useUpdateManagedAgentMutation();
  const [draft, setDraft] = React.useState(instruction ?? "");
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const content = instruction?.trim();
  const isDirty = draft !== (instruction ?? "");

  React.useEffect(() => {
    setDraft(instruction ?? "");
    setSaveError(null);
  }, [instruction]);

  if (!canEdit) {
    return (
      <div className="space-y-4" data-testid="agent-instructions">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight">
            System instructions
          </h2>
          <span className="text-2xs text-muted-foreground">
            Version 1{ownerName ? ` · ${ownerName}` : ""}
          </span>
        </div>
        <div className="rounded-xl border border-border/60 bg-muted/20 p-5">
          {content ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6 text-foreground">
              {instruction}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">
              System instructions have not been shared by the owner.
            </p>
          )}
        </div>
      </div>
    );
  }

  async function saveInstructions() {
    if (!isDirty || updateMutation.isPending) return;
    setSaveError(null);
    try {
      await updateMutation.mutateAsync({
        pubkey: agent.pubkey,
        systemPrompt: draft,
      });
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Could not save instructions.",
      );
    }
  }

  return (
    <div data-testid="agent-instructions">
      <div className="mb-5 flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold tracking-tight">
          System instructions
        </h2>
        <span className="text-2xs text-muted-foreground">
          Version 1{ownerName ? ` · ${ownerName}` : ""}
        </span>
      </div>
      <p className="mb-[1.6875rem] text-xs leading-[1.7] text-muted-foreground">
        The instructions this agent receives. Review and edit the exact text.
      </p>
      <textarea
        aria-label="System instructions"
        className="min-h-[26.25rem] w-full resize-y rounded-lg border border-border bg-muted p-[1.375rem] text-sm leading-[1.85] text-foreground outline-none"
        data-testid="agent-system-instructions"
        onChange={(event) => setDraft(event.currentTarget.value)}
        spellCheck={false}
        value={draft}
      />
      <div className="mt-4 flex items-center gap-2 text-2xs text-muted-foreground">
        <BookOpen aria-hidden="true" className="size-3.5 shrink-0" />
        <span>Business knowledge remains a separate, shared reference.</span>
        <Button
          className="ml-auto h-auto px-0 text-2xs text-[#2655a0] disabled:opacity-100 dark:text-[#adbfdf]"
          disabled
          size="sm"
          type="button"
          variant="link"
        >
          View brand guide
        </Button>
      </div>
      {saveError ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {saveError}
        </p>
      ) : null}
      <div className="mt-[2.0625rem] flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
        <p className="text-2xs text-muted-foreground">
          Changes apply after Save and the next start.
        </p>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              setDraft(instruction ?? "");
              setSaveError(null);
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={!isDirty || updateMutation.isPending}
            onClick={() => void saveInstructions()}
            size="sm"
            type="button"
          >
            {updateMutation.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ToolsAccessTab({ agent }: { agent: ManagedAgent }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.8fr)]">
      <AgentConfigPanel
        advancedMode="flat"
        pubkey={agent.pubkey}
        sections={["mcp"]}
      />
      <PanelSectionGroup title="Who can send instructions">
        <InfoRow label="Access" value={accessLabel(agent.respondTo)} />
        {agent.respondTo === "allowlist" ? (
          <InfoRow
            label="Selected people"
            value={`${agent.respondToAllowlist.length}`}
          />
        ) : null}
        <InfoRow
          label="Conversation scope"
          value={agent.sessionPolicy === "thread" ? "Thread" : "Channel"}
        />
        <p className="px-4 py-3 text-sm text-muted-foreground">
          Tool availability comes from the configured harness and its reported
          MCP servers.
        </p>
      </PanelSectionGroup>
    </div>
  );
}

function ActivityTab({
  agent,
  activeChannelIds,
  channelOptions,
  currentChannelId,
  isLoading,
  onChannelChange,
}: {
  agent: ManagedAgent;
  activeChannelIds: string[];
  channelOptions: Array<{ id: string; name: string }>;
  currentChannelId: string | null;
  isLoading: boolean;
  onChannelChange: (channelId: string) => void;
}) {
  return (
    <div className="space-y-4" data-testid="agent-activity">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHeader
          title="Activity"
          description="Channel and thread sessions reported by this agent."
        />
        {channelOptions.length > 0 ? (
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>Channel</span>
            <select
              aria-label="Activity channel"
              className="h-9 max-w-64 rounded-lg border border-input/40 bg-background px-3 text-sm text-foreground"
              onChange={(event) => onChannelChange(event.currentTarget.value)}
              value={currentChannelId ?? ""}
            >
              {channelOptions.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {activeChannelIds.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Working in {activeChannelIds.length} active{" "}
          {activeChannelIds.length === 1 ? "channel" : "channels"}.
        </p>
      ) : null}
      {isLoading ? (
        <p className="py-4 text-sm text-muted-foreground">
          Loading channel history…
        </p>
      ) : currentChannelId ? (
        <ManagedAgentSessionPanel
          agent={agent}
          channelId={currentChannelId}
          emptyDescription="No activity is available for this channel."
          showRaw={false}
        />
      ) : (
        <div className="rounded-xl border border-border/70 bg-background/70 px-5 py-10 text-center">
          <p className="text-sm font-medium">
            No channel activity is available.
          </p>
        </div>
      )}
    </div>
  );
}

function AdvancedTab({
  agent,
  runtimeLabel,
}: {
  agent: ManagedAgent;
  runtimeLabel: string;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <PanelSectionGroup title="Runtime settings">
        <InfoRow label="Harness" value={runtimeLabel} />
        <InfoRow label="Parallelism" value={String(agent.parallelism)} />
        <InfoRow
          label="Turn timeout"
          value={`${agent.turnTimeoutSeconds} seconds`}
        />
        <InfoRow
          label="Idle timeout"
          value={
            agent.idleTimeoutSeconds === null
              ? "Not reported"
              : `${agent.idleTimeoutSeconds} seconds`
          }
        />
        <InfoRow
          label="Maximum turn duration"
          value={
            agent.maxTurnDurationSeconds === null
              ? "Not reported"
              : `${agent.maxTurnDurationSeconds} seconds`
          }
        />
      </PanelSectionGroup>
      <PanelSectionGroup title="Run location">
        <InfoRow
          label="Host type"
          value={
            agent.backend.type === "local" ? "This computer" : "Remote host"
          }
        />
        <InfoRow
          label="Start with desktop"
          value={agent.startOnAppLaunch ? "On" : "Off"}
        />
        <InfoRow
          label="Restart on configuration change"
          value={agent.autoRestartOnConfigChange ? "On" : "Off"}
        />
        <p className="px-4 py-3 text-sm text-muted-foreground">
          Credential values are hidden. This view lists runtime settings only.
        </p>
      </PanelSectionGroup>
    </div>
  );
}

function MemoryTab({
  agentPubkey,
  isOwner,
  isOwnerLoading,
}: {
  agentPubkey: string;
  isOwner: boolean;
  isOwnerLoading: boolean;
}) {
  if (isOwnerLoading) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        Loading memory access…
      </p>
    );
  }
  return (
    <div className="space-y-4" data-testid="agent-profile-memory">
      <SectionHeader
        title="Memory"
        description="Private agent memories available to the owner."
      />
      {isOwner ? (
        <MemorySection
          agentPubkey={agentPubkey}
          variant="grouped"
          viewerIsOwner
        />
      ) : (
        <div className="rounded-xl border border-border/70 bg-background/70 px-5 py-8">
          <p className="text-sm text-muted-foreground">
            Memory is available to the agent owner.
          </p>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className="max-w-[65%] truncate text-right text-sm font-medium text-foreground"
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

function authStatusLabel(status: string) {
  switch (status) {
    case "logged_in":
      return "Signed in";
    case "logged_out":
      return "Sign-in needed";
    case "config_invalid":
      return "Configuration issue";
    case "not_applicable":
      return "Not checked for this harness";
    default:
      return "Unknown";
  }
}

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

function reportedValue(
  config: ReturnType<typeof useAgentConfigSurface>["data"],
  field: "thinkingEffort" | "maxOutputTokens" | "contextLimit",
  isObserved: boolean,
  isLoading: boolean,
) {
  if (isLoading) return "Loading";
  if (!isObserved || !config) return "Not reported";
  return config.normalized[field]?.value?.trim() || "Not reported";
}
