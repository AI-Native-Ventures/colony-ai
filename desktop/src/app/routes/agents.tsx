import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import {
  parseProfilePanelTab,
  parseProfilePanelView,
  type ProfilePanelTab,
  type ProfilePanelView,
} from "@/features/profile/ui/UserProfilePanelUtils";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

type AgentsRouteSearch = {
  agent?: string;
  /** Retired profile tab; kept so older links still open the agent page. */
  agentTab?: string;
  profile?: string;
  profilePersona?: string;
  profileTab?: ProfilePanelTab;
  profileView?: ProfilePanelView;
  rows?: string;
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function directoryPageSize(value: unknown): string | undefined {
  if (value === 10 || value === 20 || value === 30) return String(value);
  return nonEmptyString(value);
}

function validateAgentsSearch(
  search: Record<string, unknown>,
): AgentsRouteSearch {
  const agent = nonEmptyString(search.agent);
  return {
    agent,
    agentTab: agent ? nonEmptyString(search.agentTab) : undefined,
    profile: nonEmptyString(search.profile),
    profilePersona: nonEmptyString(search.profilePersona),
    profileTab: parseProfilePanelTab(search.profileTab) ?? undefined,
    profileView: parseProfilePanelView(search.profileView) ?? undefined,
    rows: directoryPageSize(search.rows),
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
