import type * as React from "react";

import type {
  AskComposerDraft,
  AskComposerErrors,
  AskComposerType,
} from "../askComposer";
import {
  AskApprovalIcon,
  AskChecklistIcon,
  AskChoiceIcon,
  AskHireIcon,
  AskPersonIcon,
  AskQuestionIcon,
  AskVerdictIcon,
} from "./askIcons";

type AskStandardRecipientOption = {
  pubkey: string;
  label: string;
  description: string;
};
type UpdateAskDraft = <K extends keyof AskComposerDraft>(
  key: K,
  value: AskComposerDraft[K],
) => void;

const ASK_TYPES: Array<{
  value: AskComposerType;
  label: string;
  description: string;
  Icon: React.ComponentType<{ size?: number }>;
}> = [
  {
    value: "approval",
    label: "Approval",
    description: "Approve, revise or reject",
    Icon: AskApprovalIcon,
  },
  {
    value: "question",
    label: "Question",
    description: "Ask for an answer",
    Icon: AskQuestionIcon,
  },
  {
    value: "choice",
    label: "Choice",
    description: "Pick one direction",
    Icon: AskChoiceIcon,
  },
  {
    value: "checklist",
    label: "Checklist",
    description: "Confirm each item",
    Icon: AskChecklistIcon,
  },
  {
    value: "verdict",
    label: "Verdict",
    description: "Pass or fail",
    Icon: AskVerdictIcon,
  },
  {
    value: "hire_proposal",
    label: "Hire proposal",
    description: "Propose a new employee",
    Icon: AskHireIcon,
  },
];

type AskStandardComposerProps = {
  draft: AskComposerDraft;
  errors: AskComposerErrors;
  recipientOptions: AskStandardRecipientOption[];
  recipientLoading: boolean;
  recipientError: boolean;
  /** The channel's members could be read, so an empty list is a real answer. */
  recipientOptionsReady: boolean;
  channelPeople: number;
  locked: boolean;
  canInvite: boolean;
  onInvite: () => void;
  onRetryRecipients: () => void;
  onChooseType: (type: AskComposerType) => void;
  onUpdateDraft: UpdateAskDraft;
};

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <span className="ask3-error" id={id} role="alert">
      {message}
    </span>
  ) : null;
}

