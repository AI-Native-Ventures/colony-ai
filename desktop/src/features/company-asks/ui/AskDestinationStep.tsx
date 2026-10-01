import type { AskComposerDraft, AskComposerErrors } from "../askComposer";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

type ChannelOption = { id: string; name: string };
type ThreadOption = { id: string; label: string };

export type AskDestinationStepProps = {
  channels: ChannelOption[];
  channelsPending: boolean;
  channelsError: boolean;
  selectedChannelId: string;
  channelIsMember: boolean;
  selectedChannelExists: boolean;
  startNewThread: boolean;
  selectedThreadRootId: string;
  threadOptions: ThreadOption[];
  threadsPending: boolean;
  threadsError: boolean;
  draft: AskComposerDraft;
  errors: AskComposerErrors;
  canContinue: boolean;
  onChangeChannel: (channelId: string) => void;
  onChooseExistingThread: () => void;
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
  channels,
  channelsPending,
  channelsError,
  selectedChannelId,
  channelIsMember,
  selectedChannelExists,
  startNewThread,
  selectedThreadRootId,
  threadOptions,
  threadsPending,
  threadsError,
  draft,
  errors,
  canContinue,
  onChangeChannel,
  onChooseExistingThread,
  onStartNewThread,
  onSelectThread,
  onRetryChannels,
  onRetryThreads,
  onContinue,
  onCancel,
  onUpdateDraft,
}: AskDestinationStepProps) {
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
            {channelIsMember ? (
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
                      onChange={onChooseExistingThread}
                      type="radio"
                    />
                    Existing thread
                  </label>
                  <label>
                    <input
                      checked={startNewThread}
                      name="ask-thread-mode"
                      onChange={onStartNewThread}
                      type="radio"
                    />
                    Start a new thread
                  </label>
                </fieldset>
                {startNewThread ? (
                  <>
                    <label htmlFor="ask-thread-title">New thread title</label>
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
                  </>
                ) : threadsPending ? (
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
                ) : threadOptions.length === 0 ? (
                  <div className="colony-ask-context-empty">
                    <strong>No threads in this channel yet</strong>
                    <span>
                      Start a thread for this discussion. The ask and its
                      responses will live there.
                    </span>
                    <Button
                      onClick={onStartNewThread}
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
                    {threadOptions.map((thread) => (
                      <label key={thread.id}>
                        <input
                          checked={selectedThreadRootId === thread.id}
                          name="ask-existing-thread"
                          onChange={() => onSelectThread(thread.id)}
                          type="radio"
                        />
                        <span>{thread.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </>
            ) : null}
            {channelIsMember ? (
              <div className="colony-ask-compose-actions">
                <Button
                  disabled={!canContinue}
                  onClick={onContinue}
                  type="button"
                >
                  Continue to ask
                </Button>
                <Button onClick={onCancel} type="button" variant="outline">
                  Cancel
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
