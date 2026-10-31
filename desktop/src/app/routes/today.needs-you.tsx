import { createFileRoute } from "@tanstack/react-router";

import { CofounderNeedsYouRoute } from "@/features/cofounder/ui/CofounderPhase2Routes";

export const Route = createFileRoute("/today/needs-you")({
  component: CofounderNeedsYouRoute,
});
