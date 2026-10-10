import * as React from "react";
import { AntMark } from "@/features/onboarding/ui/OnboardingScenePrimitives";
import { formatCreditMoney, type CreditSnapshot } from "./accountPayments";

export type ColonyCreditsOptionViewProps = {
  state: "loading" | "unconfigured" | "error" | "ready";
  credits?: CreditSnapshot;
  busy?: boolean;
  refreshing?: boolean;
  selected?: boolean;
  canSelect?: boolean;
  error?: string;
  onBuy?: () => void;
  onSelect?: () => void;
  onRefresh?: () => void;
  onPolicy?: (url: string) => void;
};

/** One accessible credits option for onboarding and Settings. No optimistic balance. */
export function ColonyCreditsOptionView({
  state,
  credits,
  busy = false,
  refreshing = false,
  selected = false,
  canSelect = false,
  error,
  onBuy,
  onSelect,
  onRefresh,
  onPolicy,
}: ColonyCreditsOptionViewProps) {
  const headingId = React.useId();
  const ready =
    state === "ready" &&
    credits?.enabled === true &&
    credits.provider === "stripe";
  const funded = ready && credits.balanceUsdCents > 0;
  return (
    <section
      aria-labelledby={headingId}
      className="colony-credits-option"
      aria-busy={busy || refreshing || state === "loading"}
      data-testid={
        state === "unconfigured"
          ? "onboarding-credits-coming-soon"
          : "colony-credits-option"
      }
    >
      <span aria-hidden="true" className="colony-credits-mark">
        <AntMark />
      </span>
      <div className="colony-credits-body min-w-0 flex-1">
        <h3 id={headingId}>Colony credits</h3>
        <p>
          Pay Colony for Colony Agent’s AI use, with no other account needed.
          {state === "unconfigured"
            ? " Not available yet, so connect OpenRouter to start today."
            : ""}
        </p>
        {state === "loading" ? (
          <p role="status">Checking Colony credits</p>
        ) : null}
        {ready ? (
          <>
            <p className="colony-credits-balance" role="status">
              Current balance: {formatCreditMoney(credits.balanceUsdCents)} USD
            </p>
            {selected ? <p>Selected for Colony Agent</p> : null}
            {!funded ? <p>Add credits to connect your Colony Agent.</p> : null}
            {!canSelect && !busy ? (
              <p>
                Check Colony Agent in Settings, Agent runtimes before
                connecting.
              </p>
            ) : null}
            <div className="colony-credits-actions flex flex-wrap gap-2 mt-3">
              <button
                className="primary"
                type="button"
                disabled={busy || refreshing}
                onClick={onBuy}
              >
                Buy credits
              </button>
              <button
                className="secondary"
                type="button"
                disabled={busy || refreshing || !canSelect || !funded}
                onClick={onSelect}
              >
                {busy
                  ? "Testing Colony Agent"
                  : selected
                    ? "Test Colony credits"
                    : "Use Colony credits"}
              </button>
              <button
                className="link"
                type="button"
                disabled={busy || refreshing}
                onClick={onRefresh}
              >
                {refreshing ? "Checking balance" : "Refresh balance"}
              </button>
            </div>
            <p className="colony-credits-consent">
              By buying or using Colony credits you agree to the{" "}
              <a
                href={credits.policyUrls.terms}
                onClick={(event) => {
                  event.preventDefault();
                  onPolicy?.(credits.policyUrls.terms);
                }}
              >
                Terms
              </a>{" "}
              and{" "}
              <a
                href={credits.policyUrls.acceptableUse}
                onClick={(event) => {
                  event.preventDefault();
                  onPolicy?.(credits.policyUrls.acceptableUse);
                }}
              >
                Acceptable Use Policy
              </a>
              . The connection test uses your credit balance.
            </p>
          </>
        ) : null}
        {state === "error" || error ? (
          <div className="mt-2 space-y-2">
            <p role="alert">
              {error ?? "Colony credits could not be checked. Try again."}
            </p>
            {state === "error" ? (
              <button
                className="link"
                type="button"
                disabled={refreshing}
                onClick={onRefresh}
              >
                Retry Colony credits
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {state === "unconfigured" ? (
        <span className="colony-credits-state">Coming soon</span>
      ) : null}
    </section>
  );
}
