import * as React from "react";

import { ColonySteps } from "@/shared/ui/ColonySteps";

import type { AskComposerDraft, AskComposerErrors } from "../askComposer";
import { AskDiamondIcon, AskArrowRightIcon, AskPlusIcon } from "./askIcons";
import { AskAvatar, firstName } from "./AskPeople";

type ChannelOption = { id: string; name: string };

/** One selectable thread: its title and who started it, and when. */
export type AskThreadOption = {
  id: string;
  label: string;
  startedBy: string;
  startedByAvatarUrl: string | null;
  startedByIsAgent: boolean;
  when: string;
};

export type AskDestinationStepProps = {
  channels: ChannelOption[];
  channelsPending: boolean;
  channelsError: boolean;
  selectedChannelId: string;
  channelIsMember: boolean;
  selectedChannelExists: boolean;
  selectedThreadRootId: string;
  startNewThread: boolean;
  threadOptions: AskThreadOption[];
  threadsPending: boolean;
  threadsError: boolean;
  draft: AskComposerDraft;
  errors: AskComposerErrors;
  canContinue: boolean;
  onChangeChannel: (channelId: string) => void;
  onStartNewThread: () => void;
  onSelectThread: (threadRootId: string) => void;
  onRetryChannels: () => void;
  onRetryThreads: () => void;
  onContinue: () => void;
  onCancel: () => void;
  onUpdateDraft: <K extends keyof AskComposerDraft>(
    key: K,
    value: AskComposerDraft[K],
  ) => void;
};

