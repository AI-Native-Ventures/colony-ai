import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { usePersonasQuery } from "@/features/agents/hooks";
import { companyHireRolePackFromPersona } from "@/features/company-hiring/companyHireModels";
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
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";
import { KIND_ASK_ACTION } from "@/shared/constants/kinds";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useIdentityQuery } from "@/shared/api/hooks";
import type { AgentPersona } from "@/shared/api/types";
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
  type AskComposerHireContext,
  type AskComposerDraft,
  type AskComposerErrors,
  type AskComposerType,
} from "../askComposer";
import type { HireProposal } from "../askRecords";

const ASK_TYPES: Array<{ value: AskComposerType; label: string }> = [
  { value: "approval", label: "Approval" },
  { value: "question", label: "Question" },
  { value: "choice", label: "Choice" },
  { value: "checklist", label: "Checklist" },
  { value: "verdict", label: "Verdict" },
  { value: "hire_proposal", label: "Hire proposal" },
];

type HireRoleOption = {
  persona: AgentPersona;
  rolePack: HireProposal["rolePack"];
  runtimeId: string;
};

function availableHireRoles(
  personas: readonly AgentPersona[],
): HireRoleOption[] {
  return personas.flatMap((persona) => {
    const rolePack = companyHireRolePackFromPersona(persona);
    if (!rolePack) return [];
    const runtimeId = rolePack.workerMenu.includes(persona.runtime ?? "")
      ? (persona.runtime ?? "")
      : (rolePack.workerMenu[0] ?? "");
    return runtimeId ? [{ persona, rolePack, runtimeId }] : [];
  });
}

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
  const content = event.content.replace(/\s+/g, " ").trim();
  return content.slice(0, 140) || "Discussion";
}

