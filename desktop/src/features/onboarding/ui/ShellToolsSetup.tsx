import { useManagedShellSetup } from "@/features/agents/lib/useManagedShellSetup";
import { FirstRunButton, FirstRunError } from "./firstRunControls";

/**
 * Offers the one-click download of the shell tools the Colony Agent needs on a
 * Windows PC with no Git for Windows. Shows the download's progress, and a
 * plain message with Try again when it fails. Never silent.
 */
export function ShellToolsSetup({
  copy,
  onReady,
}: {
  copy: string;
  onReady: () => void;
}) {
  const setup = useManagedShellSetup(onReady);
  return (
    <div data-testid="onboarding-shell-tools-setup">
      <p className="c3fr-note" role="status">
        {setup.pending ? (setup.line ?? "Setting up shell tools…") : copy}
      </p>
      {setup.error ? <FirstRunError>{setup.error}</FirstRunError> : null}
      <FirstRunButton
        disabled={setup.pending}
        onClick={setup.start}
        size="small"
      >
        {setup.pending
          ? "Setting up…"
          : setup.error
            ? "Try again"
            : "Set up shell tools"}
      </FirstRunButton>
    </div>
  );
}
