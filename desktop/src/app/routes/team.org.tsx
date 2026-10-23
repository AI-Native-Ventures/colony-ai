import { createFileRoute, redirect } from "@tanstack/react-router";

// Reporting lines are no longer a separate view: the Team page is one flat list.
// This redirect keeps old history entries and bookmarks landing on it.
export const Route = createFileRoute("/team/org")({
  beforeLoad: () => {
    throw redirect({ replace: true, to: "/team" });
  },
});