export function AskStandardComposer({
  draft,
  errors,
  recipientOptions,
  recipientLoading,
  recipientError,
  recipientOptionsReady,
  channelPeople,
  locked,
  canInvite,
  onInvite,
  onRetryRecipients,
  onChooseType,
  onUpdateDraft,
}: AskStandardComposerProps) {
  const alone =
    !recipientLoading &&
    !recipientError &&
    (!recipientOptionsReady || channelPeople === 0);

  const titleField = (
    <div className="ask3-field">
      <label htmlFor="ask-title">What needs a response?</label>{" "}
      <input
        aria-describedby={errors.title ? "ask-title-error" : undefined}
        aria-invalid={Boolean(errors.title)}
        className="ask3-control"
        disabled={locked}
        id="ask-title"
        maxLength={180}
        onChange={(event) => onUpdateDraft("title", event.target.value)}
        placeholder="Approve the October campaign"
        value={draft.title}
      />
      <FieldError id="ask-title-error" message={errors.title} />
    </div>
  );

  if (alone) {
    return (
      <>
        {titleField}
        <div className="ask3-notice" role="status">
          <span className="ask3-notice-head">
            <span aria-hidden="true">
              <AskPersonIcon size={17} strokeWidth={2.4} />
            </span>
            <strong>You’re the only member here</strong>
          </span>
          <p>
            An ask needs another recipient. Invite a teammate, then return to
            finish it. Your draft stays here.
          </p>
          {canInvite ? (
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
      </>
    );
  }

  return (
    <>
      <fieldset aria-label="Ask type" className="ask3-fieldset">
        <legend className="ask3-legend">What kind of response?</legend>
        <div className="ask3-types">
          {ASK_TYPES.map(({ value, label, description, Icon }) => (
            <button
              aria-pressed={draft.type === value}
              className="ask3-type"
              disabled={locked}
              key={value}
              onClick={() => onChooseType(value)}
              type="button"
            >
              <Icon size={19} />
              <span className="ask3-type-name">{label}</span>
              <span className="ask3-type-desc">{description}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {recipientLoading ? (
        <p className="ask3-state-text" role="status">
          Loading teammates…
        </p>
      ) : null}
      {recipientError ? (
        <div className="ask3-notice" data-tone="bad" role="alert">
          <p>Teammates could not load. Your draft is kept.</p>
          <button
            className="ask3-btn"
            data-size="42"
            data-variant="secondary"
            onClick={onRetryRecipients}
            type="button"
          >
            Retry teammates
          </button>
        </div>
      ) : null}

      {titleField}

      <div className="ask3-field">
        <label htmlFor="ask-body">
          {draft.type === "verdict" ? "Acceptance criteria" : "Context"}
        </label>{" "}
        <textarea
          aria-describedby={errors.body ? "ask-body-error" : undefined}
          aria-invalid={Boolean(errors.body)}
          className="ask3-textarea"
          data-leading="155"
          disabled={locked}
          id="ask-body"
          maxLength={4000}
          onChange={(event) => onUpdateDraft("body", event.target.value)}
          placeholder="Add the context someone needs to respond."
          rows={3}
          value={draft.body}
        />
        <FieldError id="ask-body-error" message={errors.body} />
      </div>

      {draft.type === "choice" ? (
        <div className="ask3-field">
          <label htmlFor="ask-options">Choices, one per line</label>{" "}
          <textarea
            aria-describedby={errors.options ? "ask-options-error" : undefined}
            aria-invalid={Boolean(errors.options)}
            className="ask3-textarea"
            data-leading="155"
            disabled={locked}
            id="ask-options"
            onChange={(event) => onUpdateDraft("options", event.target.value)}
            placeholder={"Warm editorial\nBold studio"}
            rows={3}
            value={draft.options}
          />
          <FieldError id="ask-options-error" message={errors.options} />
        </div>
      ) : null}

      {draft.type === "checklist" ? (
        <div className="ask3-field">
          <label htmlFor="ask-items">Items to confirm, one per line</label>{" "}
          <textarea
            aria-describedby={errors.items ? "ask-items-error" : undefined}
            aria-invalid={Boolean(errors.items)}
            className="ask3-textarea"
            data-leading="155"
            disabled={locked}
            id="ask-items"
            onChange={(event) => onUpdateDraft("items", event.target.value)}
            placeholder={"Client spelling checked\nDates agreed"}
            rows={3}
            value={draft.items}
          />
          <FieldError id="ask-items-error" message={errors.items} />
        </div>
      ) : null}

      <div className="ask3-grid">
        <div className="ask3-field">
          <label htmlFor="ask-addressee">Response from</label>{" "}
          <select
            aria-describedby={
              errors.addresseePubkey ? "ask-addressee-error" : undefined
            }
            aria-invalid={Boolean(errors.addresseePubkey)}
            className="ask3-control"
            disabled={
              locked ||
              recipientLoading ||
              recipientError ||
              channelPeople === 0
            }
            id="ask-addressee"
            onChange={(event) =>
              onUpdateDraft("addresseePubkey", event.target.value)
            }
            value={draft.addresseePubkey}
          >
            <option value="">Choose a person or AI employee</option>
            {recipientOptions.map((member) => (
              <option key={member.pubkey} value={member.pubkey}>
                {member.label} · {member.description}
              </option>
            ))}
          </select>
          <FieldError
            id="ask-addressee-error"
            message={errors.addresseePubkey}
          />
        </div>
        <div className="ask3-field">
          <label htmlFor="ask-decide-by">Decide by</label>{" "}
          <input
            aria-describedby={
              errors.decideBy ? "ask-decide-by-error" : undefined
            }
            aria-invalid={Boolean(errors.decideBy)}
            className="ask3-control"
            disabled={locked}
            id="ask-decide-by"
            onChange={(event) => onUpdateDraft("decideBy", event.target.value)}
            type="datetime-local"
            value={draft.decideBy}
          />
          <FieldError id="ask-decide-by-error" message={errors.decideBy} />
        </div>
      </div>
    </>
  );
}
