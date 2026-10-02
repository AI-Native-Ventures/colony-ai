import { createFileRoute } from "@tanstack/react-router";

import { AskDetailScreen } from "@/features/company-asks/ui/AskDetailScreen";

export const Route = createFileRoute("/asks/$channelId/$askId")({
  validateSearch: (search: Record<string, unknown>) =>
    search.companyToolConsentInbox === "1"
      ? { companyToolConsentInbox: true }
      : {},
  component: AskDetailRouteComponent,
});

function AskDetailRouteComponent() {
  const { askId, channelId } = Route.useParams();
  const { companyToolConsentInbox } = Route.useSearch();
  return (
    <AskDetailScreen
      askId={askId}
      channelId={channelId}
      companyToolConsentInbox={companyToolConsentInbox}
    />
  );
}
