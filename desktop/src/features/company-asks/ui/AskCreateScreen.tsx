import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { usePersonasQuery } from "@/features/agents/hooks";
import {
  useAddChannelMembersMutation,
  useChannelMembersQuery,
  useChannelsQuery,
} from "@/features/channels/hooks";
import { useCanAddChannelMembers } from "@/features/channels/useCanAddChannelMembers";
import { ChannelMemberInviteCard } from "@/features/channels/ui/ChannelMemberInviteCard";
import { useChannelMessagesQuery } from "@/features/messages/hooks";
import { getThreadReference } from "@/features/messages/lib/threading";
import { isTimelineContentEvent } from "@/features/messages/lib/formatTimelineMessages";
import { useCompanyTeamQuery } from "@/features/company-team/teamRelay";
import { useEmployeeAllowanceHeadsQuery } from "@/features/power/spendRelay";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";
import {
  HireProposalComposer,
  HireProposalReviewSteps,
  useAskHireProposal,
} from "./HireProposalComposer";
import { AskCreateSuccess } from "./AskCreateSuccess";
import { AskDestinationStep } from "./AskDestinationStep";
import { AskStandardComposer } from "./AskStandardComposer";
import { MoneyAllowanceComposer } from "./MoneyAllowanceComposer";
import { MoneyAllowanceChooser } from "./MoneyAllowanceChooser";
import { KIND_ASK_ACTION } from "@/shared/constants/kinds";
import { Button } from "@/shared/ui/button";
import { useIdentityQuery } from "@/shared/api/hooks";
import { normalizePubkey } from "@/shared/lib/pubkey";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import {
  GoalRouteBackLink,
  GoalRouteHeader,
} from "@/features/goals/ui/GoalRouteHeader";

import {
  buildAskCreateAction,
  buildAskCreateTags,
  EMPTY_ASK_COMPOSER_DRAFT,
  validateAskComposerDraft,
  type AskComposerDraft,
  type AskComposerErrors,
  type AskComposerMoneyAllowanceContext,
  type AskComposerType,
} from "../askComposer";

const ASK_TYPES: Array<{ value: AskComposerType; label: string }> = [
  { value: "approval", label: "Approval" },
  { value: "question", label: "Question" },
  { value: "choice", label: "Choice" },
  { value: "checklist", label: "Checklist" },
  { value: "verdict", label: "Verdict" },
  { value: "hire_proposal", label: "Hire proposal" },
];

function recipientDescription(isAgent: boolean) {
  return isAgent ? "AI employee" : "Person";
}

