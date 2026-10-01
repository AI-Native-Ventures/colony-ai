import { Input } from "@/shared/ui/input";

import type { AskComposerDraft, AskComposerErrors } from "../askComposer";

type AskStandardRecipientOption = {
  pubkey: string;
  label: string;
  description: string;
};
type UpdateAskDraft = <K extends keyof AskComposerDraft>(
  key: K,
  value: AskComposerDraft[K],
) => void;
type AskStandardComposerProps = {
  draft: AskComposerDraft;
  errors: AskComposerErrors;
  recipientOptions: AskStandardRecipientOption[];
  recipientLoading: boolean;
  recipientError: boolean;
  channelPeople: number;
  locked: boolean;
  onUpdateDraft: UpdateAskDraft;
};

export function AskStandardComposer({
  draft,
  errors,
  recipientOptions,
  recipientLoading,
  recipientError,
  channelPeople,
  locked,
  onUpdateDraft,
}: AskStandardComposerProps) {
  return (
    <>
      <label htmlFor="ask-title">What needs a response?</label>
      <Input
        aria-describedby={errors.title ? "ask-title-error" : undefined}
        aria-invalid={Boolean(errors.title)}
        disabled={locked}
        id="ask-title"
        maxLength={180}
        onChange={(event) => onUpdateDraft("title", event.target.value)}
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
        {draft.type === "verdict" ? "Acceptance criteria" : "Context"}
      </label>
      <textarea
        aria-describedby={errors.body ? "ask-body-error" : undefined}
        aria-invalid={Boolean(errors.body)}
        disabled={locked}
        id="ask-body"
        maxLength={4000}
        onChange={(event) => onUpdateDraft("body", event.target.value)}
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
            aria-describedby={errors.options ? "ask-options-error" : undefined}
            aria-invalid={Boolean(errors.options)}
            disabled={locked}
            id="ask-options"
            onChange={(event) => onUpdateDraft("options", event.target.value)}
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
          <label htmlFor="ask-items">Items to confirm, one per line</label>
          <textarea
            aria-describedby={errors.items ? "ask-items-error" : undefined}
            aria-invalid={Boolean(errors.items)}
            disabled={locked}
            id="ask-items"
            onChange={(event) => onUpdateDraft("items", event.target.value)}
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
          locked || recipientLoading || recipientError || channelPeople === 0
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
        aria-describedby={errors.decideBy ? "ask-decide-by-error" : undefined}
        aria-invalid={Boolean(errors.decideBy)}
        disabled={locked}
        id="ask-decide-by"
        onChange={(event) => onUpdateDraft("decideBy", event.target.value)}
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
  );
}
