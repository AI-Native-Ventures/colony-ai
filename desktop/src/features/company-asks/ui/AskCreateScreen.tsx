import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  useChannelMembersQuery,
  useChannelsQuery,
} from "@/features/channels/hooks";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";
import { KIND_ASK_ACTION } from "@/shared/constants/kinds";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useIdentityQuery } from "@/shared/api/hooks";
import { normalizePubkey } from "@/shared/lib/pubkey";
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
} from "../askComposer";
import type { AskType } from "../askRecords";

const ASK_TYPES: Array<{ value: AskType; label: string }> = [
  { value: "approval", label: "Approval" },
  { value: "question", label: "Question" },
  { value: "choice", label: "Choice" },
  { value: "checklist", label: "Checklist" },
  { value: "verdict", label: "Verdict" },
];

function recipientDescription(isAgent: boolean) {
  return isAgent ? "AI employee" : "Person";
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
  const membersQuery = useChannelMembersQuery(channelId);
  const memberPubkeys = React.useMemo(
    () => (membersQuery.data ?? []).map((member) => member.pubkey),
    [membersQuery.data],
  );
  const profilesQuery = useUsersBatchQuery(memberPubkeys, {
    enabled: memberPubkeys.length > 0,
  });
  const { goAskDetail, goChannel } = useAppNavigation();
  const [draft, setDraft] = React.useState(EMPTY_ASK_COMPOSER_DRAFT);
  const [errors, setErrors] = React.useState<AskComposerErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pendingEvent, setPendingEvent] = React.useState<RelayEvent | null>(
    null,
  );
  const [isSending, setIsSending] = React.useState(false);
  const currentPubkey = identityQuery.data?.pubkey ?? "";
  const channel = channelsQuery.data?.find(
    (candidate) => candidate.id === channelId,
  );
  const channelName = channel?.name ?? "conversation";
  const contextReady = Boolean(channelId && threadRootEventId);
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
    if (!channelId || !threadRootEventId) return;
    void goChannel(channelId, {
      messageId: threadRootEventId,
      threadRootId: threadRootEventId,
      thread: threadRootEventId,
    });
  }, [channelId, goChannel, threadRootEventId]);

  const updateDraft = React.useCallback(
    <K extends keyof AskComposerDraft>(key: K, value: AskComposerDraft[K]) => {
      if (locked) return;
      setDraft((current) => ({ ...current, [key]: value }));
      setErrors((current) => ({ ...current, [key]: undefined }));
      setFormError(null);
    },
    [locked],
  );

  const chooseAskType = (type: AskType) => {
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
    setErrors((current) => ({ ...current, type: undefined }));
    setFormError(null);
  };

  const retryRecipients = React.useCallback(() => {
    void membersQuery.refetch();
  }, [membersQuery]);

  const sendAsk = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSending || pendingEvent || !channelId || !threadRootEventId) return;
    const validation = validateAskComposerDraft(draft, {
      channelId,
      threadRootEventId,
    });
    setErrors(validation);
    setFormError(null);
    if (Object.keys(validation).length > 0) return;

    setIsSending(true);
    const askId = crypto.randomUUID();
    try {
      const action = buildAskCreateAction(draft, {
        channelId,
        threadRootEventId,
        askId,
      });
      const signedEvent = await signRelayEvent({
        kind: KIND_ASK_ACTION,
        content: JSON.stringify(action),
        tags: buildAskCreateTags(channelId, threadRootEventId, askId),
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
      await goAskDetail(channelId, askId);
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

  const retryAsk = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSending || !pendingEvent || !channelId) return;
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
      await goAskDetail(channelId, action.askId);
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
  const submitLabel = isSending
    ? "Sending…"
    : retryCurrentEvent
      ? "Retry send"
      : "Send ask";
  const channelPeople = recipients.length;
  const recipientLoadingText = recipientLoading
    ? "Loading teammates…"
    : "Choose a person or AI employee";
  const canCreate =
    contextReady &&
    Boolean(channel?.isMember) &&
    recipientOptionsReady &&
    channelPeople > 0;
  const canSubmit = retryCurrentEvent
    ? !isSending
    : canCreate && !isSending && !recipientError;

  return (
    <div className="colony-ask-detail-screen">
      <GoalRouteHeader title="Raise an ask" />
      <div className="colony-ask-detail-scroll">
        <section
          aria-labelledby="ask-create-title"
          className="colony-ask-create-content"
        >
          <GoalRouteBackLink
            label="Back to conversation"
            onClick={returnedToThread}
          />
          <h1 id="ask-create-title">Raise an ask</h1>
          {!contextReady ? (
            <div className="colony-ask-route-state" role="alert">
              <p>
                This discussion is unavailable. Open a real conversation to
                raise an ask.
              </p>
            </div>
          ) : (
            <div className="colony-ask-create-grid">
              <section
                aria-label="Ask details"
                className="colony-ask-create-main"
              >
                <p className="colony-ask-create-context">
                  In <strong>#{channelName}</strong>. Linked to the current
                  discussion thread.
                </p>
                <fieldset
                  aria-label="Ask type"
                  className="colony-ask-create-types"
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
                  <p
                    className="colony-ask-create-recipient-state"
                    role="status"
                  >
                    No people or AI employees are available in this
                    conversation.
                  </p>
                ) : null}
                <form className="colony-ask-compose-form" onSubmit={submitForm}>
                  <label htmlFor="ask-title">What needs a response?</label>
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
                      <label htmlFor="ask-options">Choices, one per line</label>
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
                        placeholder={"Client spelling checked\nDates agreed"}
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
                      errors.addresseePubkey ? "ask-addressee-error" : undefined
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
                    <option value="">Choose a person or AI employee</option>
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

                  {formError ? (
                    <div className="colony-ask-compose-failure" role="alert">
                      <strong>Ask was not sent</strong>
                      <p>{formError}</p>
                      {pendingEvent ? (
                        <p className="colony-ask-compose-retained">
                          Your wording and response details are kept. Retry
                          sends the same ask.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="colony-ask-compose-actions">
                    <Button disabled={!canSubmit} type="submit">
                      {submitLabel}
                    </Button>
                    <Button
                      onClick={returnedToThread}
                      type="button"
                      variant="outline"
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              </section>

              <aside
                aria-label="Who can answer?"
                className="colony-ask-create-aside"
              >
                <h2>Who can answer?</h2>
                <p>
                  Questions and verdicts can go to a person or an AI employee.
                  Sensitive decisions stay with authorized people.
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
                    <dd>The decision stays linked to this conversation.</dd>
                  </div>
                </dl>
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
          )}
        </section>
      </div>
    </div>
  );
}
