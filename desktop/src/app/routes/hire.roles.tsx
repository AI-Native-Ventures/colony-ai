import { createFileRoute } from "@tanstack/react-router";

import { HireRolesScreen } from "@/features/company-hiring/ui/HireRolesScreen";

export const Route = createFileRoute("/hire/roles")({
  validateSearch: (search: Record<string, unknown>) => ({
    savedRolePack:
      typeof search.savedRolePack === "string"
        ? search.savedRolePack
        : undefined,
    roleRecovery:
      search.roleRecovery === "runtime-empty" ||
      search.roleRecovery === "provider-empty" ||
      search.roleRecovery === "model-empty"
        ? (search.roleRecovery as
            | "runtime-empty"
            | "provider-empty"
            | "model-empty")
        : undefined,
    rolePersonaId:
      typeof search.rolePersonaId === "string"
        ? search.rolePersonaId
        : undefined,
  }),
  component: HireRolesRoute,
});

function HireRolesRoute() {
  const { rolePersonaId, roleRecovery, savedRolePack } = Route.useSearch();
  return (
    <HireRolesScreen
      rolePersonaId={rolePersonaId}
      roleRecovery={roleRecovery}
      savedRolePackId={savedRolePack}
    />
  );
}
