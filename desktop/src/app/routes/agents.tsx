import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import {
  parseProfilePanelTab,
  parseProfilePanelView,
  type ProfilePanelTab,
  type ProfilePanelView,
} from "@/features/profile/ui/UserProfilePanelUtils";
import {
  parseAgentProfileTab,
  type AgentProfileTab,
} from "@/features/agents/ui/AgentProfileView";
import type { AgentWorkspaceView } from "@/features/agents/ui/AgentsView";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

type AgentsRouteSearch = {
  agent?: string;
  agentTab?: AgentProfileTab;
  profile?: string;
  profilePersona?: string;
  profileTab?: ProfilePanelTab;
  profileView?: ProfilePanelView;
  rows?: string;
  view?: AgentWorkspaceView;
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function validateAgentsSearch(
  search: Record<string, unknown>,
): AgentsRouteSearch {
  const view = search.view;
  return {
    agent: nonEmptyString(search.agent),
    agentTab: parseAgentProfileTab(nonEmptyString(search.agentTab)),
    profile: nonEmptyString(search.profile),
    profilePersona: nonEmptyString(search.profilePersona),
    profileTab: parseProfilePanelTab(search.profileTab) ?? undefined,
    profileView: parseProfilePanelView(search.profileView) ?? undefined,
    rows: nonEmptyString(search.rows),
    view:
      view === "directory" ||
      view === "deployment" ||
      view === "teams" ||
      view === "templates"
        ? view
        : undefined,
  };
}

const AgentsScreen = React.lazy(async () => {
  const module = await import("@/features/agents/ui/AgentsScreen");
  return { default: module.AgentsScreen };
});

export const Route = createFileRoute("/agents")({
  validateSearch: validateAgentsSearch,
  component: AgentsRouteComponent,
});

function AgentsRouteComponent() {
  return (
    <React.Suspense fallback={<ViewLoadingFallback kind="agents" />}>
      <AgentsScreen />
    </React.Suspense>
  );
}