function threadLabel(event: RelayEvent | undefined) {
  if (!event) return "Discussion";
  if (event.kind === KIND_ASK_ACTION) {
    try {
      const action = JSON.parse(event.content) as {
        ask?: { title?: unknown; threadStart?: { title?: unknown } };
      };
      const title = action.ask?.threadStart?.title ?? action.ask?.title;
      if (typeof title === "string" && title.trim()) return title.trim();
    } catch {
      return "Ask discussion";
    }
  }
  const heading = event.content.match(/^\s{0,3}#{1,6}\s+([^\r\n]+)(?:\r?\n|$)/);
  if (heading?.[1]) {
    return heading[1].replace(/\s+#+\s*$/, "").trim();
  }
  const content = event.content.replace(/\s+/g, " ").trim();
  return content.slice(0, 140) || "Discussion";
}

/** Ask creation surface for a real channel and discussion thread. */
export function AskCreateScreen({
  channelId,
  threadRootEventId,
  initialType,
}: {
  channelId: string | null;
  threadRootEventId: string | null;
  initialType?: AskComposerType;
}) {
  const queryClient = useQueryClient();
  const identityQuery = useIdentityQuery();
  const channelsQuery = useChannelsQuery();
  const [selectedChannelId, setSelectedChannelId] = React.useState(
    channelId ?? "",
  );
  const [selectedThreadRootId, setSelectedThreadRootId] = React.useState(
    threadRootEventId ?? "",
  );
  const [startNewThread, setStartNewThread] = React.useState(
    !threadRootEventId,
  );
  const [step, setStep] = React.useState<"destination" | "compose">(
    channelId && threadRootEventId ? "compose" : "destination",
  );
  const [hireProposalReview, setHireProposalReview] = React.useState(false);
  const [moneyProposalReview, setMoneyProposalReview] = React.useState(false);
  const [hireProposalId, setHireProposalId] = React.useState("");
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const membersQuery = useChannelMembersQuery(selectedChannelId || null);
  const addMembersMutation = useAddChannelMembersMutation(
    selectedChannelId || null,
  );
  const canInviteToChannel = useCanAddChannelMembers(selectedChannelId || null);
  const channel = channelsQuery.data?.find(
    (candidate) => candidate.id === selectedChannelId,
  );
  const messagesQuery = useChannelMessagesQuery(channel ?? null);
  const memberPubkeys = React.useMemo(
    () => (membersQuery.data ?? []).map((member) => member.pubkey),
    [membersQuery.data],
  );
  const profilesQuery = useUsersBatchQuery(memberPubkeys, {
    enabled: memberPubkeys.length > 0,
  });
  const { goChannel, goToday, goHireRoles, goPower } = useAppNavigation();
  const [draft, setDraft] = React.useState(() => ({
    ...EMPTY_ASK_COMPOSER_DRAFT,
    ...(initialType ? { type: initialType } : {}),
  }));
  const [moneyAllowanceChosen, setMoneyAllowanceChosen] = React.useState(
    initialType !== "money_allowance_proposal",
  );
  const isMoneyProposal = draft.type === "money_allowance_proposal";
  const personasQuery = usePersonasQuery({
    enabled: draft.type === "hire_proposal",
  });
  const moneyTeamQuery = useCompanyTeamQuery(isMoneyProposal);
  const moneyAllowancesQuery = useEmployeeAllowanceHeadsQuery(isMoneyProposal);
  const moneyEmployees = React.useMemo(
    () =>
      (moneyTeamQuery.data?.members ?? []).filter(
        (member) =>
          member.kind === "employee" &&
          member.position?.head.status !== "terminated",
      ),
    [moneyTeamQuery.data?.members],
  );
  const moneyEmployeePubkeys = React.useMemo(
    () => moneyEmployees.map((employee) => employee.pubkey),
    [moneyEmployees],
  );
  const moneyEmployeeProfilesQuery = useUsersBatchQuery(moneyEmployeePubkeys, {
    enabled: isMoneyProposal && moneyEmployeePubkeys.length > 0,
  });
  const [errors, setErrors] = React.useState<AskComposerErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pendingEvent, setPendingEvent] = React.useState<RelayEvent | null>(
    null,
  );
  const [sentContext, setSentContext] = React.useState<{
    channelId: string;
    askId: string;
    threadRootId: string;
  } | null>(null);
  const [isSending, setIsSending] = React.useState(false);
  const {
    roleOptions: hireRoleOptions,
    selectedRole: selectedHireRole,
    hireContext,
  } = useAskHireProposal(personasQuery.data ?? [], draft.hireRolePackId);

  React.useEffect(() => {
    setSelectedChannelId(channelId ?? "");
    setSelectedThreadRootId(threadRootEventId ?? "");
    setStartNewThread(!threadRootEventId);
    setStep(channelId && threadRootEventId ? "compose" : "destination");
  }, [channelId, threadRootEventId]);

  React.useEffect(() => {
    setMoneyAllowanceChosen(initialType !== "money_allowance_proposal");
    setDraft((current) => ({
      ...current,
      type: initialType ?? "approval",
    }));
    setMoneyProposalReview(false);
  }, [initialType]);

  const currentPubkey = identityQuery.data?.pubkey ?? "";
  const moneyEmployeeOptions = moneyEmployees.flatMap((employee) => {
    const allowance = moneyAllowancesQuery.data?.records.find(
      (record) =>
        record.head.employeePubkey.toLowerCase() ===
        employee.pubkey.toLowerCase(),
    );
    return allowance
      ? [
          {
            pubkey: employee.pubkey,
            label: resolveUserLabel({
              pubkey: employee.pubkey,
              currentPubkey,
              fallbackName: employee.fallbackName ?? "AI employee",
              profiles: moneyEmployeeProfilesQuery.data?.profiles,
            }),
          },
        ]
      : [];
  });
  const selectedMoneyEmployee = moneyEmployeeOptions.find(
    (employee) =>
      employee.pubkey.toLowerCase() === draft.moneyEmployeePubkey.toLowerCase(),
  );
  const selectedMoneyAllowance = moneyAllowancesQuery.data?.records.find(
    (record) =>
      record.head.employeePubkey.toLowerCase() ===
      draft.moneyEmployeePubkey.toLowerCase(),
  );
  const moneyAllowanceContext: AskComposerMoneyAllowanceContext | undefined =
    selectedMoneyEmployee &&
    selectedMoneyAllowance &&
    moneyTeamQuery.isSuccess &&
    moneyAllowancesQuery.isSuccess
      ? {
          employeePubkey: selectedMoneyEmployee.pubkey,
          existing: selectedMoneyAllowance,
        }
      : undefined;
  const channelName = channel?.name ?? "conversation";
  const contextReady = Boolean(
    selectedChannelId && (selectedThreadRootId || startNewThread),
  );
  const threadRoots = React.useMemo(
    () =>
      (messagesQuery.data ?? [])
        .filter(
          (message) =>
            isTimelineContentEvent(message) &&
            getThreadReference(message.tags).parentId === null,
        )
        .sort(
          (first, second) =>
            second.created_at - first.created_at ||
            first.id.localeCompare(second.id),
        ),
    [messagesQuery.data],
  );
  const currentChannelMember = (membersQuery.data ?? []).find(
    (member) =>
      normalizePubkey(member.pubkey) === normalizePubkey(currentPubkey),
  );
  const recipients = React.useMemo(
    () =>
      [...(membersQuery.data ?? [])]
        .filter(
          (member) =>
            !member.isAgent ||
            draft.type === "question" ||
            draft.type === "verdict",
        )
        .filter(
          (member) =>
            member.pubkey.toLowerCase() !== currentPubkey.toLowerCase(),
        )
        .sort((first, second) => {
          if (first.isAgent !== second.isAgent) return first.isAgent ? 1 : -1;
          const firstLabel = first.displayName ?? first.pubkey;
          const secondLabel = second.displayName ?? second.pubkey;
          return firstLabel.localeCompare(secondLabel);
        }),
    [currentPubkey, draft.type, membersQuery.data],
  );
  const recipientOptions = recipients.map((member) => ({
    pubkey: member.pubkey,
    label: resolveUserLabel({
      pubkey: member.pubkey,
      currentPubkey,
      fallbackName: member.displayName,
      profiles: profilesQuery.data?.profiles,
    }),
    description: recipientDescription(member.isAgent),
  }));
  const moneyApproverPubkeys = new Set(
    (moneyTeamQuery.data?.relayMembers ?? [])
      .filter((member) => member.role === "owner" || member.role === "admin")
      .map((member) => normalizePubkey(member.pubkey)),
  );
  const moneyRecipientMembers = (membersQuery.data ?? []).filter(
    (member) =>
      !member.isAgent &&
      normalizePubkey(member.pubkey) !== normalizePubkey(currentPubkey) &&
      moneyApproverPubkeys.has(normalizePubkey(member.pubkey)),
  );
  const moneyRecipientOptions = moneyRecipientMembers.map((member) => ({
    pubkey: member.pubkey,
    label: resolveUserLabel({
      pubkey: member.pubkey,
      currentPubkey,
      fallbackName: member.displayName,
      profiles: profilesQuery.data?.profiles,
    }),
    description: "Owner or administrator",
  }));
  const recipientLoading = membersQuery.isPending;
  const recipientError = membersQuery.isError;
  const recipientOptionsReady = membersQuery.isSuccess;
  const moneyRecipientLoading =
    membersQuery.isPending || moneyTeamQuery.isPending;
  const moneyRecipientError = membersQuery.isError || moneyTeamQuery.isError;
  const moneyRecipientOptionsReady =
    membersQuery.isSuccess && moneyTeamQuery.isSuccess;
  const moneyEmployeesLoading =
    moneyTeamQuery.isPending || moneyAllowancesQuery.isPending;
  const moneyEmployeesError =
    moneyTeamQuery.isError || moneyAllowancesQuery.isError;
  const moneyEmployeesReady =
    moneyTeamQuery.isSuccess && moneyAllowancesQuery.isSuccess;
  const locked = isSending || pendingEvent !== null;
  const returnedToThread = React.useCallback(() => {
    if (!selectedChannelId) {
      void goToday();
      return;
    }
    if (selectedThreadRootId) {
      void goChannel(selectedChannelId, {
        messageId: selectedThreadRootId,
        threadRootId: selectedThreadRootId,
        thread: selectedThreadRootId,
      });
    } else {
      void goChannel(selectedChannelId);
    }
  }, [goChannel, goToday, selectedChannelId, selectedThreadRootId]);

  const returnedToPower = React.useCallback(() => {
    void goPower();
  }, [goPower]);

  const updateDraft = React.useCallback(
    <K extends keyof AskComposerDraft>(key: K, value: AskComposerDraft[K]) => {
      if (locked) return;
      setDraft((current) => ({ ...current, [key]: value }));
      setErrors((current) => ({ ...current, [key]: undefined }));
      setFormError(null);
    },
    [locked],
  );

  const chooseAskType = (type: AskComposerType) => {
    if (locked) return;
    const currentAddressee = (membersQuery.data ?? []).find(
      (member) =>
        normalizePubkey(member.pubkey) ===
        normalizePubkey(draft.addresseePubkey),
    );
    const agentAllowed = type === "question" || type === "verdict";
    setDraft((current) => ({
      ...current,
      type,
      addresseePubkey:
        currentAddressee?.isAgent && !agentAllowed
          ? ""
          : current.addresseePubkey,
    }));
    setHireProposalReview(false);
    setErrors((current) => ({ ...current, type: undefined }));
    setFormError(null);
  };

  const changeAskType = () => {
    if (locked) return;
    if (draft.type === "hire_proposal") {
      setDraft((current) => ({ ...current, type: "approval" }));
      setHireProposalReview(false);
      setFormError(null);
      return;
    }
    setStep("destination");
  };

  const retryRecipients = React.useCallback(() => {
    void membersQuery.refetch();
  }, [membersQuery]);

  const retryThreads = React.useCallback(() => {
    void messagesQuery.refetch();
  }, [messagesQuery]);

  const addInvitees = async (input: {
    pubkeys: string[];
    role: "member" | "admin" | "guest" | "bot";
  }) => {
    try {
      const result = await addMembersMutation.mutateAsync(input);
      if (result.added.length > 0) {
        await membersQuery.refetch();
        setInviteOpen(false);
      }
      return result;
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : "The teammate could not be added.";
      return {
        added: [],
        errors: input.pubkeys.map((pubkey) => ({ pubkey, error: message })),
      };
    }
  };

  const changeChannel = (nextChannelId: string) => {
    const nextThreadIsNew = step === "destination" || startNewThread;
    setSelectedChannelId(nextChannelId);
    setSelectedThreadRootId("");
    setStartNewThread(nextThreadIsNew);
    setDraft((current) => ({ ...current, addresseePubkey: "" }));
    setErrors((current) => ({ ...current, addresseePubkey: undefined }));
    setFormError(null);
  };

  const changeHireThread = (threadRootId: string) => {
    if (threadRootId === "new") {
      setSelectedThreadRootId("");
      setStartNewThread(true);
      return;
    }
    setSelectedThreadRootId(threadRootId);
    setStartNewThread(false);
  };

  const goBack = () => {
    if (isMoneyProposal && !moneyAllowanceChosen) {
      returnedToPower();
      return;
    }
    if (step !== "compose") {
      returnedToThread();
      return;
    }
    if (isHireProposal && hireProposalReview) {
      setHireProposalReview(false);
      setFormError(null);
      return;
    }
    if (isMoneyProposal && moneyProposalReview) {
      setMoneyProposalReview(false);
      setFormError(null);
      return;
    }
    if (isMoneyProposal && moneyAllowanceChosen) {
      setMoneyAllowanceChosen(false);
      setFormError(null);
      return;
    }
    changeAskType();
  };

  const continueToAsk = () => {
    if (!selectedChannelId || !channel?.isMember) return;
    if (startNewThread) {
      const nextErrors: AskComposerErrors = {};
      if (!draft.threadTitle.trim()) {
        nextErrors.threadTitle = "Add a title for the new discussion.";
      } else if (draft.threadTitle.trim().length > 180) {
        nextErrors.threadTitle = "Use 180 characters or fewer.";
      }
      if (draft.threadContext.trim().length > 4000) {
        nextErrors.threadContext = "Use 4,000 characters or fewer.";
      }
      setErrors((current) => ({
        ...current,
        threadTitle: nextErrors.threadTitle,
        threadContext: nextErrors.threadContext,
      }));
      if (Object.keys(nextErrors).length > 0) return;
    } else if (
      !threadRoots.some((message) => message.id === selectedThreadRootId)
    ) {
      return;
    }
    setStep("compose");
  };

  const sendAsk = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSending || pendingEvent || !selectedChannelId || !contextReady)
      return;
    const validation = validateAskComposerDraft(
      draft,
      {
        channelId: selectedChannelId,
        ...(startNewThread ? {} : { threadRootEventId: selectedThreadRootId }),
      },
      hireContext,
      moneyAllowanceContext,
    );
    setErrors(validation);
    setFormError(null);
    if (Object.keys(validation).length > 0) return;

    setIsSending(true);
    const askId = crypto.randomUUID();
    try {
      const hireId =
        draft.type === "hire_proposal"
          ? hireProposalId || crypto.randomUUID()
          : undefined;
      if (hireId && !hireProposalId) setHireProposalId(hireId);
      const action = buildAskCreateAction(
        draft,
        {
          channelId: selectedChannelId,
          ...(startNewThread
            ? {}
            : { threadRootEventId: selectedThreadRootId }),
          askId,
          ...(hireId ? { hireId } : {}),
        },
        hireContext,
        moneyAllowanceContext,
      );
      const signedEvent = await signRelayEvent({
        kind: KIND_ASK_ACTION,
        content: JSON.stringify(action),
        tags: buildAskCreateTags(
          selectedChannelId,
          startNewThread ? undefined : selectedThreadRootId,
          askId,
        ),
      });
      setPendingEvent(signedEvent);
      await relayClient.publishEvent(
        signedEvent,
        "The ask send timed out before the relay confirmed it.",
        "The ask could not be sent.",
      );
      await queryClient.invalidateQueries({
        queryKey: ["company-ask-heads"],
        exact: false,
      });
      setPendingEvent(null);
      setSentContext({
        channelId: selectedChannelId,
        askId,
        threadRootId: startNewThread ? signedEvent.id : selectedThreadRootId,
      });
    } catch (cause) {
      if (isMoneyProposal) setMoneyProposalReview(false);
      setFormError(
        cause instanceof Error
          ? cause.message
          : "The ask was not sent. Your draft is kept so you can retry.",
      );
    } finally {
      setIsSending(false);
    }
  };

  const reviewHireProposal = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validateAskComposerDraft(
      draft,
      {
        channelId: selectedChannelId,
        ...(startNewThread ? {} : { threadRootEventId: selectedThreadRootId }),
      },
      hireContext,
    );
    setErrors(validation);
    setFormError(null);
    if (Object.keys(validation).length > 0) return;
    setHireProposalId((current) => current || crypto.randomUUID());
    setHireProposalReview(true);
  };

  const reviewMoneyProposal = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validateAskComposerDraft(
      draft,
      {
        channelId: selectedChannelId,
        ...(startNewThread ? {} : { threadRootEventId: selectedThreadRootId }),
      },
      hireContext,
      moneyAllowanceContext,
    );
    setErrors(validation);
    setFormError(null);
    if (Object.keys(validation).length > 0) return;
    setMoneyProposalReview(true);
  };

  const retryAsk = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSending || !pendingEvent || !selectedChannelId) return;
    setIsSending(true);
    setFormError(null);
    try {
      await relayClient.publishEvent(
        pendingEvent,
        "The ask send timed out before the relay confirmed it.",
        "The ask could not be sent.",
      );
      await queryClient.invalidateQueries({
        queryKey: ["company-ask-heads"],
        exact: false,
      });
      const action = JSON.parse(pendingEvent.content) as { askId: string };
      setPendingEvent(null);
      setSentContext({
        channelId: selectedChannelId,
        askId: action.askId,
        threadRootId: startNewThread ? pendingEvent.id : selectedThreadRootId,
      });
    } catch (cause) {
      setFormError(
        cause instanceof Error
          ? cause.message
          : "The ask was not sent. Your draft is kept so you can retry.",
      );
    } finally {
      setIsSending(false);
    }
  };

  const retryCurrentEvent = Boolean(pendingEvent);
  const submitForm = retryCurrentEvent ? retryAsk : sendAsk;
  const isHireProposal = draft.type === "hire_proposal";
  const activeRecipientError = isMoneyProposal
    ? moneyRecipientError
    : recipientError;
  const activeRecipientOptionsReady = isMoneyProposal
    ? moneyRecipientOptionsReady
    : recipientOptionsReady;
  const channelPeople = isMoneyProposal
    ? moneyRecipientOptions.length
    : recipients.length;
  const submitLabel = isSending
    ? "Sending…"
    : retryCurrentEvent
      ? "Retry send"
      : isHireProposal
        ? hireProposalReview
          ? "Submit proposal"
          : "Review proposal"
        : isMoneyProposal
          ? moneyProposalReview
            ? "Submit request"
            : "Review request"
          : "Send ask";
  const recipientLoadingText = recipientLoading
    ? "Loading teammates…"
    : "Choose a person or AI employee";
  const canCreate =
    step === "compose" &&
    contextReady &&
    Boolean(channel?.isMember) &&
    activeRecipientOptionsReady &&
    channelPeople > 0;
  const moneyRecordsReady = moneyEmployeesReady;
  const canSubmit = retryCurrentEvent
    ? !isSending
    : canCreate &&
      Boolean(draft.addresseePubkey) &&
      !isSending &&
      !activeRecipientError &&
      (!isMoneyProposal || moneyRecordsReady);
  const canContinue = Boolean(
    selectedChannelId &&
      channel?.isMember &&
      (startNewThread
        ? draft.threadTitle.trim().length > 0 &&
          draft.threadTitle.trim().length <= 180 &&
          draft.threadContext.length <= 4000
        : threadRoots.some((message) => message.id === selectedThreadRootId)),
  );

  const openSentConversation = () => {
    if (!sentContext) return;
    void goChannel(sentContext.channelId, {
      messageId: sentContext.threadRootId,
      threadRootId: sentContext.threadRootId,
      thread: sentContext.threadRootId,
    });
  };

  const submitComposer = (event: React.FormEvent<HTMLFormElement>) => {
    if (retryCurrentEvent) {
      submitForm(event);
      return;
    }
    if (isHireProposal && !hireProposalReview) {
      reviewHireProposal(event);
      return;
    }
    if (isMoneyProposal && !moneyProposalReview) {
      reviewMoneyProposal(event);
      return;
    }
    submitForm(event);
  };

  return (
    <div className="colony-ask-detail-screen">
      <GoalRouteHeader
        title={
          isHireProposal
            ? "Propose a hire"
            : isMoneyProposal
              ? "Request an allowance or cost approval"
              : "Raise an ask"
        }
      />
      <div
        className={`colony-ask-detail-scroll${isHireProposal ? " colony-ask-detail-scroll--hire" : ""}${isMoneyProposal ? " colony-ask-detail-scroll--money" : ""}`}
      >
        <section
          aria-labelledby="ask-create-title"
          className={`colony-ask-create-content${isHireProposal ? " colony-ask-create-content--hire" : ""}${hireProposalReview ? " colony-ask-create-content--hire-review" : ""}${isMoneyProposal ? " colony-ask-create-content--money" : ""}${moneyProposalReview ? " colony-ask-create-content--money-review" : ""}`}
        >
          <GoalRouteBackLink
            label={
              step !== "compose"
                ? "Back"
                : isHireProposal
                  ? "Back"
                  : isMoneyProposal
                    ? "Back"
                    : "Change destination"
            }
            onClick={goBack}
            disabled={locked}
          />
          {sentContext ? (
            <AskCreateSuccess
              title={
                isHireProposal
                  ? "Proposal raised"
                  : isMoneyProposal
                    ? "Money request submitted"
                    : "Ask raised in its thread"
              }
              description={
                isHireProposal
                  ? "The proposal is waiting for review. No position or agent has been created."
                  : undefined
              }
              message={
                isMoneyProposal
                  ? "No balance or spending limit changes until an authorized human approves."
                  : `${draft.title.trim()} · #${channelName} / ${startNewThread ? draft.threadTitle.trim() : threadLabel(threadRoots.find((message) => message.id === sentContext.threadRootId) ?? threadRoots[0])}`
              }
              actionLabel={
                isHireProposal
                  ? "View proposal"
                  : isMoneyProposal
                    ? "Open decision"
                    : "Open the conversation"
              }
              onAction={openSentConversation}
            />
          ) : isMoneyProposal && !moneyAllowanceChosen ? (
            <MoneyAllowanceChooser
              onSelect={() => {
                setMoneyAllowanceChosen(true);
                setStep("compose");
              }}
            />
          ) : step === "destination" ? (
            <AskDestinationStep
              channels={(channelsQuery.data ?? []).filter(
                (candidate) => candidate.channelType !== "dm",
              )}
              channelsPending={channelsQuery.isPending}
              channelsError={channelsQuery.isError}
              selectedChannelId={selectedChannelId}
              channelIsMember={Boolean(channel?.isMember)}
              selectedChannelExists={Boolean(channel)}
              startNewThread={startNewThread}
              selectedThreadRootId={selectedThreadRootId}
              threadOptions={threadRoots.map((thread) => ({
                id: thread.id,
                label: threadLabel(thread),
              }))}
              threadsPending={messagesQuery.isPending}
              threadsError={messagesQuery.isError}
              draft={draft}
              errors={errors}
              canContinue={canContinue}
              onChangeChannel={changeChannel}
              onChooseExistingThread={() => setStartNewThread(false)}
              onStartNewThread={() => {
                setSelectedThreadRootId("");
                setStartNewThread(true);
              }}
              onSelectThread={setSelectedThreadRootId}
              onRetryChannels={() => void channelsQuery.refetch()}
              onRetryThreads={retryThreads}
              onContinue={continueToAsk}
              onCancel={returnedToThread}
              onUpdateDraft={updateDraft}
            />
          ) : (!contextReady || !channel?.isMember) && !isMoneyProposal ? (
            <div className="colony-ask-route-state" role="alert">
              <h1 id="ask-create-title">
                {isHireProposal
                  ? "Propose a hire"
                  : isMoneyProposal
                    ? "Request an allowance or cost approval"
                    : "Raise an ask"}
              </h1>
              <p>
                This conversation is unavailable. Choose a conversation you can
                access to continue.
              </p>
            </div>
          ) : (
            <>
              <h1 id="ask-create-title">
                {isHireProposal
                  ? "Propose a hire"
                  : isMoneyProposal
                    ? "Request an allowance or cost approval"
                    : "Raise an ask"}
              </h1>
              <div
                className={`colony-ask-create-grid${isHireProposal ? " colony-ask-create-grid--hire" : ""}${hireProposalReview ? " colony-ask-create-grid--hire-review" : ""}${isMoneyProposal ? " colony-ask-create-grid--money" : ""}`}
              >
                <section
                  aria-label="Ask details"
                  className="colony-ask-create-main"
                >
                  {!isHireProposal && !isMoneyProposal ? (
                    <p className="colony-ask-create-context">
                      <strong>#{channelName}</strong>
                      {startNewThread
                        ? draft.threadTitle.trim()
                        : threadLabel(
                            threadRoots.find(
                              (message) => message.id === selectedThreadRootId,
                            ) ?? threadRoots[0],
                          )}
                    </p>
                  ) : null}
                  <fieldset
                    aria-label="Ask type"
                    className="colony-ask-create-types"
                    hidden={isHireProposal || isMoneyProposal}
                  >
                    <legend className="sr-only">Ask type</legend>
                    {ASK_TYPES.map((type) => (
                      <Button
                        aria-pressed={draft.type === type.value}
                        className="colony-ask-create-type"
                        disabled={locked}
                        key={type.value}
                        onClick={() => chooseAskType(type.value)}
                        type="button"
                        variant={
                          draft.type === type.value ? "secondary" : "ghost"
                        }
                      >
                        {type.label}
                      </Button>
                    ))}
                  </fieldset>
                  {!isHireProposal && !isMoneyProposal && recipientLoading ? (
                    <p
                      className="colony-ask-create-recipient-state"
                      role="status"
                    >
                      {recipientLoadingText}
                    </p>
                  ) : !isHireProposal && !isMoneyProposal && recipientError ? (
                    <div
                      className="colony-ask-create-recipient-state"
                      role="alert"
                    >
                      <p>Teammates could not load. Your draft is kept.</p>
                      <Button
                        onClick={retryRecipients}
                        type="button"
                        variant="outline"
                      >
                        Retry teammates
                      </Button>
                    </div>
                  ) : !isHireProposal &&
                    !isMoneyProposal &&
                    (!recipientOptionsReady || channelPeople === 0) ? (
                    <div
                      className="colony-ask-create-recipient-state"
                      role="status"
                    >
                      <strong>You’re the only member here</strong>
                      <p>
                        An ask needs another recipient. Invite a teammate, then
                        return to finish it. Your draft stays here.
                      </p>
                      {canInviteToChannel ? (
                        <Button
                          onClick={() => setInviteOpen(true)}
                          type="button"
                          variant="outline"
                        >
                          Invite someone
                        </Button>
                      ) : null}
                      <p>
                        Send is unavailable. You cannot address this ask to
                        yourself.
                      </p>
                    </div>
                  ) : null}
                  <form
                    className={`colony-ask-compose-form${isHireProposal && !hireProposalReview ? " colony-ask-hire-form" : ""}${hireProposalReview ? " colony-ask-hire-review-form" : ""}${isMoneyProposal ? " colony-ask-money-form" : ""}${isMoneyProposal && moneyProposalReview ? " colony-ask-money-review-form" : ""}`}
                    noValidate={isHireProposal || isMoneyProposal}
                    onSubmit={submitComposer}
                  >
                    {isHireProposal ? (
                      <HireProposalComposer
                        draft={draft}
                        errors={errors}
                        hireProposalReview={hireProposalReview}
                        selectedHireRole={selectedHireRole}
                        roleOptions={hireRoleOptions}
                        roleOptionsPending={personasQuery.isPending}
                        roleOptionsError={personasQuery.isError}
                        roleOptionsReady={personasQuery.isSuccess}
                        recipientOptions={recipientOptions}
                        recipientLoading={recipientLoading}
                        recipientError={recipientError}
                        channelPeople={channelPeople}
                        channelOptions={(channelsQuery.data ?? [])
                          .filter(
                            (candidate) =>
                              candidate.channelType !== "dm" &&
                              candidate.isMember,
                          )
                          .map((candidate) => ({
                            id: candidate.id,
                            name: candidate.name,
                          }))}
                        selectedChannelId={selectedChannelId}
                        selectedThreadRootId={selectedThreadRootId}
                        startNewThread={startNewThread}
                        threadOptions={threadRoots.map((thread) => ({
                          id: thread.id,
                          label: threadLabel(thread),
                        }))}
                        threadsPending={messagesQuery.isPending}
                        threadsError={messagesQuery.isError}
                        proposalDestination={`#${channelName} / ${startNewThread ? draft.threadTitle.trim() : threadLabel(threadRoots.find((message) => message.id === selectedThreadRootId) ?? threadRoots[0])}`}
                        locked={locked}
                        onUpdateDraft={updateDraft}
                        onChangeChannel={changeChannel}
                        onChangeThread={changeHireThread}
                        onRetryThreads={retryThreads}
                        onRetryRoleOptions={() => void personasQuery.refetch()}
                        onOpenRoleCatalog={() => void goHireRoles()}
                      />
                    ) : isMoneyProposal ? (
                      <MoneyAllowanceComposer
                        draft={draft}
                        errors={errors}
                        locked={locked}
                        review={moneyProposalReview}
                        channelOptions={(channelsQuery.data ?? [])
                          .filter(
                            (candidate) =>
                              candidate.channelType !== "dm" &&
                              candidate.isMember,
                          )
                          .map((candidate) => ({
                            id: candidate.id,
                            name: candidate.name,
                          }))}
                        selectedChannelId={selectedChannelId}
                        selectedThreadRootId={selectedThreadRootId}
                        startNewThread={startNewThread}
                        threadOptions={threadRoots.map((thread) => ({
                          id: thread.id,
                          label: threadLabel(thread),
                        }))}
                        threadsPending={messagesQuery.isPending}
                        threadsError={messagesQuery.isError}
                        recipientOptions={moneyRecipientOptions}
                        recipientLoading={moneyRecipientLoading}
                        recipientError={moneyRecipientError}
                        channelsPending={channelsQuery.isPending}
                        channelsError={channelsQuery.isError}
                        employeeOptions={moneyEmployeeOptions}
                        employeesLoading={moneyEmployeesLoading}
                        employeesError={moneyEmployeesError}
                        channelHasOtherMembers={
                          moneyRecipientMembers.length > 0 ||
                          (membersQuery.data ?? []).some(
                            (member) =>
                              normalizePubkey(member.pubkey) !==
                              normalizePubkey(currentPubkey),
                          )
                        }
                        canInviteToChannel={canInviteToChannel}
                        onUpdateDraft={updateDraft}
                        onChangeChannel={changeChannel}
                        onChangeThread={changeHireThread}
                        onRetryChannels={() => void channelsQuery.refetch()}
                        onRetryThreads={retryThreads}
                        onRetryEmployees={() => {
                          void moneyTeamQuery.refetch();
                          void moneyAllowancesQuery.refetch();
                        }}
                        onRetryRecipients={retryRecipients}
                        onInvite={() => setInviteOpen(true)}
                      />
                    ) : (
                      <AskStandardComposer
                        draft={draft}
                        errors={errors}
                        recipientOptions={recipientOptions}
                        recipientLoading={recipientLoading}
                        recipientError={recipientError}
                        channelPeople={channelPeople}
                        locked={locked}
                        onUpdateDraft={updateDraft}
                      />
                    )}

                    {formError ? (
                      <div className="colony-ask-compose-failure" role="alert">
                        <strong>
                          {isHireProposal
                            ? "Could not save"
                            : isMoneyProposal
                              ? "Could not save"
                              : "Ask was not sent"}
                        </strong>
                        <p>
                          {isMoneyProposal
                            ? "Your inputs are kept. Review them or retry without starting again."
                            : formError}
                        </p>
                        {pendingEvent && !isMoneyProposal ? (
                          <p className="colony-ask-compose-retained">
                            {isHireProposal
                              ? "Your inputs are kept. Retry sends the same proposal."
                              : "Your wording and response details are kept. Retry sends the same ask."}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="colony-ask-compose-actions">
                      <Button disabled={!canSubmit} type="submit">
                        {submitLabel}
                      </Button>
                      {isHireProposal && hireProposalReview ? (
                        <Button
                          disabled={locked}
                          onClick={() => {
                            setHireProposalReview(false);
                            setFormError(null);
                          }}
                          type="button"
                          variant="outline"
                        >
                          Edit proposal
                        </Button>
                      ) : isMoneyProposal && moneyProposalReview ? (
                        <Button
                          disabled={locked}
                          onClick={() => {
                            setMoneyProposalReview(false);
                            setFormError(null);
                          }}
                          type="button"
                          variant="outline"
                        >
                          Back
                        </Button>
                      ) : (
                        <Button
                          disabled={locked}
                          onClick={isMoneyProposal ? goBack : returnedToThread}
                          type="button"
                          variant="outline"
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </form>
                </section>

                {!isMoneyProposal && !hireProposalReview ? (
                  <aside
                    aria-label={
                      isHireProposal
                        ? "Proposal review steps"
                        : "Who can answer?"
                    }
                    className="colony-ask-create-aside"
                  >
                    {isHireProposal ? (
                      <HireProposalReviewSteps />
                    ) : (
                      <>
                        <h2>Who can answer?</h2>
                        <p>
                          Questions and verdicts can go to a person or an AI
                          employee. Sensitive decisions stay with authorized
                          people.
                        </p>
                        <dl>
                          <div>
                            <dt>Raised by</dt>
                            <dd>
                              {currentPubkey
                                ? resolveUserLabel({
                                    pubkey: currentPubkey,
                                    currentPubkey,
                                    fallbackName: "You",
                                    preferResolvedSelfLabel: true,
                                    profiles: profilesQuery.data?.profiles,
                                  })
                                : "Your account"}
                            </dd>
                          </div>
                          <div>
                            <dt>Visibility</dt>
                            <dd>People in #{channelName}</dd>
                          </div>
                          <div>
                            <dt>After a response</dt>
                            <dd>
                              The decision stays linked to this conversation.
                            </dd>
                          </div>
                        </dl>
                      </>
                    )}
                    {membersQuery.isError ? (
                      <Button
                        onClick={retryRecipients}
                        type="button"
                        variant="outline"
                      >
                        Retry teammates
                      </Button>
                    ) : null}
                  </aside>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>
      <Dialog onOpenChange={setInviteOpen} open={inviteOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Invite someone</DialogTitle>
            <DialogDescription>
              Add a person to this conversation so they can be chosen as the
              recipient. Their access stays limited to this channel.
            </DialogDescription>
          </DialogHeader>
          <ChannelMemberInviteCard
            canAssignElevatedRoles={
              currentChannelMember?.role === "owner" ||
              currentChannelMember?.role === "admin"
            }
            existingMembers={membersQuery.data ?? []}
            isPending={addMembersMutation.isPending}
            onSubmit={addInvitees}
            open={inviteOpen}
            requestErrorMessage={null}
          />
          <p className="text-xs text-muted-foreground">
            An invitation does not make the person eligible to approve money,
            hires or tools.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
