import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useMyRelayMembershipQuery } from "@/features/community-members/hooks";
import {
  useChannelMembersQuery,
  useChannelsQuery,
} from "@/features/channels/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import {
  resolveUserLabel,
  type UserProfileLookup,
} from "@/features/profile/lib/identity";
import { useGoalHeadsQuery } from "@/features/goals/goalRelay";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { ChannelMember } from "@/shared/api/types";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";
import {
  COMPANY_WORK_SCHEMA_VERSION,
  type CompanyWorkAction,
  type CompanyWorkHeadRecord,
  type CompanyWorkInput,
} from "../companyWorkModels";
import {
  useCompanyWorkActionMutation,
  useCompanyWorkHeadsQuery,
} from "../hooks";
import {
  companyWorkPrimaryButtonClass,
  CompanyWorkBackButton,
  CompanyWorkPageHeader,
} from "./CompanyWorkPresentation";

type CompanyWorkFormScreenProps = {
  workItemId?: string;
  initialChannelId?: string;
  initialGoalId?: string;
  sourceEventId?: string;
  threadRootEventId?: string;
};

type FieldProps = {
  children: React.ReactNode;
  htmlFor: string;
  label: string;
};

function Field({ children, htmlFor, label }: FieldProps) {
  return (
    <label className="grid gap-2 text-sm font-medium" htmlFor={htmlFor}>
      {label}
      {children}
    </label>
  );
}

function memberLabel(
  member: ChannelMember,
  currentPubkey: string | undefined,
  profiles: UserProfileLookup | undefined,
) {
  return resolveUserLabel({
    currentPubkey,
    profiles,
    pubkey: member.pubkey,
    fallbackName: member.displayName,
    preferResolvedSelfLabel: true,
  });
}

function canEditRecord(
  record: CompanyWorkHeadRecord,
  currentPubkey: string | undefined,
  communityRole: string | undefined,
) {
  if (!currentPubkey) return false;
  const signer = currentPubkey.toLowerCase();
  return (
    record.head.assignedPubkeys.some(
      (pubkey) => pubkey.toLowerCase() === signer,
    ) ||
    record.head.requesterPubkey.toLowerCase() === signer ||
    communityRole === "owner" ||
    communityRole === "admin"
  );
}

