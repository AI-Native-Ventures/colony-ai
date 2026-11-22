import {
  discoverAgentModels,
  type DiscoverAgentModelsInput,
} from "@/shared/api/agentModels";
import type { AgentModelsResponse } from "@/shared/api/types";
import { getStorageItem } from "@/shared/lib/safeStorage";
import { setLocalStorageItemWithRecovery } from "@/shared/lib/localStorageQuota";

export const MODEL_DISCOVERY_CACHE_STORAGE_KEY =
  "buzz-agent-model-discovery.v1";

const CACHE_VERSION = 1;
const MAX_CACHE_ENTRIES = 24;
const MAX_PERSISTED_RESPONSE_BYTES = 128 * 1024;
export const MODEL_DISCOVERY_TIMEOUT_MS = 8_000;
export const MODEL_DISCOVERY_REFRESH_AFTER_MS = 5 * 60_000;

type CachedModelDiscovery = {
  key: string;
  response: AgentModelsResponse;
  updatedAt: number;
};

type ModelDiscoveryCache = {
  entries: CachedModelDiscovery[];
  version: number;
};

export type ModelDiscoveryIdentity = {
  agentArgs: readonly string[];
  agentCommand: string;
  provider: string;
  runtimeId: string;
};

type SharedModelDiscoveryRequest = {
  cacheKey: string;
  input: DiscoverAgentModelsInput;
  requestKey: string;
  shouldCache: (response: AgentModelsResponse) => boolean;
};

type DiscoverModels = (
  input: DiscoverAgentModelsInput,
) => Promise<AgentModelsResponse>;

type InFlightModelDiscovery = {
  operation: Promise<AgentModelsResponse>;
  requestKey: string;
};

// Requests are keyed by the durable cache identity, rather than a screen
// refresh token. This prevents a close, reopen, or explicit refresh from
// starting a second harness process while the first is still bounded by its
// native timeout.
const inFlightRequests = new Map<string, InFlightModelDiscovery>();
const latestRequestKeys = new Map<string, string>();

/** Builds the secret-free durable identity for one runtime and provider. */
export function modelDiscoveryCacheKey({
  agentArgs,
  agentCommand,
  provider,
  runtimeId,
}: ModelDiscoveryIdentity): string {
  return JSON.stringify({
    agentArgs: [...agentArgs],
    agentCommand: agentCommand.trim(),
    provider: provider.trim(),
    runtimeId: runtimeId.trim(),
  });
}

function isModelInfo(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    (typeof record.name === "string" || record.name === null) &&
    (typeof record.description === "string" || record.description === null)
  );
}

function isAgentModelsResponse(value: unknown): value is AgentModelsResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.agentName === "string" &&
    typeof record.agentVersion === "string" &&
    Array.isArray(record.models) &&
    record.models.every(isModelInfo) &&
    (typeof record.agentDefaultModel === "string" ||
      record.agentDefaultModel === null) &&
    (typeof record.selectedModel === "string" ||
      record.selectedModel === null) &&
    typeof record.supportsSwitching === "boolean"
  );
}

function parseCache(value: string | null): ModelDiscoveryCache {
  if (!value) return { entries: [], version: CACHE_VERSION };
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { entries: [], version: CACHE_VERSION };
    }
    const record = parsed as Record<string, unknown>;
    if (record.version !== CACHE_VERSION || !Array.isArray(record.entries)) {
      return { entries: [], version: CACHE_VERSION };
    }
    const entries = record.entries.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        return [];
      }
      const candidate = entry as Record<string, unknown>;
      if (
        typeof candidate.key !== "string" ||
        !Number.isFinite(candidate.updatedAt) ||
        !isAgentModelsResponse(candidate.response)
      ) {
        return [];
      }
      return [
        {
          key: candidate.key,
          response: candidate.response,
          updatedAt: candidate.updatedAt,
        },
      ];
    });
    return {
      entries: entries.slice(-MAX_CACHE_ENTRIES),
      version: CACHE_VERSION,
    };
  } catch {
    return { entries: [], version: CACHE_VERSION };
  }
}

