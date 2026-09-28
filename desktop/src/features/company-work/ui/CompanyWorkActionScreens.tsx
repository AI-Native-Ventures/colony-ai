import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { useIdentityQuery } from "@/shared/api/hooks";
import { Button } from "@/shared/ui/button";
import { Textarea } from "@/shared/ui/textarea";
import {
  COMPANY_WORK_SCHEMA_VERSION,
  type CompanyWorkAction,
  type CompanyWorkStatus,
  type CompanyWorkVerdict,
} from "../companyWorkModels";
import {
  useCompanyWorkActionMutation,
  useCompanyWorkHeadsQuery,
} from "../hooks";
import {
  CompanyWorkBackButton,
  CompanyWorkPageHeader,
  CompanyWorkStatusBadge,
} from "./CompanyWorkPresentation";

function messageOf(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}

function WorkActionPage({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <CompanyWorkPageHeader title="Work" />
      <main
        aria-label={title}
        className="mx-auto w-full max-w-[1230px] px-8 py-8"
      >
        {children}
      </main>
    </>
  );
}

function useWorkActionContext(workItemId: string) {
  const headsQuery = useCompanyWorkHeadsQuery();
  const identityQuery = useIdentityQuery();
  const membershipQuery = useMyRelayMembershipQuery();
  const record = headsQuery.data?.find(
    (candidate) => candidate.head.workItemId === workItemId,
  );
  const currentPubkey = identityQuery.data?.pubkey.toLowerCase();
  const role = membershipQuery.data?.role;
  const communityAdmin = role === "owner" || role === "admin";
  const isOwner = Boolean(
    currentPubkey &&
      record?.head.assignedPubkeys.some(
        (pubkey) => pubkey.toLowerCase() === currentPubkey,
      ),
  );
  const isRequester = Boolean(
    currentPubkey &&
      record?.head.requesterPubkey.toLowerCase() === currentPubkey,
  );
  return {
    headsQuery,
    identityQuery,
    membershipQuery,
    record,
    currentPubkey,
    communityAdmin,
    isOwner,
    isRequester,
  };
}

function useNavigateAfterAction(workItemId: string) {
  const { goCompanyWorkDetail } = useAppNavigation();
  const mutation = useCompanyWorkActionMutation();
  const submit = React.useCallback(
    async (channelId: string, action: CompanyWorkAction) => {
      await mutation.mutateAsync({ channelId, action });
      await goCompanyWorkDetail(workItemId, { replace: true });
    },
    [goCompanyWorkDetail, mutation, workItemId],
  );
  return { mutation, submit };
}

