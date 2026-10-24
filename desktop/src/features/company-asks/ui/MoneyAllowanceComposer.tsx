import type { AskComposerDraft, AskComposerErrors } from "../askComposer";
import { AskHireIcon } from "./askIcons";

type RecipientOption = { pubkey: string; label: string; description: string };
type ChannelOption = { id: string; name: string };
type ThreadOption = { id: string; label: string };
type EmployeeOption = {
  pubkey: string;
  label: string;
};
type UpdateAskDraft = <K extends keyof AskComposerDraft>(
  key: K,
  value: AskComposerDraft[K],
) => void;

export type MoneyAllowanceComposerProps = {
  draft: AskComposerDraft;
  errors: AskComposerErrors;
  locked: boolean;
  channelOptions: ChannelOption[];
  channelsPending: boolean;
  channelsError: boolean;
  selectedChannelId: string;
  selectedThreadRootId: string;
  startNewThread: boolean;
  threadOptions: ThreadOption[];
  threadsPending: boolean;
  threadsError: boolean;
  recipientOptions: RecipientOption[];
  recipientLoading: boolean;
  recipientError: boolean;
  employeeOptions: EmployeeOption[];
  employeesLoading: boolean;
  employeesError: boolean;
  /** "USD 50 per week" for the chosen employee, once their record is read. */
  currentAllowanceLabel: string | null;
  channelHasOtherMembers: boolean;
  canInviteToChannel: boolean;
  onUpdateDraft: UpdateAskDraft;
  onChangeChannel: (channelId: string) => void;
  onChangeThread: (threadRootId: string) => void;
  onRetryChannels: () => void;
  onRetryThreads: () => void;
  onRetryEmployees: () => void;
  onRetryRecipients: () => void;
  onInvite: () => void;
};

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <span className="ask3-error" id={id} role="alert">
      {message}
    </span>
  ) : null;
}

function RetryNotice({
  message,
  action,
  onRetry,
}: {
  message: string;
  action: string;
  onRetry: () => void;
}) {
  return (
    <div className="ask3-notice" data-tone="bad" role="alert">
      <p>{message}</p>
      <button
        className="ask3-btn"
        data-size="42"
        data-variant="secondary"
        onClick={onRetry}
        type="button"
      >
        {action}
      </button>
    </div>
  );
}

