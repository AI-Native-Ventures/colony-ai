import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CircleDot } from "lucide-react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import {
  resolveUserLabel,
  type UserProfileLookup,
} from "@/features/profile/lib/identity";
import { useGoalHeadsQuery } from "@/features/goals/goalRelay";
import { useIdentityQuery } from "@/shared/api/hooks";
import { relayClient } from "@/shared/api/relayClient";
import {
  KIND_STREAM_MESSAGE,
  KIND_STREAM_MESSAGE_V2,
} from "@/shared/constants/kinds";
import { Button } from "@/shared/ui/button";
import {
  useCompanyWorkActionMutation,
  useCompanyWorkHeadsQuery,
  useCompanyWorkHistoryQuery,
} from "../hooks";
import type {
  CompanyWorkAction,
  CompanyWorkHistoryEntry,
} from "../companyWorkModels";
import { COMPANY_WORK_SCHEMA_VERSION } from "../companyWorkModels";
import {
  companyWorkPrimaryButtonClass,
  CompanyWorkBackButton,
  CompanyWorkPageHeader,
  CompanyWorkStatusBadge,
  companyWorkStatusLabel,
} from "./CompanyWorkPresentation";

function actionLabel(entry: CompanyWorkHistoryEntry): string {
  switch (entry.action.action) {
    case "create":
      return "created this commitment.";
    case "update":
      return "updated this work item.";
    case "set_status":
      return (
        "changed the status to " +
        companyWorkStatusLabel(entry.action.status ?? "active") +
        "."
      );
    case "verify":
      return entry.action.verification?.verdict === "pass"
        ? "verified the done condition."
        : "requested revisions.";
    case "archive":
      return "archived this work item.";
    case "restore":
      return "restored this work item.";
  }
}

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}

function DetailError({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="mt-8 rounded-lg border border-border p-6">
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
      <Button className="mt-5" onClick={onRetry} variant="outline">
        Try again
      </Button>
    </div>
  );
}

