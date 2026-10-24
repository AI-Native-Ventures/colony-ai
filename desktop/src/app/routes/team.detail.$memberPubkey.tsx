import { createFileRoute } from "@tanstack/react-router";

import { TeamMemberScreen } from "@/features/company-team/ui/TeamMemberScreen";

export const Route = createFileRoute("/team/detail/$memberPubkey")({
  component: TeamMemberDetailRoute,
});

function TeamMemberDetailRoute() {
  const { memberPubkey } = Route.useParams();
  return <TeamMemberScreen memberPubkey={memberPubkey} mode="detail" />;
}
