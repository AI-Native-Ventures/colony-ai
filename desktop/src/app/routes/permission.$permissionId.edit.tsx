import { createFileRoute } from "@tanstack/react-router";

import { ToolPermissionScreen } from "@/features/company-permissions/ui/ToolPermissionScreen";

export const Route = createFileRoute("/permission/$permissionId/edit")({
  validateSearch: (search: Record<string, unknown>) => ({
    agent: typeof search.agent === "string" ? search.agent : undefined,
  }),
  component: EditPermissionRoute,
});

function EditPermissionRoute() {
  const { permissionId } = Route.useParams();
  const { agent } = Route.useSearch();
  return (
    <ToolPermissionScreen
      agentPubkey={agent}
      mode="edit"
      permissionId={permissionId}
    />
  );
}
