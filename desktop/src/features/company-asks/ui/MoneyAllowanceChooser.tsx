import { AskArrowUpRightIcon } from "./askIcons";

/** The "Adjust an allowance" card: the one money request the app offers. */
export function MoneyAllowanceChooser({
  selected,
  onSelect,
  disabled = false,
}: {
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      aria-pressed={selected}
      className="ask3-choice"
      disabled={disabled}
      onClick={onSelect}
      type="button"
    >
      <span aria-hidden="true" className="ask3-choice-mark">
        A
      </span>
      <span className="ask3-choice-copy">
        <strong>Adjust an allowance</strong>
        <span>Propose a salary or budget change</span>
      </span>
      <span className="ask3-choice-badge">Proposal</span>
      <AskArrowUpRightIcon size={18} strokeWidth={2.4} />
    </button>
  );
}
