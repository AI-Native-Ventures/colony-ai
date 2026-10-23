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
import { useChannelMessagesQuery } from "@/features/messages/hooks";
import { getThreadReference } from "@/features/messages/lib/threading";
import { isTimelineContentEvent } from "@/features/messages/lib/formatTimelineMessages";
import { useCompanyTeamQuery } from "@/features/company-team/teamRelay";
import { useEmployeeAllowanceHeadsQuery } from "@/features/power/spendRelay";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { resolveJobTitle } from "@/features/profile/lib/jobTitle";
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
import { AskInviteDialog } from "./AskInviteDialog";
import { AskWhoCanAnswer } from "./AskWhoCanAnswer";
import { AskStandardComposer } from "./AskStandardComposer";
import { MoneyAllowanceComposer } from "./MoneyAllowanceComposer";
import { MoneyAllowanceChooser } from "./MoneyAllowanceChooser";
import { MoneyRequestHeader } from "./MoneyRequestHeader";
import { MoneyReviewPanel } from "./MoneyReviewPanel";
import { KIND_ASK_ACTION } from "@/shared/constants/kinds";
import { useIdentityQuery } from "@/shared/api/hooks";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { ColonySteps } from "@/shared/ui/ColonySteps";
import { HashIcon, PrivateChannelIcon } from "@/shared/ui/colonyIcons";

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
import { AskArrowRightIcon } from "./askIcons";
import { AskTopBarTrail, formatThreadWhen } from "./AskPeople";
import { capitalize, formatEndDate, formatUsdFromCents } from "./askFormatting";
import { recipientDescription, threadLabel } from "./askThreadLabels";
import "./askCompose.css";

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
  const [startNewThread, setStartNewThread] = React.useState(false);
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
  const profilePubkeys = React.useMemo(
    () => [
      ...new Set([
        ...(membersQuery.data ?? []).map((member) => member.pubkey),
        ...threadRoots.map((thread) => thread.pubkey),
      ]),
    ],
    [membersQuery.data, threadRoots],
  );
  const profilesQuery = useUsersBatchQuery(profilePubkeys, {
    enabled: profilePubkeys.length > 0,
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
  const isHireProposal = draft.type === "hire_proposal";
  const personasQuery = usePersonasQuery({
    enabled: isHireProposal,
  });
  const moneyTeamQuery = useCompanyTeamQuery(isMoneyProposal || isHireProposal);
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
    setStartNewThread(false);
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
  const profiles = profilesQuery.data?.profiles;
  const teamByPubkey = React.useMemo(
    () =>
      new Map(
        (moneyTeamQuery.data?.members ?? []).map((member) => [
          member.pubkey.toLowerCase(),
          member,
        ]),
      ),
    [moneyTeamQuery.data?.members],
  );
  /** The job title shown beside a name: the profile's, else the position's. */
  const companyRoleOf = (pubkey: string) => {
    const member = teamByPubkey.get(pubkey.toLowerCase());
    return (
      resolveJobTitle({
        profile:
          profiles?.[pubkey] ??
          moneyEmployeeProfilesQuery.data?.profiles?.[pubkey] ??
          null,
        positionTitle: member?.position?.head.title,
        isOwner: member?.role === "owner",
      }) || undefined
    );
  };
  const moneyEmployeeOptions = moneyEmployees.flatMap((employee) => {
    const allowance = moneyAllowancesQuery.data?.records.find(
      (record) =>
        record.head.employeePubkey.toLowerCase() ===
        employee.pubkey.toLowerCase(),
    );
    if (!allowance) return [];
    const name = resolveUserLabel({
      pubkey: employee.pubkey,
      currentPubkey,
      fallbackName: employee.fallbackName ?? "AI employee",
      profiles: moneyEmployeeProfilesQuery.data?.profiles,
    });
    const title = companyRoleOf(employee.pubkey);
    return [
      {
        pubkey: employee.pubkey,
        name,
        label: title ? `${name} · ${title}` : name,
      },
    ];
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
  const agentPubkeys = new Set(
    (membersQuery.data ?? [])
      .filter((member) => member.isAgent)
      .map((member) => normalizePubkey(member.pubkey)),
  );
  const nowForThreads = new Date();
  const threadOptions = threadRoots.map((thread) => {
    const startedBy = resolveUserLabel({
      pubkey: thread.pubkey,
      currentPubkey,
      profiles,
      preferResolvedSelfLabel: true,
    });
    return {
      id: thread.id,
      label: threadLabel(thread),
      startedBy,
      startedByAvatarUrl: profiles?.[thread.pubkey]?.avatarUrl ?? null,
      startedByIsAgent: agentPubkeys.has(normalizePubkey(thread.pubkey)),
      when: formatThreadWhen(thread.created_at, nowForThreads),
    };
  });
  const threadOptionLabels = threadOptions.map((thread) => ({
    id: thread.id,
    label: thread.label,
  }));
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
      profiles,
    }),
    description: recipientDescription(member.isAgent),
    role: companyRoleOf(member.pubkey),
  }));
  const moneyApproverRoles = new Map(
    (moneyTeamQuery.data?.relayMembers ?? [])
      .filter((member) => member.role === "owner" || member.role === "admin")
      .map((member) => [normalizePubkey(member.pubkey), member.role]),
  );
  const moneyRecipientMembers = (membersQuery.data ?? []).filter(
    (member) =>
      !member.isAgent &&
      normalizePubkey(member.pubkey) !== normalizePubkey(currentPubkey) &&
      moneyApproverRoles.has(normalizePubkey(member.pubkey)),
  );
  const moneyRecipientOptions = moneyRecipientMembers.map((member) => ({
    pubkey: member.pubkey,
    label: resolveUserLabel({
      pubkey: member.pubkey,
      currentPubkey,
      fallbackName: member.displayName,
      profiles,
    }),
    description: capitalize(
      moneyApproverRoles.get(normalizePubkey(member.pubkey)) ?? "owner",
    ),
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

  const changeDestination = () => {
    if (locked) return;
    setStep("destination");
  };

  /** Leaves the hire proposal for the ask types again. */
  const leaveHireProposal = () => {
    if (locked) return;
    setDraft((current) => ({ ...current, type: "approval" }));
    setHireProposalReview(false);
    setFormError(null);
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
    setSelectedChannelId(nextChannelId);
    setSelectedThreadRootId("");
    setDraft((current) => ({ ...current, addresseePubkey: "" }));
    setErrors((current) => ({ ...current, addresseePubkey: undefined }));
    setFormError(null);
  };

  const chooseExistingThread = React.useCallback((threadRootId: string) => {
    setSelectedThreadRootId(threadRootId);
    setStartNewThread(false);
  }, []);

  const chooseNewThread = React.useCallback(() => {
    setSelectedThreadRootId("");
    setStartNewThread(true);
  }, []);

  const changeHireThread = (threadRootId: string) => {
    if (threadRootId === "new") {
      chooseNewThread();
      return;
    }
    chooseExistingThread(threadRootId);
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

  const sendAsk = async () => {
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

  const reviewHireProposal = () => {
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

  const reviewMoneyProposal = () => {
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

  const retryAsk = async () => {
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

  const submitComposer = () => {
    if (retryCurrentEvent) {
      void retryAsk();
      return;
    }
    if (isHireProposal && !hireProposalReview) {
      reviewHireProposal();
      return;
    }
    if (isMoneyProposal && !moneyProposalReview) {
      reviewMoneyProposal();
      return;
    }
    void sendAsk();
  };

  const threadTitleForDestination = startNewThread
    ? draft.threadTitle.trim()
    : threadLabel(
        threadRoots.find((message) => message.id === selectedThreadRootId) ??
          threadRoots[0],
      );
  const destinationLabel = `${channelName} · ${threadTitleForDestination}`;
  const pageTitle = isHireProposal
    ? "Propose a hire"
    : isMoneyProposal
      ? "Request an allowance or cost approval"
      : "Raise an ask";
  const trail = isHireProposal
    ? ["Company", "Raise an ask", "Propose a hire"]
    : isMoneyProposal
      ? ["Company", "Request an allowance"]
      : ["Company", "Raise an ask"];
  const ChannelMark =
    channel?.visibility === "private" ? PrivateChannelIcon : HashIcon;
  const raisedByLabel = currentPubkey
    ? resolveUserLabel({
        pubkey: currentPubkey,
        currentPubkey,
        fallbackName: "You",
        preferResolvedSelfLabel: true,
        profiles,
      })
    : "Your account";
  const addressee = recipients.find(
    (member) =>
      normalizePubkey(member.pubkey) === normalizePubkey(draft.addresseePubkey),
  );
  const addresseeLabel = addressee
    ? resolveUserLabel({
        pubkey: addressee.pubkey,
        currentPubkey,
        fallbackName: addressee.displayName,
        profiles,
      })
    : null;
  const moneyRecipient = moneyRecipientOptions.find(
    (option) =>
      normalizePubkey(option.pubkey) === normalizePubkey(draft.addresseePubkey),
  );
  const moneySummary = {
    recipient: moneyRecipient?.label ?? "",
    employee: selectedMoneyEmployee?.name ?? "",
    duration:
      draft.moneyDuration === "permanent"
        ? "Permanent"
        : draft.moneyDuration === "temporary"
          ? draft.moneyEndDate
            ? `Temporary · until ${formatEndDate(draft.moneyEndDate)}`
            : "Temporary"
          : "",
    amount: draft.moneyAllowance.trim()
      ? `USD ${draft.moneyAllowance.trim()}`
      : "",
    conversation: contextReady
      ? `#${channelName} · ${threadTitleForDestination || "New thread"}`
      : "",
  };
  const currentAllowanceLabel = selectedMoneyAllowance
    ? `${formatUsdFromCents(selectedMoneyAllowance.head.allowance.amountCents)} per ${selectedMoneyAllowance.head.allowance.period}`
    : null;
  const moneyReviewing =
    isMoneyProposal && moneyProposalReview && !pendingEvent;

  const openMoneyChooser = () => {
    if (locked) return;
    setMoneyAllowanceChosen(false);
    setMoneyProposalReview(false);
    setFormError(null);
  };

  const composeHeader = (
    <header className="ask3-head-row">
      <div className="ask3-head" data-gap="10">
        {isHireProposal ? (
          <span className="ask3-chip">
            <ChannelMark size={14} strokeWidth={2.2} />
            {destinationLabel}
          </span>
        ) : (
          <button
            className="ask3-chip"
            disabled={locked}
            onClick={changeDestination}
            type="button"
          >
            <ChannelMark size={14} strokeWidth={2.2} />
            {destinationLabel}
            <span className="ask3-chip-change">Change</span>
          </button>
        )}
        <h1 className="ask3-title" id="ask-create-title">
          {pageTitle}
        </h1>
        {isHireProposal ? (
          <span className="ask3-sub">
            Describe the role you need. An owner reviews it, then the founder
            signs off.
          </span>
        ) : null}
      </div>
      {isHireProposal ? null : (
        <ColonySteps
          align="end"
          current={2}
          label="Ask steps"
          onStepSelect={changeDestination}
          steps={["Destination", "Ask"]}
        />
      )}
    </header>
  );

  const failureBanner = formError ? (
    <div className="ask3-notice" data-tone="bad" role="alert">
      <strong>
        {isHireProposal || isMoneyProposal
          ? "Could not save"
          : "Ask was not sent"}
      </strong>
      <p>
        {isMoneyProposal
          ? "Your inputs are kept. Review them or retry without starting again."
          : formError}
      </p>
      {pendingEvent && !isMoneyProposal ? (
        <p>
          {isHireProposal
            ? "Your inputs are kept. Retry sends the same proposal."
            : "Your wording and response details are kept. Retry sends the same ask."}
        </p>
      ) : null}
    </div>
  ) : null;

  const actions = (
    <div className="ask3-actions">
      {moneyReviewing ? null : (
        <button className="ask3-btn" disabled={!canSubmit} type="submit">
          {submitLabel}
          {!retryCurrentEvent &&
          ((isHireProposal && !hireProposalReview) ||
            (isMoneyProposal && !moneyProposalReview)) ? (
            <AskArrowRightIcon size={16} strokeWidth={2.4} />
          ) : null}
        </button>
      )}
      {isHireProposal && hireProposalReview ? (
        <button
          className="ask3-btn"
          data-variant="secondary"
          disabled={locked}
          onClick={() => {
            setHireProposalReview(false);
            setFormError(null);
          }}
          type="button"
        >
          Edit proposal
        </button>
      ) : moneyReviewing ? null : (
        <button
          className="ask3-btn"
          data-variant="secondary"
          disabled={locked}
          onClick={
            isMoneyProposal
              ? returnedToPower
              : isHireProposal
                ? leaveHireProposal
                : returnedToThread
          }
          type="button"
        >
          Cancel
        </button>
      )}
    </div>
  );

  const formBody = isHireProposal ? (
    <HireProposalComposer
      channelOptions={(channelsQuery.data ?? [])
        .filter(
          (candidate) => candidate.channelType !== "dm" && candidate.isMember,
        )
        .map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
        }))}
      channelPeople={channelPeople}
      draft={draft}
      errors={errors}
      hireProposalReview={hireProposalReview}
      locked={locked}
      onChangeChannel={changeChannel}
      onChangeThread={changeHireThread}
      onOpenRoleCatalog={() => void goHireRoles()}
      onRetryRoleOptions={() => void personasQuery.refetch()}
      onRetryThreads={retryThreads}
      onUpdateDraft={updateDraft}
      proposalDestination={`#${channelName} / ${threadTitleForDestination}`}
      recipientError={recipientError}
      recipientLoading={recipientLoading}
      recipientOptions={recipientOptions}
      roleOptions={hireRoleOptions}
      roleOptionsError={personasQuery.isError}
      roleOptionsPending={personasQuery.isPending}
      roleOptionsReady={personasQuery.isSuccess}
      selectedChannelId={selectedChannelId}
      selectedHireRole={selectedHireRole}
      selectedThreadRootId={selectedThreadRootId}
      startNewThread={startNewThread}
      threadOptions={threadOptionLabels}
      threadsError={messagesQuery.isError}
      threadsPending={messagesQuery.isPending}
    />
  ) : isMoneyProposal ? (
    <MoneyAllowanceComposer
      canInviteToChannel={canInviteToChannel}
      channelHasOtherMembers={
        moneyRecipientMembers.length > 0 ||
        (membersQuery.data ?? []).some(
          (member) =>
            normalizePubkey(member.pubkey) !== normalizePubkey(currentPubkey),
        )
      }
      channelOptions={(channelsQuery.data ?? [])
        .filter(
          (candidate) => candidate.channelType !== "dm" && candidate.isMember,
        )
        .map((candidate) => ({
          id: candidate.id,
          name: candidate.name,
        }))}
      channelsError={channelsQuery.isError}
      channelsPending={channelsQuery.isPending}
      currentAllowanceLabel={currentAllowanceLabel}
      draft={draft}
      employeeOptions={moneyEmployeeOptions}
      employeesError={moneyEmployeesError}
      employeesLoading={moneyEmployeesLoading}
      errors={errors}
      locked={locked || moneyProposalReview}
      onChangeChannel={changeChannel}
      onChangeThread={changeHireThread}
      onInvite={() => setInviteOpen(true)}
      onRetryChannels={() => void channelsQuery.refetch()}
      onRetryEmployees={() => {
        void moneyTeamQuery.refetch();
        void moneyAllowancesQuery.refetch();
      }}
      onRetryRecipients={retryRecipients}
      onRetryThreads={retryThreads}
      onUpdateDraft={updateDraft}
      recipientError={moneyRecipientError}
      recipientLoading={moneyRecipientLoading}
      recipientOptions={moneyRecipientOptions}
      selectedChannelId={selectedChannelId}
      selectedThreadRootId={selectedThreadRootId}
      startNewThread={startNewThread}
      threadOptions={threadOptionLabels}
      threadsError={messagesQuery.isError}
      threadsPending={messagesQuery.isPending}
    />
  ) : (
    <AskStandardComposer
      canInvite={canInviteToChannel}
      channelPeople={channelPeople}
      draft={draft}
      errors={errors}
      locked={locked}
      onChooseType={chooseAskType}
      onInvite={() => setInviteOpen(true)}
      onRetryRecipients={retryRecipients}
      onUpdateDraft={updateDraft}
      recipientError={recipientError}
      recipientLoading={recipientLoading}
      recipientOptions={recipientOptions}
      recipientOptionsReady={recipientOptionsReady}
    />
  );

  const composeForm = (
    <form
      aria-label={isHireProposal ? "Hire proposal" : "Compose the ask"}
      aria-labelledby={isMoneyProposal ? "allowance-change" : undefined}
      className="ask3-card"
      data-gap={isHireProposal || isMoneyProposal ? "20" : undefined}
      noValidate={isHireProposal || isMoneyProposal}
      onSubmit={(event) => {
        event.preventDefault();
        submitComposer();
      }}
    >
      {formBody}
      {failureBanner}
      {actions}
    </form>
  );

  let body: React.ReactNode;
  if (sentContext) {
    body = (
      <div className="ask3-success-wrap">
        <AskCreateSuccess
          actionLabel={
            isHireProposal
              ? "View proposal"
              : isMoneyProposal
                ? "Open decision"
                : "Open the conversation"
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
          onAction={openSentConversation}
          title={
            isHireProposal
              ? "Proposal raised"
              : isMoneyProposal
                ? "Money request submitted"
                : "Ask raised in its thread"
          }
        />
      </div>
    );
  } else if (isMoneyProposal && !moneyAllowanceChosen) {
    body = (
      <>
        <MoneyRequestHeader current={1} />
        <MoneyAllowanceChooser
          onSelect={() => {
            setMoneyAllowanceChosen(true);
            setStep("compose");
          }}
          selected={false}
        />
      </>
    );
  } else if (isMoneyProposal) {
    body = (
      <>
        <MoneyRequestHeader
          current={moneyProposalReview ? 3 : 2}
          onStepSelect={(number) => {
            if (number === 1) openMoneyChooser();
          }}
        />
        <MoneyAllowanceChooser
          disabled={locked}
          onSelect={openMoneyChooser}
          selected
        />
        <div className="ask3-split">
          {composeForm}
          <div className="ask3-review">
            <MoneyReviewPanel
              busy={locked}
              canSubmit={canSubmit}
              onEdit={() => {
                setMoneyProposalReview(false);
                setFormError(null);
              }}
              onSubmit={submitComposer}
              reviewing={moneyReviewing}
              submitLabel={isSending ? "Sending…" : "Submit request"}
              summary={moneySummary}
            />
          </div>
        </div>
      </>
    );
  } else if (step === "destination") {
    body = (
      <AskDestinationStep
        canContinue={canContinue}
        channelIsMember={Boolean(channel?.isMember)}
        channels={(channelsQuery.data ?? []).filter(
          (candidate) => candidate.channelType !== "dm",
        )}
        channelsError={channelsQuery.isError}
        channelsPending={channelsQuery.isPending}
        draft={draft}
        errors={errors}
        onCancel={returnedToThread}
        onChangeChannel={changeChannel}
        onContinue={continueToAsk}
        onRetryChannels={() => void channelsQuery.refetch()}
        onRetryThreads={retryThreads}
        onSelectThread={chooseExistingThread}
        onStartNewThread={chooseNewThread}
        onUpdateDraft={updateDraft}
        selectedChannelExists={Boolean(channel)}
        selectedChannelId={selectedChannelId}
        selectedThreadRootId={selectedThreadRootId}
        startNewThread={startNewThread}
        threadOptions={threadOptions}
        threadsError={messagesQuery.isError}
        threadsPending={messagesQuery.isPending}
      />
    );
  } else if (!contextReady || !channel?.isMember) {
    body = (
      <div className="ask3-notice" data-tone="bad" role="alert">
        <h1 className="ask3-heading-2" id="ask-create-title">
          {pageTitle}
        </h1>
        <p>
          This conversation is unavailable. Choose a conversation you can access
          to continue.
        </p>
      </div>
    );
  } else {
    body = (
      <>
        {composeHeader}
        <div className="ask3-split">
          {composeForm}
          {hireProposalReview ? null : (
            <aside
              aria-labelledby={
                isHireProposal ? "proposal-steps" : "who-can-answer"
              }
              className="ask3-aside"
            >
              {isHireProposal ? (
                <HireProposalReviewSteps />
              ) : (
                <AskWhoCanAnswer
                  channelName={channelName}
                  raisedBy={{
                    label: raisedByLabel,
                    avatarUrl: profiles?.[currentPubkey]?.avatarUrl,
                  }}
                  responseFrom={
                    addresseeLabel
                      ? {
                          label: addresseeLabel,
                          avatarUrl:
                            profiles?.[addressee?.pubkey ?? ""]?.avatarUrl,
                          isAgent: addressee?.isAgent,
                        }
                      : null
                  }
                />
              )}
            </aside>
          )}
        </div>
      </>
    );
  }

  const narrowLayout =
    !sentContext && !isMoneyProposal && step === "destination";

  return (
    <div className="ask3-screen" data-testid="ask-create-screen">
      <AskTopBarTrail trail={trail} />
      <div
        className="ask3-page"
        data-layout={
          narrowLayout ? "narrow" : isMoneyProposal ? "money" : undefined
        }
      >
        {body}
      </div>
      <AskInviteDialog
        canAssignElevatedRoles={
          currentChannelMember?.role === "owner" ||
          currentChannelMember?.role === "admin"
        }
        existingMembers={membersQuery.data ?? []}
        isPending={addMembersMutation.isPending}
        onOpenChange={setInviteOpen}
        onSubmit={addInvitees}
        open={inviteOpen}
      />
    </div>
  );
}