export function CompanyWorkFormScreen({
  workItemId,
  initialChannelId,
  initialGoalId,
  sourceEventId,
  threadRootEventId,
}: CompanyWorkFormScreenProps) {
  const isEdit = Boolean(workItemId);
  const pageTitle = isEdit ? "Edit work item" : "Create work item";
  const [workId] = React.useState(() => workItemId ?? crypto.randomUUID());
  const [title, setTitle] = React.useState("");
  const [doneCondition, setDoneCondition] = React.useState("");
  const [ownerPubkey, setOwnerPubkey] = React.useState("");
  const [requesterPubkey, setRequesterPubkey] = React.useState("");
  const [goalId, setGoalId] = React.useState(initialGoalId ?? "");
  const [channelId, setChannelId] = React.useState(initialChannelId ?? "");
  const [evidence, setEvidence] = React.useState("");
  const initializedRecordId = React.useRef<string | null>(null);
  const { goCompanyWork, goCompanyWorkDetail } = useAppNavigation();
  const identityQuery = useIdentityQuery();
  const membershipQuery = useMyRelayMembershipQuery();
  const channelsQuery = useChannelsQuery();
  const headsQuery = useCompanyWorkHeadsQuery(isEdit);
  const goalsQuery = useGoalHeadsQuery();
  const mutation = useCompanyWorkActionMutation();
  const record = headsQuery.data?.find(
    (candidate) => candidate.head.workItemId === workItemId,
  );
  const currentPubkey = identityQuery.data?.pubkey.toLowerCase();
  const channels = (channelsQuery.data ?? []).filter(
    (channel) =>
      channel.channelType === "stream" &&
      channel.isMember &&
      channel.archivedAt === null,
  );
  const membersQuery = useChannelMembersQuery(channelId || null);
  const members = membersQuery.data ?? [];
  const membersByPubkey = React.useMemo(
    () =>
      new Map(members.map((member) => [member.pubkey.toLowerCase(), member])),
    [members],
  );
  const profilesQuery = useUsersBatchQuery(
    members.map((member) => member.pubkey),
  );
  const memberProfiles = profilesQuery.data?.profiles;
  const activeGoals = (goalsQuery.data ?? []).filter(
    (candidate) =>
      candidate.head.goal &&
      candidate.head.status !== "archived" &&
      candidate.head.status !== "deleted",
  );
  const selectedChannel = channels.find((channel) => channel.id === channelId);
  const channelLocked = Boolean(isEdit || sourceEventId);

  React.useEffect(() => {
    if (!isEdit && !channelId && channels.length > 0) {
      const goalChannel = activeGoals
        .find((candidate) => candidate.head.goalId === initialGoalId)
        ?.head.goal?.linkedChannelIds.find((id) =>
          channels.some((channel) => channel.id === id),
        );
      setChannelId(initialChannelId ?? goalChannel ?? channels[0]?.id ?? "");
    }
  }, [
    activeGoals,
    channelId,
    channels,
    initialChannelId,
    initialGoalId,
    isEdit,
  ]);

  React.useEffect(() => {
    if (
      !isEdit ||
      !record ||
      initializedRecordId.current === record.head.workItemId
    ) {
      return;
    }
    initializedRecordId.current = record.head.workItemId;
    setTitle(record.head.title);
    setDoneCondition(record.head.doneCondition);
    setOwnerPubkey(record.head.assignedPubkeys[0] ?? "");
    setRequesterPubkey(record.head.requesterPubkey);
    setGoalId(record.head.goalId ?? "");
    setChannelId(record.channelId);
    setEvidence(record.head.evidence ?? "");
  }, [isEdit, record]);

  React.useEffect(() => {
    if (members.length === 0) return;
    if (!ownerPubkey) {
      const initialOwner =
        currentPubkey && membersByPubkey.has(currentPubkey)
          ? currentPubkey
          : members[0]?.pubkey;
      if (initialOwner) setOwnerPubkey(initialOwner.toLowerCase());
    }
    if (!requesterPubkey) {
      const initialRequester =
        currentPubkey && membersByPubkey.has(currentPubkey)
          ? currentPubkey
          : members[0]?.pubkey;
      if (initialRequester) setRequesterPubkey(initialRequester.toLowerCase());
    }
  }, [currentPubkey, members, membersByPubkey, ownerPubkey, requesterPubkey]);

  const allowedToEdit =
    !isEdit ||
    (record !== undefined &&
      record.head.status !== "archived" &&
      canEditRecord(record, currentPubkey, membershipQuery.data?.role));

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !title.trim() ||
      !doneCondition.trim() ||
      !channelId ||
      !ownerPubkey ||
      !requesterPubkey ||
      !membersByPubkey.has(ownerPubkey.toLowerCase()) ||
      !membersByPubkey.has(requesterPubkey.toLowerCase()) ||
      !allowedToEdit
    ) {
      return;
    }
    const previous = record?.head;
    const head: CompanyWorkInput = {
      schemaVersion: COMPANY_WORK_SCHEMA_VERSION,
      workItemId: workId,
      title: title.trim(),
      status: previous?.status ?? "active",
      assignedPubkeys: [ownerPubkey.toLowerCase()],
      approverPubkeys: previous?.approverPubkeys ?? [],
      deliverables: previous?.deliverables ?? [],
      requesterPubkey: requesterPubkey.toLowerCase(),
      doneCondition: doneCondition.trim(),
      ...(goalId ? { goalId } : {}),
      ...(previous?.sourceEventId
        ? {
            sourceEventId: previous.sourceEventId,
            ...(previous.threadRootEventId
              ? { threadRootEventId: previous.threadRootEventId }
              : {}),
          }
        : sourceEventId && threadRootEventId
          ? { sourceEventId, threadRootEventId }
          : {}),
      ...(evidence.trim() ? { evidence: evidence.trim() } : {}),
    };
    const action: CompanyWorkAction = isEdit
      ? {
          schemaVersion: COMPANY_WORK_SCHEMA_VERSION,
          workItemId: workId,
          action: "update",
          expectedHeadEventId: record?.event.id,
          head,
        }
      : {
          schemaVersion: COMPANY_WORK_SCHEMA_VERSION,
          workItemId: workId,
          action: "create",
          head,
        };
    try {
      await mutation.mutateAsync({ channelId, action });
      await goCompanyWorkDetail(workId, { replace: true });
    } catch {
      // Keep the entered work fields visible so the user can retry or correct them.
    }
  };

  const onBack = () => {
    if (isEdit && workItemId) {
      void goCompanyWorkDetail(workItemId);
    } else {
      void goCompanyWork();
    }
  };

  if (isEdit && (headsQuery.isPending || channelsQuery.isPending)) {
    return (
      <>
        <CompanyWorkPageHeader title={pageTitle} />
        <div
          className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"
          role="status"
        >
          Loading work item
        </div>
      </>
    );
  }
  if (isEdit && (headsQuery.isError || channelsQuery.isError)) {
    return (
      <>
        <CompanyWorkPageHeader title={pageTitle} />
        <main className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <CompanyWorkBackButton onClick={onBack} />
          <h1 className="text-2xl font-bold tracking-tight">Edit work item</h1>
          <div className="mt-8 rounded-lg border border-border p-6">
            <h2 className="text-base font-semibold">Work item unavailable</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {headsQuery.isError
                ? headsQuery.error.message
                : "Conversations could not be loaded."}
            </p>
            <Button
              className="mt-5"
              onClick={() => {
                void headsQuery.refetch();
                void channelsQuery.refetch();
              }}
              variant="outline"
            >
              Try again
            </Button>
          </div>
        </main>
      </>
    );
  }
  if (isEdit && (!record || record.head.status === "archived")) {
    return (
      <>
        <CompanyWorkPageHeader title={pageTitle} />
        <main className="mx-auto w-full max-w-[1230px] px-8 py-8">
          <CompanyWorkBackButton onClick={onBack} />
          <h1 className="text-2xl font-bold tracking-tight">Edit work item</h1>
          <div className="mt-8 rounded-lg border border-border p-6">
            <h2 className="text-base font-semibold">
              This work item is unavailable.
            </h2>
            <Button className="mt-5" onClick={onBack} variant="outline">
              Back
            </Button>
          </div>
        </main>
      </>
    );
  }

  const membersReady = membersQuery.isSuccess && members.length > 0;
  const selectedGoalExists =
    !goalId ||
    activeGoals.some((candidate) => candidate.head.goalId === goalId);
  const canSubmit =
    allowedToEdit &&
    Boolean(currentPubkey) &&
    membersReady &&
    selectedGoalExists &&
    Boolean(title.trim()) &&
    Boolean(doneCondition.trim()) &&
    Boolean(ownerPubkey) &&
    Boolean(requesterPubkey) &&
    !mutation.isPending;
  const memberOptions = [...members].sort((left, right) =>
    memberLabel(left, currentPubkey, memberProfiles).localeCompare(
      memberLabel(right, currentPubkey, memberProfiles),
    ),
  );

  return (
    <>
      <CompanyWorkPageHeader title={pageTitle} />
      <main
        className="mx-auto w-full max-w-[1230px] px-8 py-8"
        data-testid="company-work-form"
      >
        <CompanyWorkBackButton onClick={onBack} />
        <h1 className="text-2xl font-bold tracking-tight">{pageTitle}</h1>
        {!allowedToEdit ? (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            Only the work owner, requester, or a community owner or admin can
            edit this item.
          </p>
        ) : null}
        {mutation.isError ? (
          <p
            className="mt-5 rounded-lg border border-destructive/40 p-4 text-sm text-destructive"
            role="alert"
          >
            {mutation.error.message}
          </p>
        ) : null}
        {channelsQuery.isError ||
        goalsQuery.isError ||
        membershipQuery.isError ? (
          <div
            className="mt-5 rounded-lg border border-border p-4 text-sm text-muted-foreground"
            role="alert"
          >
            The available people, conversations, goals, or permissions could not
            be loaded.
            <Button
              className="ml-3"
              onClick={() => {
                void channelsQuery.refetch();
                void goalsQuery.refetch();
                void membershipQuery.refetch();
              }}
              size="sm"
              variant="outline"
            >
              Try again
            </Button>
          </div>
        ) : null}
        {membersQuery.isError ? (
          <p className="mt-5 text-sm text-destructive" role="alert">
            People in this conversation could not be loaded.
          </p>
        ) : null}
        {membersQuery.isSuccess && members.length === 0 ? (
          <p className="mt-5 text-sm text-muted-foreground" role="status">
            No conversation members are available for this work item.
          </p>
        ) : null}
        <form className="mt-7 grid max-w-[740px] gap-5" onSubmit={submit}>
          <Field htmlFor="company-work-title" label="Commitment">
            <Input
              autoComplete="off"
              data-testid="company-work-title"
              id="company-work-title"
              maxLength={240}
              onChange={(event) => setTitle(event.target.value)}
              required
              value={title}
            />
          </Field>
          <Field htmlFor="company-work-done-condition" label="Done condition">
            <Textarea
              data-testid="company-work-done-condition"
              id="company-work-done-condition"
              maxLength={4_000}
              onChange={(event) => setDoneCondition(event.target.value)}
              required
              value={doneCondition}
            />
          </Field>
          <div className="grid gap-5 md:grid-cols-2">
            <Field htmlFor="company-work-owner" label="Owner">
              <select
                className="h-9 w-full rounded-lg border border-input/40 bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 md:text-sm"
                data-testid="company-work-owner"
                disabled={!membersReady || !allowedToEdit}
                id="company-work-owner"
                onChange={(event) => setOwnerPubkey(event.target.value)}
                required
                value={ownerPubkey}
              >
                <option value="">Select a person</option>
                {memberOptions.map((member) => (
                  <option
                    key={member.pubkey}
                    value={member.pubkey.toLowerCase()}
                  >
                    {memberLabel(member, currentPubkey, memberProfiles)}
                  </option>
                ))}
              </select>
            </Field>
            <Field htmlFor="company-work-requester" label="Requested by">
              <select
                className="h-9 w-full rounded-lg border border-input/40 bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 md:text-sm"
                data-testid="company-work-requester"
                disabled={!membersReady || !allowedToEdit}
                id="company-work-requester"
                onChange={(event) => setRequesterPubkey(event.target.value)}
                required
                value={requesterPubkey}
              >
                <option value="">Select a person</option>
                {memberOptions.map((member) => (
                  <option
                    key={member.pubkey}
                    value={member.pubkey.toLowerCase()}
                  >
                    {memberLabel(member, currentPubkey, memberProfiles)}
                  </option>
                ))}
              </select>
            </Field>
            <Field htmlFor="company-work-goal" label="Goal or sub-goal">
              <select
                className="h-9 w-full rounded-lg border border-input/40 bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 md:text-sm"
                data-testid="company-work-goal"
                disabled={goalsQuery.isPending || !allowedToEdit}
                id="company-work-goal"
                onChange={(event) => setGoalId(event.target.value)}
                value={goalId}
              >
                <option value="">No goal</option>
                {activeGoals.map((candidate) => (
                  <option
                    key={candidate.head.goalId}
                    value={candidate.head.goalId}
                  >
                    {candidate.head.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field htmlFor="company-work-conversation" label="Conversation">
              <select
                className="h-9 w-full rounded-lg border border-input/40 bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 md:text-sm"
                data-testid="company-work-conversation"
                disabled={
                  channelLocked || channelsQuery.isPending || !allowedToEdit
                }
                id="company-work-conversation"
                onChange={(event) => setChannelId(event.target.value)}
                required
                value={channelId}
              >
                {!channelId ? (
                  <option value="">Select a conversation</option>
                ) : null}
                {channels.map((channel) => (
                  <option
                    disabled={channelLocked && channel.id !== channelId}
                    key={channel.id}
                    value={channel.id}
                  >
                    # {channel.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field
            htmlFor="company-work-evidence"
            label="Deliverable or evidence"
          >
            <Textarea
              data-testid="company-work-evidence"
              id="company-work-evidence"
              maxLength={8_000}
              onChange={(event) => setEvidence(event.target.value)}
              value={evidence}
            />
          </Field>
          {!selectedChannel ? (
            <p className="text-sm text-muted-foreground" role="status">
              Choose an active conversation to see its people.
            </p>
          ) : null}
          {!selectedGoalExists ? (
            <p className="text-sm text-destructive" role="alert">
              The selected goal is unavailable. Choose another goal or clear the
              selection.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button
              className={companyWorkPrimaryButtonClass}
              disabled={!canSubmit}
              type="submit"
            >
              {mutation.isPending
                ? isEdit
                  ? "Saving work item"
                  : "Creating commitment"
                : isEdit
                  ? "Save work item"
                  : "Create commitment"}
            </Button>
            <Button onClick={onBack} type="button" variant="outline">
              Cancel
            </Button>
          </div>
        </form>
      </main>
    </>
  );
}