/** The Allowance change form of the Adjust an allowance board. */
export function MoneyAllowanceComposer({
  draft,
  errors,
  locked,
  channelOptions,
  channelsPending,
  channelsError,
  selectedChannelId,
  selectedThreadRootId,
  startNewThread,
  threadOptions,
  threadsPending,
  threadsError,
  recipientOptions,
  recipientLoading,
  recipientError,
  employeeOptions,
  employeesLoading,
  employeesError,
  currentAllowanceLabel,
  channelHasOtherMembers,
  canInviteToChannel,
  onUpdateDraft,
  onChangeChannel,
  onChangeThread,
  onRetryChannels,
  onRetryThreads,
  onRetryEmployees,
  onRetryRecipients,
  onInvite,
}: MoneyAllowanceComposerProps) {
  return (
    <>
      <h2 className="ask3-heading-2" id="allowance-change">
        Allowance change
      </h2>
      <fieldset className="ask3-money-context">
        <legend>Conversation and recipient</legend>
        <div className="ask3-grid" data-min="190">
          <div className="ask3-field">
            <label htmlFor="ask-channel">Channel</label>
            <select
              className="ask3-control"
              disabled={locked || channelsPending || channelsError}
              id="ask-channel"
              onChange={(event) => onChangeChannel(event.target.value)}
              value={selectedChannelId}
            >
              <option value="">Choose channel</option>
              {channelOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  # {option.name}
                </option>
              ))}
            </select>
          </div>
          <div className="ask3-field">
            <label htmlFor="ask-thread">Thread</label>
            <select
              className="ask3-control"
              disabled={
                locked || !selectedChannelId || threadsPending || threadsError
              }
              id="ask-thread"
              onChange={(event) => onChangeThread(event.target.value)}
              value={startNewThread ? "new" : selectedThreadRootId}
            >
              <option value="">Choose thread</option>
              {threadOptions.map((thread) => (
                <option key={thread.id} value={thread.id}>
                  {thread.label}
                </option>
              ))}
              <option value="new">Start a new thread</option>
            </select>
          </div>
          <div className="ask3-field">
            <label htmlFor="ask-addressee">Recipient</label>
            <select
              className="ask3-control"
              disabled={
                locked ||
                recipientLoading ||
                recipientError ||
                recipientOptions.length === 0
              }
              id="ask-addressee"
              onChange={(event) =>
                onUpdateDraft("addresseePubkey", event.target.value)
              }
              value={draft.addresseePubkey}
            >
              <option value="">Choose recipient</option>
              {recipientOptions.map((option) => (
                <option key={option.pubkey} value={option.pubkey}>
                  {option.label} · {option.description}
                </option>
              ))}
            </select>
            <span className="ask3-hint" data-size="13.5">
              Owners and admins only
            </span>
          </div>
        </div>
        {channelsError ? (
          <RetryNotice
            action="Retry conversations"
            message="Conversations could not load. Your draft is kept."
            onRetry={onRetryChannels}
          />
        ) : channelsPending ? (
          <p className="ask3-state-text" role="status">
            Loading conversations
          </p>
        ) : channelOptions.length === 0 ? (
          <p className="ask3-state-text" role="status">
            No available conversation
          </p>
        ) : null}
        {threadsError && selectedChannelId ? (
          <RetryNotice
            action="Retry threads"
            message="Threads could not load. Your draft is kept."
            onRetry={onRetryThreads}
          />
        ) : null}
        {startNewThread && selectedChannelId ? (
          <div className="ask3-grid" data-min="240">
            <div className="ask3-field">
              <label htmlFor="ask-thread-title">New thread title</label>
              <input
                aria-describedby={
                  errors.threadTitle ? "ask-thread-title-error" : undefined
                }
                aria-invalid={Boolean(errors.threadTitle)}
                className="ask3-control"
                disabled={locked}
                id="ask-thread-title"
                maxLength={180}
                onChange={(event) =>
                  onUpdateDraft("threadTitle", event.target.value)
                }
                placeholder="What is this about?"
                value={draft.threadTitle}
              />
              <FieldError
                id="ask-thread-title-error"
                message={errors.threadTitle}
              />
            </div>
            <div className="ask3-field">
              <label htmlFor="ask-thread-context">
                Opening context, optional
              </label>
              <textarea
                aria-describedby={
                  errors.threadContext ? "ask-thread-context-error" : undefined
                }
                aria-invalid={Boolean(errors.threadContext)}
                className="ask3-textarea"
                disabled={locked}
                id="ask-thread-context"
                maxLength={4000}
                onChange={(event) =>
                  onUpdateDraft("threadContext", event.target.value)
                }
                placeholder="Give the thread a starting point"
                rows={2}
                value={draft.threadContext}
              />
              <FieldError
                id="ask-thread-context-error"
                message={errors.threadContext}
              />
            </div>
          </div>
        ) : null}
        {selectedChannelId && recipientLoading ? (
          <p className="ask3-state-text" role="status">
            Loading eligible recipients
          </p>
        ) : selectedChannelId && recipientError ? (
          <RetryNotice
            action="Retry recipients"
            message="Recipients could not load. Your draft is kept."
            onRetry={onRetryRecipients}
          />
        ) : selectedChannelId && recipientOptions.length === 0 ? (
          channelHasOtherMembers ? (
            <p className="ask3-state-text" role="status">
              No owner or administrator is in this conversation.
            </p>
          ) : (
            <div className="ask3-notice" role="status">
              <strong>You’re the only member here</strong>
              <p>
                An ask needs another eligible recipient. Invite a teammate, then
                return to finish it. Your draft stays here.
              </p>
              {canInviteToChannel ? (
                <button
                  className="ask3-btn"
                  data-size="42"
                  data-variant="secondary"
                  onClick={onInvite}
                  type="button"
                >
                  <AskHireIcon size={16} />
                  Invite someone
                </button>
              ) : null}
              <p data-small="true">
                Send is unavailable. You cannot address this ask to yourself.
              </p>
            </div>
          )
        ) : null}
      </fieldset>

      <div className="ask3-field">
        <label htmlFor="money-employee">Employee or budget</label>
        <select
          aria-describedby={
            errors.moneyEmployeePubkey ? "money-employee-error" : undefined
          }
          aria-invalid={Boolean(errors.moneyEmployeePubkey)}
          className="ask3-control"
          disabled={locked || employeesLoading || employeesError}
          id="money-employee"
          onChange={(event) =>
            onUpdateDraft("moneyEmployeePubkey", event.target.value)
          }
          value={draft.moneyEmployeePubkey}
        >
          <option value="">Choose employee or budget</option>
          {employeeOptions.map((option) => (
            <option key={option.pubkey} value={option.pubkey}>
              {option.label}
            </option>
          ))}
        </select>
        {currentAllowanceLabel ? (
          <span className="ask3-hint">
            Current allowance: {currentAllowanceLabel}
          </span>
        ) : null}
        <FieldError
          id="money-employee-error"
          message={errors.moneyEmployeePubkey}
        />
        {employeesLoading ? (
          <p className="ask3-state-text" role="status">
            Loading employee records
          </p>
        ) : null}
        {employeesError ? (
          <RetryNotice
            action="Retry employee records"
            message="Employee records could not load. Your draft is kept."
            onRetry={onRetryEmployees}
          />
        ) : null}
      </div>

      <fieldset
        aria-describedby={
          errors.moneyDuration ? "money-duration-error" : undefined
        }
        className="ask3-fieldset"
        data-gap="8"
        disabled={locked}
      >
        <legend className="ask3-legend" data-gap="8">
          Change duration
        </legend>
        <div className="ask3-seg">
          {(
            [
              ["permanent", "Permanent"],
              ["temporary", "Temporary, with an end date"],
            ] as const
          ).map(([value, label]) => (
            <label
              data-selected={draft.moneyDuration === value ? "true" : "false"}
              key={value}
            >
              <input
                checked={draft.moneyDuration === value}
                name="money-duration"
                onChange={() => onUpdateDraft("moneyDuration", value)}
                type="radio"
                value={value}
              />
              {label}
            </label>
          ))}
        </div>
        <FieldError id="money-duration-error" message={errors.moneyDuration} />
      </fieldset>

      <div className="ask3-grid">
        <div className="ask3-field">
          <label htmlFor="money-end-date">
            Temporary end date, if applicable
          </label>
          <input
            aria-describedby={
              errors.moneyEndDate ? "money-end-date-error" : undefined
            }
            aria-invalid={Boolean(errors.moneyEndDate)}
            className="ask3-control"
            disabled={locked || draft.moneyDuration === "permanent"}
            id="money-end-date"
            onChange={(event) =>
              onUpdateDraft("moneyEndDate", event.target.value)
            }
            type="date"
            value={draft.moneyEndDate}
          />
          <FieldError id="money-end-date-error" message={errors.moneyEndDate} />
        </div>
        <div className="ask3-field">
          <label htmlFor="money-allowance">Requested amount, USD</label>
          <input
            aria-describedby={
              errors.moneyAllowance ? "money-allowance-error" : undefined
            }
            aria-invalid={Boolean(errors.moneyAllowance)}
            className="ask3-control"
            data-weight="700"
            disabled={locked}
            id="money-allowance"
            inputMode="decimal"
            min="0.01"
            onChange={(event) =>
              onUpdateDraft("moneyAllowance", event.target.value)
            }
            step="0.01"
            type="number"
            value={draft.moneyAllowance}
          />
          <FieldError
            id="money-allowance-error"
            message={errors.moneyAllowance}
          />
        </div>
      </div>

      <div className="ask3-field">
        <label htmlFor="money-reason">Reason</label>
        <textarea
          aria-describedby={
            errors.moneyReason ? "money-reason-error" : undefined
          }
          aria-invalid={Boolean(errors.moneyReason)}
          className="ask3-textarea"
          data-leading="155"
          disabled={locked}
          id="money-reason"
          maxLength={1000}
          onChange={(event) => onUpdateDraft("moneyReason", event.target.value)}
          required
          rows={3}
          value={draft.moneyReason}
        />
        <FieldError id="money-reason-error" message={errors.moneyReason} />
      </div>
    </>
  );
}
