import { createFileRoute } from "@tanstack/react-router";
import { BusinessWorkspaceScreen } from "@/features/discovery/BusinessWorkspaceScreen";

export const Route = createFileRoute("/sales/proposal/proposal-form")({
  component: BusinessWorkspaceScreen,
});
