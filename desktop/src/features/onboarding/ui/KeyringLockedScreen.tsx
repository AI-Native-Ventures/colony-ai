import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { relaunch } from "@tauri-apps/plugin-process";
import { importIdentity } from "@/shared/api/tauriIdentity";
import { supportsNativeCapability } from "@/shared/api/nativeBridge";
import { FirstRunButton } from "./firstRunControls";
import { LockIcon } from "./firstRunIcons";
import { StartupProblem } from "./StartupProblem";
import { NostrKeyImportForm } from "./NostrKeyImportForm";

export function KeyringLockedScreen() {
  const queryClient = useQueryClient();
  const [showImport, setShowImport] = React.useState(false);
  const canRelaunch = supportsNativeCapability("identity-recovery");
  const canImport = supportsNativeCapability("identity-import");

  const handleReimportClick = React.useCallback(() => {
    if (!canImport) return;
    const confirmed = window.confirm(
      "Using a different recovery key replaces the sign-in locked on this device. The previous sign-in will no longer be accessible. Continue?",
    );
    if (confirmed) {
      setShowImport(true);
    }
  }, [canImport]);

  const handleImport = React.useCallback(
    async (nsec: string, password?: string) => {
      if (!canImport) return;
      const identity = await importIdentity(nsec, password);
      // Update the identity query cache so useIdentityQuery observers see
      // locked: false. The bootedLocked latch in hooks.ts will then route
      // to RelaunchRequiredScreen via bootedLocked && !identityLocked.
      queryClient.setQueryData(["identity"], identity);
    },
    [canImport, queryClient],
  );

  return (
    <StartupProblem
      actions={
        showImport && canImport ? null : (
          <>
            {canRelaunch ? (
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
            ) : null}
            {canImport ? (
              <FirstRunButton
                onClick={handleReimportClick}
                size="small"
                type="button"
              >
                Use a recovery key instead
              </FirstRunButton>
            ) : null}
          </>
        )
      }
      body="Your account is safe on this device, but Colony can’t open it right now. Unlock your device or sign into your desktop account, then restart Colony."
      icon={<LockIcon size={22} />}
      testId="keyring-locked"
      title="Your sign-in is locked"
      tone="muted"
    >
      {!canRelaunch && !canImport ? (
        <p
          className="c3fr-note"
          data-testid="identity-recovery-unsupported"
          role="status"
        >
          This version of Colony can’t restore your sign-in yet. Open Colony on
          a supported desktop version, then try again.
        </p>
      ) : showImport && canImport ? (
        <NostrKeyImportForm
          backLabel="Cancel"
          onBack={() => setShowImport(false)}
          onImport={handleImport}
        />
      ) : null}
    </StartupProblem>
  );
}
