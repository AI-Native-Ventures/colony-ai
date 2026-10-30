import { createFileRoute } from "@tanstack/react-router";

import { CofounderAccessRoute } from "@/features/cofounder/ui/CofounderPhase2Routes";

export const Route = createFileRoute("/company/access")({
  component: CofounderAccessRoute,
});
