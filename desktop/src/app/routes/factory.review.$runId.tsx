import { createFileRoute } from "@tanstack/react-router";
import { FactoryWorkspace } from "@/features/factory/ui/FactoryWorkspace";

export const Route = createFileRoute("/factory/review/$runId")({
  component: FactoryWorkspace,
});
