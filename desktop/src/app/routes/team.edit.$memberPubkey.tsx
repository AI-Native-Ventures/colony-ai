import { createFileRoute } from "@tanstack/react-router";

import { TeamMemberDialogRoute } from "@/features/company-team/ui/TeamDialogRoutes";

// Editing a role and reporting line is a dialog over the person's page. The
// URL stays so links and bookmarks to it keep working.
export const Route = createFileRoute("/team/edit/$memberPubkey")({
  component: TeamMemberEditRoute,
});

function TeamMemberEditRoute() {
  const { memberPubkey } = Route.useParams();
  return <TeamMemberDialogRoute dialog="edit" memberPubkey={memberPubkey} />;
}
