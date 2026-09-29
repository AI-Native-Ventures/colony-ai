import { createFileRoute } from "@tanstack/react-router";

import { HireConfigureScreen } from "@/features/company-hiring/ui/HireConfigureScreen";

export const Route = createFileRoute("/hire/configure")({
  component: HireConfigureRoute,
  validateSearch: (search: Record<string, unknown>) => ({
    personaId:
      typeof search.personaId === "string" ? search.personaId : undefined,
    hireId: typeof search.hireId === "string" ? search.hireId : undefined,
    channelId:
      typeof search.channelId === "string" ? search.channelId : undefined,
    askId: typeof search.askId === "string" ? search.askId : undefined,
    nameTaken: search.nameTaken === "true",
  }),
});

function HireConfigureRoute() {
  const { askId, channelId, hireId, nameTaken, personaId } = Route.useSearch();
  if (!hireId) return null;
  return (
    <HireConfigureScreen
      hireId={hireId}
      personaId={personaId}
      source={askId || nameTaken ? { askId, channelId, nameTaken } : undefined}
    />
  );
}
