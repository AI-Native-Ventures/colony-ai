import * as React from "react";
import {
  EllipsisVertical,
  OctagonX,
  ArrowRight,
  Plus,
  Sun,
  Settings2,
} from "lucide-react";
import {
  consumePendingSnapshotImport,
  subscribeSnapshotImport,
} from "@/features/agents/openSnapshotImportFromUrlEvent";
import { AddAgentToChannelDialog } from "./AddAgentToChannelDialog";
import { AddTeamToChannelDialog } from "./AddTeamToChannelDialog";
import { AgentDefaultsDialog } from "./AgentDefaultsDialog";
import { AgentDialog } from "./AgentDialog";
import { CommunityCatalogDialog } from "./CommunityCatalogDialog";
import { PersonaDeleteDialog } from "./PersonaDeleteDialog";
import { PersonaShareDialog } from "./PersonaShareDialog";
import { AgentSnapshotExportDialog } from "./AgentSnapshotExportDialog";
import { AgentSnapshotImportDialog } from "./AgentSnapshotImportDialog";
import { TeamSnapshotExportDialog } from "./TeamSnapshotExportDialog";
import { TeamSnapshotImportDialog } from "./TeamSnapshotImportDialog";
import { TeamShareDialog } from "./TeamShareDialog";
import { TeamDeleteDialog } from "./TeamDeleteDialog";
import { TeamDialog } from "./TeamDialog";
import { AgentTeamsReviewView } from "./AgentTeamsReviewView";
import { TeamsSection } from "./TeamsSection";
import { UnifiedAgentsSection } from "./UnifiedAgentsSection";
import { useManagedAgentActions } from "./useManagedAgentActions";
import { usePersonaActions } from "./usePersonaActions";
import { useTeamActions } from "./useTeamActions";
import { useProfilePanel } from "@/shared/context/ProfilePanelContext";
import { useBakedBuildEnvQuery } from "@/features/agents/hooks";
import { useAcpRuntimesQuery } from "@/features/agents/hooks";
import { isManagedAgentActive } from "@/features/agents/lib/managedAgentControlActions";
import { useGlobalAgentConfig } from "@/features/agents/useGlobalAgentConfig";
import { useArchivedIdentitiesQuery } from "@/features/identity-archive/hooks";
import { useActiveAgentTurnsByChannel } from "@/features/agents/activeAgentTurnsStore";
import { AgentDirectory } from "./AgentDirectory";
import { AgentProfileView, type AgentProfileTab } from "./AgentProfileView";
import { parseAgentDirectoryPageSize } from "@/features/agents/agentDirectoryModel";
import { useAppShell } from "@/app/AppShellContext";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  useMyRelayMembershipQuery,
  useRelayMembersQuery,
} from "@/features/community-members/hooks";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { PageHeader } from "@/shared/ui/PageHeader";
import { getInheritedAgentDefaults } from "./bakedEnvHelpers";
import {
  HireBackButton,
  HirePageHeader,
} from "@/features/company-hiring/ui/HirePresentation";

export type AgentWorkspaceView = "directory" | "teams" | "templates";

const AGENT_WORKSPACE_TABS: Array<{ id: AgentWorkspaceView; label: string }> = [
  { id: "directory", label: "Directory" },
  { id: "teams", label: "Agent teams" },
  { id: "templates", label: "Templates & snapshots" },
];

