import { createFileRoute } from "@tanstack/react-router";
import { BusinessWorkspaceScreen } from "@/features/discovery/BusinessWorkspaceScreen";

export const Route = createFileRoute("/lists/$listId")({
  component: BusinessWorkspaceScreen,
});
