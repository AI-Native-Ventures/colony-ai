import * as React from "react";
import { ArrowRight, Plus, Sun } from "lucide-react";
import {
  consumePendingSnapshotImport,
  subscribeSnapshotImport,
} from "@/features/agents/openSnapshotImportFromUrlEvent";
import { AddAgentToChannelDialog } from "./AddAgentToChannelDialog";
import { AgentDefaultsDialog } from "./AgentDefaultsDialog";
import { AgentDialog } from "./AgentDialog";
import { CommunityCatalogDialog } from "./CommunityCatalogDialog";
import { AgentSnapshotImportDialog } from "./AgentSnapshotImportDialog";
import { useCompanyScopedAgentActions } from "./useCompanyScopedAgentActions";
import { usePersonaActions } from "./usePersonaActions";
import { useProfilePanel } from "@/shared/context/ProfilePanelContext";
import { useAcpRuntimesQuery } from "@/features/agents/hooks";
import { useGlobalAgentConfig } from "@/features/agents/useGlobalAgentConfig";
import { useArchivedIdentitiesQuery } from "@/features/identity-archive/hooks";
import { useActiveAgentTurnsByChannel } from "@/features/agents/activeAgentTurnsStore";
import { AgentDirectory } from "./AgentDirectory";
import { AgentProfileView, type AgentProfileTab } from "./AgentProfileView";
import { parseAgentDirectoryPageSize } from "@/features/agents/agentDirectoryModel";
import { useAppShell } from "@/app/AppShellContext";
import { useRelayMembersQuery } from "@/features/community-members/hooks";
import { Button } from "@/shared/ui/button";

export function AgentsView({
  agentPubkey,
  agentTab,
  pageSize,
  onOpenAgent,
  onMessageAgent,
  onOpenChannel,
  onCloseAgent,
  onAgentTabChange,
}: {
  agentPubkey?: string;
  agentTab: AgentProfileTab;
  pageSize?: string;
  onOpenAgent: (pubkey: string) => void;
  onMessageAgent: (pubkey: string) => Promise<void>;
  onOpenChannel: (channelId: string) => void;
  onCloseAgent: () => void;
  onAgentTabChange: (tab: AgentProfileTab) => void;
}) {
  const { openPersonaProfilePanel } = useProfilePanel();
  const { globalConfig } = useGlobalAgentConfig();
  const appShell = useAppShell();
  const runtimeCatalogQuery = useAcpRuntimesQuery({ enabled: true });
  const archivedQuery = useArchivedIdentitiesQuery();
  const activeTurnsByChannel = useActiveAgentTurnsByChannel();
  const agents = useCompanyScopedAgentActions();
  const personas = usePersonaActions();
  const aiDefaultsTriggerRef = React.useRef<HTMLButtonElement>(null);
  const [isAiDefaultsOpen, setIsAiDefaultsOpen] = React.useState(false);
  const relayMembersQuery = useRelayMembersQuery();

  const [isCatalogOpen, setIsCatalogOpen] = React.useState(false);

  function openCommunityCatalog() {
    personas.clearFeedback("catalog");
    personas.prepareCreate();
    void personas.catalogQuery.refetch();
    setIsCatalogOpen(true);
  }

  const isActionPending = agents.isPending || personas.isPending;
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only; personas.handleImportSnapshotFile is stable
  React.useEffect(() => {
    // Consume a snapshot import that was enqueued before navigation (e.g. from
    // a timeline AgentSnapshotCard click that navigated here).
    const pending = consumePendingSnapshotImport();
    if (pending && pending.snapshotKind !== "team") {
      void personas.handleImportSnapshotFile(
        pending.fileBytes,
        pending.fileName,
      );
    }

    return subscribeSnapshotImport(({ fileBytes, fileName, snapshotKind }) => {
      if (snapshotKind !== "team") {
        void personas.handleImportSnapshotFile(fileBytes, fileName);
      }
    });
  }, []);

  return (
    <>
      <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
        <div
          className={`mx-auto w-full ${selectedAgent ? "h-full min-h-0 max-w-none" : "flex h-full min-h-0 max-w-none flex-col"}`}
          data-testid="agents-page-content"
        >
          {selectedAgent ? (
            <AgentProfileView
              agent={selectedAgent}
              isActionPending={isActionPending}
              onBack={onCloseAgent}
              onMessage={onMessageAgent}
              onOpenChannel={onOpenChannel}
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
                    onClick={() => setIsAiDefaultsOpen(true)}
                    ref={aiDefaultsTriggerRef}
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
                    onClick={openCommunityCatalog}
                    size="sm"
                    type="button"
                  >
                    <Plus aria-hidden="true" className="size-3.5" />
                    Add agent
                  </Button>
                </div>
              </header>
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
                  onClick={() => appShell.onOpenSettings?.("community-members")}
                  type="button"
                >
                  People
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
            </>
          )}
        </div>
      </div>

      <AgentDefaultsDialog
        onOpenChange={setIsAiDefaultsOpen}
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
      {isCatalogOpen ? (
        <CommunityCatalogDialog
          createContent={({ onDirtyChange, onRequestClose }) => (
            <AgentDialog
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
              runtimes={personas.acpRuntimesQuery.data ?? []}
              runtimeCatalogStatus={
                personas.acpRuntimesQuery.isLoading
                  ? "loading"
                  : personas.acpRuntimesQuery.isError
                    ? "error"
                    : "ready"
              }
              submitLabel="Add agent"
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

            setIsCatalogOpen(false);
            openPersonaProfilePanel?.(addedPersona);
          }}
          // Dialog
          open={isCatalogOpen}
          onOpenChange={(open) => {
            if (!open) setIsCatalogOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
