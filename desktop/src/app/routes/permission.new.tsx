import { createFileRoute } from "@tanstack/react-router";

import { ToolPermissionScreen } from "@/features/company-permissions/ui/ToolPermissionScreen";

export const Route = createFileRoute("/permission/new")({
  validateSearch: (search: Record<string, unknown>) => ({
    agent: typeof search.agent === "string" ? search.agent : undefined,
  }),
  component: GrantPermissionRoute,
});

function GrantPermissionRoute() {
  const { agent } = Route.useSearch();
  return <ToolPermissionScreen agentPubkey={agent} mode="grant" />;
}