export function CompanyWorkDetailScreen({
  workItemId,
}: {
  workItemId: string;
}) {
  const headsQuery = useCompanyWorkHeadsQuery();
  const { activeCommunity } = useCommunities();
  const channelsQuery = useChannelsQuery();
  const goalsQuery = useGoalHeadsQuery();
  const identityQuery = useIdentityQuery();
  const membershipQuery = useMyRelayMembershipQuery();
  const mutation = useCompanyWorkActionMutation();
  const record = headsQuery.data?.find(
    (candidate) => candidate.head.workItemId === workItemId,
  );
  const historyQuery = useCompanyWorkHistoryQuery(
    record?.channelId ?? null,
    record?.head.workItemId ?? null,
    Boolean(record),
  );
  const currentPubkey = identityQuery.data?.pubkey.toLowerCase();
  const communityRole = membershipQuery.data?.role;
  const communityAdmin = communityRole === "owner" || communityRole === "admin";
  const head = record?.head;
  const goalRecords = goalsQuery.data ?? [];
  const linkedGoal = head?.goalId
    ? goalRecords.find((candidate) => candidate.head.goalId === head.goalId)
    : undefined;
  const parentGoalId = linkedGoal?.head.goal?.parentGoalId;
  const parentGoal = parentGoalId
    ? goalRecords.find((candidate) => candidate.head.goalId === parentGoalId)
    : undefined;
  const conversationRootQuery = useQuery({
    enabled: Boolean(record?.channelId && head?.threadRootEventId),
    queryKey: [
      "company-work-thread-root",
      activeCommunity?.relayUrl ?? null,
      record?.channelId ?? null,
      head?.threadRootEventId ?? null,
    ],
    queryFn: async () => {
      if (!record?.channelId || !head?.threadRootEventId) return null;
      const events = await relayClient.fetchEvents({
        kinds: [KIND_STREAM_MESSAGE, KIND_STREAM_MESSAGE_V2],
        ids: [head.threadRootEventId],
        "#h": [record.channelId],
        limit: 1,
      });
      return events[0]?.content ?? null;
    },
    staleTime: 60_000,
  });
  const history = historyQuery.data ?? [];
  const pubkeys = React.useMemo(
    () => [
      ...new Set(
        [
          ...(head?.assignedPubkeys ?? []),
          head?.requesterPubkey,
          head?.verification?.reviewerPubkey,
          linkedGoal?.head.goal?.ownerPubkey,
          ...history.map((entry) => entry.event.pubkey),
        ].filter((pubkey): pubkey is string => Boolean(pubkey)),
      ),
    ],
    [head, history, linkedGoal],
  );
  const profilesQuery = useUsersBatchQuery(pubkeys);
  const profiles: UserProfileLookup | undefined = profilesQuery.data?.profiles;
  const channels = channelsQuery.data ?? [];
  const {
    goCompanyWork,
    goCompanyWorkArchive,
    goCompanyWorkEdit,
    goCompanyWorkStatus,
    goCompanyWorkVerify,
    goChannel,
    goGoal,
  } = useAppNavigation();

  const canOwn = Boolean(
    currentPubkey &&
      head?.assignedPubkeys.some(
        (pubkey) => pubkey.toLowerCase() === currentPubkey,
      ),
  );
  const canRequest = Boolean(
    currentPubkey && head?.requesterPubkey.toLowerCase() === currentPubkey,
  );
  const canEdit = Boolean(canOwn || canRequest || communityAdmin);
  const canChangeStatus = Boolean(canOwn || communityAdmin);
  const canVerify = Boolean(canRequest || communityAdmin);
  const canArchive = Boolean(canOwn || canRequest || communityAdmin);

  const handleSimpleAction = async (
    actionKind: Extract<CompanyWorkAction["action"], "archive" | "restore">,
  ) => {
    if (!record) return;
    const action: CompanyWorkAction = {
      schemaVersion: COMPANY_WORK_SCHEMA_VERSION,
      workItemId: record.head.workItemId,
      action: actionKind,
      expectedHeadEventId: record.event.id,
    };
    try {
      await mutation.mutateAsync({ channelId: record.channelId, action });
    } catch {
      // The relay error is presented below. The detail stays available for recovery.
    }
  };

  if (headsQuery.isPending || channelsQuery.isPending) {
    return (
      <>
        <CompanyWorkPageHeader title="Work" />
        <div
          className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"
          role="status"
        >
          Loading work item
        </div>
      </>
    );
  }
  if (headsQuery.isError || channelsQuery.isError) {
    return (
      <>
        <CompanyWorkPageHeader title="Work" />
        <main className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <CompanyWorkBackButton onClick={() => void goCompanyWork()} />
          <h1 className="text-2xl font-bold tracking-tight">
            Work item unavailable
          </h1>
          <DetailError
            message={
              headsQuery.isError
                ? errorText(headsQuery.error)
                : "Conversations could not be loaded."
            }
            onRetry={() => {
              void headsQuery.refetch();
              void channelsQuery.refetch();
            }}
            title="The work item could not be loaded."
          />
        </main>
      </>
    );
  }
  if (!record || !head) {
    return (
      <>
        <CompanyWorkPageHeader title="Work" />
        <main className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <CompanyWorkBackButton onClick={() => void goCompanyWork()} />
          <h1 className="text-2xl font-bold tracking-tight">
            Work item unavailable
          </h1>
          <div className="mt-8 rounded-lg border border-border p-6">
            <h2 className="text-base font-semibold">
              This work item could not be found in the current community.
            </h2>
          </div>
        </main>
      </>
    );
  }

  const ownerLabel = resolveUserLabel({
    currentPubkey,
    profiles,
    pubkey: head.assignedPubkeys[0] ?? "",
    preferResolvedSelfLabel: true,
  });
  const requesterLabel = resolveUserLabel({
    currentPubkey,
    profiles,
    pubkey: head.requesterPubkey,
    preferResolvedSelfLabel: true,
  });
  const channel = channels.find(
    (candidate) => candidate.id === record.channelId,
  );
  const goalOwnerLabel = linkedGoal?.head.goal
    ? resolveUserLabel({
        currentPubkey,
        profiles,
        pubkey: linkedGoal.head.goal.ownerPubkey,
        preferResolvedSelfLabel: true,
      })
    : "";
  const review = head.verification;
  const conversationPreview = conversationRootQuery.data
    ?.split(/\r?\n/, 1)[0]
    ?.replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
  const conversationMessageId = head.sourceEventId ?? head.threadRootEventId;
  const openConversation = () => {
    if (!channel) return;
    void goChannel(record.channelId, {
      ...(conversationMessageId
        ? {
            messageId: conversationMessageId,
            threadRootId: head.threadRootEventId ?? null,
          }
        : {}),
    });
  };

  return (
    <>
      <CompanyWorkPageHeader title={head.title} />
      <main
        className="mx-auto w-full max-w-[1230px] px-8 py-8"
        data-testid="company-work-detail"
      >
        <CompanyWorkBackButton onClick={() => void goCompanyWork()} />
        <h1 className="max-w-3xl text-2xl font-bold tracking-tight">
          {head.title}
        </h1>
        {head.status === "archived" ? (
          <div className="mt-5 rounded-lg border border-border bg-muted/30 p-4">
            <strong className="text-sm">This work item is archived.</strong>
            <p className="mt-1 text-sm text-muted-foreground">
              Its history and links are retained. Restore it to resume work.
            </p>
          </div>
        ) : null}
        <div className="my-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <CompanyWorkStatusBadge status={head.status} />
          <span>
            Owner:{" "}
            <strong className="font-semibold text-foreground">
              {ownerLabel}
            </strong>
          </span>
          <span>
            Requested by{" "}
            <strong className="font-semibold text-foreground">
              {requesterLabel}
            </strong>
          </span>
        </div>
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.8fr)_minmax(240px,1fr)] lg:gap-12">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Done condition</h2>
            <p className="mt-2 max-w-2xl whitespace-pre-wrap text-sm leading-7">
              {head.doneCondition}
            </p>
            <h2 className="mt-7 text-base font-semibold">Goal</h2>
            {head.goalId && linkedGoal?.head.goal ? (
              <button
                aria-label={`Open goal: ${linkedGoal.head.title}`}
                className="mt-3 flex w-full items-center gap-3 rounded-lg border border-border bg-[#f8f7f8] p-5 text-left transition-colors hover:bg-[#f4f0f7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:bg-[#302b38] dark:hover:bg-[#39313f]"
                data-testid="company-work-goal-card"
                onClick={() => void goGoal(head.goalId ?? "")}
                type="button"
              >
                <CircleDot
                  aria-hidden="true"
                  className="size-5 shrink-0 text-primary"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-2xs text-muted-foreground">
                    {linkedGoal.head.goal.parentGoalId
                      ? "SUB-GOAL"
                      : "COMPANY GOAL"}{" "}
                    · {linkedGoal.head.goalId.slice(0, 8).toUpperCase()}
                  </span>
                  <span className="mt-1 block text-sm font-semibold leading-6">
                    {linkedGoal.head.title}
                  </span>
                  <span className="mt-1 block text-2xs text-muted-foreground">
                    {goalOwnerLabel} · {linkedGoal.head.status}
                    {parentGoal ? ` · Part of ${parentGoal.head.title}` : ""}
                  </span>
                </span>
                <ArrowUpRight
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground"
                />
              </button>
            ) : head.goalId ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Linked goal unavailable.
              </p>
            ) : null}
            <h2 className="mt-7 text-base font-semibold">
              Deliverable and evidence
            </h2>
            <div className="mt-3 rounded-lg border border-border p-4">
              <p className="whitespace-pre-wrap text-sm leading-6">
                {head.evidence || "No evidence submitted yet."}
              </p>
            </div>
            {review ? (
              <div
                className="mt-4 rounded-lg border border-border p-4"
                data-testid="company-work-verification"
              >
                <h3 className="text-sm font-semibold">
                  {review.verdict === "pass"
                    ? "Verification passed"
                    : "Revision requested"}
                </h3>
                <p className="mt-2 text-sm leading-6">{review.reason}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                  {review.evidence}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">
                  Reviewed by{" "}
                  {resolveUserLabel({
                    currentPubkey,
                    profiles,
                    pubkey: review.reviewerPubkey,
                    preferResolvedSelfLabel: true,
                  })}
                </p>
              </div>
            ) : null}
            {head.statusReason ? (
              <p className="mt-3 text-sm text-muted-foreground">
                {head.statusReason}
              </p>
            ) : null}
            <h2 className="mt-7 text-base font-semibold">History</h2>
            {historyQuery.isPending ? (
              <p className="mt-3 text-sm text-muted-foreground" role="status">
                Loading history
              </p>
            ) : null}
            {historyQuery.isError ? (
              <DetailError
                message={errorText(historyQuery.error)}
                onRetry={() => void historyQuery.refetch()}
                title="History is unavailable."
              />
            ) : null}
            {history.length > 0 ? (
              <ol className="mt-3 pl-0">
                {history.map((entry) => (
                  <li
                    className="relative border-l border-border pb-4 pl-4 before:absolute before:-left-[3px] before:top-1.5 before:size-1.5 before:rounded-full before:bg-primary"
                    key={entry.event.id}
                  >
                    <strong className="block text-xs font-semibold">
                      {resolveUserLabel({
                        currentPubkey,
                        profiles,
                        pubkey: entry.event.pubkey,
                        preferResolvedSelfLabel: true,
                      })}{" "}
                      {actionLabel(entry)}
                    </strong>
                    {entry.action.reason ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                        {entry.action.reason}
                      </p>
                    ) : null}
                    {entry.action.verification?.evidence ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6">
                        {entry.action.verification.evidence}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
          <aside className="border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <h2 className="text-base font-semibold">Conversation</h2>
            <Button
              className="mt-3 w-full justify-center font-semibold"
              disabled={!channel}
              onClick={openConversation}
              variant="outline"
            >
              {channel
                ? `# ${channel.name}${conversationPreview ? ` · ${conversationPreview}` : ""}`
                : "Conversation unavailable"}
            </Button>
            {canEdit && head.status !== "archived" ? (
              <Button
                className="mt-2 w-full font-semibold"
                onClick={() => void goCompanyWorkEdit(workItemId)}
                variant="outline"
              >
                Edit work item
              </Button>
            ) : null}
            {canChangeStatus &&
            head.status !== "archived" &&
            head.status !== "done_verified" ? (
              <Button
                className="mt-2 w-full font-semibold"
                onClick={() => void goCompanyWorkStatus(workItemId)}
                variant="outline"
              >
                Update status
              </Button>
            ) : null}
            {canVerify && head.status === "done_unverified" ? (
              <Button
                className={`mt-2 w-full font-semibold ${companyWorkPrimaryButtonClass}`}
                onClick={() => void goCompanyWorkVerify(workItemId)}
              >
                Review and verify
              </Button>
            ) : null}
            {canArchive && head.status !== "archived" ? (
              <Button
                className="mt-2 w-full font-semibold"
                onClick={() => void goCompanyWorkArchive(workItemId)}
                variant="ghost"
              >
                Archive work item
              </Button>
            ) : null}
            {canArchive && head.status === "archived" ? (
              <Button
                className="mt-2 w-full font-semibold"
                disabled={mutation.isPending}
                onClick={() => void handleSimpleAction("restore")}
                variant="outline"
              >
                {mutation.isPending
                  ? "Restoring work item"
                  : "Restore work item"}
              </Button>
            ) : null}
            {mutation.isError ? (
              <p className="mt-3 text-sm text-destructive" role="alert">
                {errorText(mutation.error)}
              </p>
            ) : null}
            {identityQuery.isError || membershipQuery.isError ? (
              <p className="mt-3 text-xs text-muted-foreground" role="status">
                Permissions could not be checked. Work actions are unavailable.
              </p>
            ) : null}
            {profilesQuery.isError ? (
              <p className="mt-3 text-xs text-muted-foreground" role="status">
                Some names are unavailable.
              </p>
            ) : null}
          </aside>
        </div>
      </main>
    </>
  );
}
