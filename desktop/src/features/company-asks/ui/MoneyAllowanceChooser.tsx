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
          <span>Proposal</span>
          <strong>Adjust an allowance</strong>
          <span>Propose an allowance change for an employee.</span>
        </button>
      </div>
    </div>
  );
}
