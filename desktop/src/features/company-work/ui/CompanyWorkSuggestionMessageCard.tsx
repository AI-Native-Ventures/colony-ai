import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useCompanyWorkMessageContext } from "../companyWorkMessageContext";
import { useCompanyWorkTrackingContext } from "../companyWorkTrackingContext";
import { useCompanyWorkTrackingActionMutation } from "../companyWorkTrackingRelay";
import { Button } from "@/shared/ui/button";

export function CompanyWorkSuggestionMessageCard() {
  const messageContext = useCompanyWorkMessageContext();
  const trackingContext = useCompanyWorkTrackingContext();
  const mutation = useCompanyWorkTrackingActionMutation();
  const { goChannel, goCompanyWorkDetail, goCompanyWorkTracking } =
    useAppNavigation();
  if (!messageContext || !trackingContext) return null;

  const record = trackingContext.records.find(
    (candidate) =>
      candidate.channelId === messageContext.channelId.toLowerCase() &&
      candidate.head.recordType === "commitment_suggestion" &&
      candidate.head.sourceEventId ===
        messageContext.sourceEventId.toLowerCase(),
  );
  if (record?.head.recordType !== "commitment_suggestion") {
    return null;
  }
  const suggestion = record.head;
  if (suggestion.status !== "pending") return null;

  const accept = async () => {
    const acceptedWorkItemId = crypto.randomUUID();
    try {
      await mutation.mutateAsync({
        channelId: record.channelId,
        dTag: record.dTag,
        action: {
          schemaVersion: 1,
          action: "accept",
          recordId: suggestion.suggestionId,
          expectedHeadEventId: record.event.id,
          acceptedWorkItemId,
        },
      });
    } catch {
      void goCompanyWorkTracking("failed", suggestion.suggestionId, {
        channel: record.channelId,
        threadRoot: messageContext.threadRootEventId,
      });
      return;
    }
    void goCompanyWorkDetail(acceptedWorkItemId);
  };

  const dismiss = async () => {
    try {
      await mutation.mutateAsync({
        channelId: record.channelId,
        dTag: record.dTag,
        action: {
          schemaVersion: 1,
          action: "dismiss",
          recordId: suggestion.suggestionId,
          expectedHeadEventId: record.event.id,
        },
      });
    } catch {
      void goCompanyWorkTracking("failed", suggestion.suggestionId, {
        channel: record.channelId,
        threadRoot: messageContext.threadRootEventId,
      });
      return;
    }
    void goChannel(record.channelId, {
      messageId: messageContext.sourceEventId,
      threadRootId: messageContext.threadRootEventId,
    });
  };

  return (
    <section
      aria-label="Commitment suggestion"
      className="my-2 w-full max-w-[740px] rounded-lg border border-border bg-muted/20 p-4"
      data-testid={`company-work-suggestion-${suggestion.suggestionId}`}
    >
      <p className="text-sm font-semibold">Looks like a commitment.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          disabled={mutation.isPending}
          onClick={() => void accept()}
          size="sm"
        >
          Track this
        </Button>
        <Button
          disabled={mutation.isPending}
          onClick={() => void dismiss()}
          size="sm"
          variant="ghost"
        >
          Not now
        </Button>
      </div>
    </section>
  );
}
