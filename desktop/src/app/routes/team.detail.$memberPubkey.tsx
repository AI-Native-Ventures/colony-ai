import { createFileRoute } from "@tanstack/react-router";

import { TeamMemberScreen } from "@/features/company-team/ui/TeamMemberScreen";

export const Route = createFileRoute("/team/detail/$memberPubkey")({
  // `tab` and `panel` are retired (history and salary are cut); older links
  // still open the member page.
  validateSearch: (search: Record<string, unknown>) => ({
    tab: search.tab === "history" ? ("history" as const) : undefined,
    panel:
      search.panel === "salary" || search.panel === "salary-edit"
        ? search.panel
        : undefined,
  }),
  component: TeamMemberDetailRoute,
});

function TeamMemberDetailRoute() {
  const { memberPubkey } = Route.useParams();
  const { tab } = Route.useSearch();
  return (
    <TeamMemberScreen initialTab={tab} memberPubkey={memberPubkey} mode="detail" />
  );
}
