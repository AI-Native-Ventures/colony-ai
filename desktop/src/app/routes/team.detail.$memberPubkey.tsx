import { createFileRoute } from "@tanstack/react-router";

import { TeamMemberScreen } from "@/features/company-team/ui/TeamMemberScreen";

export const Route = createFileRoute("/team/detail/$memberPubkey")({
  validateSearch: (search: Record<string, unknown>) => ({
    panel:
      search.panel === "salary" || search.panel === "salary-edit"
        ? search.panel
        : undefined,
  }),
  component: TeamMemberDetailRoute,
});

function TeamMemberDetailRoute() {
  const { memberPubkey } = Route.useParams();
  const { panel } = Route.useSearch();
  return (
    <TeamMemberScreen
      memberPubkey={memberPubkey}
      mode="detail"
      salaryPanel={
        panel === "salary" || panel === "salary-edit" ? panel : undefined
      }
    />
  );
}
