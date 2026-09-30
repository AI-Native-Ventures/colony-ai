import { createFileRoute } from "@tanstack/react-router";

import { TeamMemberScreen } from "@/features/company-team/ui/TeamMemberScreen";

export const Route = createFileRoute("/team/detail/$memberPubkey")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: search.tab === "history" ? ("history" as const) : undefined,
  }),
  component: TeamMemberDetailRoute,
});

function TeamMemberDetailRoute() {
  const { memberPubkey } = Route.useParams();
  const { tab } = Route.useSearch();
  return (
    <TeamMemberScreen
      initialTab={tab}
      memberPubkey={memberPubkey}
      mode="detail"
    />
  );
}
