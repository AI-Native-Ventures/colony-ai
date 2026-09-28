import * as React from "react";
import { createFileRoute, notFound } from "@tanstack/react-router";

import {
  CompanyWorkBackButton,
  CompanyWorkPageHeader,
} from "@/features/company-work/ui/CompanyWorkPresentation";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";

const CompanyWorkDetailScreen = React.lazy(async () => {
  const module = await import(
    "@/features/company-work/ui/CompanyWorkDetailScreen"
  );
  return { default: module.CompanyWorkDetailScreen };
});

const CompanyWorkFormScreen = React.lazy(async () => {
  const module = await import(
    "@/features/company-work/ui/CompanyWorkFormScreen"
  );
  return { default: module.CompanyWorkFormScreen };
});

const CompanyWorkStatusScreen = React.lazy(async () => {
  const module = await import(
    "@/features/company-work/ui/CompanyWorkActionScreens"
  );
  return { default: module.CompanyWorkStatusScreen };
});

const CompanyWorkVerifyScreen = React.lazy(async () => {
  const module = await import(
    "@/features/company-work/ui/CompanyWorkActionScreens"
  );
  return { default: module.CompanyWorkVerifyScreen };
});

const CompanyWorkArchiveScreen = React.lazy(async () => {
  const module = await import(
    "@/features/company-work/ui/CompanyWorkActionScreens"
  );
  return { default: module.CompanyWorkArchiveScreen };
});

const screens = new Set([
  "detail",
  "edit",
  "status",
  "verify",
  "archive",
  "from-chat",
]);

export const Route = createFileRoute("/work/$screen/$resourceId")({
  beforeLoad: ({ params }) => {
    if (!screens.has(params.screen)) {
      throw notFound();
    }
  },
  component: CompanyWorkActionRouteComponent,
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search.channel === "string" ? { channel: search.channel } : {}),
    ...(typeof search.threadRoot === "string"
      ? { threadRoot: search.threadRoot }
      : {}),
    ...(typeof search.goal === "string" ? { goal: search.goal } : {}),
  }),
});

function CompanyWorkActionRouteComponent() {
  const { resourceId, screen } = Route.useParams();
  const { channel, goal, threadRoot } = Route.useSearch();

  if (screen === "from-chat" && (!channel || !threadRoot)) {
    return <MissingConversationSource />;
  }

  let content: React.ReactNode;
  let fallback = "Loading work item";
  switch (screen) {
    case "detail":
      content = <CompanyWorkDetailScreen workItemId={resourceId} />;
      break;
    case "edit":
      content = <CompanyWorkFormScreen workItemId={resourceId} />;
      break;
    case "status":
      content = <CompanyWorkStatusScreen workItemId={resourceId} />;
      break;
    case "verify":
      content = <CompanyWorkVerifyScreen workItemId={resourceId} />;
      break;
    case "archive":
      content = <CompanyWorkArchiveScreen workItemId={resourceId} />;
      break;
    case "from-chat":
      fallback = "Loading work form";
      content = (
        <CompanyWorkFormScreen
          initialChannelId={channel}
          initialGoalId={goal}
          sourceEventId={resourceId}
          threadRootEventId={threadRoot}
        />
      );
      break;
    default:
      throw notFound();
  }

  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
          {fallback}
        </div>
      }
    >
      {content}
    </React.Suspense>
  );
}

function MissingConversationSource() {
  const { goCompanyWork } = useAppNavigation();
  return (
    <>
      <CompanyWorkPageHeader title="Work" />
      <main className="mx-auto w-full max-w-[1230px] px-8 py-8">
        <CompanyWorkBackButton onClick={() => void goCompanyWork()} />
        <h1 className="text-2xl font-bold tracking-tight">
          Work from discussion
        </h1>
        <div className="mt-8 rounded-lg border border-border p-6">
          <h2 className="text-base font-semibold">
            The conversation source is unavailable.
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Open a goal reference in a conversation and create the work item
            there.
          </p>
        </div>
      </main>
    </>
  );
}
