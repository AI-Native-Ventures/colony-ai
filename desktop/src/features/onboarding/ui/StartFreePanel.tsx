import { useInstallOutputLine } from "@/features/agents/lib/useInstallOutputLine";
import { FirstRunError } from "./firstRunControls";
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
};

const INSTALL_FALLBACK =
  "Free AI could not be set up. Check your internet connection and try again.";

/**
 * Start free on the Connect step: idle, installing Colony's own OpenCode,
 * install failed, or ended (OpenCode no longer offers the free model).
 * Presentation only; ConnectSetupStep owns the flow and the Test button.
 */
export function StartFreePanel({
  state,
  hint,
  reason = null,
}: StartFreePanelProps) {
  const installLine = useInstallOutputLine(
    START_FREE_RUNTIME_ID,
    state === "installing",
  );

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
          <strong>Setting up free AI…</strong>
          {installLine ? <span>{installLine}</span> : null}
        </div>
      </div>
    );
  }

  if (state === "install-failed" || state === "ended") {
    return (
      <div data-testid="start-free-problem">
        <FirstRunError>
          {state === "ended"
            ? "OpenCode's free AI has ended. Connect your own AI to continue."
            : (hint ?? INSTALL_FALLBACK)}
        </FirstRunError>
        {state === "install-failed" && reason ? (
          <p className="c3fr-note start-free-reason">{reason}</p>
        ) : null}
      </div>
    );
  }

  return (
    <p className="c3fr-note" data-testid="start-free-fine-print">
      Runs through OpenCode on your computer. Chats aren't stored or used for
      training. Free while OpenCode offers it.
    </p>
  );
}
