import { AskShieldIcon } from "./askIcons";

export type MoneyReviewSummary = {
  recipient: string;
  employee: string;
  duration: string;
  amount: string;
  conversation: string;
};

/**
 * "Review money request": what will be sent, the authority note and, once the
 * form has been reviewed, the Submit request and Edit request buttons.
 */
export function MoneyReviewPanel({
  summary,
  reviewing,
  busy,
  canSubmit,
  submitLabel,
  onSubmit,
  onEdit,
}: {
  summary: MoneyReviewSummary;
  reviewing: boolean;
  busy: boolean;
  canSubmit: boolean;
  submitLabel: string;
  onSubmit: () => void;
  onEdit: () => void;
}) {
  const rows: Array<[string, string]> = [
    ["Recipient", summary.recipient],
    ["Employee or budget", summary.employee],
    ["Duration", summary.duration],
    ["Requested amount", summary.amount],
    ["Conversation", summary.conversation],
  ];
  return (
    <section aria-labelledby="review-money" className="ask3-review-panel">
      <h2 className="ask3-aside-title" id="review-money">
        Review money request
      </h2>
      <dl className="ask3-rows">
        {rows.map(([label, value]) => (
          <div className="ask3-row" key={label}>
            <dt>{label}</dt>
            <dd>{value || "Not chosen yet"}</dd>
          </div>
        ))}
      </dl>
      <div className="ask3-notice" data-tone="info">
        <AskShieldIcon size={18} />
        <span className="ask3-notice-copy">
          <strong>Authority is checked on response</strong>
          <p>
            Submitting does not charge a card, reimburse a cost or change an
            allowance.
          </p>
        </span>
      </div>
      {reviewing ? (
        <div className="ask3-review-actions">
          <button
            className="ask3-btn"
            data-size="44"
            disabled={!canSubmit}
            onClick={onSubmit}
            type="button"
          >
            {submitLabel}
          </button>
          <button
            className="ask3-btn"
            data-size="44"
            data-variant="secondary"
            disabled={busy}
            onClick={onEdit}
            type="button"
          >
            Edit request
          </button>
        </div>
      ) : null}
    </section>
  );
}
