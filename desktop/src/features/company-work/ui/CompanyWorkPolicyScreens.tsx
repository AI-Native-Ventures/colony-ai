import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { useIdentityQuery } from "@/shared/api/hooks";
import { Button } from "@/shared/ui/button";
import {
  useCompanyWorkHeadsQuery,
  useCompanyWorkActionMutation,
} from "../hooks";
import { COMPANY_WORK_SCHEMA_VERSION } from "../companyWorkModels";
import {
  companyWorkTimeZone,
  localDateTimeInputToUtc,
  utcToLocalDateTimeInput,
} from "../companyWorkDueDate";
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

const DUE_DRAFT_KEY = "buzz.company-work.due-date-draft.v1";

function messageForError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}

function readDueDraft(key: string) {
  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeDueDraft(key: string, value: string | null) {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // The form state remains available for this screen when storage is blocked.
  }
}

function dueDraftKey(communityId: string | undefined, workItemId: string) {
  return `${DUE_DRAFT_KEY}:${communityId ?? "local"}:${workItemId}`;
}

export function CompanyWorkDueDateScreen({
  screen,
  workItemId,
}: {
  screen: "due" | "due-clear" | "due-denied";
  workItemId: string;
}) {
  const headsQuery = useCompanyWorkHeadsQuery();
  const identity = useIdentityQuery();
  const membership = useMyRelayMembershipQuery();
  const { activeCommunity } = useCommunities();
  const { goCompanyWorkDetail, goCompanyWorkTracking } = useAppNavigation();
  const mutation = useCompanyWorkActionMutation();
  const record = headsQuery.data?.find(
    (candidate) => candidate.head.workItemId === workItemId,
  );
  const currentPubkey = identity.data?.pubkey.toLowerCase();
  const canEdit = Boolean(
    currentPubkey &&
      record &&
      (record.head.requesterPubkey.toLowerCase() === currentPubkey ||
        record.head.assignedPubkeys.some(
          (pubkey) => pubkey.toLowerCase() === currentPubkey,
        ) ||
        membership.data?.role === "owner" ||
        membership.data?.role === "admin"),
  );
  const draftKey = dueDraftKey(activeCommunity?.id, workItemId);

  if (
    headsQuery.channelsQuery.isPending ||
    headsQuery.isPending ||
    identity.isPending ||
    membership.isPending
  ) {
    return <CompanyWorkPageHeader title="Loading due date" />;
  }
  if (headsQuery.channelsQuery.isError || headsQuery.isError) {
    return (
      <CompanyWorkDueUnavailable
        message={messageForError(
          headsQuery.channelsQuery.isError
            ? headsQuery.channelsQuery.error
            : headsQuery.error,
        )}
        title="Work item unavailable"
      />
    );
  }
  if (!record) {
    return (
      <CompanyWorkDueUnavailable
        message="This work item is not available in the current community."
        title="Work item unavailable"
      />
    );
  }

  if (screen === "due-denied" || !canEdit) {
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

  if (screen === "due-clear") {
    return (
      <CompanyWorkDueClearScreen
        record={record}
        onCancel={() => {
          writeDueDraft(draftKey, null);
          void goCompanyWorkDetail(workItemId);
        }}
        onClear={async () => {
          try {
            await mutation.mutateAsync({
              channelId: record.channelId,
              action: {
                schemaVersion: COMPANY_WORK_SCHEMA_VERSION,
                workItemId,
                action: "clear_due_date",
                expectedHeadEventId: record.event.id,
              },
            });
            writeDueDraft(draftKey, null);
            await goCompanyWorkTracking("due-saved", workItemId);
          } catch {
            // Keep the saved deadline and staged input available for a retry.
          }
        }}
        onKeep={() => void goCompanyWorkTracking("due", workItemId)}
        pending={mutation.isPending}
        saveError={mutation.error}
      />
    );
  }

  return (
    <CompanyWorkDueEditScreen
      draftKey={draftKey}
      record={record}
      onCancel={() => {
        writeDueDraft(draftKey, null);
        void goCompanyWorkDetail(workItemId);
      }}
      onClear={() => void goCompanyWorkTracking("due-clear", workItemId)}
      onSave={async (dueAt) => {
        try {
          await mutation.mutateAsync({
            channelId: record.channelId,
            action: {
              schemaVersion: COMPANY_WORK_SCHEMA_VERSION,
              workItemId,
              action: "set_due_date",
              expectedHeadEventId: record.event.id,
              dueAt,
            },
          });
          writeDueDraft(draftKey, null);
          await goCompanyWorkTracking("due-saved", workItemId);
        } catch {
          // The failed mutation keeps the existing input in place for retry.
        }
      }}
      pending={mutation.isPending}
      saveError={mutation.error}
    />
  );
}

function CompanyWorkDueEditScreen({
  draftKey,
  record,
  onCancel,
  onClear,
  onSave,
  pending,
  saveError,
}: {
  draftKey: string;
  record: NonNullable<
    ReturnType<typeof useCompanyWorkHeadsQuery>["data"]
  >[number];
  onCancel: () => void;
  onClear: () => void;
  onSave: (dueAt: string) => Promise<void>;
  pending: boolean;
  saveError: unknown;
}) {
  const [value, setValue] = React.useState("");
  const initializedForDraft = React.useRef<string | null>(null);
  const [invalidTime, setInvalidTime] = React.useState(false);
  React.useEffect(() => {
    if (initializedForDraft.current === draftKey) return;
    initializedForDraft.current = draftKey;
    setInvalidTime(false);
    setValue(
      readDueDraft(draftKey) ||
        (record.head.dueAt ? utcToLocalDateTimeInput(record.head.dueAt) : ""),
    );
  }, [draftKey, record.head.dueAt]);
  const dueAt = localDateTimeInputToUtc(value);
  const acceptedAtInput = record.head.acceptedAt
    ? utcToLocalDateTimeInput(record.head.acceptedAt)
    : undefined;

  return (
    <>
      <CompanyWorkPageHeader title={record.head.title} />
      <main className="mx-auto w-full max-w-[1230px] px-8 py-8">
        <CompanyWorkBackButton onClick={onCancel} />
        <h1 className="text-2xl font-bold tracking-tight">Set a due date</h1>
        {saveError ? (
          <p className="mt-4 text-sm text-destructive" role="alert">
            Could not save. Your inputs are kept. Review them or retry without
            starting again.
          </p>
        ) : null}
        {invalidTime ? (
          <p className="mt-4 text-sm text-destructive" role="alert">
            Choose a valid date and time.
          </p>
        ) : null}
        <section className="mt-7 max-w-2xl rounded-xl border border-border p-6">
          <label
            className="block text-sm font-medium"
            htmlFor="company-work-due-at"
          >
            Due date and time
          </label>
          <input
            className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            id="company-work-due-at"
            max="9999-12-31T23:59"
            min={acceptedAtInput}
            onChange={(event) => {
              setInvalidTime(false);
              setValue(event.currentTarget.value);
              writeDueDraft(draftKey, event.currentTarget.value);
            }}
            required
            type="datetime-local"
            value={value}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Timezone: {companyWorkTimeZone()}
          </p>
          <p className="mt-5 text-sm text-muted-foreground">
            A due date is a commitment deadline. It does not start a timer or
            automatically complete the work.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button
              disabled={pending || !value.trim()}
              onClick={() => {
                if (!dueAt) {
                  setInvalidTime(true);
                  return;
                }
                setInvalidTime(false);
                void onSave(dueAt);
              }}
            >
              Save due date
            </Button>
            <Button disabled={pending} onClick={onCancel} variant="outline">
              Cancel
            </Button>
            {record.head.dueAt ? (
              <Button disabled={pending} onClick={onClear} variant="ghost">
                Clear due date
              </Button>
            ) : null}
          </div>
        </section>
      </main>
    </>
  );
}

function CompanyWorkDueClearScreen({
  record,
  onCancel,
  onClear,
  onKeep,
  pending,
  saveError,
}: {
  record: NonNullable<
    ReturnType<typeof useCompanyWorkHeadsQuery>["data"]
  >[number];
  onCancel: () => void;
  onClear: () => Promise<void>;
  onKeep: () => void;
  pending: boolean;
  saveError: unknown;
}) {
  return (
    <>
      <CompanyWorkPageHeader title={record.head.title} />
      <main className="mx-auto w-full max-w-[1230px] px-8 py-8">
        <CompanyWorkBackButton onClick={onCancel} />
        <h1 className="text-2xl font-bold tracking-tight">
          Clear this due date?
        </h1>
        <section className="mt-7 max-w-2xl rounded-xl border border-border p-6">
          {saveError ? (
            <p className="mb-4 text-sm text-destructive" role="alert">
              Could not save. Your inputs are kept. Review them or retry without
              starting again.
            </p>
          ) : null}
          <p className="text-sm text-muted-foreground">
            The work stays active. Its previous date remains in the timeline.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <Button
              disabled={pending || !record.head.dueAt}
              onClick={() => void onClear()}
            >
              Clear due date
            </Button>
            <Button disabled={pending} onClick={onKeep} variant="outline">
              Keep date
            </Button>
          </div>
        </section>
      </main>
    </>
  );
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

function CompanyWorkDueUnavailable({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return <CompanyWorkPolicyUnavailable message={message} title={title} />;
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