/** Ask creation surface for a real channel and discussion thread. */
export function AskCreateScreen({
  channelId,
  threadRootEventId,
}: {
  channelId: string | null;
  threadRootEventId: string | null;
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
  const { goChannel, goToday, goHireRoles } = useAppNavigation();
  const [draft, setDraft] = React.useState(EMPTY_ASK_COMPOSER_DRAFT);
  const personasQuery = usePersonasQuery({
    enabled: draft.type === "hire_proposal",
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

  const hireRoleOptions = React.useMemo(
    () => availableHireRoles(personasQuery.data ?? []),
    [personasQuery.data],
  );
  const selectedHireRole = hireRoleOptions.find(
    (option) => option.persona.id === draft.hireRolePackId,
  );
  const hireContext: AskComposerHireContext | undefined = selectedHireRole
    ? {
        rolePack: selectedHireRole.rolePack,
        runtimeId: selectedHireRole.runtimeId,
        ...(selectedHireRole.persona.runtime === selectedHireRole.runtimeId &&
        selectedHireRole.persona.provider
          ? { providerId: selectedHireRole.persona.provider }
          : {}),
        ...(selectedHireRole.persona.runtime === selectedHireRole.runtimeId &&
        selectedHireRole.persona.model
          ? { modelId: selectedHireRole.persona.model }
          : {}),
      }
    : undefined;

  React.useEffect(() => {
    setSelectedChannelId(channelId ?? "");
    setSelectedThreadRootId(threadRootEventId ?? "");
    setStartNewThread(!threadRootEventId);
    setStep(channelId && threadRootEventId ? "compose" : "destination");
  }, [channelId, threadRootEventId]);

  const currentPubkey = identityQuery.data?.pubkey ?? "";
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
  const recipientLoading = membersQuery.isPending;
  const recipientError = membersQuery.isError;
  const recipientOptionsReady = membersQuery.isSuccess;
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
    setSelectedChannelId(nextChannelId);
    setSelectedThreadRootId("");
    setStartNewThread(true);
    setDraft((current) => ({ ...current, addresseePubkey: "" }));
    setErrors((current) => ({ ...current, addresseePubkey: undefined }));
    setFormError(null);
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
  const submitLabel = isSending
    ? "Sending…"
    : retryCurrentEvent
      ? "Retry send"
      : isHireProposal
        ? hireProposalReview
          ? "Submit proposal"
          : "Review proposal"
        : "Send ask";
  const channelPeople = recipients.length;
  const recipientLoadingText = recipientLoading
    ? "Loading teammates…"
    : "Choose a person or AI employee";
  const canCreate =
    step === "compose" &&
    contextReady &&
    Boolean(channel?.isMember) &&
    recipientOptionsReady &&
    channelPeople > 0;
  const canSubmit = retryCurrentEvent
    ? !isSending
    : canCreate &&
      Boolean(draft.addresseePubkey) &&
      !isSending &&
      !recipientError;
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
    if (isHireProposal && !hireProposalReview) {
      reviewHireProposal(event);
      return;
    }
    submitForm(event);
  };

  return (
    <div className="colony-ask-detail-screen">
      <GoalRouteHeader
        title={isHireProposal ? "Propose a hire" : "Raise an ask"}
      />
      <div className="colony-ask-detail-scroll">
        <section
          aria-labelledby="ask-create-title"
          className="colony-ask-create-content"
        >
          <GoalRouteBackLink
            label={
              step !== "compose"
                ? "Back"
                : isHireProposal
                  ? "Change ask type"
                  : "Change destination"
            }
            onClick={step !== "compose" ? returnedToThread : changeAskType}
            disabled={locked}
          />
          {sentContext ? (
            <div className="colony-ask-create-success" role="status">
              <h1 id="ask-create-title">
                {isHireProposal
                  ? "Proposal raised"
                  : "Ask raised in its thread"}
              </h1>
              {isHireProposal ? (
                <p>
                  The proposal is waiting for review. No position or agent has
                  been created.
                </p>
              ) : null}
              <p>
                {draft.title.trim()} · #{channelName} /{" "}
                {startNewThread
                  ? draft.threadTitle.trim()
                  : threadLabel(
                      threadRoots.find(
                        (message) => message.id === sentContext.threadRootId,
                      ) ?? threadRoots[0],
                    )}
              </p>
              <Button onClick={openSentConversation} type="button">
                {isHireProposal ? "View proposal" : "Open the conversation"}
              </Button>
            </div>
          ) : step === "destination" ? (
            <div className="colony-ask-context-step">
              <h1 id="ask-create-title">Raise an ask</h1>
              <div className="colony-ask-context-panel">
                <h2>Where should the conversation happen?</h2>
                <p>
                  <strong>Every ask belongs to a thread</strong>
                  <span>
                    Choose a channel first, then an existing thread or a new
                    discussion.
                  </span>
                </p>
                {channelsQuery.isPending ? (
                  <p role="status">Loading conversations…</p>
                ) : channelsQuery.isError ? (
                  <div role="alert">
                    <p>Conversations could not load. Your ask draft is kept.</p>
                    <Button
                      onClick={() => void channelsQuery.refetch()}
                      type="button"
                      variant="outline"
                    >
                      Retry conversations
                    </Button>
                  </div>
                ) : (
                  <>
                    <label htmlFor="ask-channel">Channel</label>
                    <select
                      id="ask-channel"
                      onChange={(event) => changeChannel(event.target.value)}
                      value={selectedChannelId}
                    >
                      <option value="">Choose channel</option>
                      {(channelsQuery.data ?? [])
                        .filter((candidate) => candidate.channelType !== "dm")
                        .map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name}
                          </option>
                        ))}
                    </select>
                    {selectedChannelId && !channel ? (
                      <p role="alert">
                        This conversation is unavailable to your account.
                      </p>
                    ) : null}
                    {channel && !channel.isMember ? (
                      <p role="alert">
                        You need to be a member of this conversation to raise an
                        ask.
                      </p>
                    ) : null}
                    {channel?.isMember ? (
                      <>
                        <fieldset
                          aria-label="Thread destination"
                          className="colony-ask-context-options"
                        >
                          <legend>Thread</legend>
                          <label>
                            <input
                              checked={!startNewThread}
                              name="ask-thread-mode"
                              onChange={() => setStartNewThread(false)}
                              type="radio"
                            />
                            Existing thread
                          </label>
                          <label>
                            <input
                              checked={startNewThread}
                              name="ask-thread-mode"
                              onChange={() => {
                                setSelectedThreadRootId("");
                                setStartNewThread(true);
                              }}
                              type="radio"
                            />
                            Start a new thread
                          </label>
                        </fieldset>
                        {startNewThread ? (
                          <>
                            <label htmlFor="ask-thread-title">
                              New thread title
                            </label>
                            <Input
                              aria-describedby={
                                errors.threadTitle
                                  ? "ask-thread-title-error"
                                  : undefined
                              }
                              aria-invalid={Boolean(errors.threadTitle)}
                              id="ask-thread-title"
                              maxLength={180}
                              onChange={(event) =>
                                updateDraft("threadTitle", event.target.value)
                              }
                              value={draft.threadTitle}
                            />
                            {errors.threadTitle ? (
                              <span
                                className="colony-ask-compose-error"
                                id="ask-thread-title-error"
                                role="alert"
                              >
                                {errors.threadTitle}
                              </span>
                            ) : null}
                            <label htmlFor="ask-thread-context">
                              Opening context, optional
                            </label>
                            <textarea
                              aria-describedby={
                                errors.threadContext
                                  ? "ask-thread-context-error"
                                  : undefined
                              }
                              aria-invalid={Boolean(errors.threadContext)}
                              id="ask-thread-context"
                              maxLength={4000}
                              onChange={(event) =>
                                updateDraft("threadContext", event.target.value)
                              }
                              rows={4}
                              value={draft.threadContext}
                            />
                            {errors.threadContext ? (
                              <span
                                className="colony-ask-compose-error"
                                id="ask-thread-context-error"
                                role="alert"
                              >
                                {errors.threadContext}
                              </span>
                            ) : null}
                          </>
                        ) : messagesQuery.isPending ? (
                          <p role="status">Loading threads…</p>
                        ) : messagesQuery.isError ? (
                          <div role="alert">
                            <p>
                              Threads could not load. Your ask draft is kept.
                            </p>
                            <Button
                              onClick={retryThreads}
                              type="button"
                              variant="outline"
                            >
                              Retry threads
                            </Button>
                          </div>
                        ) : threadRoots.length === 0 ? (
                          <div className="colony-ask-context-empty">
                            <strong>No threads in this channel yet</strong>
                            <span>
                              Start a thread for this discussion. The ask and
                              its responses will live there.
                            </span>
                            <Button
                              onClick={() => setStartNewThread(true)}
                              type="button"
                              variant="outline"
                            >
                              Start a thread
                            </Button>
                          </div>
                        ) : (
                          <div
                            aria-label="Threads"
                            className="colony-ask-thread-list"
                            role="radiogroup"
                          >
                            {threadRoots.map((thread) => (
                              <label key={thread.id}>
                                <input
                                  checked={selectedThreadRootId === thread.id}
                                  name="ask-existing-thread"
                                  onChange={() =>
                                    setSelectedThreadRootId(thread.id)
                                  }
                                  type="radio"
                                />
                                <span>{threadLabel(thread)}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </>
                    ) : null}
                    {channel?.isMember ? (
                      <div className="colony-ask-compose-actions">
                        <Button
                          disabled={!canContinue}
                          onClick={continueToAsk}
                          type="button"
                        >
                          Continue to ask
                        </Button>
                        <Button
                          onClick={returnedToThread}
                          type="button"
                          variant="outline"
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          ) : !contextReady || !channel?.isMember ? (
            <div className="colony-ask-route-state" role="alert">
              <h1 id="ask-create-title">
                {isHireProposal ? "Propose a hire" : "Raise an ask"}
              </h1>
              <p>
                This conversation is unavailable. Choose a conversation you can
                access to continue.
              </p>
            </div>
          ) : (
            <>
              <h1 id="ask-create-title">
                {isHireProposal ? "Propose a hire" : "Raise an ask"}
              </h1>
              <div className="colony-ask-create-grid">
                <section
                  aria-label="Ask details"
                  className="colony-ask-create-main"
                >
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
                  <fieldset
                    aria-label="Ask type"
                    className="colony-ask-create-types"
                    hidden={isHireProposal}
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
                  {recipientLoading ? (
                    <p
                      className="colony-ask-create-recipient-state"
                      role="status"
                    >
                      {recipientLoadingText}
                    </p>
                  ) : recipientError ? (
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
                  ) : !recipientOptionsReady || channelPeople === 0 ? (
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
                    className="colony-ask-compose-form"
                    noValidate={isHireProposal}
                    onSubmit={submitComposer}
                  >
                    {isHireProposal ? (
                      hireProposalReview && selectedHireRole ? (
                        <div className="colony-ask-hire-review">
                          <h2>Review hire proposal</h2>
                          <dl>
                            <div>
                              <dt>Role pack</dt>
                              <dd>{selectedHireRole.rolePack.title}</dd>
                            </div>
                            <div>
                              <dt>Name</dt>
                              <dd>{draft.hireName.trim()}</dd>
                            </div>
                            <div>
                              <dt>Title</dt>
                              <dd>{draft.hireTitle.trim()}</dd>
                            </div>
                            <div>
                              <dt>Allowance request</dt>
                              <dd>USD {draft.hireAllowance.trim()} / week</dd>
                            </div>
                            <div>
                              <dt>Reason</dt>
                              <dd>{draft.hireReason.trim()}</dd>
                            </div>
                            <div>
                              <dt>Destination</dt>
                              <dd>
                                #{channelName} /{" "}
                                {startNewThread
                                  ? draft.threadTitle.trim()
                                  : threadLabel(
                                      threadRoots.find(
                                        (message) =>
                                          message.id === selectedThreadRootId,
                                      ) ?? threadRoots[0],
                                    )}
                              </dd>
                            </div>
                          </dl>
                          <p>
                            Submitting proposes a hire. Only the founder can
                            complete sign-off.
                          </p>
                        </div>
                      ) : (
                        <>
                          <label htmlFor="ask-addressee">Recipient</label>
                          <select
                            aria-describedby={
                              errors.addresseePubkey
                                ? "ask-addressee-error"
                                : undefined
                            }
                            aria-invalid={Boolean(errors.addresseePubkey)}
                            disabled={
                              locked ||
                              recipientLoading ||
                              recipientError ||
                              channelPeople === 0
                            }
                            id="ask-addressee"
                            onChange={(event) =>
                              updateDraft("addresseePubkey", event.target.value)
                            }
                            value={draft.addresseePubkey}
                          >
                            <option value="">Choose recipient</option>
                            {recipients.map((member) => (
                              <option key={member.pubkey} value={member.pubkey}>
                                {resolveUserLabel({
                                  pubkey: member.pubkey,
                                  currentPubkey,
                                  fallbackName: member.displayName,
                                  profiles: profilesQuery.data?.profiles,
                                })}
                              </option>
                            ))}
                          </select>
                          {errors.addresseePubkey ? (
                            <span
                              className="colony-ask-compose-error"
                              id="ask-addressee-error"
                              role="alert"
                            >
                              {errors.addresseePubkey}
                            </span>
                          ) : null}

                          <label htmlFor="hire-role-pack">Role pack</label>
                          <select
                            aria-describedby={
                              errors.hireRolePackId
                                ? "hire-role-pack-error"
                                : undefined
                            }
                            aria-invalid={Boolean(errors.hireRolePackId)}
                            disabled={locked || !personasQuery.isSuccess}
                            id="hire-role-pack"
                            onChange={(event) =>
                              updateDraft("hireRolePackId", event.target.value)
                            }
                            value={draft.hireRolePackId}
                          >
                            <option value="">Choose role pack</option>
                            {hireRoleOptions.map((option) => (
                              <option
                                key={option.persona.id}
                                value={option.persona.id}
                              >
                                {option.rolePack.title}
                              </option>
                            ))}
                          </select>
                          {personasQuery.isPending ? (
                            <p role="status">Loading role packs…</p>
                          ) : personasQuery.isError ? (
                            <div role="alert">
                              <p>
                                Role packs could not load. Your draft is kept.
                              </p>
                              <Button
                                onClick={() => void personasQuery.refetch()}
                                type="button"
                                variant="outline"
                              >
                                Retry role packs
                              </Button>
                            </div>
                          ) : hireRoleOptions.length === 0 ? (
                            <div role="status">
                              <p>No role pack is available.</p>
                              <Button
                                onClick={() => void goHireRoles()}
                                type="button"
                                variant="outline"
                              >
                                No role available? Open catalog
                              </Button>
                            </div>
                          ) : null}
                          {errors.hireRolePackId ? (
                            <span
                              className="colony-ask-compose-error"
                              id="hire-role-pack-error"
                              role="alert"
                            >
                              {errors.hireRolePackId}
                            </span>
                          ) : null}
                          {selectedHireRole ? (
                            <>
                              <div className="colony-ask-hire-fields">
                                <div>
                                  <label htmlFor="hire-name">
                                    Proposed name
                                  </label>
                                  <Input
                                    aria-describedby={
                                      errors.hireName
                                        ? "hire-name-error"
                                        : undefined
                                    }
                                    aria-invalid={Boolean(errors.hireName)}
                                    disabled={locked}
                                    id="hire-name"
                                    maxLength={120}
                                    onChange={(event) =>
                                      updateDraft(
                                        "hireName",
                                        event.target.value,
                                      )
                                    }
                                    value={draft.hireName}
                                  />
                                  {errors.hireName ? (
                                    <span
                                      className="colony-ask-compose-error"
                                      id="hire-name-error"
                                      role="alert"
                                    >
                                      {errors.hireName}
                                    </span>
                                  ) : null}
                                </div>
                                <div>
                                  <label htmlFor="hire-title">Job title</label>
                                  <Input
                                    aria-describedby={
                                      errors.hireTitle
                                        ? "hire-title-error"
                                        : undefined
                                    }
                                    aria-invalid={Boolean(errors.hireTitle)}
                                    disabled={locked}
                                    id="hire-title"
                                    maxLength={120}
                                    onChange={(event) =>
                                      updateDraft(
                                        "hireTitle",
                                        event.target.value,
                                      )
                                    }
                                    value={draft.hireTitle}
                                  />
                                  {errors.hireTitle ? (
                                    <span
                                      className="colony-ask-compose-error"
                                      id="hire-title-error"
                                      role="alert"
                                    >
                                      {errors.hireTitle}
                                    </span>
                                  ) : null}
                                </div>
                              </div>

                              <label htmlFor="hire-reason">Reason</label>
                              <textarea
                                aria-describedby={
                                  errors.hireReason
                                    ? "hire-reason-error hire-reason-count"
                                    : "hire-reason-count"
                                }
                                aria-invalid={Boolean(errors.hireReason)}
                                disabled={locked}
                                id="hire-reason"
                                maxLength={1000}
                                onChange={(event) =>
                                  updateDraft("hireReason", event.target.value)
                                }
                                rows={4}
                                value={draft.hireReason}
                              />
                              <small id="hire-reason-count">
                                {Array.from(draft.hireReason).length} / 1,000
                                characters · Required
                              </small>
                              {errors.hireReason ? (
                                <span
                                  className="colony-ask-compose-error"
                                  id="hire-reason-error"
                                  role="alert"
                                >
                                  {errors.hireReason}
                                </span>
                              ) : null}

                              <div className="colony-ask-hire-fields">
                                <div>
                                  <label htmlFor="hire-allowance">
                                    Requested allowance, USD
                                  </label>
                                  <Input
                                    aria-describedby={
                                      errors.hireAllowance
                                        ? "hire-allowance-error"
                                        : undefined
                                    }
                                    aria-invalid={Boolean(errors.hireAllowance)}
                                    disabled={locked}
                                    id="hire-allowance"
                                    min="0.01"
                                    onChange={(event) =>
                                      updateDraft(
                                        "hireAllowance",
                                        event.target.value,
                                      )
                                    }
                                    step="0.01"
                                    type="number"
                                    value={draft.hireAllowance}
                                  />
                                  {errors.hireAllowance ? (
                                    <span
                                      className="colony-ask-compose-error"
                                      id="hire-allowance-error"
                                      role="alert"
                                    >
                                      {errors.hireAllowance}
                                    </span>
                                  ) : null}
                                </div>
                                <div>
                                  <label htmlFor="hire-allowance-period">
                                    Allowance period
                                  </label>
                                  <select
                                    aria-describedby={
                                      errors.hireAllowancePeriod
                                        ? "hire-allowance-period-error"
                                        : undefined
                                    }
                                    aria-invalid={Boolean(
                                      errors.hireAllowancePeriod,
                                    )}
                                    disabled={locked}
                                    id="hire-allowance-period"
                                    onChange={(event) =>
                                      updateDraft(
                                        "hireAllowancePeriod",
                                        event.target
                                          .value as AskComposerDraft["hireAllowancePeriod"],
                                      )
                                    }
                                    value={draft.hireAllowancePeriod}
                                  >
                                    <option value="">
                                      Choose allowance period
                                    </option>
                                    <option disabled value="day">
                                      Day
                                    </option>
                                    <option value="week">Week</option>
                                    <option disabled value="month">
                                      Month
                                    </option>
                                  </select>
                                  {errors.hireAllowancePeriod ? (
                                    <span
                                      className="colony-ask-compose-error"
                                      id="hire-allowance-period-error"
                                      role="alert"
                                    >
                                      {errors.hireAllowancePeriod}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </>
                          ) : null}
                        </>
                      )
                    ) : (
                      <>
                        <label htmlFor="ask-title">
                          What needs a response?
                        </label>
                        <Input
                          aria-describedby={
                            errors.title ? "ask-title-error" : undefined
                          }
                          aria-invalid={Boolean(errors.title)}
                          disabled={locked}
                          id="ask-title"
                          maxLength={180}
                          onChange={(event) =>
                            updateDraft("title", event.target.value)
                          }
                          placeholder="Approve the October campaign"
                          value={draft.title}
                        />
                        {errors.title ? (
                          <span
                            className="colony-ask-compose-error"
                            id="ask-title-error"
                            role="alert"
                          >
                            {errors.title}
                          </span>
                        ) : null}

                        <label htmlFor="ask-body">
                          {draft.type === "verdict"
                            ? "Acceptance criteria"
                            : "Context"}
                        </label>
                        <textarea
                          aria-describedby={
                            errors.body ? "ask-body-error" : undefined
                          }
                          aria-invalid={Boolean(errors.body)}
                          disabled={locked}
                          id="ask-body"
                          maxLength={4000}
                          onChange={(event) =>
                            updateDraft("body", event.target.value)
                          }
                          placeholder="Add the context someone needs to respond."
                          rows={4}
                          value={draft.body}
                        />
                        {errors.body ? (
                          <span
                            className="colony-ask-compose-error"
                            id="ask-body-error"
                            role="alert"
                          >
                            {errors.body}
                          </span>
                        ) : null}

                        {draft.type === "choice" ? (
                          <>
                            <label htmlFor="ask-options">
                              Choices, one per line
                            </label>
                            <textarea
                              aria-describedby={
                                errors.options ? "ask-options-error" : undefined
                              }
                              aria-invalid={Boolean(errors.options)}
                              disabled={locked}
                              id="ask-options"
                              onChange={(event) =>
                                updateDraft("options", event.target.value)
                              }
                              placeholder={"Warm editorial\nBold studio"}
                              rows={3}
                              value={draft.options}
                            />
                            {errors.options ? (
                              <span
                                className="colony-ask-compose-error"
                                id="ask-options-error"
                                role="alert"
                              >
                                {errors.options}
                              </span>
                            ) : null}
                          </>
                        ) : null}

                        {draft.type === "checklist" ? (
                          <>
                            <label htmlFor="ask-items">
                              Items to confirm, one per line
                            </label>
                            <textarea
                              aria-describedby={
                                errors.items ? "ask-items-error" : undefined
                              }
                              aria-invalid={Boolean(errors.items)}
                              disabled={locked}
                              id="ask-items"
                              onChange={(event) =>
                                updateDraft("items", event.target.value)
                              }
                              placeholder={
                                "Client spelling checked\nDates agreed"
                              }
                              rows={3}
                              value={draft.items}
                            />
                            {errors.items ? (
                              <span
                                className="colony-ask-compose-error"
                                id="ask-items-error"
                                role="alert"
                              >
                                {errors.items}
                              </span>
                            ) : null}
                          </>
                        ) : null}

                        <label htmlFor="ask-addressee">Response from</label>
                        <select
                          aria-describedby={
                            errors.addresseePubkey
                              ? "ask-addressee-error"
                              : undefined
                          }
                          aria-invalid={Boolean(errors.addresseePubkey)}
                          disabled={
                            locked ||
                            recipientLoading ||
                            recipientError ||
                            channelPeople === 0
                          }
                          id="ask-addressee"
                          onChange={(event) =>
                            updateDraft("addresseePubkey", event.target.value)
                          }
                          value={draft.addresseePubkey}
                        >
                          <option value="">
                            Choose a person or AI employee
                          </option>
                          {recipients.map((member) => (
                            <option key={member.pubkey} value={member.pubkey}>
                              {resolveUserLabel({
                                pubkey: member.pubkey,
                                currentPubkey,
                                fallbackName: member.displayName,
                                profiles: profilesQuery.data?.profiles,
                              })}{" "}
                              · {recipientDescription(member.isAgent)}
                            </option>
                          ))}
                        </select>
                        {errors.addresseePubkey ? (
                          <span
                            className="colony-ask-compose-error"
                            id="ask-addressee-error"
                            role="alert"
                          >
                            {errors.addresseePubkey}
                          </span>
                        ) : null}

                        <label htmlFor="ask-decide-by">Decide by</label>
                        <Input
                          aria-describedby={
                            errors.decideBy ? "ask-decide-by-error" : undefined
                          }
                          aria-invalid={Boolean(errors.decideBy)}
                          disabled={locked}
                          id="ask-decide-by"
                          onChange={(event) =>
                            updateDraft("decideBy", event.target.value)
                          }
                          type="datetime-local"
                          value={draft.decideBy}
                        />
                        {errors.decideBy ? (
                          <span
                            className="colony-ask-compose-error"
                            id="ask-decide-by-error"
                            role="alert"
                          >
                            {errors.decideBy}
                          </span>
                        ) : null}
                      </>
                    )}

                    {formError ? (
                      <div className="colony-ask-compose-failure" role="alert">
                        <strong>
                          {isHireProposal
                            ? "Could not save"
                            : "Ask was not sent"}
                        </strong>
                        <p>{formError}</p>
                        {pendingEvent ? (
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
                      ) : (
                        <Button
                          onClick={returnedToThread}
                          type="button"
                          variant="outline"
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </form>
                </section>

                <aside
                  aria-label={
                    isHireProposal ? "Proposal review steps" : "Who can answer?"
                  }
                  className="colony-ask-create-aside"
                >
                  {isHireProposal ? (
                    <>
                      <h2>A proposal, then a decision</h2>
                      <ol className="colony-ask-hire-steps">
                        <li>
                          <strong>Describe the need</strong>
                          <p>Choose a curated role and explain the work.</p>
                        </li>
                        <li>
                          <strong>Review the request</strong>
                          <p>
                            An authorized human reviews the scope and allowance.
                          </p>
                        </li>
                        <li>
                          <strong>Founder signs off</strong>
                          <p>
                            Creating the position remains a separate, explicit
                            action.
                          </p>
                        </li>
                      </ol>
                    </>
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