export function CompanyWorkStatusScreen({
  workItemId,
}: {
  workItemId: string;
}) {
  const {
    headsQuery,
    identityQuery,
    membershipQuery,
    record,
    currentPubkey,
    communityAdmin,
    isOwner,
  } = useWorkActionContext(workItemId);
  const { goCompanyWorkDetail } = useAppNavigation();
  const { mutation, submit } = useNavigateAfterAction(workItemId);
  const [status, setStatus] = React.useState<CompanyWorkStatus>("active");
  const [reason, setReason] = React.useState("");
  const [initializedId, setInitializedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (record && initializedId !== record.head.workItemId) {
      setInitializedId(record.head.workItemId);
      setStatus(record.head.status);
    }
  }, [initializedId, record]);

  if (
    headsQuery.isPending ||
    identityQuery.isPending ||
    membershipQuery.isPending
  ) {
    return (
      <WorkActionPage title="Update work status">
        <div
          className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"
          role="status"
        >
          Loading work item
        </div>
      </WorkActionPage>
    );
  }
  if (headsQuery.isError || identityQuery.isError || membershipQuery.isError) {
    return (
      <WorkActionPage title="Update work status">
        <CompanyWorkBackButton
          onClick={() => void goCompanyWorkDetail(workItemId)}
        />
        <h1 className="text-2xl font-bold tracking-tight">
          Update work status
        </h1>
        <div className="mt-8 rounded-lg border border-border p-6">
          <h2 className="text-base font-semibold">Work item unavailable</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {headsQuery.isError
              ? messageOf(headsQuery.error)
              : "Your identity or permissions could not be checked."}
          </p>
          <Button
            className="mt-5"
            onClick={() => {
              void headsQuery.refetch();
              void identityQuery.refetch();
              void membershipQuery.refetch();
            }}
            variant="outline"
          >
            Try again
          </Button>
        </div>
      </WorkActionPage>
    );
  }
  if (
    !record ||
    !currentPubkey ||
    record.head.status === "archived" ||
    record.head.status === "done_verified"
  ) {
    return (
      <WorkActionPage title="Update work status">
        <CompanyWorkBackButton
          onClick={() => void goCompanyWorkDetail(workItemId)}
        />
        <h1 className="text-2xl font-bold tracking-tight">
          Update work status
        </h1>
        <div className="mt-8 rounded-lg border border-border p-6">
          <h2 className="text-base font-semibold">
            This work item cannot change status.
          </h2>
        </div>
      </WorkActionPage>
    );
  }
  const canChangeStatus = isOwner || communityAdmin;
  if (!canChangeStatus) {
    return (
      <WorkActionPage title="Update work status">
        <CompanyWorkBackButton
          onClick={() => void goCompanyWorkDetail(workItemId)}
        />
        <h1 className="text-2xl font-bold tracking-tight">
          Update work status
        </h1>
        <div className="mt-8 rounded-lg border border-border p-6">
          <h2 className="text-base font-semibold">
            You cannot change this work status.
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Only the work owner or a community owner or admin can change status.
          </p>
        </div>
      </WorkActionPage>
    );
  }

  const statuses: CompanyWorkStatus[] = [
    "active",
    "paused",
    "blocked",
    ...(isOwner ? ["done_unverified" as const] : []),
  ];
  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reason.trim()) return;
    const action: CompanyWorkAction = {
      schemaVersion: COMPANY_WORK_SCHEMA_VERSION,
      workItemId,
      action: "set_status",
      expectedHeadEventId: record.event.id,
      status,
      reason: reason.trim(),
    };
    try {
      await submit(record.channelId, action);
    } catch {
      // Preserve the selected status and reason after a rejected save.
    }
  };

  return (
    <WorkActionPage title="Update work status">
      <CompanyWorkBackButton
        onClick={() => void goCompanyWorkDetail(workItemId)}
      />
      <h1 className="text-2xl font-bold tracking-tight">Update work status</h1>
      <p className="mt-2 text-sm text-muted-foreground">{record.head.title}</p>
      {mutation.isError ? (
        <p
          className="mt-5 rounded-lg border border-destructive/40 p-4 text-sm text-destructive"
          role="alert"
        >
          {messageOf(mutation.error)}
        </p>
      ) : null}
      <form className="mt-7 grid max-w-3xl gap-5" onSubmit={onSubmit}>
        <label
          className="grid gap-2 text-sm font-medium"
          htmlFor="company-work-status"
        >
          Status
          <select
            className="h-9 w-full rounded-lg border border-input/40 bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
            data-testid="company-work-status"
            id="company-work-status"
            onChange={(event) =>
              setStatus(event.target.value as CompanyWorkStatus)
            }
            value={status}
          >
            {statuses.map((option) => (
              <option key={option} value={option}>
                {option.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label
          className="grid gap-2 text-sm font-medium"
          htmlFor="company-work-status-reason"
        >
          Reason or update
          <Textarea
            data-testid="company-work-status-reason"
            id="company-work-status-reason"
            maxLength={4_000}
            onChange={(event) => setReason(event.target.value)}
            required
            value={reason}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button disabled={mutation.isPending || !reason.trim()} type="submit">
            {mutation.isPending ? "Saving status" : "Save status"}
          </Button>
          <Button
            onClick={() => void goCompanyWorkDetail(workItemId)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
        </div>
      </form>
    </WorkActionPage>
  );
}

export function CompanyWorkVerifyScreen({
  workItemId,
}: {
  workItemId: string;
}) {
  const {
    headsQuery,
    identityQuery,
    membershipQuery,
    record,
    currentPubkey,
    communityAdmin,
    isRequester,
  } = useWorkActionContext(workItemId);
  const { goCompanyWorkDetail } = useAppNavigation();
  const { mutation, submit } = useNavigateAfterAction(workItemId);
  const [verdict, setVerdict] = React.useState<CompanyWorkVerdict>("pass");
  const [reason, setReason] = React.useState("");
  const reviewerProfilesQuery = useUsersBatchQuery(
    currentPubkey ? [currentPubkey] : [],
  );
  const reviewerLabel = currentPubkey
    ? resolveUserLabel({
        currentPubkey,
        profiles: reviewerProfilesQuery.data?.profiles,
        pubkey: currentPubkey,
        preferResolvedSelfLabel: true,
      })
    : "";

  if (
    headsQuery.isPending ||
    identityQuery.isPending ||
    membershipQuery.isPending
  ) {
    return (
      <WorkActionPage title="Review completed work">
        <div
          className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"
          role="status"
        >
          Loading work item
        </div>
      </WorkActionPage>
    );
  }
  if (headsQuery.isError || identityQuery.isError || membershipQuery.isError) {
    return (
      <WorkActionPage title="Review completed work">
        <CompanyWorkBackButton
          onClick={() => void goCompanyWorkDetail(workItemId)}
        />
        <h1 className="text-2xl font-bold tracking-tight">
          Review completed work
        </h1>
        <p className="mt-5 text-sm text-muted-foreground" role="alert">
          {headsQuery.isError
            ? messageOf(headsQuery.error)
            : "Your identity or permissions could not be checked."}
        </p>
      </WorkActionPage>
    );
  }
  if (!record || !currentPubkey || record.head.status !== "done_unverified") {
    return (
      <WorkActionPage title="Review completed work">
        <CompanyWorkBackButton
          onClick={() => void goCompanyWorkDetail(workItemId)}
        />
        <h1 className="text-2xl font-bold tracking-tight">
          Review completed work
        </h1>
        <div className="mt-8 rounded-lg border border-border p-6">
          <h2 className="text-base font-semibold">
            This work item is not awaiting verification.
          </h2>
        </div>
      </WorkActionPage>
    );
  }
  if (!isRequester && !communityAdmin) {
    return (
      <WorkActionPage title="Review completed work">
        <CompanyWorkBackButton
          onClick={() => void goCompanyWorkDetail(workItemId)}
        />
        <h1 className="text-2xl font-bold tracking-tight">
          Review completed work
        </h1>
        <div className="mt-8 rounded-lg border border-border p-6">
          <h2 className="text-base font-semibold">
            You cannot verify this work item.
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            A community owner, admin, or the person who requested the work can
            review it.
          </p>
        </div>
      </WorkActionPage>
    );
  }
  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reason.trim()) return;
    const verificationEvidence = record.head.evidence?.trim() || reason.trim();
    const action: CompanyWorkAction = {
      schemaVersion: COMPANY_WORK_SCHEMA_VERSION,
      workItemId,
      action: "verify",
      expectedHeadEventId: record.event.id,
      verification: {
        verdict,
        reason: reason.trim(),
        evidence: verificationEvidence,
      },
    };
    try {
      await submit(record.channelId, action);
    } catch {
      // Preserve the entered review note and verdict after a rejected save.
    }
  };

  return (
    <WorkActionPage title="Review completed work">
      <CompanyWorkBackButton
        onClick={() => void goCompanyWorkDetail(workItemId)}
      />
      <h1 className="text-2xl font-bold tracking-tight">
        Review completed work
      </h1>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold">{record.head.title}</h2>
        <CompanyWorkStatusBadge status={record.head.status} />
      </div>
      <div className="mt-6 max-w-3xl rounded-lg border border-border p-4">
        <strong className="text-sm">Done condition</strong>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
          {record.head.doneCondition}
        </p>
      </div>
      <div className="mt-4 max-w-3xl rounded-lg border border-border p-4">
        <p className="whitespace-pre-wrap text-sm leading-6">
          {record.head.evidence || "No deliverable supplied."}
        </p>
      </div>
      {mutation.isError ? (
        <p
          className="mt-5 max-w-3xl rounded-lg border border-destructive/40 p-4 text-sm text-destructive"
          role="alert"
        >
          {messageOf(mutation.error)}
        </p>
      ) : null}
      <form className="mt-5 grid max-w-3xl gap-5" onSubmit={onSubmit}>
        <div className="grid gap-2 text-sm">
          <span className="font-medium">Reviewer</span>
          <span className="rounded-lg border border-border bg-muted/30 px-3 py-2">
            {reviewerLabel || "Your identity is unavailable"}
          </span>
        </div>
        <label
          className="grid gap-2 text-sm font-medium"
          htmlFor="company-work-verdict"
        >
          Verdict
          <select
            className="h-9 w-full rounded-lg border border-input/40 bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
            data-testid="company-work-verdict"
            id="company-work-verdict"
            onChange={(event) =>
              setVerdict(event.target.value as CompanyWorkVerdict)
            }
            value={verdict}
          >
            <option value="pass">Pass: meets the done condition</option>
            <option value="revision_requested">
              Request revision: more work needed
            </option>
          </select>
        </label>
        <label
          className="grid gap-2 text-sm font-medium"
          htmlFor="company-work-review-note"
        >
          Reason and evidence checked
          <Textarea
            data-testid="company-work-review-note"
            id="company-work-review-note"
            maxLength={4_000}
            onChange={(event) => setReason(event.target.value)}
            required
            value={reason}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button disabled={mutation.isPending || !reason.trim()} type="submit">
            {mutation.isPending ? "Recording verdict" : "Record verdict"}
          </Button>
          <Button
            onClick={() => void goCompanyWorkDetail(workItemId)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
        </div>
      </form>
    </WorkActionPage>
  );
}

export function CompanyWorkArchiveScreen({
  workItemId,
}: {
  workItemId: string;
}) {
  const {
    headsQuery,
    identityQuery,
    membershipQuery,
    record,
    currentPubkey,
    communityAdmin,
    isOwner,
    isRequester,
  } = useWorkActionContext(workItemId);
  const { goCompanyWorkDetail } = useAppNavigation();
  const { mutation, submit } = useNavigateAfterAction(workItemId);

  if (
    headsQuery.isPending ||
    identityQuery.isPending ||
    membershipQuery.isPending
  ) {
    return (
      <WorkActionPage title="Archive work item">
        <div
          className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"
          role="status"
        >
          Loading work item
        </div>
      </WorkActionPage>
    );
  }
  if (headsQuery.isError || identityQuery.isError || membershipQuery.isError) {
    return (
      <WorkActionPage title="Archive work item">
        <CompanyWorkBackButton
          onClick={() => void goCompanyWorkDetail(workItemId)}
        />
        <h1 className="text-2xl font-bold tracking-tight">
          Archive work item?
        </h1>
        <p className="mt-5 text-sm text-muted-foreground" role="alert">
          {headsQuery.isError
            ? messageOf(headsQuery.error)
            : "Your identity or permissions could not be checked."}
        </p>
      </WorkActionPage>
    );
  }
  if (!record || !currentPubkey || record.head.status === "archived") {
    return (
      <WorkActionPage title="Archive work item">
        <CompanyWorkBackButton
          onClick={() => void goCompanyWorkDetail(workItemId)}
        />
        <h1 className="text-2xl font-bold tracking-tight">
          Archive work item?
        </h1>
        <div className="mt-8 rounded-lg border border-border p-6">
          <h2 className="text-base font-semibold">
            This work item cannot be archived.
          </h2>
        </div>
      </WorkActionPage>
    );
  }
  if (!isOwner && !isRequester && !communityAdmin) {
    return (
      <WorkActionPage title="Archive work item">
        <CompanyWorkBackButton
          onClick={() => void goCompanyWorkDetail(workItemId)}
        />
        <h1 className="text-2xl font-bold tracking-tight">
          Archive work item?
        </h1>
        <div className="mt-8 rounded-lg border border-border p-6">
          <h2 className="text-base font-semibold">
            You cannot archive this work item.
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Only the work owner, requester, or a community owner or admin can
            archive it.
          </p>
        </div>
      </WorkActionPage>
    );
  }
  const onArchive = async () => {
    const action: CompanyWorkAction = {
      schemaVersion: COMPANY_WORK_SCHEMA_VERSION,
      workItemId,
      action: "archive",
      expectedHeadEventId: record.event.id,
    };
    try {
      await submit(record.channelId, action);
    } catch {
      // The confirmation remains available after a rejected save.
    }
  };

  return (
    <WorkActionPage title="Archive work item">
      <CompanyWorkBackButton
        onClick={() => void goCompanyWorkDetail(workItemId)}
      />
      <h1 className="text-2xl font-bold tracking-tight">Archive work item?</h1>
      <div className="mt-7 max-w-3xl rounded-lg border border-border p-6">
        <h2 className="text-base font-semibold">{record.head.title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          The commitment leaves active work. Its conversation and history
          remain.
        </p>
        {mutation.isError ? (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {messageOf(mutation.error)}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button
            disabled={mutation.isPending}
            onClick={() => void onArchive()}
          >
            {mutation.isPending ? "Archiving work item" : "Archive item"}
          </Button>
          <Button
            onClick={() => void goCompanyWorkDetail(workItemId)}
            variant="outline"
          >
            Cancel
          </Button>
        </div>
      </div>
    </WorkActionPage>
  );
}
