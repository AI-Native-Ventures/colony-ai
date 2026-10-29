import { createFileRoute } from "@tanstack/react-router";

import { CompanyMapScreen } from "@/features/cofounder/ui/CompanyMapScreen";

export const Route = createFileRoute("/company/map")({
  component: CompanyMapScreen,
});
