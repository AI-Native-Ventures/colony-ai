import { createFileRoute } from "@tanstack/react-router";

import { TeamMemberScreen } from "@/features/company-team/ui/TeamMemberScreen";

export const Route = createFileRoute("/team/archive/$memberPubkey")({
  component: TeamMemberArchiveRoute,
});

function TeamMemberArchiveRoute() {
  const { memberPubkey } = Route.useParams();
  return <TeamMemberScreen memberPubkey={memberPubkey} mode="archive" />;
}
