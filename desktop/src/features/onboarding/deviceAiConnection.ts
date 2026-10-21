import * as React from "react";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";

import { refreshAcpRuntimes } from "@/features/agents/acpRuntimesQuery";
import { globalAgentConfigQueryKey } from "@/features/agents/useGlobalAgentConfig";
import { agentDefaultsConnection } from "@/features/settings/lib/agentDefaultsConnection";
import { getGlobalAgentConfig } from "@/shared/api/tauriGlobalAgentConfig";
import type {
  AcpRuntimeCatalogEntry,
  GlobalAgentConfig,
} from "@/shared/api/types";

/**
 * Settings > Agents "Your connection" kinds that name a saved route this
 * device can run: a signed-in subscription, a tested OpenRouter link, a saved
 * provider and key (Start free included), or Colony credits. "unknown" (not
 * configured, needs sign-in, not confirmed) and "unavailable" do not.
 */
const WORKING_CONNECTION_KINDS = new Set([
  "subscription",
  "openrouter",
  "key",
  "credits",
]);

/** Longest wait after a business is picked before Connect is shown anyway. */
export const DEVICE_AI_CONNECTION_WAIT_MS = 10_000;

/** True when the "Your connection" card would describe a working route. */
export function hasWorkingAiConnection(
  config: GlobalAgentConfig,
  runtimes: readonly AcpRuntimeCatalogEntry[],
) {
  if (!config.preferred_runtime) return false;
  return WORKING_CONNECTION_KINDS.has(
    agentDefaultsConnection(config, runtimes).kind,
  );
}

/**
 * Read this device's saved route and a forced runtime catalog, the same inputs
 * the "Your connection" card uses. Any read failure answers false: Connect is
 * the recovery path, and opening a business with no AI is the failure.
 */
export async function readDeviceAiConnection(queryClient: QueryClient) {
  try {
    const config = await queryClient.fetchQuery({
      queryKey: globalAgentConfigQueryKey,
      queryFn: getGlobalAgentConfig,
      staleTime: 0,
    });
    // No saved route: nothing to probe, Connect is needed.
    if (!config.preferred_runtime) return false;
    const runtimes = await refreshAcpRuntimes(queryClient);
    return runtimes ? hasWorkingAiConnection(config, runtimes) : false;
  } catch {
    return false;
  }
}

/** Wait for a read, answering false once `timeoutMs` passes. */
export function waitForDeviceAiConnection(
  check: Promise<boolean>,
  timeoutMs = DEVICE_AI_CONNECTION_WAIT_MS,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  return Promise.race([check, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Start the device connection read while a business chooser is open, so it is
 * usually settled by the time a business is picked. `resolve` answers null
 * when the chooser closed or a newer pick started while it waited.
 */
export function useDeviceAiConnectionCheck(active: boolean) {
  const queryClient = useQueryClient();
  const pending = React.useRef<Promise<boolean> | null>(null);
  const generation = React.useRef(0);
  const [checking, setChecking] = React.useState(false);
  React.useEffect(() => {
    if (!active) return;
    pending.current = readDeviceAiConnection(queryClient);
    return () => {
      pending.current = null;
      generation.current += 1;
      setChecking(false);
    };
  }, [active, queryClient]);
  const resolve = React.useCallback(async () => {
    const attempt = ++generation.current;
    setChecking(true);
    const connected = await waitForDeviceAiConnection(
      pending.current ?? readDeviceAiConnection(queryClient),
    );
    if (generation.current !== attempt) return null;
    setChecking(false);
    return connected;
  }, [queryClient]);
  return { checking, resolve };
}