function writeCache(cache: ModelDiscoveryCache): void {
  setLocalStorageItemWithRecovery(
    MODEL_DISCOVERY_CACHE_STORAGE_KEY,
    JSON.stringify({ ...cache, updatedAt: Date.now() }),
  );
}

/** Reads the last usable model catalog for an identity from local storage. */
export function readCachedModelDiscovery(
  key: string,
): CachedModelDiscovery | null {
  return (
    parseCache(getStorageItem(MODEL_DISCOVERY_CACHE_STORAGE_KEY)).entries.find(
      (entry) => entry.key === key,
    ) ?? null
  );
}

/** Saves a bounded usable model catalog without credentials or other env data. */
export function saveCachedModelDiscovery(
  key: string,
  response: AgentModelsResponse,
  updatedAt = Date.now(),
): void {
  const serializedResponse = JSON.stringify(response);
  if (serializedResponse.length > MAX_PERSISTED_RESPONSE_BYTES) return;
  const current = parseCache(getStorageItem(MODEL_DISCOVERY_CACHE_STORAGE_KEY));
  const entries = current.entries.filter((entry) => entry.key !== key);
  entries.push({ key, response, updatedAt });
  writeCache({
    entries: entries.slice(-MAX_CACHE_ENTRIES),
    version: CACHE_VERSION,
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      reject(new Error("Model discovery timed out. Try again."));
    }, timeoutMs);
    promise.then(
      (value) => {
        globalThis.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        globalThis.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function startSharedDiscovery(
  request: SharedModelDiscoveryRequest,
  discover: DiscoverModels,
): Promise<AgentModelsResponse> {
  latestRequestKeys.set(request.cacheKey, request.requestKey);
  const operation = Promise.resolve().then(() => discover(request.input));
  inFlightRequests.set(request.cacheKey, {
    operation,
    requestKey: request.requestKey,
  });
  void operation.then(
    (response) => {
      if (
        latestRequestKeys.get(request.cacheKey) === request.requestKey &&
        request.shouldCache(response)
      ) {
        saveCachedModelDiscovery(request.cacheKey, response);
      }
    },
    () => undefined,
  );
  void operation.then(
    () => {
      if (inFlightRequests.get(request.cacheKey)?.operation === operation) {
        inFlightRequests.delete(request.cacheKey);
      }
    },
    () => {
      if (inFlightRequests.get(request.cacheKey)?.operation === operation) {
        inFlightRequests.delete(request.cacheKey);
      }
    },
  );
  return operation;
}

function requestModelDiscoveryOperation(
  request: SharedModelDiscoveryRequest,
  discover: DiscoverModels,
): Promise<AgentModelsResponse> {
  const activeRequest = inFlightRequests.get(request.cacheKey);
  if (!activeRequest) return startSharedDiscovery(request, discover);
  if (activeRequest.requestKey === request.requestKey) {
    return activeRequest.operation;
  }

  // Credential edits must get a new probe, but only after the earlier command
  // is no longer running. Both outcomes advance the queued request because a
  // failed old credential must not strand the newer one.
  const startAfterActiveRequest = () =>
    requestModelDiscoveryOperation(request, discover);
  return activeRequest.operation.then(
    startAfterActiveRequest,
    startAfterActiveRequest,
  );
}

/**
 * Reuses an active request for an identical discovery input. The native IPC
 * keeps running after the caller's UI timeout so reopening a dialog cannot
 * create another concurrent harness process.
 */
export function requestSharedModelDiscovery(
  request: SharedModelDiscoveryRequest,
  options: {
    discover?: DiscoverModels;
    onSuccess?: (response: AgentModelsResponse) => void;
    timeoutMs?: number;
  } = {},
): Promise<AgentModelsResponse> {
  const operation = requestModelDiscoveryOperation(
    request,
    options.discover ?? discoverAgentModels,
  );
  void operation.then(options.onSuccess, () => undefined);
  return withTimeout(
    operation,
    options.timeoutMs ?? MODEL_DISCOVERY_TIMEOUT_MS,
  );
}

/** Test-only isolation seam for in-flight discovery requests. */
export function __resetModelDiscoveryCacheForTests(): void {
  inFlightRequests.clear();
  latestRequestKeys.clear();
}
