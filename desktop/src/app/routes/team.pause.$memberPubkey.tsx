import { createFileRoute, redirect } from "@tanstack/react-router";

// Editing a role, terminating and rehiring are dialogs on the person's page
// now. This redirect keeps old history entries and bookmarks landing there.
export const Route = createFileRoute("/team/pause/$memberPubkey")({
  beforeLoad: ({ params }) => {
    throw redirect({
      params: { memberPubkey: params.memberPubkey },
      replace: true,
      search: { panel: undefined, tab: undefined },
      to: "/team/detail/$memberPubkey",
    });
  },
});
