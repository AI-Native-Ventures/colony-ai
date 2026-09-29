import { createFileRoute, notFound } from "@tanstack/react-router";

import { ToolPermissionScreen } from "@/features/company-permissions/ui/ToolPermissionScreen";

type PermissionRouteTarget = {
  mode: "detail" | "edit" | "grant" | "revoke";
  permissionId?: string;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolvePermissionRoute(
  splat: string | undefined,
): PermissionRouteTarget | null {
  if (typeof splat !== "string") return null;
  const parts = splat.split("/");
  if (parts.length === 1 && parts[0] === "new") return { mode: "grant" };
  if (parts.length === 1 && UUID_PATTERN.test(parts[0])) {
    return { mode: "detail", permissionId: parts[0] };
  }
  if (parts.length === 2 && UUID_PATTERN.test(parts[0])) {
    if (parts[1] === "edit") return { mode: "edit", permissionId: parts[0] };
    if (parts[1] === "revoke") {
      return { mode: "revoke", permissionId: parts[0] };
    }
  }
  return null;
}

export const Route = createFileRoute("/permission/$")({
  validateSearch: (search: Record<string, unknown>) => ({
    agent: typeof search.agent === "string" ? search.agent : undefined,
  }),
  component: PermissionRoute,
});

function PermissionRoute() {
  const target = resolvePermissionRoute(Route.useParams()._splat);
  if (!target) throw notFound();
  const { agent } = Route.useSearch();
  return (
    <ToolPermissionScreen
      agentPubkey={agent}
      mode={target.mode}
      permissionId={target.permissionId}
    />
  );
}
