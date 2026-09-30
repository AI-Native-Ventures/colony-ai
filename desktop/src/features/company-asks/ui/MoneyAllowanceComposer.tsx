import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";

import type { AskComposerDraft, AskComposerErrors } from "../askComposer";

type RecipientOption = { pubkey: string; label: string; description: string };
type ChannelOption = { id: string; name: string };
type ThreadOption = { id: string; label: string };
type EmployeeOption = {
  pubkey: string;
  label: string;
  allowance?: { amountCents: string; period: string };
};
type UpdateAskDraft = <K extends keyof AskComposerDraft>(
  key: K,
  value: AskComposerDraft[K],
) => void;

export type MoneyAllowanceComposerProps = {
  draft: AskComposerDraft;
  errors: AskComposerErrors;
  locked: boolean;
  review: boolean;
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

export function MoneyAllowanceComposer({
  draft,
  errors,
  locked,
  review,
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
  const employee = employeeOptions.find(
    (option) => option.pubkey === draft.moneyEmployeePubkey,
  );
  const channelName = channelOptions.find(
    (option) => option.id === selectedChannelId,
  )?.name;
  const threadName = startNewThread
    ? draft.threadTitle.trim()
    : threadOptions.find((thread) => thread.id === selectedThreadRootId)?.label;
  const recipientName = recipientOptions.find(
    (option) => option.pubkey === draft.addresseePubkey,
  )?.label;
  if (review) {
    return (
      <section
        aria-label="Review money request"
        className="colony-ask-money-review"
      >
        <h2>Review money request</h2>
        <dl>
          <div>
            <dt>Type</dt>
            <dd>Allowance</dd>
          </div>
          <div>
            <dt>Employee</dt>
            <dd>{employee?.label ?? ""}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>
              {draft.moneyDuration === "temporary" ? "Temporary" : "Permanent"}
            </dd>
          </div>
          {draft.moneyDuration === "temporary" ? (
            <div>
              <dt>End date</dt>
              <dd>{draft.moneyEndDate}</dd>
            </div>
          ) : null}
          <div>
            <dt>Requested amount, USD</dt>
            <dd>{draft.moneyAllowance}</dd>
          </div>
          <div>
            <dt>Allowance period</dt>
            <dd>{draft.moneyAllowancePeriod}</dd>
          </div>
          <div>
            <dt>Reason</dt>
            <dd>{draft.moneyReason}</dd>
          </div>
          <div>
            <dt>Channel</dt>
            <dd>{channelName ? `#${channelName}` : ""}</dd>
          </div>
          <div>
            <dt>Thread</dt>
            <dd>{threadName ?? ""}</dd>
          </div>
          <div>
            <dt>Recipient</dt>
            <dd>{recipientName ?? ""}</dd>
          </div>
        </dl>
        <aside>
          <strong>Authority is checked on response</strong>
          <p>
            Submitting does not change an allowance or spending limit. An
            authorized human must approve the request.
          </p>
        </aside>
      </section>
    );
  }

  return (
    <>
      <h2>Allowance change</h2>
      <fieldset className="colony-ask-money-context">
        <legend>Conversation and recipient</legend>
        <div className="colony-ask-money-context-grid">
          <div>
            <label htmlFor="ask-channel">Channel</label>
            <select
              disabled={locked || channelsPending || channelsError}
              id="ask-channel"
              onChange={(event) => onChangeChannel(event.target.value)}
              value={selectedChannelId}
            >
              <option value="">Choose channel</option>
              {channelOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ask-thread">Thread</label>
            <select
              disabled={
                locked || !selectedChannelId || threadsPending || threadsError
              }
              id="ask-thread"
              onChange={(event) => onChangeThread(event.target.value)}
              value={startNewThread ? "new" : selectedThreadRootId}
            >
              <option value="">Choose thread</option>
              <option value="new">Start a new thread</option>
              {threadOptions.map((thread) => (
                <option key={thread.id} value={thread.id}>
                  {thread.label}
                </option>
              ))}
            </select>
          </div>
          <div className="colony-ask-money-recipient">
            <label htmlFor="ask-addressee">Recipient</label>
            <select
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
          </div>
        </div>
        {channelsError ? (
          <div role="alert">
            <p>Conversations could not load. Your draft is kept.</p>
            <Button onClick={onRetryChannels} type="button" variant="outline">
              Retry conversations
            </Button>
          </div>
        ) : channelsPending ? (
          <p role="status">Loading conversations</p>
        ) : channelOptions.length === 0 ? (
          <p role="status">No available conversation</p>
        ) : null}
        {threadsError && selectedChannelId ? (
          <div role="alert">
            <p>Threads could not load. Your draft is kept.</p>
            <Button onClick={onRetryThreads} type="button" variant="outline">
              Retry threads
            </Button>
          </div>
        ) : null}
        {startNewThread && selectedChannelId ? (
          <div className="colony-ask-money-new-thread">
            <label htmlFor="ask-thread-title">New thread title</label>
            <Input
              aria-describedby={
                errors.threadTitle ? "ask-thread-title-error" : undefined
              }
              aria-invalid={Boolean(errors.threadTitle)}
              disabled={locked}
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
                errors.threadContext ? "ask-thread-context-error" : undefined
              }
              aria-invalid={Boolean(errors.threadContext)}
              disabled={locked}
              id="ask-thread-context"
              maxLength={4000}
              onChange={(event) =>
                onUpdateDraft("threadContext", event.target.value)
              }
              rows={3}
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
        {selectedChannelId && recipientLoading ? (
          <p role="status">Loading eligible recipients</p>
        ) : selectedChannelId && recipientError ? (
          <div role="alert">
            <p>Recipients could not load. Your draft is kept.</p>
            <Button onClick={onRetryRecipients} type="button" variant="outline">
              Retry recipients
            </Button>
          </div>
        ) : selectedChannelId && recipientOptions.length === 0 ? (
          <div className="colony-ask-money-recipient-state" role="status">
            {channelHasOtherMembers ? (
              <p>No owner or administrator is in this conversation.</p>
            ) : (
              <>
                <strong>You’re the only member here</strong>
                <p>
                  An ask needs another eligible recipient. Invite a teammate,
                  then return to finish it. Your draft stays here.
                </p>
                {canInviteToChannel ? (
                  <Button onClick={onInvite} type="button" variant="outline">
                    Invite someone
                  </Button>
                ) : null}
                <p>
                  Send is unavailable. You cannot address this ask to yourself.
                </p>
              </>
            )}
          </div>
        ) : null}
      </fieldset>

      <label htmlFor="money-employee">Employee</label>
      <select
        aria-describedby={
          errors.moneyEmployeePubkey ? "money-employee-error" : undefined
        }
        aria-invalid={Boolean(errors.moneyEmployeePubkey)}
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
      {errors.moneyEmployeePubkey ? (
        <span
          className="colony-ask-compose-error"
          id="money-employee-error"
          role="alert"
        >
          {errors.moneyEmployeePubkey}
        </span>
      ) : null}
      {employeesLoading ? <p role="status">Loading employee records</p> : null}
      {employeesError ? (
        <div role="alert">
          <p>Employee records could not load. Your draft is kept.</p>
          <Button onClick={onRetryEmployees} type="button" variant="outline">
            Retry employee records
          </Button>
        </div>
      ) : null}

      <label htmlFor="money-duration">Change duration</label>
      <select
        aria-describedby={
          errors.moneyDuration ? "money-duration-error" : undefined
        }
        aria-invalid={Boolean(errors.moneyDuration)}
        disabled={locked}
        id="money-duration"
        onChange={(event) =>
          onUpdateDraft(
            "moneyDuration",
            event.target.value as AskComposerDraft["moneyDuration"],
          )
        }
        value={draft.moneyDuration}
      >
        <option value="">Choose change duration</option>
        <option value="permanent">Permanent</option>
        <option value="temporary">Temporary</option>
      </select>
      {errors.moneyDuration ? (
        <span
          className="colony-ask-compose-error"
          id="money-duration-error"
          role="alert"
        >
          {errors.moneyDuration}
        </span>
      ) : null}

      <label htmlFor="money-end-date">Temporary end date, if applicable</label>
      <Input
        aria-describedby={
          errors.moneyEndDate ? "money-end-date-error" : undefined
        }
        aria-invalid={Boolean(errors.moneyEndDate)}
        disabled={locked || draft.moneyDuration === "permanent"}
        id="money-end-date"
        onChange={(event) => onUpdateDraft("moneyEndDate", event.target.value)}
        type="date"
        value={draft.moneyEndDate}
      />
      {errors.moneyEndDate ? (
        <span
          className="colony-ask-compose-error"
          id="money-end-date-error"
          role="alert"
        >
          {errors.moneyEndDate}
        </span>
      ) : null}

      <label htmlFor="money-allowance">Requested amount, USD</label>
      <Input
        aria-describedby={
          errors.moneyAllowance ? "money-allowance-error" : undefined
        }
        aria-invalid={Boolean(errors.moneyAllowance)}
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
      {errors.moneyAllowance ? (
        <span
          className="colony-ask-compose-error"
          id="money-allowance-error"
          role="alert"
        >
          {errors.moneyAllowance}
        </span>
      ) : null}

      <label htmlFor="money-allowance-period">Allowance period</label>
      <select
        aria-describedby={
          errors.moneyAllowancePeriod ? "money-period-error" : undefined
        }
        aria-invalid={Boolean(errors.moneyAllowancePeriod)}
        disabled={locked}
        id="money-allowance-period"
        onChange={(event) =>
          onUpdateDraft(
            "moneyAllowancePeriod",
            event.target.value as AskComposerDraft["moneyAllowancePeriod"],
          )
        }
        value={draft.moneyAllowancePeriod}
      >
        <option value="">Choose allowance period</option>
        <option value="day">Day</option>
        <option value="week">Week</option>
        <option value="month">Month</option>
      </select>
      {errors.moneyAllowancePeriod ? (
        <span
          className="colony-ask-compose-error"
          id="money-period-error"
          role="alert"
        >
          {errors.moneyAllowancePeriod}
        </span>
      ) : null}

      <label htmlFor="money-reason">Reason</label>
      <textarea
        aria-describedby={errors.moneyReason ? "money-reason-error" : undefined}
        aria-invalid={Boolean(errors.moneyReason)}
        disabled={locked}
        id="money-reason"
        maxLength={1000}
        onChange={(event) => onUpdateDraft("moneyReason", event.target.value)}
        required
        rows={3}
        value={draft.moneyReason}
      />
      {errors.moneyReason ? (
        <span
          className="colony-ask-compose-error"
          id="money-reason-error"
          role="alert"
        >
          {errors.moneyReason}
        </span>
      ) : null}
    </>
  );
}
