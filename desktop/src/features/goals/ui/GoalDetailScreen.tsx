import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { useIdentityQuery } from "@/shared/api/hooks";
import { Button } from "@/shared/ui/button";
import { useCompanyWorkHeadsQuery } from "@/features/company-work/hooks";
import { CompanyWorkListRow } from "@/features/company-work/ui/CompanyWorkPresentation";
import {
  canCreateSubgoal,
  canEditGoal,
  canRestoreOrDeleteGoal,
  parseGoalActionEvent,
} from "../goalModels";
import {
  useGoalActionMutation,
  useGoalHeadQuery,
  useGoalHeadsQuery,
  useGoalHistoryQuery,
} from "../goalRelay";
import { GoalListRow, GoalStatusLabel } from "./GoalsScreen";
import { GoalRouteBackLink, GoalRouteHeader } from "./GoalRouteHeader";

function shortGoalId(goalId: string): string {
  return goalId.slice(0, 8).toUpperCase();
}

function GoalUnavailable({
  deleted,
  onBack,
}: {
  deleted?: boolean;
  onBack: () => void;
}) {
  return (
    <>
      <GoalRouteHeader title="Goal unavailable" />
      <section
        aria-labelledby="goal-unavailable-title"
        className="mx-auto w-full max-w-[1230px] px-8 py-8"
      >
        <GoalRouteBackLink onClick={onBack} />
        <h1
          className="text-2xl font-semibold tracking-tight"
          id="goal-unavailable-title"
        >
          Goal unavailable
        </h1>
        <div className="mt-8 rounded-lg border border-border p-6">
          <h2 className="text-base font-semibold">
            {deleted ? "This goal was deleted." : "This goal is unavailable."}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {deleted
              ? "Its old references remain as a deleted-goal marker."
              : "This goal could not be found in the current community."}
          </p>
          <Button className="mt-5" onClick={onBack}>
            Back to goals
          </Button>
        </div>
      </section>
    </>
  );
}

function historyLabel(action: string, parentGoal: boolean): string {
  switch (action) {
    case "create":
      return parentGoal
        ? "created this sub-goal."
        : "created this company goal.";
    case "update":
      return "updated this goal.";
    case "progress":
      return "recorded progress.";
    case "set_status":
      return "changed this goal’s status.";
    case "archive":
      return "archived this goal.";
    case "restore":
      return "restored this goal.";
    case "delete":
      return "deleted this goal.";
    default:
      return "updated this goal.";
  }
}

