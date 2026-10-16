import { useInstallOutputLine } from "@/features/agents/lib/useInstallOutputLine";
import { START_FREE_RUNTIME_ID } from "./startFree";

export type StartFreeState = "idle" | "installing" | "install-failed" | "ended";

type StartFreePanelProps = {
  state: StartFreeState;
  /** Install failure guidance from the native install step, when it has one. */
  hint: string | null;
  /** What went wrong, from the native install step. */
  reason?: string | null;
  /** False when retrying cannot help (unsupported computer). */
  canRetry?: boolean;
  disabled?: boolean;
  onStart: () => void;
  onUseOwn: () => void;
  onSkip: () => void;
};

const INSTALL_FALLBACK =
  "Free AI could not be set up. Check your internet connection and try again.";

/**
 * Start free on the Connect step: idle, installing Colony's own OpenCode,
 * install failed, or ended (OpenCode no longer offers the free model).
 * Presentation only; ConnectSetupStep owns the flow.
 */
export function StartFreePanel({
  state,
  hint,
  reason = null,
  canRetry = true,
  disabled = false,
  onStart,
  onUseOwn,
  onSkip,
}: StartFreePanelProps) {
  const installLine = useInstallOutputLine(
    START_FREE_RUNTIME_ID,
    state === "installing",
  );

  if (state === "installing") {
    return (
      <div
        aria-live="polite"
        className="start-free-panel start-free-installing"
        data-testid="start-free-installing"
        role="status"
      >
        <span aria-hidden="true" className="spinner" />
        <div className="start-free-progress">
          <h3>Setting up free AI...</h3>
          {installLine ? <p>{installLine}</p> : null}
        </div>
      </div>
    );
  }

  if (state === "install-failed" || state === "ended") {
    return (
      <div className="start-free-panel" data-testid="start-free-problem">
        <div className="power-notice is-error start-free-notice" role="alert">
          <p>
            {state === "ended"
              ? "OpenCode's free AI has ended. Connect your own AI to continue."
              : (hint ?? INSTALL_FALLBACK)}
          </p>
          {state === "install-failed" && reason ? (
            <p className="start-free-reason">{reason}</p>
          ) : null}
        </div>
        <div className="power-cta start-free-actions">
          {state === "install-failed" && canRetry ? (
            <button
              className="primary full"
              data-testid="start-free-retry"
              disabled={disabled}
              onClick={onStart}
              type="button"
            >
              Try again
            </button>
          ) : null}
          <button
            className={
              state === "ended" || !canRetry
                ? "primary full"
                : "back start-free-secondary"
            }
            data-testid="start-free-use-own"
            onClick={onUseOwn}
            type="button"
          >
            Use your own AI
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="start-free-panel">
      <p className="start-free-fine-print">
        Runs through OpenCode on your computer. Chats aren't stored or used for
        training. Free while OpenCode offers it.
      </p>
      <div className="power-cta start-free-actions">
        <button
          className="primary full"
          data-testid="start-free-continue"
          disabled={disabled}
          onClick={onStart}
          type="button"
        >
          Start free <span aria-hidden="true">→</span>
        </button>
        <button
          className="back start-free-secondary"
          data-testid="start-free-skip"
          onClick={onSkip}
          type="button"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
