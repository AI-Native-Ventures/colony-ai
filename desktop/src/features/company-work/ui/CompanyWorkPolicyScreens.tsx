import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { useIdentityQuery } from "@/shared/api/hooks";
import { Button } from "@/shared/ui/button";
import { useCompanyWorkHeadsQuery } from "../hooks";
import {
  companyWorkWatchdogDTag,
  COMPANY_WORK_TRACKING_SCHEMA_VERSION,
} from "../companyWorkTrackingModels";
import {
  useCompanyWorkTrackingActionMutation,
  useCompanyWorkTrackingHeadsQuery,
} from "../companyWorkTrackingRelay";
import {
  CompanyWorkBackButton,
  CompanyWorkPageHeader,
} from "./CompanyWorkPresentation";

function messageForError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}

/**
 * Due date routes stay unreachable until the server exposes the configured
 * workspace timezone. Falling back to the device timezone would save a
 * different commitment for members in other locations.
 */
export function CompanyWorkDueDateScreen({
  workItemId,
}: {
  workItemId: string;
}) {
  const { goCompanyWorkDetail } = useAppNavigation();
  const redirected = React.useRef(false);
  React.useEffect(() => {
    if (redirected.current) return;
    redirected.current = true;
    void goCompanyWorkDetail(workItemId);
  }, [goCompanyWorkDetail, workItemId]);
  return null;
}