export function GoalDetailScreen({ goalId }: { goalId: string }) {
  const goalQuery = useGoalHeadQuery(goalId);
  const goalsQuery = useGoalHeadsQuery();
  const historyQuery = useGoalHistoryQuery(
    goalQuery.data?.dTag ?? null,
    Boolean(goalQuery.data),
  );
  const identityQuery = useIdentityQuery();
  const membershipQuery = useMyRelayMembershipQuery();
  const channelsQuery = useChannelsQuery();
  const companyWorkQuery = useCompanyWorkHeadsQuery();
  const mutation = useGoalActionMutation();
  const {
    goEditGoal,
    goGoal,
    goGoalArchive,
    goGoalDelete,
    goGoalProgress,
    goGoals,
    goNewGoal,
    goChannel,
    goShareGoal,
    goNewCompanyWork,
  } = useAppNavigation();
  const record = goalQuery.data;
  const head = record?.head;
  const goal = head?.goal;
  const currentPubkey = identityQuery.data?.pubkey;
  const allGoals = goalsQuery.data ?? [];
  const children = React.useMemo(
    () =>
      allGoals
        .filter(
          (candidate) =>
            candidate.head.goal?.parentGoalId === goalId &&
            candidate.head.status !== "deleted",
        )
        .sort((left, right) => {
          const leftDueDate = left.head.goal?.dueDate ?? "9999-12-31";
          const rightDueDate = right.head.goal?.dueDate ?? "9999-12-31";
          return (
            leftDueDate.localeCompare(rightDueDate) ||
            left.head.title.localeCompare(right.head.title)
          );
        }),
    [allGoals, goalId],
  );
  const linkedWork = React.useMemo(
    () =>
      (companyWorkQuery.data ?? [])
        .filter((record) => record.head.goalId === goalId)
        .sort((left, right) => left.head.title.localeCompare(right.head.title)),
    [companyWorkQuery.data, goalId],
  );
  const linkedWorkPubkeys = React.useMemo(
    () =>
      linkedWork.flatMap((record) => [
        record.head.assignedPubkeys[0],
        record.head.requesterPubkey,
      ]),
    [linkedWork],
  );
  const ownerAndHistoryPubkeys = React.useMemo(() => {
    const pubkeys = new Set<string>();
    if (goal?.ownerPubkey) pubkeys.add(goal.ownerPubkey);
    for (const pubkey of linkedWorkPubkeys) {
      if (pubkey) pubkeys.add(pubkey);
    }
    for (const child of children) {
      const childOwner = child.head.goal?.ownerPubkey;
      if (childOwner) pubkeys.add(childOwner);
    }
    for (const event of historyQuery.data ?? []) pubkeys.add(event.pubkey);
    return [...pubkeys];
  }, [children, goal?.ownerPubkey, historyQuery.data, linkedWorkPubkeys]);
  const profilesQuery = useUsersBatchQuery(ownerAndHistoryPubkeys);
  const channels = channelsQuery.data ?? [];
  const role = membershipQuery.data?.role;

  const handleRestore = React.useCallback(async () => {
    if (!record) return;
    await mutation.mutateAsync({
      action: {
        schemaVersion: 1,
        goalId: record.head.goalId,
        action: "restore",
        expectedHeadEventId: record.event.id,
      },
    });
  }, [mutation, record]);

  if (goalQuery.isPending) {
    return (
      <>
        <GoalRouteHeader title="Goals" />
        <div
          className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"
          role="status"
        >
          Loading goal
        </div>
      </>
    );
  }

  if (goalQuery.isError) {
    return (
      <>
        <GoalRouteHeader title="Goal unavailable" />
        <section
          aria-labelledby="goal-load-error-title"
          className="mx-auto w-full max-w-[1230px] px-8 py-8"
        >
          <GoalRouteBackLink onClick={() => void goGoals()} />
          <h1
            className="text-2xl font-semibold tracking-tight"
            id="goal-load-error-title"
          >
            Goal unavailable
          </h1>
          <div className="mt-8 rounded-lg border border-border p-6">
            <h2 className="text-base font-semibold">
              The goal could not be loaded.
            </h2>
            <Button
              className="mt-5"
              onClick={() => void goalQuery.refetch()}
              variant="outline"
            >
              Try again
            </Button>
          </div>
        </section>
      </>
    );
  }

  if (!record || !head || head.status === "deleted" || !goal) {
    return (
      <GoalUnavailable
        deleted={head?.status === "deleted"}
        onBack={() => void goGoals()}
      />
    );
  }

  const parent = goal.parentGoalId
    ? allGoals.find((candidate) => candidate.head.goalId === goal.parentGoalId)
    : undefined;
  const parentName = parent?.head.title ?? "Archived parent";
  const ownerLabel = resolveUserLabel({
    currentPubkey,
    profiles: profilesQuery.data?.profiles,
    pubkey: goal.ownerPubkey,
    preferResolvedSelfLabel: true,
  });
  const permissionsResolved =
    membershipQuery.isSuccess && identityQuery.isSuccess;
  const canEdit = canEditGoal(role, currentPubkey, head);
  const canAddSubgoal = canCreateSubgoal(role, currentPubkey, head);
  const canRestore = head.status === "archived" && canRestoreOrDeleteGoal(role);
  const canDelete = canRestoreOrDeleteGoal(role);
  const linkedChannels = goal.linkedChannelIds.map((channelId) => ({
    id: channelId,
    channel: channels.find((candidate) => candidate.id === channelId),
  }));
  const target = goal.target ? Number(goal.target.value) : Number.NaN;
  const current = head.progress?.current
    ? Number(head.progress.current)
    : Number.NaN;
  const canShowMetric =
    Number.isFinite(target) && target > 0 && Number.isFinite(current);
  const history = (historyQuery.data ?? []).flatMap((event) => {
    const parsed = parseGoalActionEvent(event, record.dTag);
    return parsed ? [{ event: parsed.event, action: parsed.action }] : [];
  });

  return (
    <>
      <GoalRouteHeader title={head.title} />
      <main
        className="mx-auto w-full max-w-[1230px] px-8 py-8"
        data-testid="goal-detail"
      >
        <GoalRouteBackLink onClick={() => void goGoals()} />
        <h1 className="max-w-3xl text-2xl font-bold tracking-tight">
          {head.title}
        </h1>
        {head.status === "archived" ? (
          <div className="mt-5 rounded-lg border border-border bg-muted/30 p-4">
            <strong className="text-sm">This goal is archived.</strong>
            <p className="mt-1 text-sm text-muted-foreground">
              History and links are retained. Restore it to resume tracking.
            </p>
          </div>
        ) : null}
        <div className="my-4 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <GoalStatusLabel status={head.status} />
          <span>
            Owner:{" "}
            <strong className="font-semibold text-foreground">
              {ownerLabel}
            </strong>
          </span>
          <span>
            Due:{" "}
            <strong className="font-semibold text-foreground">
              {goal.dueDate ?? "Not set"}
            </strong>
          </span>
          <span>
            ID:{" "}
            <strong className="font-semibold text-foreground">
              {shortGoalId(goal.goalId)}
            </strong>
          </span>
        </div>
        {goal.parentGoalId ? (
          <div className="mb-6 rounded-lg bg-muted/40 px-4 py-3 text-sm">
            Part of{" "}
            <button
              className="font-medium text-primary underline underline-offset-4"
              onClick={() => void goGoal(goal.parentGoalId ?? "")}
              type="button"
            >
              {parentName}
            </button>
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.8fr)_minmax(240px,1fr)] lg:gap-12">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">What done means</h2>
            <p className="mt-2 max-w-2xl text-sm leading-7">
              {goal.doneCondition}
            </p>
            {goal.target ? (
              <div className="mt-6 grid gap-2">
                {canShowMetric ? (
                  <strong className="text-2xl">
                    {current}{" "}
                    <span className="text-base font-normal">of {target}</span>
                  </strong>
                ) : (
                  <strong className="text-2xl">{goal.target.value}</strong>
                )}
                <span className="text-sm text-muted-foreground">
                  {goal.target.unit}
                </span>
                {canShowMetric ? (
                  <progress
                    aria-label={`${current} of ${target} ${goal.target.unit}`}
                    className="my-2 h-1.5 w-full accent-[#637fb1] dark:accent-[#8aa6d8]"
                    max={target}
                    value={current}
                  />
                ) : null}
                <span className="text-xs text-muted-foreground">
                  A target reaching 100% does not automatically mark the goal
                  achieved.
                </span>
              </div>
            ) : null}
            <div className="my-7 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold">
                Sub-goals{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  {children.length}
                </span>
              </h2>
              {head.status !== "archived" &&
              permissionsResolved &&
              canAddSubgoal ? (
                <Button onClick={() => void goNewGoal(goalId)} variant="ghost">
                  Add sub-goal
                </Button>
              ) : null}
            </div>
            {children.length ? (
              <div>
                {children.map((child) => (
                  <GoalListRow
                    key={child.head.goalId}
                    ownerLabel={resolveUserLabel({
                      currentPubkey,
                      profiles: profilesQuery.data?.profiles,
                      pubkey: child.head.goal?.ownerPubkey ?? "",
                      preferResolvedSelfLabel: true,
                    })}
                    record={child}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm leading-7 text-muted-foreground">
                No sub-goals yet. Break the outcome down when it helps.
              </p>
            )}
            {permissionsResolved &&
            !canAddSubgoal &&
            head.status !== "archived" ? (
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Only the community owner, an admin, or this goal’s owner can
                create a sub-goal.
              </p>
            ) : null}
            <div className="my-7 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold">
                Linked work{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  {linkedWork.length}
                </span>
              </h2>
              <Button
                onClick={() => {
                  const linkedChannel = goal.linkedChannelIds.find(
                    (channelId) =>
                      channels.some(
                        (candidate) =>
                          candidate.id === channelId &&
                          candidate.channelType === "stream" &&
                          candidate.isMember &&
                          candidate.archivedAt === null,
                      ),
                  );
                  void goNewCompanyWork({
                    goal: goalId,
                    ...(linkedChannel ? { channel: linkedChannel } : {}),
                  });
                }}
                variant="ghost"
              >
                Link work
              </Button>
            </div>
            {companyWorkQuery.isPending ? (
              <p className="mt-3 text-sm text-muted-foreground" role="status">
                Loading linked work
              </p>
            ) : null}
            {companyWorkQuery.isError ? (
              <div className="mt-3">
                <p className="text-sm text-muted-foreground">
                  Linked work is unavailable.
                </p>
                <Button
                  className="mt-2"
                  onClick={() => void companyWorkQuery.refetch()}
                  variant="outline"
                >
                  Try again
                </Button>
              </div>
            ) : null}
            {companyWorkQuery.isSuccess && linkedWork.length === 0 ? (
              <p className="text-sm leading-7 text-muted-foreground">
                No work is linked to this goal yet.
              </p>
            ) : null}
            {linkedWork.length > 0 ? (
              <div className="mt-1">
                {linkedWork.map((record) => {
                  const linkedChannel = channels.find(
                    (candidate) => candidate.id === record.channelId,
                  );
                  return (
                    <CompanyWorkListRow
                      channelLabel={
                        linkedChannel?.name ?? record.channelId.slice(0, 8)
                      }
                      key={record.head.workItemId}
                      ownerLabel={resolveUserLabel({
                        currentPubkey,
                        profiles: profilesQuery.data?.profiles,
                        pubkey: record.head.assignedPubkeys[0] ?? "",
                        preferResolvedSelfLabel: true,
                      })}
                      record={record}
                    />
                  );
                })}
              </div>
            ) : null}
            <h2 className="mt-8 text-base font-semibold">History</h2>
            {historyQuery.isPending ? (
              <p className="mt-3 text-sm text-muted-foreground" role="status">
                Loading history
              </p>
            ) : null}
            {historyQuery.isError ? (
              <p className="mt-3 text-sm text-muted-foreground">
                History is unavailable.
              </p>
            ) : null}
            {!historyQuery.isPending &&
            !historyQuery.isError &&
            history.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No history available.
              </p>
            ) : null}
            {history.length > 0 ? (
              <ol className="mt-3 pl-0">
                {history.map(({ event, action }) => {
                  const actor = resolveUserLabel({
                    currentPubkey,
                    profiles: profilesQuery.data?.profiles,
                    pubkey: event.pubkey,
                    preferResolvedSelfLabel: true,
                  });
                  return (
                    <li
                      className="relative border-l border-border pb-4 pl-4 before:absolute before:-left-[3px] before:top-1.5 before:size-1.5 before:rounded-full before:bg-primary"
                      key={event.id}
                    >
                      <strong className="block text-xs font-semibold">
                        {actor}{" "}
                        {historyLabel(
                          action.action,
                          Boolean(goal.parentGoalId),
                        )}
                      </strong>
                      {action.progress?.evidence ? (
                        <p className="mt-2 text-sm leading-6">
                          {action.progress.evidence}
                        </p>
                      ) : null}
                      {action.reason ? (
                        <p className="mt-2 text-sm leading-6">
                          {action.reason}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ) : null}
          </div>
          <aside className="border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
            <h2 className="text-base font-semibold">Conversations</h2>
            {linkedChannels.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No linked conversations.
              </p>
            ) : null}
            {linkedChannels.map(({ id, channel }) => (
              <Button
                className="mt-2 w-full justify-start"
                key={id}
                onClick={() => channel && void goChannel(id)}
                variant="outline"
              >
                {channel
                  ? `# ${channel.name}`
                  : `Conversation unavailable · ${shortGoalId(id)}`}
              </Button>
            ))}
            <Button
              className="mt-2 w-full"
              onClick={() => void goShareGoal(goalId)}
              variant="outline"
            >
              Reference in a conversation
            </Button>
            <h2 className="mt-7 text-base font-semibold">Progress</h2>
            {permissionsResolved && canEdit && head.status !== "archived" ? (
              <Button
                className="mt-3 w-full"
                onClick={() => void goGoalProgress(goalId)}
                variant="outline"
              >
                Update progress
              </Button>
            ) : null}
            <h2 className="mt-7 text-base font-semibold">Manage goal</h2>
            {permissionsResolved && canEdit ? (
              <Button
                className="mt-2 w-full"
                onClick={() => void goEditGoal(goalId)}
                variant="outline"
              >
                Edit goal
              </Button>
            ) : null}
            {permissionsResolved && canEdit && head.status !== "archived" ? (
              <Button
                className="mt-2 w-full"
                onClick={() => void goGoalArchive(goalId)}
                variant="outline"
              >
                Archive goal
              </Button>
            ) : null}
            {permissionsResolved && canDelete ? (
              <Button
                className="mt-2 w-full text-[#a04f64] hover:bg-[#a04f64]/[0.08] dark:text-[#e8a1af] dark:hover:bg-[#e8a1af]/[0.08]"
                onClick={() => void goGoalDelete(goalId)}
                variant="ghost"
              >
                Delete goal
              </Button>
            ) : null}
            {permissionsResolved && canRestore ? (
              <Button
                className="mt-2 w-full"
                disabled={mutation.isPending}
                onClick={() => void handleRestore()}
                variant="outline"
              >
                {mutation.isPending ? "Restoring goal" : "Restore goal"}
              </Button>
            ) : null}
            {permissionsResolved && !canEdit ? (
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Only the goal owner, the community owner, or an admin can edit
                this goal.
              </p>
            ) : null}
            {permissionsResolved &&
            head.status === "archived" &&
            !canRestore ? (
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Only the community owner or an admin can restore an archived
                goal.
              </p>
            ) : null}
            {permissionsResolved && !canDelete ? (
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Only the community owner or an admin can delete a goal.
              </p>
            ) : null}
            {mutation.isError ? (
              <p className="mt-2 text-sm text-destructive">
                {mutation.error.message}
              </p>
            ) : null}
            {membershipQuery.isPending || identityQuery.isPending ? (
              <p className="mt-3 text-xs text-muted-foreground" role="status">
                Checking goal permissions
              </p>
            ) : null}
            {membershipQuery.isError ? (
              <div className="mt-3">
                <p className="text-xs text-muted-foreground">
                  Goal permissions could not be checked.
                </p>
                <Button
                  className="mt-2 w-full"
                  onClick={() => void membershipQuery.refetch()}
                  variant="outline"
                >
                  Try again
                </Button>
              </div>
            ) : null}
            {identityQuery.isError ? (
              <div className="mt-3">
                <p className="text-xs text-muted-foreground">
                  Your identity could not be checked.
                </p>
                <Button
                  className="mt-2 w-full"
                  onClick={() => void identityQuery.refetch()}
                  variant="outline"
                >
                  Try again
                </Button>
              </div>
            ) : null}
          </aside>
        </div>
      </main>
    </>
  );
}
