import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  COMPANY_WORK_SCHEMA_VERSION,
  type CompanyWorkAction,
  type CompanyWorkHeadRecord,
  type CompanyWorkInput,
} from "@/features/company-work/companyWorkModels";
import {
  useCompanyWorkActionMutation,
  useCompanyWorkHeadsQuery,
} from "@/features/company-work/hooks";
import { companyWorkStatusLabel } from "@/features/company-work/ui/CompanyWorkPresentation";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { useIdentityQuery } from "@/shared/api/hooks";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { useGoalHeadQuery } from "../goalRelay";
import { GoalRouteBackLink, GoalRouteHeader } from "./GoalRouteHeader";

type WorkLinkResult = { kind: "saved" } | { kind: "failed"; message: string };

function editableWorkInput(
  record: CompanyWorkHeadRecord,
  goalId: string | null,
): CompanyWorkInput {
  const head = record.head;
  return {
    schemaVersion: head.schemaVersion,
    workItemId: head.workItemId,
    title: head.title,
    status: head.status,
    assignedPubkeys: head.assignedPubkeys,
    approverPubkeys: head.approverPubkeys,
    deliverables: head.deliverables,
    requesterPubkey: head.requesterPubkey,
    doneCondition: head.doneCondition,
    ...(goalId ? { goalId } : {}),
    ...(head.sourceEventId ? { sourceEventId: head.sourceEventId } : {}),
    ...(head.threadRootEventId
      ? { threadRootEventId: head.threadRootEventId }
      : {}),
    ...(head.evidence ? { evidence: head.evidence } : {}),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The work link could not be saved.";
}

export function GoalWorkLinkScreen({ goalId }: { goalId: string }) {
  const goalQuery = useGoalHeadQuery(goalId);
  const workQuery = useCompanyWorkHeadsQuery();
  const identityQuery = useIdentityQuery();
  const mutation = useCompanyWorkActionMutation();
  const { goGoal } = useAppNavigation();
  const [savedGoalIds, setSavedGoalIds] = React.useState<Record<
    string,
    string | null
  > | null>(null);
  const [selectedById, setSelectedById] = React.useState<Record<
    string,
    boolean
  > | null>(null);
  const [results, setResults] = React.useState<Record<string, WorkLinkResult>>(
    {},
  );
  const [isSaving, setIsSaving] = React.useState(false);

  const workRecords = React.useMemo(
    () =>
      (workQuery.data ?? [])
        .filter((record) => record.head.status !== "archived")
        .sort((left, right) => left.head.title.localeCompare(right.head.title)),
    [workQuery.data],
  );

  React.useEffect(() => {
    if (!workQuery.isSuccess || savedGoalIds !== null) return;
    setSavedGoalIds(
      Object.fromEntries(
        workRecords.map((record) => [
          record.head.workItemId,
          record.head.goalId ?? null,
        ]),
      ),
    );
    setSelectedById(
      Object.fromEntries(
        workRecords.map((record) => [
          record.head.workItemId,
          record.head.goalId === goalId,
        ]),
      ),
    );
  }, [goalId, savedGoalIds, workQuery.isSuccess, workRecords]);

  const pubkeys = React.useMemo(
    () => [
      ...new Set(workRecords.flatMap((record) => record.head.assignedPubkeys)),
    ],
    [workRecords],
  );
  const profilesQuery = useUsersBatchQuery(pubkeys);
  const selected = selectedById ?? {};
  const pendingRecords = React.useMemo(
    () =>
      savedGoalIds === null || selectedById === null
        ? []
        : workRecords.filter(
            (record) =>
              Boolean(selectedById[record.head.workItemId]) !==
              (savedGoalIds[record.head.workItemId] === goalId),
          ),
    [goalId, savedGoalIds, selectedById, workRecords],
  );
  const failedPendingRecords = pendingRecords.filter(
    (record) => results[record.head.workItemId]?.kind === "failed",
  );
  const allPendingChangesFailed =
    pendingRecords.length > 0 &&
    failedPendingRecords.length === pendingRecords.length;
  const hasFailures = failedPendingRecords.length > 0;

  const setSelected = (workItemId: string, checked: boolean) => {
    setSelectedById((previous) => ({
      ...(previous ?? {}),
      [workItemId]: checked,
    }));
    setResults((previous) => {
      if (!previous[workItemId]) return previous;
      const next = { ...previous };
      delete next[workItemId];
      return next;
    });
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSaving || pendingRecords.length === 0) return;

    setIsSaving(true);
    let failed = false;
    for (const record of pendingRecords) {
      const workItemId = record.head.workItemId;
      const shouldLink = Boolean(selected[workItemId]);
      const action: CompanyWorkAction = {
        schemaVersion: COMPANY_WORK_SCHEMA_VERSION,
        workItemId,
        action: "update",
        expectedHeadEventId: record.event.id,
        head: editableWorkInput(record, shouldLink ? goalId : null),
      };

      try {
        await mutation.mutateAsync({ channelId: record.channelId, action });
        setSavedGoalIds((previous) => ({
          ...(previous ?? {}),
          [workItemId]: shouldLink ? goalId : null,
        }));
        setResults((previous) => ({
          ...previous,
          [workItemId]: { kind: "saved" },
        }));
      } catch (error) {
        failed = true;
        setResults((previous) => ({
          ...previous,
          [workItemId]: { kind: "failed", message: errorMessage(error) },
        }));
      }
    }
    setIsSaving(false);
    if (!failed) void goGoal(goalId, { replace: true });
  };

  const backToGoal = () => {
    if (!isSaving) void goGoal(goalId);
  };

  const goalRecord = goalQuery.data;
  const goal = goalRecord?.head.goal;
  const currentPubkey = identityQuery.data?.pubkey;

  if (goalQuery.isPending) {
    return (
      <>
        <GoalRouteHeader title="Link work to this goal" />
        <section className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <GoalRouteBackLink disabled onClick={backToGoal} />
          <p className="text-sm text-muted-foreground" role="status">
            Loading goal
          </p>
        </section>
      </>
    );
  }

  if (goalQuery.isError || !goal || goalRecord?.head.status === "deleted") {
    return (
      <>
        <GoalRouteHeader title="Goal unavailable" />
        <section
          aria-labelledby="goal-work-link-unavailable-title"
          className="mx-auto w-full max-w-[1230px] px-8 py-8"
        >
          <GoalRouteBackLink label="Back to goal" onClick={backToGoal} />
          <h1
            className="text-2xl font-semibold tracking-tight"
            id="goal-work-link-unavailable-title"
          >
            Goal unavailable
          </h1>
          <div className="mt-8 rounded-lg border border-border p-6">
            <p className="text-sm text-muted-foreground">
              This goal could not be found in the current community.
            </p>
          </div>
        </section>
      </>
    );
  }

  if (workQuery.isError) {
    return (
      <>
        <GoalRouteHeader title="Link work to this goal" />
        <section className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <GoalRouteBackLink label="Back to goal" onClick={backToGoal} />
          <h1 className="text-2xl font-semibold tracking-tight">
            Link work to this goal
          </h1>
          <p className="mt-8 text-sm text-muted-foreground">
            Work is unavailable.
          </p>
          <Button
            className="mt-3"
            onClick={() => void workQuery.refetch()}
            variant="outline"
          >
            Try again
          </Button>
        </section>
      </>
    );
  }

  if (workQuery.isPending || savedGoalIds === null || selectedById === null) {
    return (
      <>
        <GoalRouteHeader title="Link work to this goal" />
        <section className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <GoalRouteBackLink disabled onClick={backToGoal} />
          <h1 className="text-2xl font-semibold tracking-tight">
            Link work to this goal
          </h1>
          <p className="mt-8 text-sm text-muted-foreground" role="status">
            Loading work items
          </p>
        </section>
      </>
    );
  }

  return (
    <>
      <GoalRouteHeader title="Link work to this goal" />
      <section
        aria-labelledby="goal-work-link-title"
        className="mx-auto w-full max-w-[1230px] px-8 py-8"
        data-testid="goal-work-link-screen"
      >
        <GoalRouteBackLink disabled={isSaving} onClick={backToGoal} />
        <h1
          className="text-2xl font-semibold tracking-tight"
          id="goal-work-link-title"
        >
          Link work to this goal
        </h1>
        <form
          aria-label="Link work to this goal"
          className="mt-8 max-w-[820px]"
          data-testid="goal-work-link-form"
          onSubmit={(event) => void onSubmit(event)}
        >
          <h2 className="text-base font-semibold">{goal.title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Each work item has one goal. Choosing an item here moves its link to
            this goal.
          </p>
          <div className="mt-6 divide-y divide-border border-y border-border">
            {workRecords.map((record) => {
              const workItemId = record.head.workItemId;
              const ownerLabel = resolveUserLabel({
                currentPubkey,
                profiles: profilesQuery.data?.profiles,
                pubkey: record.head.assignedPubkeys[0] ?? "",
                preferResolvedSelfLabel: true,
              });
              const result = results[workItemId];
              return (
                <div
                  className="px-2 py-4"
                  data-testid={`goal-work-link-item-${workItemId}`}
                  key={workItemId}
                >
                  <label
                    className="flex cursor-pointer items-start gap-3"
                    htmlFor={`goal-work-link-checkbox-${workItemId}`}
                  >
                    <Checkbox
                      aria-label={`Link ${record.head.title} to ${goal.title}`}
                      checked={Boolean(selected[workItemId])}
                      data-testid={`goal-work-link-checkbox-${workItemId}`}
                      disabled={isSaving}
                      id={`goal-work-link-checkbox-${workItemId}`}
                      onCheckedChange={(checked) =>
                        setSelected(workItemId, checked === true)
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-foreground">
                        {record.head.title}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {ownerLabel} ·{" "}
                        {companyWorkStatusLabel(record.head.status)}
                      </span>
                    </span>
                  </label>
                  {result?.kind === "saved" ? (
                    <p
                      className="ml-7 mt-2 text-xs text-muted-foreground"
                      role="status"
                    >
                      Saved
                    </p>
                  ) : null}
                  {result?.kind === "failed" ? (
                    <p
                      className="ml-7 mt-2 text-xs text-destructive"
                      data-testid={`goal-work-link-error-${workItemId}`}
                      role="alert"
                    >
                      {result.message}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
          {hasFailures ? (
            <p
              className="mt-4 text-sm text-destructive"
              data-testid="goal-work-link-partial-failure"
              role="status"
            >
              Some work links could not be saved. Review the failed items and
              retry.
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap gap-3">
            <Button
              disabled={isSaving || pendingRecords.length === 0}
              type="submit"
            >
              {isSaving
                ? "Saving work links"
                : allPendingChangesFailed
                  ? "Retry failed links"
                  : "Save work links"}
            </Button>
            <Button
              disabled={isSaving}
              onClick={backToGoal}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        </form>
      </section>
    </>
  );
}
