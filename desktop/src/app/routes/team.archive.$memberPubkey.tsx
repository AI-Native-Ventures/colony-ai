import { createFileRoute } from "@tanstack/react-router";

import { TeamMemberDialogRoute } from "@/features/company-team/ui/TeamDialogRoutes";

// Terminating an employee, and reviewing a rehire (`?dialog=rehire`), are
// dialogs over the person's page. The URL stays so links keep working.
export const Route = createFileRoute("/team/archive/$memberPubkey")({
  validateSearch: (search: Record<string, unknown>) => ({
    dialog: search.dialog === "rehire" ? ("rehire" as const) : undefined,
  }),
  component: TeamMemberArchiveRoute,
});

function TeamMemberArchiveRoute() {
  const { memberPubkey } = Route.useParams();
  const { dialog } = Route.useSearch();
  return (
    <TeamMemberDialogRoute
      dialog={dialog === "rehire" ? "rehire" : "terminate"}
      memberPubkey={memberPubkey}
    />
  );
}
