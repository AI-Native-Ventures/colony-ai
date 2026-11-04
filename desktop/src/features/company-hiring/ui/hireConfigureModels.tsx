import * as React from "react";

import { getProviderEffortConfig } from "@/features/agents/ui/buzzAgentConfig";
import { usePersonaModelDiscovery } from "@/features/agents/ui/usePersonaModelDiscovery";
import type { AcpRuntimeCatalogEntry } from "@/shared/api/types";

export function effortOptionsFor(
  runtime: AcpRuntimeCatalogEntry | undefined,
  providerId: string,
  modelId: string,
): readonly string[] {
  if (runtime?.effortCanonicalValues?.length) {
    return runtime.effortCanonicalValues;
  }
  if (runtime?.id === "buzz-agent") {
    return getProviderEffortConfig(providerId, modelId).validValues;
  }
  return [];
}

export function defaultEffortFor(
  runtime: AcpRuntimeCatalogEntry | undefined,
  providerId: string,
  modelId: string,
) {
  if (runtime?.id === "buzz-agent") {
    return getProviderEffortConfig(providerId, modelId).defaultValue ?? "";
  }
  return runtime?.effortCanonicalValues?.[0] ?? "";
}

export function WorkerModelProbe({
  envVars,
  onOptions,
  providerId,
  runtime,
}: {
  envVars: Record<string, string>;
  onOptions: (
    runtimeId: string,
    providerId: string,
    options: readonly { id: string; label: string }[] | null,
  ) => void;
  providerId: string;
  runtime: AcpRuntimeCatalogEntry;
}) {
  const { discoveredModelOptions } = usePersonaModelDiscovery({
    envVars,
    isCustomProviderEditing: false,
    modelFieldVisible: true,
    open: true,
    provider: providerId,
    selectedRuntime: runtime,
  });
  React.useEffect(() => {
    onOptions(runtime.id, providerId, discoveredModelOptions);
  }, [discoveredModelOptions, onOptions, providerId, runtime.id]);
  return null;
}
