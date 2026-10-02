import { createFileRoute } from "@tanstack/react-router";
import { BusinessWorkspaceScreen } from "@/features/discovery/BusinessWorkspaceScreen";

export const Route = createFileRoute("/pipeline")({
  component: BusinessWorkspaceScreen,
});
