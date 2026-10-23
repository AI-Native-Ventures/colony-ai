import { AskApprovalIcon } from "./askIcons";

type AskCreateSuccessProps = {
  title: string;
  description?: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
};

/** The green confirmation card ("Money request submitted") of the boards. */
export function AskCreateSuccess({
  title,
  description,
  message,
  actionLabel,
  onAction,
}: AskCreateSuccessProps) {
  return (
    <div className="ask3-success" role="status">
      <span aria-hidden="true" className="ask3-success-mark">
        <AskApprovalIcon size={16} strokeWidth={3} />
      </span>
      <span className="ask3-success-copy">
        <h1 id="ask-create-title">{title}</h1>
        {description ? <p>{description}</p> : null}
        <p>{message}</p>
        <button onClick={onAction} type="button">
          {actionLabel}
        </button>
      </span>
    </div>
  );
}
