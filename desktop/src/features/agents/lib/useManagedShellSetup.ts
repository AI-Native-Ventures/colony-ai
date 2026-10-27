import * as React from "react";

import { useInstallAcpRuntimeMutation } from "@/features/agents/hooks";
import { useInstallOutputLine } from "@/features/agents/lib/useInstallOutputLine";
import { getInstallErrorMessage } from "@/shared/lib/installError";

/** The Colony Agent's runtime id: its shell tools install as that runtime. */
const COLONY_AGENT_RUNTIME_ID = "buzz-agent";

const SETUP_FAILED_COPY =
  "Setting up the shell tools could not finish. Check your internet connection, then try again.";

/**
 * One-click setup of the shell tools the Colony Agent needs on a Windows PC
 * with no Git for Windows. The native host downloads a pinned copy into
 * Colony's own folder; nothing is installed system wide.
 *
 * `onReady` runs after a successful setup so the caller can re-check the
 * prerequisite. A failure keeps its plain message until the next try.
 */
export function useManagedShellSetup(onReady: () => void) {
  const install = useInstallAcpRuntimeMutation();
  const line = useInstallOutputLine(COLONY_AGENT_RUNTIME_ID, install.isPending);
  const [error, setError] = React.useState<string | null>(null);

  const start = React.useCallback(() => {
    setError(null);
    install.mutate(COLONY_AGENT_RUNTIME_ID, {
      onSuccess: (result) => {
        if (result.success) onReady();
        else setError(getInstallErrorMessage(result));
      },
      onError: () => setError(SETUP_FAILED_COPY),
    });
  }, [install.mutate, onReady]);

  return { pending: install.isPending, line, error, start };
}