/** Step 1 of Raise an ask: one panel with the channel and the thread rows. */
export function AskDestinationStep({
  channels,
  channelsPending,
  channelsError,
  selectedChannelId,
  channelIsMember,
  selectedChannelExists,
  selectedThreadRootId,
  startNewThread,
  threadOptions,
  threadsPending,
  threadsError,
  draft,
  errors,
  canContinue,
  onChangeChannel,
  onStartNewThread,
  onSelectThread,
  onRetryChannels,
  onRetryThreads,
  onContinue,
  onCancel,
  onUpdateDraft,
}: AskDestinationStepProps) {
  const threadsReady = channelIsMember && !threadsPending && !threadsError;
  const showEmptyThreads =
    threadsReady && threadOptions.length === 0 && !startNewThread;
  const firstThreadId = threadOptions[0]?.id ?? "";

  // The board opens with the newest thread chosen. Never override a choice.
  React.useEffect(() => {
    if (
      threadsReady &&
      firstThreadId &&
      !selectedThreadRootId &&
      !startNewThread
    ) {
      onSelectThread(firstThreadId);
    }
  }, [
    firstThreadId,
    onSelectThread,
    selectedThreadRootId,
    startNewThread,
    threadsReady,
  ]);

  const newThreadFields = (
    <div className="ask3-new-thread-fields">
      <div className="ask3-field">
        <label htmlFor="ask-thread-title">New thread title</label>{" "}
        <input
          aria-describedby={
            errors.threadTitle ? "ask-thread-title-error" : undefined
          }
          aria-invalid={Boolean(errors.threadTitle)}
          className="ask3-control"
          id="ask-thread-title"
          maxLength={180}
          onChange={(event) => {
            if (!startNewThread) onStartNewThread();
            onUpdateDraft("threadTitle", event.target.value);
          }}
          placeholder="What is this about?"
          value={draft.threadTitle}
        />
        {errors.threadTitle ? (
          <span className="ask3-error" id="ask-thread-title-error" role="alert">
            {errors.threadTitle}
          </span>
        ) : null}
      </div>
      <div className="ask3-field">
        <label htmlFor="ask-thread-context">Opening context, optional</label>{" "}
        <textarea
          aria-describedby={
            errors.threadContext ? "ask-thread-context-error" : undefined
          }
          aria-invalid={Boolean(errors.threadContext)}
          className="ask3-textarea"
          id="ask-thread-context"
          maxLength={4000}
          onChange={(event) => {
            if (!startNewThread) onStartNewThread();
            onUpdateDraft("threadContext", event.target.value);
          }}
          placeholder="Give the thread a starting point"
          rows={2}
          value={draft.threadContext}
        />
        {errors.threadContext ? (
          <span
            className="ask3-error"
            id="ask-thread-context-error"
            role="alert"
          >
            {errors.threadContext}
          </span>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="ask3-narrow" data-testid="ask-destination-step">
      <header className="ask3-head">
        <span className="ask3-eyebrow">Raise an ask</span>
        <h1 className="ask3-title" data-size="38" id="ask-create-title">
          Where should the conversation happen?
        </h1>
        <span className="ask3-sub">
          Every ask belongs to a thread, so the answer stays next to the work.
        </span>
      </header>
      <ColonySteps
        current={1}
        label="Ask steps"
        steps={["Destination", "Ask"]}
      />
      <form
        aria-label="Choose a destination"
        className="ask3-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (canContinue) onContinue();
        }}
      >
        {channelsPending ? (
          <p className="ask3-state-text" role="status">
            Loading conversations…
          </p>
        ) : channelsError ? (
          <div className="ask3-notice" data-tone="bad" role="alert">
            <p>Conversations could not load. Your ask draft is kept.</p>
            <button
              className="ask3-btn"
              data-size="42"
              data-variant="secondary"
              onClick={onRetryChannels}
              type="button"
            >
              Retry conversations
            </button>
          </div>
        ) : (
          <>
            <div className="ask3-field">
              <label htmlFor="ask-channel">Channel</label>{" "}
              <select
                className="ask3-control"
                id="ask-channel"
                onChange={(event) => onChangeChannel(event.target.value)}
                value={selectedChannelId}
              >
                <option value="">Choose channel</option>
                {channels.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    # {candidate.name}
                  </option>
                ))}
              </select>
            </div>
            {selectedChannelId && !selectedChannelExists ? (
              <p className="ask3-error" role="alert">
                This conversation is unavailable to your account.
              </p>
            ) : null}
            {selectedChannelExists && !channelIsMember ? (
              <p className="ask3-error" role="alert">
                You need to be a member of this conversation to raise an ask.
              </p>
            ) : null}
            {channelIsMember && threadsPending ? (
              <p className="ask3-state-text" role="status">
                Loading threads…
              </p>
            ) : null}
            {channelIsMember && threadsError ? (
              <div className="ask3-notice" data-tone="bad" role="alert">
                <p>Threads could not load. Your ask draft is kept.</p>
                <button
                  className="ask3-btn"
                  data-size="42"
                  data-variant="secondary"
                  onClick={onRetryThreads}
                  type="button"
                >
                  Retry threads
                </button>
              </div>
            ) : null}
            {showEmptyThreads ? (
              <div className="ask3-empty" role="status">
                <span aria-hidden="true" className="ask3-empty-icon">
                  <AskDiamondIcon size={24} />
                </span>
                <h3>No threads in this channel yet</h3>
                <p>
                  Start a thread for this discussion. The ask and its responses
                  will live there.
                </p>
                <button
                  className="ask3-btn"
                  data-size="44"
                  onClick={onStartNewThread}
                  type="button"
                >
                  <AskPlusIcon size={15} strokeWidth={2.4} />
                  Start a thread
                </button>
              </div>
            ) : null}
            {threadsReady && !showEmptyThreads ? (
              <fieldset className="ask3-fieldset">
                <legend className="ask3-legend">Thread</legend>
                {threadOptions.map((thread) => {
                  const selected =
                    !startNewThread && selectedThreadRootId === thread.id;
                  return (
                    <label
                      className="ask3-thread"
                      data-selected={selected ? "true" : "false"}
                      data-testid={`ask-thread-option-${thread.id}`}
                      key={thread.id}
                    >
                      <input
                        checked={selected}
                        className="ask3-radio"
                        name="ask-thread"
                        onChange={() => onSelectThread(thread.id)}
                        type="radio"
                      />
                      <span className="ask3-thread-copy">
                        <span className="ask3-thread-title">
                          {thread.label}
                        </span>
                        <span className="ask3-thread-meta">
                          Started by {firstName(thread.startedBy)} ·{" "}
                          {thread.when}
                        </span>
                      </span>
                      <AskAvatar
                        avatarUrl={thread.startedByAvatarUrl}
                        isAgent={thread.startedByIsAgent}
                        label={thread.startedBy}
                        size={thread.startedByIsAgent ? 30 : 28}
                      />
                    </label>
                  );
                })}
                <div
                  className="ask3-new-thread"
                  data-selected={startNewThread ? "true" : "false"}
                >
                  <label className="ask3-new-thread-head">
                    <input
                      checked={startNewThread}
                      className="ask3-radio"
                      name="ask-thread"
                      onChange={onStartNewThread}
                      type="radio"
                    />
                    Start a new thread
                  </label>
                  {newThreadFields}
                </div>
              </fieldset>
            ) : null}
            <div className="ask3-actions">
              {showEmptyThreads ? null : (
                <button
                  className="ask3-btn"
                  disabled={!canContinue}
                  type="submit"
                >
                  Continue to ask
                  <AskArrowRightIcon size={16} strokeWidth={2.4} />
                </button>
              )}
              <button
                className="ask3-btn"
                data-variant="secondary"
                onClick={onCancel}
                type="button"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
