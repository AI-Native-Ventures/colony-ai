import { createFileRoute } from "@tanstack/react-router";

import { isFunctionId } from "@/features/cofounder/functions";
import { FunctionScreen } from "@/features/cofounder/ui/FunctionScreen";

export const Route = createFileRoute("/company/function/$function")({
  component: CompanyFunctionRoute,
});

function CompanyFunctionRoute() {
  const { function: functionId } = Route.useParams();
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
  return <FunctionScreen functionId={functionId} />;
}
