import { ColonySteps } from "@/shared/ui/ColonySteps";

/** Title, subtitle and the Choose, Allowance change, Review tracker. */
export function MoneyRequestHeader({
  current,
  onStepSelect,
}: {
  current: 1 | 2 | 3;
  onStepSelect?: (stepNumber: number) => void;
}) {
  return (
    <header className="ask3-head-row">
      <div className="ask3-head">
        <h1 className="ask3-title" data-size="38-money" id="ask-create-title">
          Request an allowance or cost approval
        </h1>
        <span className="ask3-sub">
          Propose the change in its thread. An owner or administrator decides.
        </span>
      </div>
      <ColonySteps
        align="end"
        connector={32}
        current={current}
        label="Request steps"
        onStepSelect={onStepSelect}
        steps={["Choose", "Allowance change", "Review"]}
      />
    </header>
  );
}
