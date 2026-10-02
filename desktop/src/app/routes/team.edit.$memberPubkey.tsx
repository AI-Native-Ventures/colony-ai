import { createFileRoute } from "@tanstack/react-router";

import { TeamMemberScreen } from "@/features/company-team/ui/TeamMemberScreen";

export const Route = createFileRoute("/team/edit/$memberPubkey")({
  component: TeamMemberEditRoute,
});

function TeamMemberEditRoute() {
  const { memberPubkey } = Route.useParams();
  return <TeamMemberScreen memberPubkey={memberPubkey} mode="edit" />;
}