export function CompanyWorkWatchdogScreen({
  workItemId,
  saved = false,
}: {
  workItemId: string;
  saved?: boolean;
}) {
  const headsQuery = useCompanyWorkHeadsQuery();
  const trackingQuery = useCompanyWorkTrackingHeadsQuery();
  const identity = useIdentityQuery();
  const membership = useMyRelayMembershipQuery();
  const mutation = useCompanyWorkTrackingActionMutation();
  const { goCompanyWorkDetail, goCompanyWorkTracking } = useAppNavigation();
  const record = headsQuery.data?.find(
    (candidate) => candidate.head.workItemId === workItemId,
  );
  const savedConfigRecord = trackingQuery.data?.find(
    (candidate) =>
      candidate.head.recordType === "watchdog_configuration" &&
      candidate.head.workItemId === workItemId,
  );
  const currentPubkey = identity.data?.pubkey.toLowerCase();
  const canConfigure = Boolean(
    currentPubkey &&
      record &&
      (record.head.requesterPubkey.toLowerCase() === currentPubkey ||
        record.head.assignedPubkeys.some(
          (pubkey) => pubkey.toLowerCase() === currentPubkey,
        ) ||
        membership.data?.role === "owner" ||
        membership.data?.role === "admin"),
  );
  const [intervalMinutes, setIntervalMinutes] = React.useState("");
  const [reviewer, setReviewer] = React.useState("");
  const didInitialize = React.useRef(false);
  React.useEffect(() => {
    if (didInitialize.current || !savedConfigRecord) return;
    didInitialize.current = true;
    if (
      savedConfigRecord.head.recordType === "watchdog_configuration" &&
      savedConfigRecord.head.enabled &&
      savedConfigRecord.head.config
    ) {
      setIntervalMinutes(
        String(savedConfigRecord.head.config.checkIntervalSeconds / 60),
      );
      setReviewer(savedConfigRecord.head.config.askFirstPubkey ?? "");
    }
  }, [savedConfigRecord]);
  const approverPubkeys = record?.head.approverPubkeys ?? [];
  const profileQuery = useUsersBatchQuery(approverPubkeys, {
    enabled: approverPubkeys.length > 0,
  });
  const profiles = profileQuery.data?.profiles;
  const interval = Number(intervalMinutes);
  const intervalIsValid =
    intervalMinutes.trim() !== "" &&
    Number.isInteger(interval) &&
    interval > 0 &&
    interval * 60 <= 4_294_967_295;

  if (
    headsQuery.channelsQuery.isPending ||
    headsQuery.isPending ||
    trackingQuery.channelsQuery.isPending ||
    trackingQuery.isPending ||
    identity.isPending ||
    membership.isPending
  ) {
    return <CompanyWorkPolicyUnavailable title="Loading watchdog settings" />;
  }
  if (headsQuery.isError || trackingQuery.isError) {
    return (
      <CompanyWorkPolicyUnavailable
        title="Watchdog settings unavailable"
        message={messageForError(
          headsQuery.isError ? headsQuery.error : trackingQuery.error,
        )}
      />
    );
  }
  if (!record) {
    return (
      <CompanyWorkPolicyUnavailable
        title="Watchdog settings unavailable"
        message="This work item is not available in the current community."
      />
    );
  }
  if (!canConfigure) {
    return (
      <>
        <CompanyWorkPageHeader title={record.head.title} />
        <main className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <CompanyWorkBackButton
            onClick={() => void goCompanyWorkDetail(workItemId)}
          />
          <h1 className="text-2xl font-bold tracking-tight">
            You do not have permission for this action
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            Your view access is unchanged. An authorized person can review the
            proposal.
          </p>
          <Button
            className="mt-6"
            onClick={() => void goCompanyWorkDetail(workItemId)}
            variant="outline"
          >
            Back to the record
          </Button>
        </main>
      </>
    );
  }

  if (saved) {
    const savedInterval =
      savedConfigRecord?.head.recordType === "watchdog_configuration" &&
      savedConfigRecord.head.enabled &&
      savedConfigRecord.head.config
        ? savedConfigRecord.head.config.checkIntervalSeconds / 60
        : null;
    return (
      <>
        <CompanyWorkPageHeader title={record.head.title} />
        <main className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <CompanyWorkBackButton
            onClick={() => void goCompanyWorkDetail(workItemId)}
          />
          <h1 className="text-2xl font-bold tracking-tight">
            Watchdog configuration prepared
          </h1>
          <section className="mt-7 max-w-2xl rounded-xl border border-border p-6">
            {savedInterval !== null ? (
              <p className="mb-3 text-sm font-medium">
                Quiet time before a review: {savedInterval} minutes
              </p>
            ) : null}
            <p className="text-sm text-muted-foreground">
              Only the interval explicitly entered for this business will be
              used.
            </p>
          </section>
          <Button
            className="mt-5"
            onClick={() => void goCompanyWorkDetail(workItemId)}
            variant="outline"
          >
            Back to the record
          </Button>
        </main>
      </>
    );
  }

  const canSubmit =
    intervalIsValid && (!reviewer || approverPubkeys.includes(reviewer));
  const handleSave = async () => {
    if (!canSubmit) return;
    const existingHead = savedConfigRecord?.event.id;
    try {
      await mutation.mutateAsync({
        channelId: record.channelId,
        dTag: companyWorkWatchdogDTag(workItemId),
        action: {
          schemaVersion: COMPANY_WORK_TRACKING_SCHEMA_VERSION,
          action: "configure",
          recordId: workItemId,
          ...(existingHead ? { expectedHeadEventId: existingHead } : {}),
          config: {
            checkWhen: "no_update",
            checkIntervalSeconds: interval * 60,
            ...(reviewer ? { askFirstPubkey: reviewer } : {}),
          },
        },
      });
      await goCompanyWorkTracking("watchdog-saved", workItemId);
    } catch {
      // The server did not accept the partial change; both entered values stay in this form.
    }
  };

  return (
    <>
      <CompanyWorkPageHeader title={record.head.title} />
      <main className="mx-auto w-full max-w-[1230px] px-8 py-8">
        <CompanyWorkBackButton
          onClick={() => void goCompanyWorkDetail(workItemId)}
        />
        <h1 className="text-2xl font-bold tracking-tight">
          Off until configured
        </h1>
        {mutation.error ? (
          <p className="mt-4 text-sm text-destructive" role="alert">
            Could not save. Your inputs are kept. Review them or retry without
            starting again.
          </p>
        ) : null}
        <section className="mt-7 max-w-2xl rounded-xl border border-border p-6">
          <p className="text-sm text-muted-foreground">
            No interval selected. Choose an interval before enabling checks.
            There is no preset.
          </p>
          <div className="mt-5">
            <label
              className="block text-sm font-medium"
              htmlFor="company-work-watchdog-interval"
            >
              Quiet time before a review, minutes
            </label>
            <input
              className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              id="company-work-watchdog-interval"
              inputMode="numeric"
              min="1"
              onChange={(event) =>
                setIntervalMinutes(event.currentTarget.value)
              }
              step="1"
              type="number"
              value={intervalMinutes}
            />
          </div>
          <div className="mt-5">
            <label
              className="block text-sm font-medium"
              htmlFor="company-work-watchdog-reviewer"
            >
              Reviewer
            </label>
            <select
              className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              id="company-work-watchdog-reviewer"
              onChange={(event) => setReviewer(event.currentTarget.value)}
              value={reviewer}
            >
              <option value="">Choose reviewer</option>
              {approverPubkeys.map((pubkey) => (
                <option key={pubkey} value={pubkey}>
                  {resolveUserLabel({ currentPubkey, profiles, pubkey })}
                </option>
              ))}
            </select>
          </div>
          <Button
            className="mt-6"
            disabled={!canSubmit || mutation.isPending}
            onClick={() => void handleSave()}
          >
            Review configuration
          </Button>
        </section>
      </main>
    </>
  );
}

function CompanyWorkPolicyUnavailable({
  title,
  message,
}: {
  title: string;
  message?: string;
}) {
  const { goCompanyWork } = useAppNavigation();
  return (
    <>
      <CompanyWorkPageHeader title="Work" />
      <main className="mx-auto w-full max-w-[1230px] px-8 py-8">
        <CompanyWorkBackButton onClick={() => void goCompanyWork()} />
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {message ? (
          <p className="mt-3 text-sm text-muted-foreground">{message}</p>
        ) : null}
      </main>
    </>
  );
}
