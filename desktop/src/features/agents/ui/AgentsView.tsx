import * as React from "react";
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
import { AgentPage } from "./AgentPage";
import { AgentsDirectoryHeader } from "./AgentsDirectoryHeader";
import { parseAgentDirectoryPageSize } from "@/features/agents/agentDirectoryModel";
import { useAppShell } from "@/app/AppShellContext";
import { useRelayMembersQuery } from "@/features/community-members/hooks";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";

export function AgentsView({
  agentPubkey,
  pageSize,
  onPageSizeChange,
  onOpenAgent,
  onMessageAgent,
}: {
  agentPubkey?: string;
  pageSize?: string;
  onPageSizeChange?: (size: 10 | 20 | 30) => void;
  onOpenAgent: (pubkey: string) => void;
  onMessageAgent: (pubkey: string) => Promise<void>;
}) {
  const { goTeam } = useAppNavigation();
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
  const directoryAgentCount = agents.managedAgents.length;
  const directoryPeopleCount = (relayMembersQuery.data ?? []).filter(
    (member) => !directoryAgentPubkeys.has(member.pubkey.toLowerCase()),
  ).length;
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
          className={`w-full ${agentPubkey ? "h-full min-h-0" : ""}`}
          data-testid="agents-page-content"
        >
          {agentPubkey ? (
            <AgentPage pubkey={agentPubkey} />
          ) : (
            <div className="agents-c3 agents-c3-page">
              <AgentsDirectoryHeader
                agentCount={directoryAgentCount}
                defaultsLabel={
                  hasSavedAgentDefaults
                    ? "Agent defaults"
                    : "Set agent defaults"
                }
                defaultsRef={aiDefaultsTriggerRef}
                onAddAgent={openCommunityCatalog}
                onHarnesses={() => appShell.onOpenSettings?.("agents")}
                onInvite={() => appShell.onOpenSettings?.("community-members")}
                onOpenDefaults={(trigger) => {
                  aiDefaultsTriggerRef.current = trigger;
                  setIsAiDefaultsOpen(true);
                }}
                onOpenPeople={() => void goTeam()}
                peopleCount={directoryPeopleCount}
              />
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
                onPageSizeChange={onPageSizeChange}
                pageSize={parseAgentDirectoryPageSize(pageSize)}
                runtimes={runtimeCatalogQuery.data ?? []}
              />
            </div>
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
