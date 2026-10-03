import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useCompanyWorkHeadsQuery } from "@/features/company-work/hooks";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { useCommunities } from "@/features/communities/useCommunities";

function isCurrentStatus(status: string) {
  return ["active", "paused", "blocked", "done_unverified"].includes(status);
}

export function MemberDoingNowSection({
  memberPubkey,
  heading = "Doing now",
  testId = "company-member-doing-now",
  headingClassName = "mb-4 text-base font-semibold",
}: {
  memberPubkey: string;
  heading?: string;
  testId?: string;
  headingClassName?: string;
}) {
  const { activeCommunity } = useCommunities();
  const hasRelay = Boolean(activeCommunity?.relayUrl);
  const workQuery = useCompanyWorkHeadsQuery(hasRelay);
  const { goCompanyWorkDetail } = useAppNavigation();
  const [retrying, setRetrying] = React.useState(false);
  const retryAfterChannels = React.useRef(false);

  const memberWorkRecords = React.useMemo(
    () =>
      (workQuery.data ?? [])
        .filter(
          (record) =>
            record.head.assignedPubkeys.some(
              (pubkey) => pubkey.toLowerCase() === memberPubkey.toLowerCase(),
            ) && isCurrentStatus(record.head.status),
        )
        .sort(
          (first, second) => second.event.created_at - first.event.created_at,
        ),
    [memberPubkey, workQuery.data],
  );

  React.useEffect(() => {
    if (!retryAfterChannels.current || !workQuery.channelsQuery.isSuccess) {
      return;
    }
    retryAfterChannels.current = false;
    void workQuery.refetch().finally(() => setRetrying(false));
  }, [workQuery.channelsQuery.isSuccess, workQuery.refetch]);

  async function retryCurrentWork() {
    if (retrying) return;
    setRetrying(true);
    if (workQuery.channelsQuery.isError) {
      retryAfterChannels.current = true;
      const result = await workQuery.channelsQuery.refetch();
      if (result.isError) {
        retryAfterChannels.current = false;
        setRetrying(false);
      }
      return;
    }
    await workQuery.refetch().finally(() => setRetrying(false));
  }

  const loadFailed = workQuery.channelsQuery.isError || workQuery.isError;
  const isLoading =
    workQuery.channelsQuery.isPending ||
    (workQuery.channelsQuery.isSuccess && workQuery.isLoading);

  return (
    <section data-testid={testId}>
      <h2 className={headingClassName}>{heading}</h2>
      {!hasRelay ? (
        <Alert data-testid="company-member-doing-now-unavailable">
          <AlertTitle>Could not load current work</AlertTitle>
          <AlertDescription>
            This profile is available, but work status could not be refreshed.
            Do not treat this as no work.
          </AlertDescription>
          <Button
            className="mt-3"
            onClick={() => void retryCurrentWork()}
            size="sm"
            type="button"
            variant="outline"
          >
            Retry current work
          </Button>
        </Alert>
      ) : isLoading ? (
        <div aria-live="polite" className="rounded-lg border border-border p-4">
          <p className="text-sm font-medium">Loading commitments</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Checking the shared work list.
          </p>
        </div>
      ) : loadFailed ? (
        <Alert data-testid="company-member-doing-now-failed">
          <AlertTitle>Could not load current work</AlertTitle>
          <AlertDescription>
            This profile is available, but work status could not be refreshed.
            Do not treat this as no work.
          </AlertDescription>
          <Button
            className="mt-3"
            disabled={retrying}
            onClick={() => void retryCurrentWork()}
            size="sm"
            type="button"
            variant="outline"
          >
            {retrying ? "Retrying" : "Retry current work"}
          </Button>
        </Alert>
      ) : memberWorkRecords.length === 0 ? (
        <div className="py-3">
          <p className="text-xs text-muted-foreground">
            No current commitments.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border">
          {memberWorkRecords.map((record) => {
            const channelName = workQuery.channelsQuery.data?.find(
              (channel) =>
                channel.id.toLowerCase() === record.channelId.toLowerCase(),
            )?.name;
            return (
              <button
                className="flex min-h-20 w-full items-center justify-between gap-4 px-1 py-5 text-left hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid={`employee-work-${record.head.workItemId}`}
                key={record.head.workItemId}
                onClick={() => void goCompanyWorkDetail(record.head.workItemId)}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate text-compact font-semibold">
                    {record.head.title}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {channelName
                      ? `#${channelName}`
                      : `channel:${record.channelId}`}
                  </span>
                </span>
                <Badge
                  className="rounded-[0.3125rem] text-badge normal-case leading-relaxed tracking-normal"
                  variant={
                    record.head.status === "blocked" ? "warning" : "outline"
                  }
                >
                  {record.head.status.replaceAll("_", " ")}
                </Badge>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
