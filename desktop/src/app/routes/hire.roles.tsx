import { createFileRoute } from "@tanstack/react-router";

import { HireRolesScreen } from "@/features/company-hiring/ui/HireRolesScreen";

export const Route = createFileRoute("/hire/roles")({
  component: HireRolesScreen,
});
