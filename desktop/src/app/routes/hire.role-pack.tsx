import { createFileRoute } from "@tanstack/react-router";

import { RolePackEditorScreen } from "@/features/company-hiring/ui/RolePackEditorScreen";

export const Route = createFileRoute("/hire/role-pack")({
  component: RolePackEditorRoute,
  validateSearch: (search: Record<string, unknown>) => ({
    personaId:
      typeof search.personaId === "string" ? search.personaId : undefined,
  }),
});

function RolePackEditorRoute() {
  const { personaId } = Route.useSearch();
  return <RolePackEditorScreen personaId={personaId} />;
}
