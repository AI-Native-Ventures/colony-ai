import { createFileRoute } from "@tanstack/react-router";

import { HireSuccessScreen } from "@/features/company-hiring/ui/HireSuccessScreen";

export const Route = createFileRoute("/hire/success")({
  component: HireSuccessRoute,
  validateSearch: (search: Record<string, unknown>) => ({
    hireId: typeof search.hireId === "string" ? search.hireId : undefined,
  }),
});

function HireSuccessRoute() {
  const { hireId } = Route.useSearch();
  if (!hireId) return null;
  return <HireSuccessScreen hireId={hireId} />;
}
