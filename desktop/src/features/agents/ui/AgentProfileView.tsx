import { EmployeeAvatar } from "@/features/company-team/ui/EmployeeAvatar";
import { useEmployeeRuntime } from "@/features/company-team/useEmployeeRuntime";
import * as React from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  BookOpen,
  Ellipsis,
  FileText,
  MessageSquare,
  Square,
  Users,
} from "lucide-react";

import { useUserProfileQuery } from "@/features/profile/hooks";
import { useCompanyTeamQuery } from "@/features/company-team/teamRelay";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { CompanyEmployeeProfileActions } from "@/features/company-team/ui/CompanyEmployeeProfileActions";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { useIdentityArchive } from "@/features/identity-archive/hooks";
import { useActiveAgentTurns } from "@/features/agents/activeAgentTurnsStore";
import { runtimeForAgent } from "@/features/agents/agentDirectoryModel";
import {
  useAcpRuntimesQuery,
  useRelayAgentsQuery,
  useUpdateManagedAgentMutation,
} from "@/features/agents/hooks";
import { useChannelsQuery } from "@/features/channels/hooks";
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
import { Badge } from "@/shared/ui/badge";
import { providerDisplayLabel } from "./agentConfigOptions";
import { OverviewTab } from "./AgentProfileOverviewTab";

export type AgentProfileTab = "overview" | "instructions";

const PROFILE_TABS: Array<{ id: AgentProfileTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "instructions", label: "Instructions" },
];

const PROFILE_TAB_ICONS: Record<AgentProfileTab, typeof Users> = {
  overview: Users,
  instructions: FileText,
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
  const channelsQuery = useChannelsQuery({
    enabled: tab === "overview",
  });
  const relayAgentsQuery = useRelayAgentsQuery({
    enabled: tab === "overview",
  });
  const activeTurns = useActiveAgentTurns(agent.pubkey);
  const identity = useIdentityQuery();
  const profileQuery = useUserProfileQuery(agent.pubkey);
  const companyTeamQuery = useCompanyTeamQuery();
  const { goTeamArchive, goTeamEdit, goTeamMember } = useAppNavigation();
  const companyMember = companyTeamQuery.data?.members.find(
    (member) => member.pubkey.toLowerCase() === agent.pubkey.toLowerCase(),
  );
  const position = companyMember?.position?.head;
  const viewerCompanyRole = companyTeamQuery.data?.relayMembers.find(
    (member) =>
      member.pubkey.toLowerCase() === identity.data?.pubkey.toLowerCase(),
  )?.role;
  const canManageCompany =
    viewerCompanyRole === "owner" || viewerCompanyRole === "admin";
  const managerProfileQuery = useUserProfileQuery(position?.managerPubkey);
  const ownerProfileQuery = useUserProfileQuery(
    profileQuery.data?.ownerPubkey ?? undefined,
  );
  const refreshedSummaryPubkey = React.useRef<string | null>(null);
  const archive = useIdentityArchive(agent.pubkey);
  const [archiveDialogOpen, setArchiveDialogOpen] = React.useState(false);
  const [isOpeningMessage, setIsOpeningMessage] = React.useState(false);
  const [messageError, setMessageError] = React.useState<string | null>(null);

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
  const role = profileQuery.data?.about?.trim() || null;
  const managerName = managerProfileQuery.data?.displayName?.trim() || null;
  const companyPosition = position
    ? `${position.title} · Employee${managerName ? ` · Reports to ${managerName}` : ""}`
    : null;
  const ownerName = ownerProfileQuery.data?.displayName?.trim() || null;
  const description = linkedPersona?.description?.trim() || null;
  const employeeRuntime = useEmployeeRuntime(
    companyMember ?? {
      pubkey: agent.pubkey,
      kind: "employee",
      createdAt: agent.createdAt,
      fallbackName: agent.name,
      role: null,
      managedAgent: agent,
      relayAgent: relayAgent ?? null,
      position: null,
    },
  );
  const presenceLabel = employeeRuntime.label;

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

  const profileStatus = employeeRuntime.label;
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
            <EmployeeAvatar
              name={agent.name}
              profile={profileQuery.data?.avatarUrl}
              instance={agent.avatarUrl}
              definition={
                personas.find((persona) => persona.id === agent.personaId)
                  ?.avatarUrl
              }
              personaId={agent.personaId}
              className="size-[2.6875rem] shrink-0"
              testId="agent-profile-avatar"
            />
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
              {companyPosition ? (
                <p
                  className="truncate text-xs text-muted-foreground"
                  data-testid="company-position-header"
                >
                  {companyPosition}
                </p>
              ) : null}
            </div>
            {position ? (
              <Badge
                className="ml-1 shrink-0 rounded-[5px] border border-border px-2 py-0.5 text-2xs font-medium normal-case tracking-normal"
                variant={position.status === "active" ? "secondary" : "outline"}
              >
                {position.status === "terminated"
                  ? "Archived"
                  : position.status}
              </Badge>
            ) : null}
            <Badge
              className="ml-1 shrink-0 rounded-[5px] px-2 py-0.5 text-2xs font-medium normal-case tracking-normal"
              variant={
                profileStatus === "Ready" || profileStatus === "Working"
                  ? "success"
                  : profileStatus === "Needs attention"
                    ? "warning"
                    : "secondary"
              }
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

      {position?.status === "paused" ? (
        <Alert className="mx-8 mt-4" data-testid="company-paused-banner">
          <AlertTitle>Paused · {position.reason}</AlertTitle>
          <AlertDescription>
            Existing work and history stay visible. Pausing employees is
            unavailable.
          </AlertDescription>
        </Alert>
      ) : null}

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
              <>
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
                  providerLabel={
                    agent.provider
                      ? providerDisplayLabel(agent.provider)
                      : "Not reported"
                  }
                />
                {companyMember?.kind === "employee" ? (
                  <CompanyEmployeeProfileActions
                    canManage={canManageCompany}
                    employeePubkey={agent.pubkey}
                    managerName={managerName}
                    onEdit={() => void goTeamEdit(agent.pubkey)}
                    onOpenReport={(pubkey) => void goTeamMember(pubkey)}
                    onTerminate={() => void goTeamArchive(agent.pubkey)}
                    position={position}
                  />
                ) : null}
              </>
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
