import { relaunch } from "@tauri-apps/plugin-process";

import { supportsNativeCapability } from "@/shared/api/nativeBridge";
import { FirstRunButton } from "./firstRunControls";
import { RestartIcon, SignOutIcon } from "./firstRunIcons";
import { StartupProblem } from "./StartupProblem";

export function RecoveryScreen({
  testId,
  title,
  body,
  tone = "accent",
}: {
  testId: string;
  title: string;
  body: string;
  /** Restart screens are violet; a failed sign-out is amber. */
  tone?: "accent" | "need";
}) {
  const canRelaunch = supportsNativeCapability("identity-recovery");

  return (
    <StartupProblem
      actions={
        canRelaunch ? (
          <FirstRunButton
            data-testid="relaunch-app"
            kind="primary"
            onClick={() => {
              void relaunch();
            }}
            size="small"
            type="button"
          >
            Relaunch Colony
          </FirstRunButton>
        ) : null
      }
      body={body}
      icon={
        tone === "need" ? <SignOutIcon size={22} /> : <RestartIcon size={22} />
      }
      testId={testId}
      title={title}
      tone={tone}
    >
      {canRelaunch ? null : (
        <p
          className="c3fr-note"
          data-testid="identity-recovery-unsupported"
          role="status"
        >
          Restoring your sign-in is not available in this version of Colony yet.
          Open Colony on a supported desktop version and try again.
        </p>
      )}
    </StartupProblem>
  );
}
