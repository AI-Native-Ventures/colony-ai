import { createFileRoute } from "@tanstack/react-router";

import { TeamMemberScreen } from "@/features/company-team/ui/TeamMemberScreen";

export const Route = createFileRoute("/team/pause/$memberPubkey")({
  component: TeamMemberPauseRoute,
});

function TeamMemberPauseRoute() {
  const { memberPubkey } = Route.useParams();
  return <TeamMemberScreen memberPubkey={memberPubkey} mode="pause" />;
}
