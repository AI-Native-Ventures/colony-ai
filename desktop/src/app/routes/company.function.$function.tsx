import { createFileRoute } from "@tanstack/react-router";

import { companyMapWindowJobForRoute } from "@/features/cofounder/companyMapJobRoutes";
import { isFunctionId } from "@/features/cofounder/functions";
import { FunctionScreen } from "@/features/cofounder/ui/FunctionScreen";

export const Route = createFileRoute("/company/function/$function")({
  component: CompanyFunctionRoute,
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search.mapJob === "string" ? { mapJob: search.mapJob } : {}),
  }),
});

function CompanyFunctionRoute() {
  const { function: functionId } = Route.useParams();
  const { mapJob } = Route.useSearch();
  if (!isFunctionId(functionId)) {
    return (
      <section className="team-page" data-testid="cofounder-function-screen">
        <div className="team-page-inner">
          <h1 className="team-page-title" tabIndex={-1}>
            Function not found
          </h1>
        </div>
      </section>
    );
  }
  const mapWindowJob = companyMapWindowJobForRoute(
    `/company/function/${functionId}`,
    { mapJob },
  );
  const selectedOperationsPlaybookId =
    mapWindowJob && "playbookId" in mapWindowJob
      ? (mapWindowJob.playbookId ?? undefined)
      : undefined;

  return (
    <FunctionScreen
      functionId={functionId}
      selectedOperationsPlaybookId={selectedOperationsPlaybookId}
    />
  );
}
