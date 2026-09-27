import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { AgentSupervisionView } from "@/features/agents/ui/AgentSupervisionView";

type SupervisionSearch = {
  agent?: string;
  channel?: string;
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function validateSupervisionSearch(
  search: Record<string, unknown>,
): SupervisionSearch {
  return {
    agent: nonEmptyString(search.agent),
    channel: nonEmptyString(search.channel),
  };
}

export const Route = createFileRoute("/supervision")({
  validateSearch: validateSupervisionSearch,
  component: SupervisionRouteComponent,
});

function SupervisionRouteComponent() {
  const navigate = useNavigate();
  const search = Route.useSearch();

  return (
    <AgentSupervisionView
      agentPubkey={search.agent}
      channelId={search.channel}
      onSelectTrace={(channel, agent) =>
        void navigate({
          to: "/supervision",
          search: { channel, agent },
        })
      }
    />
  );
}
