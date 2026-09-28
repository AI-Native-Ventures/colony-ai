import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import {
  CompanyWorkBackButton,
  CompanyWorkPageHeader,
} from "@/features/company-work/ui/CompanyWorkPresentation";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";

const CompanyWorkFormScreen = React.lazy(async () => {
  const module = await import(
    "@/features/company-work/ui/CompanyWorkFormScreen"
  );
  return { default: module.CompanyWorkFormScreen };
});

export const Route = createFileRoute("/work/from-chat/$messageId")({
  component: CompanyWorkFromChatRouteComponent,
  validateSearch: (search: Record<string, unknown>) => ({
    channel: typeof search.channel === "string" ? search.channel : undefined,
    threadRoot:
      typeof search.threadRoot === "string" ? search.threadRoot : undefined,
    goal: typeof search.goal === "string" ? search.goal : undefined,
  }),
});

function CompanyWorkFromChatRouteComponent() {
  const { messageId } = Route.useParams();
  const { channel, goal, threadRoot } = Route.useSearch();
  if (!channel || !threadRoot) {
    return <MissingConversationSource />;
  }
  return (
    <React.Suspense
      fallback={
        <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
          Loading work form
        </div>
      }
    >
      <CompanyWorkFormScreen
        initialChannelId={channel}
        initialGoalId={goal}
        sourceEventId={messageId}
        threadRootEventId={threadRoot}
      />
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
