import { CheckIcon } from "@/shared/ui/colonyIcons";
import { cn } from "@/shared/lib/cn";

type ColonyStepsProps = {
  /** Accessible name of the list ("Hiring steps", "Ask steps"). */
  label: string;
  /** Step names in order. */
  steps: readonly string[];
  /**
   * The active step, 1-based. Steps before it are done; passing
   * `steps.length + 1` marks every step done and none active.
   */
  current: number;
  /** Where the row sits in its line (the Ask boards push it to the end). */
  align?: "start" | "center" | "end";
  /** Connector width in design px: 36 on the Hire and Ask boards, 32 on Money. */
  connector?: 32 | 36;
  /** The last step shows a check in the ink circle instead of its number. */
  checkLast?: boolean;
  /** Makes a done step a link back to it. */
  onStepSelect?: (stepNumber: number) => void;
  className?: string;
};

/**
 * The numbered step tracker of the Hire and Ask boards (`HireRoles.dc.html`,
 * `AskNew.dc.html`): a 30px circle per step (ink while active, green with a
 * check when done, outlined while ahead) joined by 2px connectors that turn
 * green behind completed steps.
 */
export function ColonySteps({
  label,
  steps,
  current,
  align = "start",
  connector = 36,
  checkLast = false,
  onStepSelect,
  className,
}: ColonyStepsProps) {
  return (
    <ol
      aria-label={label}
      className={cn("colony-steps", className)}
      data-align={align}
      data-connector={connector}
    >
      {steps.map((step, index) => {
        const number = index + 1;
        const state =
          number < current ? "done" : number === current ? "active" : "ahead";
        const last = number === steps.length;
        const marker =
          state === "done" || (state === "active" && last && checkLast) ? (
            <CheckIcon size={15} strokeWidth={3} />
          ) : (
            number
          );
        const content = (
          <>
            <span aria-hidden="true" className="colony-step-marker">
              {marker}
            </span>
            {step}
          </>
        );
        return (
          <li
            aria-current={state === "active" ? "step" : undefined}
            className="colony-step"
            data-state={state}
            key={step}
          >
            {state === "done" && onStepSelect ? (
              <button
                className="colony-step-link"
                onClick={() => onStepSelect(number)}
                type="button"
              >
                {content}
              </button>
            ) : (
              content
            )}
            {last ? null : (
              <span
                aria-hidden="true"
                className="colony-step-connector"
                data-done={state === "done" ? "true" : undefined}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
