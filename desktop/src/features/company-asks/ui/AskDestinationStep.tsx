import type { AskComposerDraft, AskComposerErrors } from "../askComposer";
import { Diamond } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

type ChannelOption = { id: string; name: string };
type ThreadOption = { id: string; label: string };

export type AskDestinationStepProps = {
  destinationMode: "channel" | "threads" | "new-thread";
  channels: ChannelOption[];
  channelsPending: boolean;
  channelsError: boolean;
  selectedChannelId: string;
  channelIsMember: boolean;
  selectedChannelExists: boolean;
  selectedThreadRootId: string;
  threadOptions: ThreadOption[];
  threadsPending: boolean;
  threadsError: boolean;
  draft: AskComposerDraft;
  errors: AskComposerErrors;
  canChooseThreads: boolean;
  canContinue: boolean;
  onChangeChannel: (channelId: string) => void;
  onChooseThreads: () => void;
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

export function AskDestinationStep({
  destinationMode,
  channels,
  channelsPending,
  channelsError,
  selectedChannelId,
  channelIsMember,
  selectedChannelExists,
  selectedThreadRootId,
  threadOptions,
  threadsPending,
  threadsError,
  draft,
  errors,
  canChooseThreads,
  canContinue,
  onChangeChannel,
  onChooseThreads,
  onStartNewThread,
  onSelectThread,
  onRetryChannels,
  onRetryThreads,
  onContinue,
  onCancel,
  onUpdateDraft,
}: AskDestinationStepProps) {
  const showEmptyThreads =
    channelIsMember &&
    destinationMode === "threads" &&
    !threadsPending &&
    !threadsError &&
    threadOptions.length === 0;

  if (showEmptyThreads) {
    return (
      <div className="colony-ask-context-step">
        <h1 className="sr-only" id="ask-create-title">
          Raise an ask
        </h1>
        <div className="colony-ask-context-empty">
          <span aria-hidden="true" className="colony-ask-context-empty-icon">
            <Diamond />
          </span>
          <h2>No threads in this channel yet</h2>
          <p>
            Start a thread for this discussion. The ask and its responses will
            live there.
          </p>
          <Button onClick={onStartNewThread} type="button">
            Start a thread
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="colony-ask-context-step">
      <h1 id="ask-create-title">Raise an ask</h1>
      <div className="colony-ask-context-panel">
        <h2>Where should the conversation happen?</h2>
        <p>
          <strong>Every ask belongs to a thread</strong>
          <span>
            Choose a channel first, then an existing thread or a new discussion.
          </span>
        </p>
        {channelsPending ? (
          <p role="status">Loading conversations…</p>
        ) : channelsError ? (
          <div role="alert">
            <p>Conversations could not load. Your ask draft is kept.</p>
            <Button onClick={onRetryChannels} type="button" variant="outline">
              Retry conversations
            </Button>
          </div>
        ) : (
          <>
            <div className="colony-ask-context-field">
              <label htmlFor="ask-channel">Channel</label>
              <select
                id="ask-channel"
                onChange={(event) => onChangeChannel(event.target.value)}
                value={selectedChannelId}
              >
                <option value="">Choose channel</option>
                {channels.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </div>
            {selectedChannelId && !selectedChannelExists ? (
              <p role="alert">
                This conversation is unavailable to your account.
              </p>
            ) : null}
            {selectedChannelExists && !channelIsMember ? (
              <p role="alert">
                You need to be a member of this conversation to raise an ask.
              </p>
            ) : null}
            {channelIsMember && destinationMode === "threads" ? (
              <div className="colony-ask-context-field">
                <label htmlFor="ask-thread-select">Thread</label>
                <select
                  disabled={threadsPending || threadsError}
                  id="ask-thread-select"
                  onChange={(event) => onSelectThread(event.target.value)}
                  value={selectedThreadRootId}
                >
                  <option value="">Choose thread</option>
                  {threadOptions.map((thread) => (
                    <option key={thread.id} value={thread.id}>
                      {thread.label}
                    </option>
                  ))}
                </select>
                {threadsPending ? (
                  <p role="status">Loading threads…</p>
                ) : threadsError ? (
                  <div role="alert">
                    <p>Threads could not load. Your ask draft is kept.</p>
                    <Button
                      onClick={onRetryThreads}
                      type="button"
                      variant="outline"
                    >
                      Retry threads
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {channelIsMember && destinationMode === "new-thread" ? (
              <div className="colony-ask-context-field">
                <label htmlFor="ask-thread-title">New thread title</label>
                <Input
                  aria-describedby={
                    errors.threadTitle ? "ask-thread-title-error" : undefined
                  }
                  aria-invalid={Boolean(errors.threadTitle)}
                  id="ask-thread-title"
                  maxLength={180}
                  onChange={(event) =>
                    onUpdateDraft("threadTitle", event.target.value)
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
                <label
                  className="colony-ask-context-field-label--spaced"
                  htmlFor="ask-thread-context"
                >
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
                    onUpdateDraft("threadContext", event.target.value)
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
              </div>
            ) : null}
            <div className="colony-ask-compose-actions">
              {destinationMode === "channel" ? (
                <Button
                  disabled={!canChooseThreads}
                  onClick={onChooseThreads}
                  type="button"
                >
                  Choose a thread
                </Button>
              ) : (
                <Button
                  disabled={!canContinue}
                  onClick={onContinue}
                  type="button"
                >
                  Continue to ask
                </Button>
              )}
              {destinationMode === "threads" && channelIsMember ? (
                <Button
                  onClick={onStartNewThread}
                  type="button"
                  variant="outline"
                >
                  Start a new thread
                </Button>
              ) : null}
              {destinationMode === "channel" ? (
                <Button onClick={onCancel} type="button" variant="outline">
                  Cancel
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
