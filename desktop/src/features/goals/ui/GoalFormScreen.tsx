import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useChannelsQuery } from "@/features/channels/hooks";
import {
  useMyRelayMembershipQuery,
  useRelayMembersQuery,
} from "@/features/community-members/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { useIdentityQuery } from "@/shared/api/hooks";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  canCreateSubgoal,
  canEditGoal,
  canManageCompanyGoals,
  type GoalRecord,
  type GoalTarget,
} from "../goalModels";
import {
  useGoalActionMutation,
  useGoalHeadQuery,
  useGoalHeadsQuery,
} from "../goalRelay";
import { GoalRouteBackLink, GoalRouteHeader } from "./GoalRouteHeader";

type GoalFormMode = "create" | "edit" | "subgoal";
type GoalFormValues = {
  title: string;
  doneCondition: string;
  ownerPubkey: string;
  dueDate: string;
  parentGoalId: string;
  linkedChannelId: string;
  targetValue: string;
  targetUnit: string;
};

function emptyValues(ownerPubkey: string, parentGoalId = ""): GoalFormValues {
  return {
    title: "",
    doneCondition: "",
    ownerPubkey,
    dueDate: "",
    parentGoalId,
    linkedChannelId: "",
    targetValue: "",
    targetUnit: "",
  };
}

function valuesFromGoal(goal: GoalRecord): GoalFormValues {
  return {
    title: goal.title,
    doneCondition: goal.doneCondition,
    ownerPubkey: goal.ownerPubkey,
    dueDate: goal.dueDate ?? "",
    parentGoalId: goal.parentGoalId ?? "",
    linkedChannelId: goal.linkedChannelIds[0] ?? "",
    targetValue: goal.target?.value ?? "",
    targetUnit: goal.target?.unit ?? "",
  };
}

