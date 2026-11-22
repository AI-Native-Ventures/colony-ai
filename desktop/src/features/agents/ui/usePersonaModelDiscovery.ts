import * as React from "react";

import type {
  AcpRuntimeCatalogEntry,
  AgentModelsResponse,
} from "@/shared/api/types";
import type { EnvVarsValue } from "./EnvVarsEditor";
import {
  formatModelDiscoveryErrorStatus,
  type PersonaModelDiscoveryStatus,
} from "./personaModelDiscoveryStatus";
import type { PersonaModelOption } from "./agentConfigOptions";
import { providerRequiresExplicitModel } from "./agentConfigOptions";
import { resolveModelLabel } from "@/features/agents/lib/formatAgentModelLabel";
import {
  MODEL_DISCOVERY_REFRESH_AFTER_MS,
  modelDiscoveryCacheKey,
  readCachedModelDiscovery,
  requestSharedModelDiscovery,
} from "./personaModelDiscoveryCache";

export const MODEL_DISCOVERY_LOADING_VALUE = "__model_discovery_loading__";

const MODEL_DISCOVERY_CREDENTIAL_DEBOUNCE_MS = 250;

function stableModelDiscoveryEnvKey(envVars: EnvVarsValue): string {
  return JSON.stringify(
    Object.entries(envVars).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

/**
 * True when a harness catalog entry is the harness's own "use my default"
 * row (e.g. Claude Code ships a literal `default` model id). Such entries
 * mean the same thing as leaving the model unset, so the UI merges them
 * into the single canonical default row instead of showing two rows for
 * one idea.
 */
function isHarnessDefaultModelEntry(model: { id: string }) {
  return model.id.trim().toLowerCase() === "default";
}

export function getDiscoveredPersonaModelOptions(
  response: AgentModelsResponse | null,
  provider: string,
): readonly PersonaModelOption[] | null {
  if (!response?.supportsSwitching || response.models.length === 0) {
    return null;
  }

  // One row per idea: the harness's own default catalog entry (if any) is
  // absorbed into the canonical default row. Selecting it keeps the stored
  // model unset — behaviorally identical, and it avoids two saved states
  // ("default" vs unset) that mean the same thing.
  const explicitModels = response.models.filter(
    (model) => !isHarnessDefaultModelEntry(model),
  );
  const harnessDefaultEntry = response.models.find(isHarnessDefaultModelEntry);
  const agentDefaultModel = response.agentDefaultModel?.trim();
  const agentDefaultModelInfo = agentDefaultModel
    ? response.models.find((model) => model.id.trim() === agentDefaultModel)
    : undefined;

  const defaultModelOption =
    providerRequiresExplicitModel(provider) && harnessDefaultEntry === undefined
      ? []
      : [
          {
            id: "",
            label:
              provider === "relay-mesh"
                ? "Default (auto)"
                : agentDefaultModel
                  ? `Default model (${resolveModelLabel(agentDefaultModel, agentDefaultModelInfo?.name, provider)})`
                  : "Default model",
          },
        ];

  if (explicitModels.length === 0 && defaultModelOption.length === 0) {
    return null;
  }

  return [
    ...defaultModelOption,
    ...explicitModels.map((model) => ({
      id: model.id,
      label: resolveModelLabel(model.id, model.name, provider),
    })),
  ];
}

/**
 * Returns a warning status when a discovery response resolves but contains no
 * usable model options (either because the harness does not support model
 * switching, or because it returned an empty model list). When options ARE
 * available, returns null so callers can clear any prior status.
 */
export function synthesizeEmptyDiscoveryStatus(
  response: AgentModelsResponse,
  provider: string,
): PersonaModelDiscoveryStatus | null {
  if (getDiscoveredPersonaModelOptions(response, provider) !== null) {
    return null;
  }
  const agentLabel =
    typeof response.agentName === "string" ? response.agentName.trim() : "";
  return {
    message: `${agentLabel || "This agent"} reported no models. Check that the CLI is installed and signed in, then reopen this screen.`,
    tone: "warning",
  };
}

/**
 * True when a discovery response is worth caching.  Responses that yielded no
 * usable model options are intentionally excluded so that close → reopen
 * re-runs discovery, letting the user's CLI install or sign-in be reflected
 * without a hard refresh.
 */
export function isCacheableDiscoveryResponse(
  response: AgentModelsResponse,
  provider: string,
): boolean {
  return getDiscoveredPersonaModelOptions(response, provider) !== null;
}

/**
 * Pure derivation of the "discovery is still pending" flag exposed by the
 * hook.  Extracted so tests can verify resolved-but-empty responses do not
 * count as pending.
 */
export function deriveModelDiscoveryPending({
  modelDiscoveryLoading,
  modelDiscoveryKey,
  activeModelDiscoveryData,
  activeModelDiscoveryStatus,
}: {
  modelDiscoveryLoading: boolean;
  modelDiscoveryKey: string | null;
  activeModelDiscoveryData: AgentModelsResponse | null;
  activeModelDiscoveryStatus: PersonaModelDiscoveryStatus | null;
}): boolean {
  return (
    modelDiscoveryLoading ||
    (modelDiscoveryKey !== null &&
      activeModelDiscoveryData === null &&
      activeModelDiscoveryStatus === null)
  );
}

/**
 * True when discovery IPC resolved with a response that yielded no usable
 * model options. Distinct from a thrown/unavailable failure (data stays null).
 * Callers that omit the Model control or heal persisted values must gate on
 * this — not on `discoveredModelOptions === null` alone.
 */
export function isSuccessfulEmptyDiscovery({
  activeModelDiscoveryData,
  discoveredModelOptions,
  modelDiscoveryPending,
}: {
  activeModelDiscoveryData: AgentModelsResponse | null;
  discoveredModelOptions: readonly PersonaModelOption[] | null;
  modelDiscoveryPending: boolean;
}): boolean {
  return (
    !modelDiscoveryPending &&
    activeModelDiscoveryData !== null &&
    discoveredModelOptions === null
  );
}

export function usePersonaModelDiscovery({
  envVars,
  isCustomProviderEditing,
  modelFieldVisible,
  open,
  provider,
  selectedRuntime,
}: {
  envVars: EnvVarsValue;
  isCustomProviderEditing: boolean;
  modelFieldVisible: boolean;
  open: boolean;
  provider: string;
  selectedRuntime: AcpRuntimeCatalogEntry | undefined;
}) {
  const [refreshToken, setRefreshToken] = React.useState(0);
  const refreshRequestedRef = React.useRef(false);
  const [modelDiscoveryData, setModelDiscoveryData] =
    React.useState<AgentModelsResponse | null>(null);
  const [modelDiscoveryDataKey, setModelDiscoveryDataKey] = React.useState<
    string | null
  >(null);
  const [modelDiscoveryStatus, setModelDiscoveryStatus] =
    React.useState<PersonaModelDiscoveryStatus | null>(null);
  const [modelDiscoveryStatusKey, setModelDiscoveryStatusKey] = React.useState<
    string | null
  >(null);
  const [modelDiscoveryLoading, setModelDiscoveryLoading] =
    React.useState(false);
  const modelDiscoveryRequestRef = React.useRef(0);

  const refreshModelDiscovery = React.useCallback(() => {
    refreshRequestedRef.current = true;
    setRefreshToken((current) => current + 1);
  }, []);

  const trimmedProvider = provider.trim();
  const shouldDebounceModelDiscovery =
    providerRequiresExplicitModel(trimmedProvider);
  const discoveryAgentCommand = selectedRuntime?.command?.trim()
    ? selectedRuntime.command
    : null;
  // Narrow to the individual fields the effect consumes so a new object
  // reference from a React Query refetch (same data, unstable ref) does not
  // abandon and re-issue an in-flight discovery IPC call.
  const selectedRuntimeAvailability = selectedRuntime?.availability;
  const selectedRuntimeLabel = selectedRuntime?.label;
  const selectedRuntimeDefaultArgs = selectedRuntime?.defaultArgs;
  const selectedRuntimeDefinitionEnv = selectedRuntime?.definitionEnv;
  const canDiscoverModelOptions =
    open &&
    modelFieldVisible &&
    selectedRuntime?.availability === "available" &&
    discoveryAgentCommand !== null &&
    (!isCustomProviderEditing || trimmedProvider.length > 0);
  const modelDiscoveryEnvKey = React.useMemo(
    () => stableModelDiscoveryEnvKey(envVars),
    [envVars],
  );
  const modelDiscoveryIdentityKey = React.useMemo(() => {
    if (!canDiscoverModelOptions || discoveryAgentCommand === null) {
      return null;
    }

    return modelDiscoveryCacheKey({
      agentCommand: discoveryAgentCommand,
      agentArgs: selectedRuntime?.defaultArgs ?? [],
      provider: trimmedProvider,
      runtimeId: selectedRuntime?.id ?? "",
    });
  }, [
    canDiscoverModelOptions,
    discoveryAgentCommand,
    selectedRuntime?.defaultArgs,
    selectedRuntime?.id,
    trimmedProvider,
  ]);
  const modelDiscoveryKey = React.useMemo(() => {
    if (modelDiscoveryIdentityKey === null) return null;
    return JSON.stringify({
      identity: modelDiscoveryIdentityKey,
      envVars: modelDiscoveryEnvKey,
      refreshToken,
    });
  }, [modelDiscoveryEnvKey, modelDiscoveryIdentityKey, refreshToken]);
  const modelDiscoveryRequestKey = React.useMemo(() => {
    if (modelDiscoveryIdentityKey === null) return null;
    return JSON.stringify({
      identity: modelDiscoveryIdentityKey,
      envVars: modelDiscoveryEnvKey,
    });
  }, [modelDiscoveryEnvKey, modelDiscoveryIdentityKey]);
  const cachedModelDiscovery = React.useMemo(
    () =>
      modelDiscoveryIdentityKey === null
        ? null
        : readCachedModelDiscovery(modelDiscoveryIdentityKey),
    [modelDiscoveryIdentityKey],
  );

  React.useEffect(() => {
    if (
      modelDiscoveryKey === null ||
      modelDiscoveryRequestKey === null ||
      modelDiscoveryIdentityKey === null ||
      discoveryAgentCommand === null
    ) {
      modelDiscoveryRequestRef.current += 1;
      setModelDiscoveryData(null);
      setModelDiscoveryDataKey(null);
      // When the runtime exists but is not available, surface a status message
      // so the model dropdown explains why no live models can be loaded.
      if (
        selectedRuntimeAvailability != null &&
        selectedRuntimeAvailability !== "available"
      ) {
        setModelDiscoveryStatus(
          formatModelDiscoveryErrorStatus(
            new Error(`Runtime not available: ${selectedRuntimeAvailability}`),
            trimmedProvider,
            selectedRuntimeLabel,
          ),
        );
        setModelDiscoveryStatusKey(null);
      } else {
        setModelDiscoveryStatus(null);
        setModelDiscoveryStatusKey(null);
      }
      setModelDiscoveryLoading(false);
      return;
    }

    const requestId = modelDiscoveryRequestRef.current + 1;
    modelDiscoveryRequestRef.current = requestId;
    const activeAgentCommand = discoveryAgentCommand;
    const activeModelDiscoveryKey = modelDiscoveryKey;
    const activeModelDiscoveryRequestKey = modelDiscoveryRequestKey;
    const activeModelDiscoveryIdentityKey = modelDiscoveryIdentityKey;
    const cached = cachedModelDiscovery;
    if (cached) {
      setModelDiscoveryData(cached.response);
      setModelDiscoveryDataKey(activeModelDiscoveryKey);
      setModelDiscoveryStatus(
        synthesizeEmptyDiscoveryStatus(cached.response, trimmedProvider),
      );
      setModelDiscoveryStatusKey(activeModelDiscoveryKey);
      setModelDiscoveryLoading(false);
    }
    const refresh = refreshRequestedRef.current;
    refreshRequestedRef.current = false;
    const cacheIsFresh =
      cached !== null &&
      Date.now() - cached.updatedAt < MODEL_DISCOVERY_REFRESH_AFTER_MS;
    if (cacheIsFresh && !refresh) return;
    if (!cached) {
      setModelDiscoveryData(null);
      setModelDiscoveryDataKey(null);
      setModelDiscoveryStatus(null);
      setModelDiscoveryStatusKey(activeModelDiscoveryKey);
      setModelDiscoveryLoading(true);
    }
    function runModelDiscovery() {
      const input = {
        agentCommand: activeAgentCommand,
        agentArgs: selectedRuntimeDefaultArgs ?? [],
        provider: trimmedProvider || undefined,
        envVars,
        definitionEnv: selectedRuntimeDefinitionEnv ?? {},
        refresh,
      };
      const receiveResponse = (response: AgentModelsResponse) => {
        if (modelDiscoveryRequestRef.current !== requestId) return;
        const next =
          cached && !isCacheableDiscoveryResponse(response, trimmedProvider)
            ? cached.response
            : response;
        setModelDiscoveryData(next);
        setModelDiscoveryDataKey(activeModelDiscoveryKey);
        setModelDiscoveryStatus(
          synthesizeEmptyDiscoveryStatus(next, trimmedProvider),
        );
        setModelDiscoveryStatusKey(activeModelDiscoveryKey);
        setModelDiscoveryLoading(false);
      };
      const receiveError = (error: unknown) => {
        if (modelDiscoveryRequestRef.current !== requestId) return;
        if (cached) {
          setModelDiscoveryData(cached.response);
          setModelDiscoveryDataKey(activeModelDiscoveryKey);
          setModelDiscoveryStatus(null);
        } else {
          setModelDiscoveryData(null);
          setModelDiscoveryDataKey(null);
          setModelDiscoveryStatus(
            formatModelDiscoveryErrorStatus(
              error,
              trimmedProvider,
              selectedRuntimeLabel,
            ),
          );
        }
        setModelDiscoveryStatusKey(activeModelDiscoveryKey);
        setModelDiscoveryLoading(false);
      };
      void requestSharedModelDiscovery(
        {
          cacheKey: activeModelDiscoveryIdentityKey,
          input,
          requestKey: activeModelDiscoveryRequestKey,
          shouldCache: (response) =>
            isCacheableDiscoveryResponse(response, trimmedProvider),
        },
        { onSuccess: receiveResponse },
      ).catch((error) => {
        receiveError(error);
      });
    }

    const timeout = shouldDebounceModelDiscovery
      ? window.setTimeout(
          runModelDiscovery,
          MODEL_DISCOVERY_CREDENTIAL_DEBOUNCE_MS,
        )
      : null;
    if (timeout === null) runModelDiscovery();

    return () => {
      if (timeout !== null) window.clearTimeout(timeout);
      if (modelDiscoveryRequestRef.current === requestId) {
        modelDiscoveryRequestRef.current += 1;
        setModelDiscoveryLoading(false);
      }
    };
  }, [
    discoveryAgentCommand,
    envVars,
    cachedModelDiscovery,
    modelDiscoveryKey,
    modelDiscoveryIdentityKey,
    modelDiscoveryRequestKey,
    selectedRuntimeAvailability,
    selectedRuntimeDefaultArgs,
    selectedRuntimeDefinitionEnv,
    selectedRuntimeLabel,
    shouldDebounceModelDiscovery,
    trimmedProvider,
  ]);

  const activeModelDiscoveryData =
    modelDiscoveryKey !== null && modelDiscoveryDataKey === modelDiscoveryKey
      ? modelDiscoveryData
      : (cachedModelDiscovery?.response ?? null);
  const activeModelDiscoveryStatus =
    modelDiscoveryKey === null
      ? modelDiscoveryStatus
      : modelDiscoveryStatusKey === modelDiscoveryKey
        ? modelDiscoveryStatus
        : null;
  const discoveredModelOptions = React.useMemo(
    () =>
      getDiscoveredPersonaModelOptions(
        activeModelDiscoveryData,
        trimmedProvider,
      ),
    [activeModelDiscoveryData, trimmedProvider],
  );
  const modelDiscoveryPending = deriveModelDiscoveryPending({
    modelDiscoveryLoading,
    modelDiscoveryKey,
    activeModelDiscoveryData,
    activeModelDiscoveryStatus,
  });
  const modelDiscoverySuccessfulEmpty = isSuccessfulEmptyDiscovery({
    activeModelDiscoveryData,
    discoveredModelOptions,
    modelDiscoveryPending,
  });

  return {
    discoveredModelOptions,
    modelDiscoveryLoading: modelDiscoveryPending,
    modelDiscoveryStatus:
      modelDiscoveryPending || discoveredModelOptions !== null
        ? null
        : activeModelDiscoveryStatus,
    modelDiscoverySuccessfulEmpty,
    refreshModelDiscovery,
  };
}
