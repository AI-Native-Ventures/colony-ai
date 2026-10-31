import * as React from "react";
import {
  consumePendingSnapshotImport,
  subscribeSnapshotImport,
} from "@/features/agents/openSnapshotImportFromUrlEvent";
import { AddAgentToChannelDialog } from "./AddAgentToChannelDialog";
import { AgentSnapshotImportDialog } from "./AgentSnapshotImportDialog";
import { useCompanyScopedAgentActions } from "./useCompanyScopedAgentActions";
import { usePersonaActions } from "./usePersonaActions";
import { useAcpRuntimesQuery } from "@/features/agents/hooks";
import { useArchivedIdentitiesQuery } from "@/features/identity-archive/hooks";
import { useActiveAgentTurnsByChannel } from "@/features/agents/activeAgentTurnsStore";
import { AgentDirectory } from "./AgentDirectory";
import { KeyRescueCard } from "./KeyRescueCard";
import { AgentPage } from "./AgentPage";
import { AgentsDirectoryHeader } from "./AgentsDirectoryHeader";
import { parseAgentDirectoryPageSize } from "@/features/agents/agentDirectoryModel";
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
  const { goHireRoles } = useAppNavigation();
  const runtimeCatalogQuery = useAcpRuntimesQuery({ enabled: true });
  const archivedQuery = useArchivedIdentitiesQuery();
  const activeTurnsByChannel = useActiveAgentTurnsByChannel();
  const agents = useCompanyScopedAgentActions();
  const personas = usePersonaActions();

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
  const directoryAgentCount = agents.managedAgents.length;
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
                onHire={() => void goHireRoles()}
              />
              <KeyRescueCard />
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
                  runtimeCatalogQuery.isLoading
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
    </>
  );
}