export function GoalFormScreen({
  mode,
  goalId,
  parentGoalId,
}: {
  mode: GoalFormMode;
  goalId?: string;
  parentGoalId?: string;
}) {
  const allGoalsQuery = useGoalHeadsQuery();
  const goalQuery = useGoalHeadQuery(goalId ?? "", Boolean(goalId));
  const parentQuery = useGoalHeadQuery(
    parentGoalId ?? "",
    Boolean(parentGoalId),
  );
  const identityQuery = useIdentityQuery();
  const membershipQuery = useMyRelayMembershipQuery();
  const membersQuery = useRelayMembersQuery();
  const channelsQuery = useChannelsQuery();
  const mutation = useGoalActionMutation();
  const { goGoal, goGoals } = useAppNavigation();
  const source = mode === "edit" ? goalQuery.data : undefined;
  const parent = mode === "subgoal" ? parentQuery.data : undefined;
  const currentPubkey = identityQuery.data?.pubkey ?? "";
  const allGoals = allGoalsQuery.data ?? [];
  const [values, setValues] = React.useState(() =>
    emptyValues(currentPubkey, parentGoalId),
  );
  const [formError, setFormError] = React.useState<string | null>(null);
  const [isDirty, setIsDirty] = React.useState(false);
  const initializedKeyRef = React.useRef<string | null>(null);
  const role = membershipQuery.data?.role;

  React.useEffect(() => {
    if (mode === "edit" && source?.head.goal) {
      const key = `edit:${source.event.id}`;
      if (initializedKeyRef.current === key || isDirty) return;
      initializedKeyRef.current = key;
      setValues(valuesFromGoal(source.head.goal));
    } else if (mode === "subgoal" && parent) {
      const key = `subgoal:${parent.event.id}`;
      if (initializedKeyRef.current === key || isDirty) return;
      initializedKeyRef.current = key;
      setValues((current) => ({
        ...current,
        parentGoalId: parent.head.goalId,
      }));
    }
  }, [isDirty, mode, parent, source]);

  const ownerPubkeys = React.useMemo(() => {
    const keys = new Set(
      (membersQuery.data ?? []).map((member) => member.pubkey),
    );
    if (values.ownerPubkey) keys.add(values.ownerPubkey);
    return [...keys];
  }, [membersQuery.data, values.ownerPubkey]);
  const profilesQuery = useUsersBatchQuery(ownerPubkeys);
  const linkedChannels = (channelsQuery.data ?? []).filter(
    (channel) => channel.channelType !== "dm",
  );
  const activeParents = allGoals.filter(
    (record) =>
      record.head.status === "active" &&
      record.head.goal &&
      (mode !== "edit" || record.head.goalId !== goalId),
  );
  const selectedParent = values.parentGoalId
    ? allGoals.find((record) => record.head.goalId === values.parentGoalId)
    : undefined;
  const canSave =
    mode === "edit"
      ? Boolean(
          source?.head.goal && canEditGoal(role, currentPubkey, source.head),
        )
      : mode === "subgoal"
        ? Boolean(
            parent?.head.goal &&
              canCreateSubgoal(role, currentPubkey, parent.head),
          )
        : values.parentGoalId
          ? Boolean(
              selectedParent?.head.goal &&
                canCreateSubgoal(role, currentPubkey, selectedParent.head),
            )
          : canManageCompanyGoals(role);
  const updateValue = (field: keyof GoalFormValues, value: string) => {
    setIsDirty(true);
    setFormError(null);
    setValues((current) => ({ ...current, [field]: value }));
  };

  const onCancel = () => {
    if (mode === "edit" && goalId) {
      void goGoal(goalId);
    } else if (parentGoalId) {
      void goGoal(parentGoalId);
    } else {
      void goGoals();
    }
  };

  const title =
    mode === "edit"
      ? "Edit goal"
      : mode === "subgoal" || values.parentGoalId
        ? "Create sub-goal"
        : "Create company goal";

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave || mutation.isPending) return;
    if (!values.title.trim() || !values.doneCondition.trim()) {
      setFormError("Add a goal title and done condition.");
      return;
    }
    if (values.targetValue.trim() && !values.targetUnit.trim()) {
      setFormError("Add a unit for the numeric target.");
      return;
    }
    const target: GoalTarget | undefined = values.targetValue.trim()
      ? { value: values.targetValue.trim(), unit: values.targetUnit.trim() }
      : undefined;
    const nextGoalId = mode === "edit" ? goalId : crypto.randomUUID();
    if (!nextGoalId) return;
    const selectedParentGoalId =
      mode === "subgoal" ? parentGoalId : values.parentGoalId || undefined;
    const goal: GoalRecord = {
      schemaVersion: 1,
      goalId: nextGoalId,
      ...(selectedParentGoalId ? { parentGoalId: selectedParentGoalId } : {}),
      title: values.title.trim(),
      ownerPubkey: values.ownerPubkey.toLowerCase(),
      ...(values.dueDate ? { dueDate: values.dueDate } : {}),
      doneCondition: values.doneCondition.trim(),
      ...(target ? { target } : {}),
      linkedChannelIds: values.linkedChannelId ? [values.linkedChannelId] : [],
    };

    try {
      await mutation.mutateAsync({
        action:
          mode === "edit"
            ? {
                schemaVersion: 1,
                goalId: nextGoalId,
                action: "update",
                expectedHeadEventId: source?.event.id,
                goal,
              }
            : {
                schemaVersion: 1,
                goalId: nextGoalId,
                action: "create",
                goal,
              },
      });
      await goGoal(nextGoalId);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Goal could not be saved.",
      );
    }
  };

  if (
    allGoalsQuery.isPending ||
    membershipQuery.isPending ||
    membersQuery.isPending ||
    identityQuery.isPending ||
    channelsQuery.isPending ||
    (mode === "edit" && goalQuery.isPending) ||
    (mode === "subgoal" && parentQuery.isPending)
  ) {
    return (
      <>
        <GoalRouteHeader title={title} />
        <div
          className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"
          role="status"
        >
          Loading goal
        </div>
      </>
    );
  }
  if (
    allGoalsQuery.isError ||
    membersQuery.isError ||
    identityQuery.isError ||
    (mode === "edit" && goalQuery.isError) ||
    (mode === "subgoal" && parentQuery.isError)
  ) {
    return (
      <>
        <GoalRouteHeader title="Goal unavailable" />
        <section className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <GoalRouteBackLink onClick={onCancel} />
          <h1 className="text-2xl font-bold tracking-tight">
            Goal unavailable
          </h1>
          <p className="mt-5 text-sm text-muted-foreground">
            Goal details, identity or community members could not be loaded.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            {allGoalsQuery.isError ? (
              <Button
                onClick={() => void allGoalsQuery.refetch()}
                variant="outline"
              >
                Try loading goals again
              </Button>
            ) : null}
            {membersQuery.isError ? (
              <Button
                onClick={() => void membersQuery.refetch()}
                variant="outline"
              >
                Try loading members again
              </Button>
            ) : null}
            {identityQuery.isError ? (
              <Button
                onClick={() => void identityQuery.refetch()}
                variant="outline"
              >
                Try loading identity again
              </Button>
            ) : null}
            {mode === "edit" && goalQuery.isError ? (
              <Button
                onClick={() => void goalQuery.refetch()}
                variant="outline"
              >
                Try loading goal again
              </Button>
            ) : null}
            {mode === "subgoal" && parentQuery.isError ? (
              <Button
                onClick={() => void parentQuery.refetch()}
                variant="outline"
              >
                Try loading parent again
              </Button>
            ) : null}
            <Button onClick={onCancel} variant="ghost">
              Back to goals
            </Button>
          </div>
        </section>
      </>
    );
  }
  if (
    (mode === "edit" &&
      (!source?.head.goal || source.head.status === "deleted")) ||
    (mode === "subgoal" &&
      (!parent?.head.goal || parent.head.status === "deleted"))
  ) {
    return (
      <>
        <GoalRouteHeader title="Goal unavailable" />
        <section className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <GoalRouteBackLink onClick={onCancel} />
          <h1 className="text-2xl font-bold tracking-tight">
            Goal unavailable
          </h1>
          <p className="mt-5 text-sm text-muted-foreground">
            This goal is unavailable.
          </p>
          <Button className="mt-5" onClick={onCancel}>
            Back to goals
          </Button>
        </section>
      </>
    );
  }
  if (membershipQuery.isError) {
    return (
      <>
        <GoalRouteHeader title="Goal permissions" />
        <section className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <GoalRouteBackLink onClick={onCancel} />
          <h1 className="text-2xl font-bold tracking-tight">
            Goal permissions
          </h1>
          <p className="mt-5 text-sm text-muted-foreground">
            Goal permissions could not be checked.
          </p>
          <Button
            className="mt-5"
            onClick={() => void membershipQuery.refetch()}
            variant="outline"
          >
            Try again
          </Button>
        </section>
      </>
    );
  }
  if (!canSave && membershipQuery.isSuccess) {
    return (
      <>
        <GoalRouteHeader title="Goal permissions" />
        <section className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <GoalRouteBackLink onClick={onCancel} />
          <h1 className="text-2xl font-bold tracking-tight">
            Goal permissions
          </h1>
          <p className="mt-5 text-sm text-muted-foreground">
            You do not have permission to manage this goal.
          </p>
          <Button className="mt-5" onClick={onCancel}>
            Back to goals
          </Button>
        </section>
      </>
    );
  }

  return (
    <>
      <GoalRouteHeader title={title} />
      <main
        className="mx-auto w-full max-w-[1230px] px-8 py-8"
        data-testid="goal-form-screen"
      >
        <GoalRouteBackLink onClick={onCancel} />
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {mode === "subgoal" && parent ? (
          <div className="mt-5 rounded-lg bg-muted/40 px-4 py-3">
            <strong className="text-sm">Parent goal</strong>
            <p className="mt-1 text-sm">{parent.head.title}</p>
          </div>
        ) : null}
        <form
          className="mt-6 max-w-[740px]"
          onSubmit={(event) => void onSubmit(event)}
        >
          <label
            className="mb-5 flex flex-col gap-2 text-xs font-semibold"
            htmlFor="goal-title"
          >
            Goal title
            <Input
              autoFocus
              className="rounded-md text-sm"
              id="goal-title"
              maxLength={180}
              onChange={(event) =>
                updateValue("title", event.currentTarget.value)
              }
              required
              value={values.title}
            />
          </label>
          <label
            className="mb-5 flex flex-col gap-2 text-xs font-semibold"
            htmlFor="goal-done-condition"
          >
            Done condition
            <textarea
              className="min-h-20 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm font-normal leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              id="goal-done-condition"
              maxLength={1000}
              onChange={(event) =>
                updateValue("doneCondition", event.currentTarget.value)
              }
              placeholder="What must be true for this goal to be achieved?"
              required
              value={values.doneCondition}
            />
          </label>
          <div className="grid grid-cols-1 gap-x-5 sm:grid-cols-2">
            <label
              className="mb-5 flex flex-col gap-2 text-xs font-semibold"
              htmlFor="goal-owner"
            >
              Owner
              <select
                className="min-h-10 rounded-md border border-input bg-background px-3 text-sm font-normal"
                id="goal-owner"
                onChange={(event) =>
                  updateValue("ownerPubkey", event.currentTarget.value)
                }
                required
                value={values.ownerPubkey}
              >
                <option value="">Choose an owner</option>
                {(membersQuery.data ?? []).map((member) => (
                  <option key={member.pubkey} value={member.pubkey}>
                    {resolveUserLabel({
                      currentPubkey,
                      profiles: profilesQuery.data?.profiles,
                      pubkey: member.pubkey,
                      preferResolvedSelfLabel: true,
                    })}
                  </option>
                ))}
              </select>
            </label>
            <label
              className="mb-5 flex flex-col gap-2 text-xs font-semibold"
              htmlFor="goal-due-date"
            >
              Due date
              <Input
                className="rounded-md text-sm"
                id="goal-due-date"
                onChange={(event) =>
                  updateValue("dueDate", event.currentTarget.value)
                }
                type="date"
                value={values.dueDate}
              />
            </label>
            <label
              className="mb-5 flex flex-col gap-2 text-xs font-semibold"
              htmlFor="goal-linked-channel"
            >
              Linked channel
              <select
                className="min-h-10 rounded-md border border-input bg-background px-3 text-sm font-normal"
                id="goal-linked-channel"
                onChange={(event) =>
                  updateValue("linkedChannelId", event.currentTarget.value)
                }
                value={values.linkedChannelId}
              >
                <option value="">No linked channel</option>
                {linkedChannels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </select>
            </label>
            {channelsQuery.isError ? (
              <p className="mb-5 text-xs text-muted-foreground sm:col-span-2">
                Conversations could not be loaded.{" "}
                <button
                  className="text-primary underline underline-offset-2"
                  onClick={() => void channelsQuery.refetch()}
                  type="button"
                >
                  Try again
                </button>
              </p>
            ) : null}
            {mode !== "subgoal" ? (
              <label
                className="mb-5 flex flex-col gap-2 text-xs font-semibold"
                htmlFor="goal-parent"
              >
                Parent goal
                <select
                  className="min-h-10 rounded-md border border-input bg-background px-3 text-sm font-normal"
                  id="goal-parent"
                  onChange={(event) =>
                    updateValue("parentGoalId", event.currentTarget.value)
                  }
                  value={values.parentGoalId}
                >
                  <option value="">Company goal</option>
                  {activeParents.map((record) => (
                    <option key={record.head.goalId} value={record.head.goalId}>
                      {record.head.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <details className="mb-5" open={Boolean(values.targetValue)}>
            <summary className="cursor-pointer text-sm">
              Optional numeric target
            </summary>
            <div className="mt-4 grid grid-cols-1 gap-x-5 sm:grid-cols-2">
              <label
                className="mb-5 flex flex-col gap-2 text-xs font-semibold"
                htmlFor="goal-target-value"
              >
                Target
                <Input
                  className="rounded-md text-sm"
                  id="goal-target-value"
                  min="0"
                  onChange={(event) =>
                    updateValue("targetValue", event.currentTarget.value)
                  }
                  step="any"
                  type="number"
                  value={values.targetValue}
                />
              </label>
              <label
                className="mb-5 flex flex-col gap-2 text-xs font-semibold"
                htmlFor="goal-target-unit"
              >
                Unit
                <Input
                  className="rounded-md text-sm"
                  id="goal-target-unit"
                  maxLength={24}
                  onChange={(event) =>
                    updateValue("targetUnit", event.currentTarget.value)
                  }
                  placeholder="e.g. approved client plans"
                  required={Boolean(values.targetValue.trim())}
                  value={values.targetUnit}
                />
              </label>
            </div>
          </details>
          <p className="text-xs leading-6 text-muted-foreground">
            Company goals are set by the founder. Managers can create sub-goals
            within their team’s scope.
          </p>
          {formError ? (
            <p
              className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              role="alert"
            >
              {formError}
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-5">
            <Button
              className="bg-[#637fb1] text-white hover:bg-[#536d9c] dark:bg-[#8aa6d8] dark:text-[#282532] dark:hover:bg-[#7795c9]"
              disabled={!canSave || mutation.isPending}
              type="submit"
            >
              {mutation.isPending
                ? "Saving goal"
                : mode === "edit"
                  ? "Save goal"
                  : "Create goal"}
            </Button>
            <Button onClick={onCancel} type="button" variant="outline">
              Cancel
            </Button>
          </div>
        </form>
      </main>
    </>
  );
}
