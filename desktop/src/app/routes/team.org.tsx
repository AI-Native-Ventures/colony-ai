import { createFileRoute } from "@tanstack/react-router";

import { TeamScreen } from "@/features/company-team/ui/TeamScreen";

export const Route = createFileRoute("/team/org")({
  component: () => <TeamScreen view="org" />,
});