export function AgentsView({
  view,
  agentPubkey,
  agentTab,
  pageSize,
  createRolePack = false,
  editRolePackPersonaId,
  resumeRolePack = false,
  onWorkspaceViewChange,
  onOpenAgent,
  onMessageAgent,
  onOpenChannel,
  onCloseAgent,
  onAgentTabChange,
  onOpenSupervision,
}: {
  view: AgentWorkspaceView;
  agentPubkey?: string;
  agentTab: AgentProfileTab;
  pageSize?: string;
  createRolePack?: boolean;
  editRolePackPersonaId?: string;
  resumeRolePack?: boolean;
  onWorkspaceViewChange: (view: AgentWorkspaceView) => void;
  onOpenAgent: (pubkey: string) => void;
  onMessageAgent: (pubkey: string) => Promise<void>;
  onOpenChannel: (channelId: string) => void;
  onCloseAgent: () => void;
  onAgentTabChange: (tab: AgentProfileTab) => void;
  onOpenSupervision: () => void;
}) {
  const { goHireRoleRecovery, goHireRoles } = useAppNavigation();
  const handleRoleRecovery = React.useCallback(
    (kind: "runtime" | "provider" | "model", draftPersonaId: string) => {
      void goHireRoleRecovery(kind, draftPersonaId);
    },
    [goHireRoleRecovery],
  );
  const { openPersonaProfilePanel, openProfilePanel } = useProfilePanel();
  const { globalConfig } = useGlobalAgentConfig();
  const appShell = useAppShell();
  const { data: bakedEnv } = useBakedBuildEnvQuery({ enabled: true });
  const runtimeCatalogQuery = useAcpRuntimesQuery({ enabled: true });
  const archivedQuery = useArchivedIdentitiesQuery();
  const activeTurnsByChannel = useActiveAgentTurnsByChannel();
  const inheritedDefaults = getInheritedAgentDefaults(globalConfig, bakedEnv);
  const agents = useManagedAgentActions();
  const personas = usePersonaActions();
  const membershipQuery = useMyRelayMembershipQuery();
  const canCurateCompanyRoles =
    membershipQuery.data?.role === "owner" ||
    membershipQuery.data?.role === "admin";
  const teamImportInputRef = React.useRef<HTMLInputElement | null>(null);
  const aiDefaultsTriggerRef = React.useRef<HTMLButtonElement>(null);
  const fullAiDefaultsTriggerRef = React.useRef<HTMLButtonElement>(null);
  const compactActionsTriggerRef = React.useRef<HTMLButtonElement>(null);
  const [isAiDefaultsOpen, setIsAiDefaultsOpen] = React.useState(false);
  const relayMembersQuery = useRelayMembersQuery(view === "directory");

  function openAiDefaults(trigger: HTMLButtonElement | null) {
    aiDefaultsTriggerRef.current = trigger;
    setIsAiDefaultsOpen(true);
  }

  function setAiDefaultsDialogOpen(open: boolean) {
    if (!open) {
      // Return focus to whichever trigger is on screen. The directory header
      // has the inline button; the Templates header only has the actions
      // menu, where the inline ref is null (and `null?.offsetParent !== null`
      // would wrongly pick it and drop focus to the page).
      const inlineTrigger = fullAiDefaultsTriggerRef.current;
      aiDefaultsTriggerRef.current =
        inlineTrigger && inlineTrigger.offsetParent !== null
          ? inlineTrigger
          : compactActionsTriggerRef.current;
    }
    setIsAiDefaultsOpen(open);
  }

  const teamActions = useTeamActions(
    {
      setActionNoticeMessage: agents.setActionNoticeMessage,
      setActionErrorMessage: agents.setActionErrorMessage,
    },
    {
      refetchManagedAgents: agents.refetchManagedAgents,
      refetchRelayAgents: agents.refetchRelayAgents,
    },
  );

  // Parent-owned unified catalog state per Thufir's corrective:
  // - discriminated launch target so both sections refetch on open
  // - one close owner via this boolean
  const [catalogLaunchTarget, setCatalogLaunchTarget] = React.useState<
    "agents" | "teams" | null
  >(null);
  const [catalogLaunchRolePack, setCatalogLaunchRolePack] =
    React.useState(false);
  const pendingRolePackSavedIdRef = React.useRef<string | null>(null);

  function openCommunityCatalog(
    target: "agents" | "teams",
    rolePackMode = false,
  ) {
    personas.clearFeedback("catalog");
    personas.prepareCreate();
    void personas.catalogQuery.refetch();
    void teamActions.catalogQuery.refetch();
    setCatalogLaunchRolePack(rolePackMode);
    pendingRolePackSavedIdRef.current = null;
    setCatalogLaunchTarget(target);
  }

  const didOpenRolePackRef = React.useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the route flag is a one-shot command that must open the catalog once.
  React.useEffect(() => {
    if (!createRolePack) {
      didOpenRolePackRef.current = false;
      return;
    }
    if (didOpenRolePackRef.current || membershipQuery.isPending) return;
    didOpenRolePackRef.current = true;
    if (canCurateCompanyRoles && !membershipQuery.isError) {
      openCommunityCatalog("agents", true);
    }
  }, [
    canCurateCompanyRoles,
    createRolePack,
    membershipQuery.isError,
    membershipQuery.isPending,
  ]);

  const didOpenRolePackEditRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!editRolePackPersonaId) {
      didOpenRolePackEditRef.current = null;
      return;
    }
    if (didOpenRolePackEditRef.current === editRolePackPersonaId) return;
    if (membershipQuery.isPending || personas.personasQuery.isPending) {
      return;
    }
    didOpenRolePackEditRef.current = editRolePackPersonaId;
    if (!canCurateCompanyRoles || membershipQuery.isError) return;
    const persona = (personas.personasQuery.data ?? []).find(
      (candidate) => candidate.id === editRolePackPersonaId,
    );
    if (persona?.companyRole && persona.isActive && !persona.isBuiltIn) {
      personas.openEdit(persona);
    }
  }, [
    canCurateCompanyRoles,
    editRolePackPersonaId,
    membershipQuery.isError,
    membershipQuery.isPending,
    personas.openEdit,
    personas.personasQuery.data,
    personas.personasQuery.isPending,
  ]);

  const isActionPending =
    agents.isPending ||
    personas.isPending ||
    teamActions.createTeamMutation.isPending ||
    teamActions.updateTeamMutation.isPending ||
    teamActions.deleteTeamMutation.isPending;
  const runningAgentCount = agents.managedAgents.filter((agent) =>
    isManagedAgentActive(agent),
  ).length;
  const activePubkeys = React.useMemo(
    () =>
      new Set(
        activeTurnsByChannel.flatMap((turn) =>
          turn.agentPubkeys.map((pubkey) => pubkey.toLowerCase()),
        ),
      ),
    [activeTurnsByChannel],
  );
  const archivedPubkeys = React.useMemo(
    () =>
      new Set(
        (archivedQuery.data?.archived ?? []).map((pubkey) =>
          pubkey.toLowerCase(),
        ),
      ),
    [archivedQuery.data],
  );
  const directoryAgentPubkeys = React.useMemo(
    () =>
      new Set([
        ...agents.managedAgents.map((agent) => agent.pubkey.toLowerCase()),
        ...(agents.relayAgentsQuery.data ?? []).map((agent) =>
          agent.pubkey.toLowerCase(),
        ),
      ]),
    [agents.managedAgents, agents.relayAgentsQuery.data],
  );
  const directoryAgentCount = agents.managedAgents.filter(
    (agent) => !archivedPubkeys.has(agent.pubkey.toLowerCase()),
  ).length;
  const directoryPeopleCount = (relayMembersQuery.data ?? []).filter(
    (member) => !directoryAgentPubkeys.has(member.pubkey.toLowerCase()),
  ).length;
  const selectedAgent = agentPubkey
    ? agents.managedAgents.find(
        (agent) => agent.pubkey.toLowerCase() === agentPubkey.toLowerCase(),
      )
    : undefined;
  const hasSavedAgentDefaults = Boolean(
    globalConfig.preferred_runtime?.trim() ||
      globalConfig.provider?.trim() ||
      globalConfig.model?.trim() ||
      Object.values(globalConfig.env_vars).some(
        (value) => value.trim().length > 0,
      ),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only; personas.handleImportSnapshotFile and teamActions.handleImportTeamSnapshotFile are stable
  React.useEffect(() => {
    // Consume a snapshot import that was enqueued before navigation (e.g. from
    // a timeline AgentSnapshotCard click that navigated here).
    const pending = consumePendingSnapshotImport();
    if (pending) {
      if (pending.snapshotKind === "team") {
        void teamActions.handleImportTeamSnapshotFile(
          pending.fileBytes,
          pending.fileName,
        );
      } else {
        void personas.handleImportSnapshotFile(
          pending.fileBytes,
          pending.fileName,
        );
      }
    }

    return subscribeSnapshotImport(({ fileBytes, fileName, snapshotKind }) => {
      if (snapshotKind === "team") {
        void teamActions.handleImportTeamSnapshotFile(fileBytes, fileName);
      } else {
        void personas.handleImportSnapshotFile(fileBytes, fileName);
      }
    });
  }, []);

  const personaDialogState = personas.personaDialogState;
  const rolePackEditMode = Boolean(
    personaDialogState?.initialValues.companyRole && canCurateCompanyRoles,
  );
  const showRolePackPage = catalogLaunchRolePack || rolePackEditMode;
  const personaDefinitionDialog = personaDialogState ? (
    <AgentDialog
      companyRoleMode={Boolean(
        personaDialogState.initialValues.companyRole && canCurateCompanyRoles,
      )}
      embedded={rolePackEditMode}
      onRoleRecovery={handleRoleRecovery}
      suppressRoleRecovery={resumeRolePack}
      description={
        personaDialogState.initialValues.companyRole && canCurateCompanyRoles
          ? "Define the job, skills, scoped tools and allowed worker menu."
          : personaDialogState.description
      }
      error={
        personas.updatePersonaMutation.error instanceof Error
          ? personas.updatePersonaMutation.error
          : personas.updatePersonaAndPublishMutation.error instanceof Error
            ? personas.updatePersonaAndPublishMutation.error
            : personas.createPersonaMutation.error instanceof Error
              ? personas.createPersonaMutation.error
              : null
      }
      initialValues={personaDialogState.initialValues}
      isPending={personas.isPending}
      mode="definition-edit"
      onSavedPersona={(persona) => {
        if (persona.companyRole) void goHireRoles(persona.id);
      }}
      runtimes={personas.acpRuntimesQuery.data ?? []}
      runtimeCatalogStatus={
        personas.acpRuntimesQuery.isLoading
          ? "loading"
          : personas.acpRuntimesQuery.isError
            ? "error"
            : "ready"
      }
      onOpenChange={(open) => {
        if (!open) {
          const isRolePack = Boolean(
            personaDialogState.initialValues.companyRole,
          );
          personas.setPersonaDialogState(null);
          if (isRolePack) void goHireRoles();
        }
      }}
      onSubmit={(input, options, onSavedPersona) =>
        personas.handleSubmit(
          input,
          undefined,
          undefined,
          undefined,
          options,
          onSavedPersona,
        )
      }
      open
      publishCatalogUpdatesOnSave={
        "id" in personaDialogState.initialValues &&
        personas.sharedCatalogPersonaIdSet.has(
          personaDialogState.initialValues.id,
        )
      }
      submitLabel={
        personaDialogState.initialValues.companyRole && canCurateCompanyRoles
          ? "Save role pack"
          : personaDialogState.submitLabel
      }
      title={
        personaDialogState.initialValues.companyRole && canCurateCompanyRoles
          ? "Edit a role pack"
          : personaDialogState.title
      }
    />
  ) : null;

  return (
    <>
      <div
        className={`flex-1 overflow-y-auto overflow-x-hidden overscroll-contain ${selectedAgent || view === "directory" ? "" : "px-4 py-7 sm:px-6 sm:py-8"}`}
        style={showRolePackPage ? { display: "none" } : undefined}
      >
        <div
          className={`mx-auto w-full ${selectedAgent ? "h-full min-h-0 max-w-none" : view === "directory" ? "flex h-full min-h-0 max-w-none flex-col" : "max-w-6xl space-y-8 [container-type:inline-size]"}`}
          data-testid="agents-page-content"
        >
          {selectedAgent ? (
            <AgentProfileView
              agent={selectedAgent}
              isActionPending={isActionPending}
              onBack={onCloseAgent}
              onMessage={onMessageAgent}
              onOpenChannel={onOpenChannel}
              onOpenHarnesses={() => appShell.onOpenSettings?.("agents")}
              onRestartAgent={(pubkey) => void agents.handleRestart(pubkey)}
              onStopAgent={(pubkey) => void agents.handleStop(pubkey)}
              onTabChange={onAgentTabChange}
              personas={personas.personasQuery.data ?? []}
              tab={agentTab}
            />
          ) : agentPubkey && agents.managedAgentsQuery.isLoading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Loading agent…
            </p>
          ) : agentPubkey ? (
            <div className="space-y-4 py-10 text-center">
              <p className="text-sm font-medium">Agent not found.</p>
              <Button
                onClick={onCloseAgent}
                size="sm"
                type="button"
                variant="outline"
              >
                Back to directory
              </Button>
            </div>
          ) : (
            <>
              {view === "directory" ? (
                <header className="flex flex-wrap items-center justify-between gap-4 px-7 pb-4 pt-5">
                  <div>
                    <h1 className="text-2xl font-semibold leading-tight tracking-tight text-foreground">
                      Your team
                    </h1>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {directoryAgentCount} agents · {directoryPeopleCount}{" "}
                      {directoryPeopleCount === 1 ? "person" : "people"}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Button
                      className="h-7 px-2.5 text-xs"
                      data-testid="agent-defaults-button"
                      onClick={(event) => openAiDefaults(event.currentTarget)}
                      ref={fullAiDefaultsTriggerRef}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Sun aria-hidden="true" className="size-3.5" />
                      {hasSavedAgentDefaults
                        ? "Agent defaults"
                        : "Set agent defaults"}
                    </Button>
                    <Button
                      className="h-7 px-2.5 text-xs"
                      onClick={() =>
                        appShell.onOpenSettings?.("community-members")
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Invite a person
                    </Button>
                    <Button
                      className="h-7 px-2.5 text-xs"
                      data-testid="agent-add-button"
                      onClick={() => openCommunityCatalog("agents")}
                      size="sm"
                      type="button"
                    >
                      <Plus aria-hidden="true" className="size-3.5" />
                      Add agent
                    </Button>
                  </div>
                </header>
              ) : (
                <PageHeader
                  action={
                    view === "teams" ? (
                      <Button
                        onClick={teamActions.openCreateDialog}
                        size="sm"
                        type="button"
                      >
                        Create team
                      </Button>
                    ) : (
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          onClick={() =>
                            appShell.onOpenSettings?.("community-members")
                          }
                          size="sm"
                          variant="outline"
                        >
                          Invite a person
                        </Button>
                        <Button
                          data-testid="agent-add-button"
                          onClick={() => openCommunityCatalog("agents")}
                          size="sm"
                        >
                          Add agent
                        </Button>
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <Button
                              aria-label="Agent actions"
                              data-testid="agent-actions-menu-trigger"
                              ref={compactActionsTriggerRef}
                              size="icon"
                              type="button"
                              variant="outline"
                            >
                              <EllipsisVertical />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() =>
                                openAiDefaults(compactActionsTriggerRef.current)
                              }
                            >
                              <Settings2 />
                              {hasSavedAgentDefaults
                                ? "Agent defaults"
                                : "Set agent defaults"}
                            </DropdownMenuItem>
                            {runningAgentCount > 0 ? (
                              <DropdownMenuItem
                                disabled={isActionPending}
                                onSelect={() =>
                                  void agents.handleBulkStopRunning()
                                }
                              >
                                <OctagonX />
                                Stop running agents
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    )
                  }
                  description={
                    view === "teams"
                      ? undefined
                      : `${agents.managedAgents.length} agents`
                  }
                  title={
                    view === "teams" ? "Agent teams" : "Templates & snapshots"
                  }
                />
              )}
              {view === "directory" ? (
                <nav
                  aria-label="Team views"
                  className="flex items-center gap-6 border-b border-border/60 px-7 pt-2.5"
                >
                  <button
                    aria-current="page"
                    className="border-b-2 border-[#2655a0] px-1 pb-2.5 text-sm font-medium text-foreground dark:border-[#adbfdf]"
                    type="button"
                  >
                    Agents
                  </button>
                  <button
                    className="border-b-2 border-transparent px-1 pb-2.5 text-sm font-medium text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      appShell.onOpenSettings?.("community-members")
                    }
                    type="button"
                  >
                    People
                  </button>
                  <button
                    className="border-b-2 border-transparent px-1 pb-2.5 text-sm font-medium text-muted-foreground hover:text-foreground"
                    onClick={() => onWorkspaceViewChange("templates")}
                    type="button"
                  >
                    Templates
                  </button>
                  <button
                    className="ml-auto inline-flex items-center gap-1 border-b-2 border-transparent px-1 pb-2.5 text-sm font-medium text-muted-foreground hover:text-foreground"
                    onClick={() => appShell.onOpenSettings?.("agents")}
                    type="button"
                  >
                    Harnesses &amp; connections
                    <ArrowRight aria-hidden="true" className="size-3.5" />
                  </button>
                </nav>
              ) : (
                <nav
                  aria-label="Agent workspace sections"
                  className="overflow-x-auto border-b border-border/60"
                >
                  <div className="flex min-w-max gap-5">
                    <button
                      className="border-b-2 border-transparent px-1 pb-3 text-sm font-medium text-muted-foreground hover:text-foreground"
                      onClick={onOpenSupervision}
                      type="button"
                    >
                      Runs
                    </button>
                    {AGENT_WORKSPACE_TABS.map((tab) => (
                      <button
                        aria-current={view === tab.id ? "page" : undefined}
                        className={`border-b-2 px-1 pb-3 text-sm font-medium ${view === tab.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                        key={tab.id}
                        onClick={() => onWorkspaceViewChange(tab.id)}
                        type="button"
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </nav>
              )}
              {view === "directory" ? (
                <AgentDirectory
                  activePubkeys={activePubkeys}
                  agents={agents.managedAgents}
                  archivedPubkeys={archivedPubkeys}
                  archiveError={
                    archivedQuery.error instanceof Error
                      ? archivedQuery.error
                      : null
                  }
                  catalogError={
                    runtimeCatalogQuery.error instanceof Error
                      ? runtimeCatalogQuery.error
                      : null
                  }
                  error={
                    agents.managedAgentsQuery.error instanceof Error
                      ? agents.managedAgentsQuery.error
                      : null
                  }
                  isLoading={
                    agents.managedAgentsQuery.isLoading ||
                    runtimeCatalogQuery.isLoading ||
                    relayMembersQuery.isLoading
                  }
                  onOpenAgent={(agent) => onOpenAgent(agent.pubkey)}
                  onMessageAgent={(pubkey) => void onMessageAgent(pubkey)}
                  pageSize={parseAgentDirectoryPageSize(pageSize)}
                  runtimes={runtimeCatalogQuery.data ?? []}
                />
              ) : null}
              {view === "teams" ? (
                <AgentTeamsReviewView
                  agents={agents.managedAgents}
                  error={
                    teamActions.teamsQuery.error instanceof Error
                      ? teamActions.teamsQuery.error
                      : null
                  }
                  isLoading={teamActions.teamsQuery.isLoading}
                  isPending={
                    teamActions.createTeamMutation.isPending ||
                    teamActions.updateTeamMutation.isPending ||
                    teamActions.deleteTeamMutation.isPending
                  }
                  onEdit={teamActions.openEditDialog}
                  onOpenAgent={(agent) => onOpenAgent(agent.pubkey)}
                  onOpenPersona={(persona) =>
                    openPersonaProfilePanel?.(persona)
                  }
                  onReviewDeployment={teamActions.setTeamToAddToChannel}
                  personas={personas.personasQuery.data ?? []}
                  teams={teamActions.teams}
                />
              ) : null}
              {view === "templates" ? (
                <div className="flex flex-col gap-8">
                  <UnifiedAgentsSection
                    getAvailability={agents.getAvailability}
                    defaultModel={inheritedDefaults.model.value}
                    actionErrorMessage={agents.actionErrorMessage}
                    actionNoticeMessage={agents.actionNoticeMessage}
                    agents={agents.managedAgents}
                    agentsError={
                      agents.managedAgentsQuery.error instanceof Error
                        ? agents.managedAgentsQuery.error
                        : null
                    }
                    isActionPending={isActionPending}
                    isAgentsLoading={agents.managedAgentsQuery.isLoading}
                    startingAgentPubkey={agents.startingAgentPubkey}
                    restartingAgentPubkey={agents.restartingAgentPubkey}
                    startingPersonaIds={agents.startingPersonaIds}
                    onOpenAgentProfile={(pubkey, options) => {
                      openProfilePanel?.(pubkey, options);
                    }}
                    onOpenPersonaProfile={(persona) => {
                      openPersonaProfilePanel?.(persona);
                    }}
                    onStartAgent={(pubkey) => {
                      void agents.handleStart(pubkey);
                    }}
                    onRestartAgent={(pubkey) => {
                      void agents.handleRestart(pubkey);
                    }}
                    onStartPersona={(persona) => {
                      void agents.handleStartPersona(persona);
                    }}
                    // Persona props
                    personas={personas.libraryPersonas}
                    personasError={
                      personas.personasQuery.error instanceof Error
                        ? personas.personasQuery.error
                        : null
                    }
                    personaFeedbackErrorMessage={
                      personas.personaFeedbackSurface === "library"
                        ? personas.personaErrorMessage
                        : null
                    }
                    personaFeedbackNoticeMessage={
                      personas.personaFeedbackSurface === "library"
                        ? personas.personaNoticeMessage
                        : null
                    }
                    isPersonasLoading={personas.personasQuery.isLoading}
                    isPersonasPending={personas.isPending}
                    onOpenCatalog={() => openCommunityCatalog("agents")}
                    onDuplicatePersona={personas.openDuplicate}
                    onEditPersona={personas.openEdit}
                    onSharePersona={personas.openShare}
                    onDeactivatePersona={(persona) => {
                      void personas.handleSetActive(persona, false, "library");
                    }}
                    onDeletePersona={personas.openDelete}
                  />

                  {/* Team templates keep create, import, share, catalog,
                      duplicate and delete until the company-layer design
                      (r21) gives teams their own home. */}
                  <TeamsSection
                    error={
                      teamActions.teamsQuery.error instanceof Error
                        ? teamActions.teamsQuery.error
                        : null
                    }
                    isLoading={teamActions.teamsQuery.isLoading}
                    isPending={
                      teamActions.createTeamMutation.isPending ||
                      teamActions.updateTeamMutation.isPending ||
                      teamActions.deleteTeamMutation.isPending
                    }
                    onCreate={teamActions.openCreateDialog}
                    onDelete={teamActions.setTeamToDelete}
                    onDuplicate={teamActions.openDuplicateDialog}
                    onEdit={teamActions.openEditDialog}
                    onAddToChannel={teamActions.setTeamToAddToChannel}
                    onDiscover={() => openCommunityCatalog("teams")}
                    onShare={teamActions.openShare}
                    onImport={() => {
                      teamImportInputRef.current?.click();
                    }}
                    personas={personas.libraryPersonas}
                    teams={teamActions.teams}
                  />
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      <AgentDefaultsDialog
        onOpenChange={setAiDefaultsDialogOpen}
        open={isAiDefaultsOpen}
        returnFocusRef={aiDefaultsTriggerRef}
      />

      {agents.agentToAddToChannel ? (
        <AddAgentToChannelDialog
          agent={agents.agentToAddToChannel}
          onAdded={agents.handleAddedToChannel}
          onOpenChange={(open) => {
            if (!open) {
              agents.setAgentToAddToChannel(null);
            }
          }}
          open={agents.agentToAddToChannel !== null}
        />
      ) : null}
      {rolePackEditMode ? (
        <section
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background"
          data-testid="company-role-pack-page"
        >
          <HirePageHeader title="Role catalog" />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[74.5rem] px-12 pb-12 2xl:px-6">
              <HireBackButton
                disabled={personas.isPending}
                onClick={() => {
                  personas.setPersonaDialogState(null);
                  void goHireRoles();
                }}
              />
              <PageHeader className="mb-7" title="Role catalog" />
              {personaDefinitionDialog}
            </div>
          </div>
        </section>
      ) : (
        personaDefinitionDialog
      )}
      {personas.personaToDelete ? (
        <PersonaDeleteDialog
          instanceCount={
            (agents.managedAgents ?? []).filter(
              (a) => a.personaId === personas.personaToDelete?.id,
            ).length
          }
          onConfirm={(persona) => {
            void personas.handleDelete(persona);
          }}
          onOpenChange={(open) => {
            if (!open) {
              personas.setPersonaToDelete(null);
            }
          }}
          open={personas.personaToDelete !== null}
          persona={personas.personaToDelete}
        />
      ) : null}
      {personas.personaToShare ? (
        <PersonaShareDialog
          catalogShareLevel={personas.getPersonaCatalogShareLevel(
            personas.personaToShare.persona,
          )}
          isPending={personas.isPending}
          linkedAgentPubkey={personas.personaToShare.linkedAgentPubkey}
          effectiveAvatarUrl={personas.personaToShare.effectiveAvatarUrl}
          onCatalogShareLevelChange={(shareLevel) => {
            const shareTarget = personas.personaToShare;
            if (!shareTarget) return;
            void personas.setPersonaCatalogShareLevel(
              shareTarget.persona,
              shareLevel,
            );
          }}
          onExport={() => {
            const shareTarget = personas.personaToShare;
            if (!shareTarget) return;
            personas.setPersonaToShare(null);
            personas.setPersonaToExportSnapshot(shareTarget);
          }}
          onOpenChange={(open) => {
            if (!open) {
              personas.setPersonaToShare(null);
            }
          }}
          open={personas.personaToShare !== null}
          persona={personas.personaToShare.persona}
        />
      ) : null}
      {personas.personaToExportSnapshot ? (
        <AgentSnapshotExportDialog
          agentName={personas.personaToExportSnapshot.persona.displayName}
          isSavePending={personas.isPending}
          open={personas.personaToExportSnapshot !== null}
          linkedAgentPubkey={personas.personaToExportSnapshot.linkedAgentPubkey}
          onSaveFile={(memoryLevel, format) => {
            if (personas.personaToExportSnapshot) {
              personas.handleExportSnapshot(
                personas.personaToExportSnapshot.persona,
                personas.personaToExportSnapshot.linkedAgentPubkey,
                personas.personaToExportSnapshot.effectiveAvatarUrl,
                memoryLevel,
                format,
              );
            }
          }}
          onOpenChange={(open) => {
            if (!open) {
              personas.setPersonaToExportSnapshot(null);
            }
          }}
        />
      ) : null}
      {personas.snapshotImportState ? (
        <AgentSnapshotImportDialog
          open={personas.snapshotImportState !== null}
          preview={personas.snapshotImportState.preview}
          isConfirming={personas.isSnapshotImportConfirming}
          result={personas.snapshotImportResult}
          confirmError={personas.snapshotImportConfirmError}
          onConfirm={(keepAllowlist) => {
            void personas.handleConfirmSnapshotImport(keepAllowlist);
          }}
          onOpenChange={(open) => {
            if (!open) {
              personas.closeSnapshotImportDialog();
            }
          }}
        />
      ) : null}
      {catalogLaunchTarget !== null ? (
        <CommunityCatalogDialog
          createDescription={
            catalogLaunchRolePack
              ? "Define the job, skills, scoped tools and allowed worker menu."
              : undefined
          }
          createTitle={catalogLaunchRolePack ? "Role catalog" : undefined}
          rolePackMode={catalogLaunchRolePack}
          createContent={({ onDirtyChange, onRequestClose }) => (
            <AgentDialog
              onRoleRecovery={handleRoleRecovery}
              companyRoleMode={catalogLaunchRolePack}
              definitionError={
                personas.createPersonaMutation.error instanceof Error
                  ? personas.createPersonaMutation.error
                  : null
              }
              embedded
              isDefinitionPending={personas.isPending}
              mode="definition"
              onDirtyChange={onDirtyChange}
              onOpenChange={(open) => {
                if (!open) onRequestClose();
              }}
              onSubmitDefinition={(
                input,
                intent,
                backendIntent,
                onSavedPersona,
              ) =>
                personas.handleSubmit(
                  input,
                  intent,
                  backendIntent,
                  undefined,
                  undefined,
                  onSavedPersona,
                )
              }
              onRolePackSaved={(personaId) => {
                pendingRolePackSavedIdRef.current = personaId;
              }}
              suppressRoleRecovery={resumeRolePack}
              runtimes={personas.acpRuntimesQuery.data ?? []}
              runtimeCatalogStatus={
                personas.acpRuntimesQuery.isLoading
                  ? "loading"
                  : personas.acpRuntimesQuery.isError
                    ? "error"
                    : "ready"
              }
              submitLabel={
                catalogLaunchRolePack ? "Save role pack" : "Add agent"
              }
            />
          )}
          // Persona side
          personas={personas.catalogPersonas}
          personasError={
            personas.catalogQuery.error instanceof Error
              ? personas.catalogQuery.error
              : null
          }
          personasLoading={personas.catalogQuery.isLoading}
          personasPending={personas.isPending}
          feedbackErrorMessage={
            personas.personaFeedbackSurface === "catalog"
              ? personas.personaErrorMessage
              : null
          }
          feedbackNoticeMessage={
            personas.personaFeedbackSurface === "catalog"
              ? personas.personaNoticeMessage
              : null
          }
          onClearFeedback={() => {
            personas.clearFeedback("catalog");
          }}
          onImportFile={(fileBytes, fileName) => {
            void personas.handleImportSnapshotFile(fileBytes, fileName);
          }}
          onSelectPersona={async (persona, active) => {
            const addedPersona = await personas.handleSetActive(
              persona,
              active,
              "catalog",
            );
            if (!active || !addedPersona) return;

            setCatalogLaunchTarget(null);
            openPersonaProfilePanel?.(addedPersona);
          }}
          // Team side
          teams={teamActions.catalogTeams}
          teamsError={
            teamActions.catalogQuery.error instanceof Error
              ? teamActions.catalogQuery.error
              : null
          }
          teamsLoading={teamActions.catalogQuery.isLoading}
          teamsAdding={teamActions.isAddingFromCatalog}
          onAddTeam={(team) => {
            void teamActions.handleAddTeamFromCatalog(team, () =>
              setCatalogLaunchTarget(null),
            );
          }}
          // Dialog
          open={catalogLaunchTarget !== null}
          preferSection={catalogLaunchTarget}
          onOpenChange={(open) => {
            if (!open) {
              const returnToRoleCatalog = catalogLaunchRolePack;
              const savedRolePackId = pendingRolePackSavedIdRef.current;
              pendingRolePackSavedIdRef.current = null;
              setCatalogLaunchTarget(null);
              setCatalogLaunchRolePack(false);
              if (returnToRoleCatalog) {
                void goHireRoles(savedRolePackId ?? undefined);
              }
            }
          }}
        />
      ) : null}
      {teamActions.teamDialogState ? (
        <TeamDialog
          description={teamActions.teamDialogState.description}
          error={
            teamActions.updateTeamMutation.error instanceof Error
              ? teamActions.updateTeamMutation.error
              : teamActions.createTeamMutation.error instanceof Error
                ? teamActions.createTeamMutation.error
                : null
          }
          initialValues={teamActions.teamDialogState.initialValues}
          isPending={
            teamActions.createTeamMutation.isPending ||
            teamActions.updateTeamMutation.isPending
          }
          onOpenChange={(open) => {
            if (!open) {
              teamActions.setTeamDialogState(null);
            }
          }}
          onDeleteRemovedPersonas={teamActions.handleDeleteRemovedPersonas}
          onSubmit={teamActions.handleTeamSubmit}
          open={teamActions.teamDialogState !== null}
          personas={personas.libraryPersonas}
          submitLabel={teamActions.teamDialogState.submitLabel}
          title={teamActions.teamDialogState.title}
        />
      ) : null}
      {teamActions.teamToDelete ? (
        <TeamDeleteDialog
          onConfirm={(team) => {
            void teamActions.handleDeleteTeam(team);
          }}
          onOpenChange={(open) => {
            if (!open) {
              teamActions.setTeamToDelete(null);
            }
          }}
          open={teamActions.teamToDelete !== null}
          team={teamActions.teamToDelete}
        />
      ) : null}
      {teamActions.teamToAddToChannel ? (
        <AddTeamToChannelDialog
          onDeployed={teamActions.handleTeamDeployed}
          onOpenChange={(open) => {
            if (!open) {
              teamActions.setTeamToAddToChannel(null);
            }
          }}
          open={teamActions.teamToAddToChannel !== null}
          personas={personas.libraryPersonas}
          team={teamActions.teamToAddToChannel}
        />
      ) : null}
      {teamActions.teamToShare ? (
        <TeamShareDialog
          catalogShareLevel={teamActions.getTeamCatalogShareLevel(
            teamActions.teamToShare,
          )}
          isPending={
            teamActions.createTeamMutation.isPending ||
            teamActions.updateTeamMutation.isPending ||
            teamActions.deleteTeamMutation.isPending ||
            teamActions.isCatalogSharePending
          }
          onCatalogShareLevelChange={(shareLevel) => {
            if (teamActions.teamToShare) {
              void teamActions.setTeamCatalogShareLevel(
                teamActions.teamToShare,
                shareLevel,
              );
            }
          }}
          onExport={() => {
            if (teamActions.teamToShare) {
              const team = teamActions.teamToShare;
              teamActions.setTeamToShare(null);
              teamActions.openExportSnapshot(team);
            }
          }}
          onOpenChange={(open) => {
            if (!open) {
              teamActions.setTeamToShare(null);
            }
          }}
          open={teamActions.teamToShare !== null}
          team={teamActions.teamToShare}
        />
      ) : null}
      {teamActions.teamToExport ? (
        <TeamSnapshotExportDialog
          isSavePending={teamActions.exportTeamSnapshotMutation.isPending}
          open={teamActions.teamToExport !== null}
          team={teamActions.teamToExport}
          onSaveFile={(memoryLevel, format) => {
            if (teamActions.teamToExport) {
              teamActions.handleExportTeamSnapshot(
                teamActions.teamToExport,
                memoryLevel,
                format,
              );
            }
          }}
          onOpenChange={(open) => {
            if (!open) {
              teamActions.setTeamToExport(null);
            }
          }}
        />
      ) : null}
      {teamActions.teamSnapshotImportState ? (
        <TeamSnapshotImportDialog
          open={teamActions.teamSnapshotImportState !== null}
          preview={teamActions.teamSnapshotImportState.preview}
          isConfirming={teamActions.isTeamSnapshotImportConfirming}
          result={teamActions.teamSnapshotImportResult}
          confirmError={teamActions.teamSnapshotImportConfirmError}
          onConfirm={(keepAllowlist) => {
            void teamActions.handleConfirmTeamSnapshotImport(keepAllowlist);
          }}
          onOpenChange={(open) => {
            if (!open) {
              teamActions.closeTeamSnapshotImportDialog();
            }
          }}
        />
      ) : null}
      {/* Hidden file input for team snapshot import via file picker */}
      <input
        accept=".team.json,.team.png"
        className="hidden"
        data-testid="team-snapshot-import-input"
        ref={teamImportInputRef}
        type="file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const buffer = reader.result as ArrayBuffer;
            const fileBytes = Array.from(new Uint8Array(buffer));
            void teamActions.handleImportTeamSnapshotFile(fileBytes, file.name);
          };
          reader.readAsArrayBuffer(file);
          // Reset so the same file can be picked again.
          e.target.value = "";
        }}
      />
    </>
  );
}
