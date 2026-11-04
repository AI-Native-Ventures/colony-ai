import { FirstRunError } from "./firstRunControls";

export type StartFreeState = "idle" | "installing" | "install-failed" | "ended";

type StartFreePanelProps = {
  state: StartFreeState;
  /** Gateway or native connection failure guidance. */
  hint: string | null;
  /** Optional diagnostic detail. */
  reason?: string | null;
  /** False when retrying cannot help (unsupported computer). */
  canRetry?: boolean;
};

const FREE_AI_FALLBACK =
  "Colony free AI could not connect. Try again or use your own AI.";

/**
 * Start free on the Connect step: idle, checking Colony's free gateway, or
 * unavailable. The gateway uses the bundled Colony Agent and no subscription.
 * Presentation only; ConnectSetupStep owns the flow and the Test button.
 */
export function StartFreePanel({
  state,
  hint,
  reason = null,
}: StartFreePanelProps) {
  if (state === "installing") {
    return (
      <div
        aria-live="polite"
        className="c3fr-start-free"
        data-testid="start-free-installing"
        role="status"
      >
        <span aria-hidden="true" className="c3fr-spinner" />
        <div className="c3fr-start-free-text">
          <strong>Connecting to Colony free AI…</strong>
        </div>
      </div>
    );
  }

  if (state === "install-failed" || state === "ended") {
    return (
      <div data-testid="start-free-problem">
        <FirstRunError>
          {state === "ended"
            ? "Colony free AI is not configured for this workspace. Use your own AI or try again later."
            : (hint ?? FREE_AI_FALLBACK)}
        </FirstRunError>
        {state === "install-failed" && reason ? (
          <p className="c3fr-note start-free-reason">{reason}</p>
        ) : null}
      </div>
    );
  }

  return (
    <p className="c3fr-note" data-testid="start-free-fine-print">
      Uses Colony's free AI gateway and the bundled Colony Agent. No
      subscription or customer API key is required.
    </p>
  );
}
