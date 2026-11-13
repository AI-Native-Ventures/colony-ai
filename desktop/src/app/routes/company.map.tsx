import { createFileRoute } from "@tanstack/react-router";

import { CompanyMapScreen } from "@/features/cofounder/ui/CompanyMapScreen";
import { useMapShellEnabled } from "@/features/map-shell/useMapShellEnabled";
import { useMediaBreakpoint } from "@/shared/hooks/use-mobile";

export const Route = createFileRoute("/company/map")({
  component: CompanyMapRouteComponent,
});

function CompanyMapRouteComponent() {
  const mapShellEnabled = useMapShellEnabled();
  const isMapCanvasNarrow = useMediaBreakpoint(701);
  return mapShellEnabled && !isMapCanvasNarrow ? null : <CompanyMapScreen />;
}
