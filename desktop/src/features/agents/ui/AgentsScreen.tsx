import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { usePersonasQuery } from "@/features/agents/hooks";
import { useOpenDmMutation } from "@/features/channels/hooks";
import {
  type ProfilePanelTab,
  type ProfilePanelView,
  UserProfilePanel,
} from "@/features/profile/ui/UserProfilePanel";
import {
  profilePanelTabFromSearch,
  profilePanelViewFromSearch,
} from "@/features/profile/ui/UserProfilePanelUtils";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { AgentPersona } from "@/shared/api/types";
import {
  type ProfilePanelOpenOptions,
  ProfilePanelProvider,
} from "@/shared/context/ProfilePanelContext";
import { useHistorySearchState } from "@/shared/hooks/useHistorySearchState";
import { useThreadPanelWidth } from "@/shared/hooks/useThreadPanelWidth";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";
import { parseAgentProfileTab, type AgentProfileTab } from "./AgentProfileView";
import type { AgentWorkspaceView } from "./AgentsView";

function workspaceViewFromSearch(value: string | null): AgentWorkspaceView {
  return value === "deployment" || value === "teams" || value === "templates"
    ? value
    : "directory";
}

const AgentsView = React.lazy(async () => {
  const module = await import("@/features/agents/ui/AgentsView");
  return { default: module.AgentsView };
});

type ProfilePanelTarget =
  | { kind: "pubkey"; pubkey: string }
  | { kind: "persona"; persona: AgentPersona };

const AGENTS_PROFILE_SEARCH_KEYS = [
  "agent",
  "agentTab",
  "profile",
  "profilePersona",
  "profileTab",
  "profileView",
  "rows",
  "view",
] as const;

export function AgentsScreen() {
  const identityQuery = useIdentityQuery();
  const personasQuery = usePersonasQuery();
  const { applyPatch, values } = useHistorySearchState(
    AGENTS_PROFILE_SEARCH_KEYS,
  );
  const profilePanelTab = profilePanelTabFromSearch(values.profileTab);
  const profilePanelView = profilePanelViewFromSearch(values.profileView);
  const profilePanelTarget = React.useMemo<ProfilePanelTarget | null>(() => {
    if (values.profile) {
      return { kind: "pubkey", pubkey: values.profile };
    }

    if (values.profilePersona) {
      const persona = personasQuery.data?.find(
        (candidate) => candidate.id === values.profilePersona,
      );
      if (persona) {
        return { kind: "persona", persona };
      }
    }

    return null;
  }, [personasQuery.data, values.profile, values.profilePersona]);
  const threadPanelWidth = useThreadPanelWidth();
  const openDmMutation = useOpenDmMutation();
  const { goChannel, goSupervision } = useAppNavigation();

  const handleOpenProfilePanel = React.useCallback(
    (pubkey: string, options?: ProfilePanelOpenOptions) => {
      applyPatch({
        agent: null,
        agentTab: null,
        profile: pubkey,
        profilePersona: null,
        profileTab: options?.tab === "info" ? null : (options?.tab ?? null),
        profileView: null,
      });
    },
    [applyPatch],
  );

  const handleOpenPersonaProfilePanel = React.useCallback(
    (persona: AgentPersona) => {
      applyPatch({
        agent: null,
        agentTab: null,
        profile: null,
        profilePersona: persona.id,
        profileTab: null,
        profileView: null,
      });
    },
    [applyPatch],
  );
  const handleCloseProfilePanel = React.useCallback(() => {
    applyPatch({
      profile: null,
      profilePersona: null,
      profileTab: null,
      profileView: null,
    });
  }, [applyPatch]);
  const handleOpenAgent = React.useCallback(
    (pubkey: string) =>
      applyPatch({
        agent: pubkey,
        agentTab: "overview",
        profile: null,
        profilePersona: null,
        profileTab: null,
        profileView: null,
        view: null,
      }),
    [applyPatch],
  );
  const handleCloseAgent = React.useCallback(
    () => applyPatch({ agent: null, agentTab: null }),
    [applyPatch],
  );
  const handleAgentTabChange = React.useCallback(
    (agentTab: AgentProfileTab) => applyPatch({ agentTab }),
    [applyPatch],
  );
  const handleWorkspaceViewChange = React.useCallback(
    (view: AgentWorkspaceView) =>
      applyPatch({
        agent: null,
        agentTab: null,
        view: view === "directory" ? null : view,
      }),
    [applyPatch],
  );
  const handleDirectoryPageSizeChange = React.useCallback(
    (rows: 10 | 20 | 30) => applyPatch({ rows: String(rows) }),
    [applyPatch],
  );
  const handleProfilePanelViewChange = React.useCallback(
    (view: ProfilePanelView, options?: { replace?: boolean }) =>
      applyPatch({ profileView: view === "summary" ? null : view }, options),
    [applyPatch],
  );
  const handleProfilePanelTabChange = React.useCallback(
    (tab: ProfilePanelTab, options?: { replace?: boolean }) =>
      applyPatch({ profileTab: tab === "info" ? null : tab }, options),
    [applyPatch],
  );

  const handleOpenDm = React.useCallback(
    async (pubkeys: string[]) => {
      const dm = await openDmMutation.mutateAsync({ pubkeys });
      await goChannel(dm.id);
    },
    [goChannel, openDmMutation],
  );

  return (
    <ProfilePanelProvider
      onOpenPersonaProfilePanel={handleOpenPersonaProfilePanel}
      onOpenProfilePanel={handleOpenProfilePanel}
    >
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden">
          <React.Suspense fallback={<ViewLoadingFallback kind="agents" />}>
            <AgentsView
              agentPubkey={values.agent ?? undefined}
              agentTab={parseAgentProfileTab(values.agentTab)}
              onAgentTabChange={handleAgentTabChange}
              onCloseAgent={handleCloseAgent}
              onDirectoryPageSizeChange={handleDirectoryPageSizeChange}
              onMessageAgent={(pubkey) => handleOpenDm([pubkey])}
              onOpenAgent={handleOpenAgent}
              onOpenChannel={(channelId) => void goChannel(channelId)}
              onOpenSupervision={() => void goSupervision()}
              onWorkspaceViewChange={handleWorkspaceViewChange}
              pageSize={values.rows ?? undefined}
              view={workspaceViewFromSearch(values.view)}
            />
          </React.Suspense>
          {profilePanelTarget ? (
            <UserProfilePanel
              canResetWidth={threadPanelWidth.canReset}
              currentPubkey={identityQuery.data?.pubkey}
              onClose={handleCloseProfilePanel}
              onOpenDm={handleOpenDm}
              onOpenProfile={handleOpenProfilePanel}
              onResetWidth={threadPanelWidth.onResetWidth}
              onResizeStart={threadPanelWidth.onResizeStart}
              onTabChange={handleProfilePanelTabChange}
              onViewChange={handleProfilePanelViewChange}
              persona={
                profilePanelTarget.kind === "persona"
                  ? profilePanelTarget.persona
                  : undefined
              }
              pubkey={
                profilePanelTarget.kind === "pubkey"
                  ? profilePanelTarget.pubkey
                  : undefined
              }
              tab={profilePanelTab}
              view={profilePanelView}
              widthPx={threadPanelWidth.widthPx}
            />
          ) : null}
        </div>
      </div>
    </ProfilePanelProvider>
  );
}
