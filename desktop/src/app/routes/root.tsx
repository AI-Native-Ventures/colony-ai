import { createRootRoute } from "@tanstack/react-router";

import { AppShell } from "@/app/AppShell";
import { UserStatusLookupProvider } from "@/features/user-status/UserStatusLookupContext";

function RootRoute() {
  return (
    <UserStatusLookupProvider>
      <AppShell />
    </UserStatusLookupProvider>
  );
}

export const Route = createRootRoute({
  component: RootRoute,
});
