import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import type { SecretRouteState } from "@/features/company-secrets/ui/SecretBindingsScreen";

const SecretBindingsScreen = React.lazy(async () => {
  const module = await import(
    "@/features/company-secrets/ui/SecretBindingsScreen"
  );
  return { default: module.SecretBindingsScreen };
});

const STATES = new Set<SecretRouteState>([
  "list",
  "empty",
  "loading",
  "unavailable",
  "denied",
  "request",
  "entry",
  "device",
  "server",
  "failed",
  "saved",
  "revoke",
  "revoked",
]);

export const Route = createFileRoute("/secrets")({
  validateSearch: (search: Record<string, unknown>) => ({
    state:
      typeof search.state === "string" &&
      STATES.has(search.state as SecretRouteState)
        ? (search.state as SecretRouteState)
        : ("list" as const),
    channelId: typeof search.channelId === "string" ? search.channelId : null,
    askId: typeof search.askId === "string" ? search.askId : null,
    bindingId: typeof search.bindingId === "string" ? search.bindingId : null,
  }),
  component: SecretBindingsRouteComponent,
});

function SecretBindingsRouteComponent() {
  const { state, channelId, askId, bindingId } = Route.useSearch();
  return (
    <React.Suspense
      fallback={
        <div
          className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"
          role="status"
        >
          Loading secret bindings
        </div>
      }
    >
      <SecretBindingsScreen
        askId={askId}
        bindingId={bindingId}
        channelId={channelId}
        state={state}
      />
    </React.Suspense>
  );
}
