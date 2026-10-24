import type { ReactNode } from "react";

import { AgentManagementMarker } from "@/features/agents/ui/OtherSetupAgentMarker";
import { CopyButton } from "@/features/agents/ui/CopyButton";
import {
  PROFILE_PANEL_VIEW_TITLES,
  type ProfilePanelView,
} from "@/features/profile/ui/UserProfilePanelUtils";
import {
  AuxiliaryPanelHeaderActions,
  AuxiliaryPanelHeaderGroup,
  AuxiliaryPanelHeaderTitleBlock,
} from "@/shared/layout/AuxiliaryPanel";

export function getUserProfilePanelHeaderContent({
  agentSettingsMenu,
  effectivePubkey,
  ownerPubkey,
  logCopyValue,
  logSubtitle,
  onBack,
  view,
}: {
  agentSettingsMenu: ReactNode;
  effectivePubkey: string | null;
  ownerPubkey?: string | null;
  logCopyValue?: string | null;
  logSubtitle?: string | null;
  onBack: () => void;
  view: ProfilePanelView;
}) {
  const title = PROFILE_PANEL_VIEW_TITLES[view];
  const shouldShowLogDetails =
    (view === "diagnostics" || view === "logs") && Boolean(logSubtitle);
  const headerLeftContent = (
    <AuxiliaryPanelHeaderGroup
      align={shouldShowLogDetails ? "start" : "center"}
      backButtonAriaLabel="Back to profile"
      backButtonTestId="user-profile-panel-back"
      onBack={view !== "summary" ? onBack : undefined}
    >
      <AuxiliaryPanelHeaderTitleBlock
        subtitle={shouldShowLogDetails ? logSubtitle : null}
        subtitleTitle={logSubtitle ?? undefined}
        title={title}
      />
      {view !== "summary" ? (
        <AgentManagementMarker
          pubkey={effectivePubkey}
          ownerPubkey={ownerPubkey}
          testId="user-profile-header-agent-provenance"
        />
      ) : null}
    </AuxiliaryPanelHeaderGroup>
  );
  const headerActions = (
    <AuxiliaryPanelHeaderActions>
      {view === "summary" ? agentSettingsMenu : null}
      {shouldShowLogDetails ? (
        <CopyButton
          className="text-muted-foreground hover:text-foreground"
          iconOnly
          label="Copy log"
          size="icon"
          value={logCopyValue ?? ""}
          variant="ghost"
        />
      ) : null}
    </AuxiliaryPanelHeaderActions>
  );

  return { headerActions, headerLeftContent };
}
