import { ArrowUpRight } from "lucide-react";

export function MoneyAllowanceChooser({ onSelect }: { onSelect: () => void }) {
  return (
    <div className="colony-ask-money-choose">
      <h1 id="ask-create-title">Request an allowance or cost approval</h1>
      <div className="colony-ask-money-choice-grid">
        <button
          className="colony-ask-money-choice"
          onClick={onSelect}
          type="button"
        >
          <span aria-hidden="true" className="colony-ask-money-choice-icon">
            A
          </span>
          <span className="colony-ask-money-choice-copy">
            <strong>Adjust an allowance</strong>
            <span>Propose a salary or budget change</span>
          </span>
          <span className="colony-ask-money-choice-badge">Proposal</span>
          <ArrowUpRight aria-hidden="true" size={16} />
        </button>
      </div>
    </div>
  );
}
