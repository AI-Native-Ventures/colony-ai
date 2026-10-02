import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { verifyEvent } from "nostr-tools/pure";

import { getRelaySelf } from "@/features/moderation/lib/relaySelf";
import { useCommunities } from "@/features/communities/useCommunities";
import { relayClient } from "@/shared/api/relayClient";
import { signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";
import {
  KIND_FACTORY_RUN_ACTION,
  KIND_FACTORY_RUN_HEAD,
} from "@/shared/constants/kinds";

export type FactoryPreviewState =
  | { state: "not_configured" }
  | {
      state: "not_started";
      command: string;
      localUrl: string;
      port?: number;
      readiness?: FactoryPreviewReadiness;
    }
  | {
      state: "starting";
      command: string;
      localUrl: string;
      port?: number;
      readiness?: FactoryPreviewReadiness;
    }
  | {
      state: "running";
      command: string;
      localUrl: string;
      url: string;
      port?: number;
      readiness?: FactoryPreviewReadiness;
    }
  | {
      state: "failed";
      command: string;
      localUrl: string;
      reason: string;
      startupOutput?: string;
      port?: number;
      readiness?: FactoryPreviewReadiness;
    }
  | {
      state: "stopped";
      command: string;
      localUrl: string;
      port?: number;
      readiness?: FactoryPreviewReadiness;
    };

export type FactoryPreviewReadiness = {
  mode: "http_endpoint" | "output_message";
  value: string;
};

export type FactoryCheckResult = {
  name: string;
  status: "unknown" | "queued" | "running" | "passed" | "failed" | "cancelled";
  detailsUrl?: string;
};

export type FactoryPullRequest = {
  url: string;
  number: number;
  state: "unknown" | "draft" | "open" | "closed" | "merged";
  checkResults: FactoryCheckResult[];
  reviewHandoff?: string;
};

export type FactoryRunHead = {
  schemaVersion: 1;
  runId: string;
  runOwnerPubkey: string;
  preview: FactoryPreviewState;
  pullRequest?: FactoryPullRequest;
  updatedAt: string;
};

export type FactoryRunRecord = {
  event: RelayEvent;
  head: FactoryRunHead;
};

export type FactoryRunAction = {
  schemaVersion: 1;
  runId: string;
  runOwnerPubkey?: string;
  expectedHeadEventId?: string;
  action:
    | "configure_preview"
    | "report_preview_state"
    | "link_pull_request"
    | "unlink_pull_request";
  command?: string;
  localUrl?: string;
  port?: number;
  readiness?: FactoryPreviewReadiness;
  preview?: FactoryPreviewState;
  pullRequest?: FactoryPullRequest;
};

const FACTORY_RUN_QUERY_LIMIT = 2;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBKEY_PATTERN = /^[0-9a-f]{64}$/i;
const EVENT_ID_PATTERN = /^[0-9a-f]{64}$/i;
const PREVIEW_STATES = new Set([
  "not_configured",
  "not_started",
  "starting",
  "running",
  "failed",
  "stopped",
]);
const PULL_REQUEST_STATES = new Set([
  "unknown",
  "draft",
  "open",
  "closed",
  "merged",
]);
const CHECK_STATES = new Set([
  "unknown",
  "queued",
  "running",
  "passed",
  "failed",
  "cancelled",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function textLength(value: string) {
  return Array.from(value).length;
}

function oneTagValue(event: RelayEvent, name: string): string | null {
  const tags = event.tags.filter((tag) => tag[0] === name);
  return tags.length === 1 && typeof tags[0]?.[1] === "string"
    ? tags[0][1]
    : null;
}

export function factoryRunDTag(runId: string): string {
  if (!UUID_PATTERN.test(runId)) {
    throw new Error("Factory run coordinates require a UUID.");
  }
  return `company:factory-run:${runId.toLowerCase()}`;
}

function isValidUrl(value: unknown, httpsOnly: boolean): value is string {
  if (typeof value !== "string" || textLength(value) > 2048) return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || !url.hostname) return false;
    if (httpsOnly) return url.protocol === "https:";
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    const ipv4 = hostname.split(".");
    const isIpv4Loopback =
      ipv4.length === 4 &&
      ipv4[0] === "127" &&
      ipv4.every(
        (octet) =>
          /^\d+$/.test(octet ?? "") &&
          Number(octet) >= 0 &&
          Number(octet) <= 255,
      );
    return (
      hostname.toLowerCase() === "localhost" ||
      isIpv4Loopback ||
      hostname === "::1"
    );
  } catch {
    return false;
  }
}

function validPreviewReadiness(
  value: unknown,
): value is FactoryPreviewReadiness {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["mode", "value"]) ||
    typeof value.mode !== "string" ||
    typeof value.value !== "string"
  ) {
    return false;
  }
  if (value.mode === "http_endpoint") {
    return (
      value.value.startsWith("/") &&
      !value.value.startsWith("//") &&
      !value.value.includes("\r") &&
      !value.value.includes("\n") &&
      Array.from(value.value).length <= 2048
    );
  }
  return (
    value.mode === "output_message" &&
    value.value.trim().length > 0 &&
    Array.from(value.value).length <= 512
  );
}

export function isValidFactoryPreviewState(
  value: unknown,
): value is FactoryPreviewState {
  if (!isRecord(value) || typeof value.state !== "string") return false;
  if (!PREVIEW_STATES.has(value.state)) return false;
  if (value.state === "not_configured") {
    return hasOnlyKeys(value, ["state"]);
  }
  const allowedConfigurationKeys = [
    "state",
    "command",
    "localUrl",
    "port",
    "readiness",
  ];
  if (
    typeof value.command !== "string" ||
    value.command.trim().length === 0 ||
    textLength(value.command) > 512 ||
    !isValidUrl(value.localUrl, false)
  ) {
    return false;
  }
  if ((value.port === undefined) !== (value.readiness === undefined)) {
    return false;
  }
  if (value.port !== undefined) {
    if (
      typeof value.port !== "number" ||
      !Number.isSafeInteger(value.port) ||
      value.port < 1 ||
      value.port > 65535 ||
      !validPreviewReadiness(value.readiness)
    ) {
      return false;
    }
    const localUrl = new URL(value.localUrl as string);
    const actualPort = Number(
      localUrl.port || (localUrl.protocol === "https:" ? "443" : "80"),
    );
    if (actualPort !== value.port) return false;
  }
  if (value.state === "running") {
    return (
      hasOnlyKeys(value, [...allowedConfigurationKeys, "url"]) &&
      isValidUrl(value.url, false)
    );
  }
  if (value.state === "failed") {
    return (
      hasOnlyKeys(value, [
        ...allowedConfigurationKeys,
        "reason",
        "startupOutput",
      ]) &&
      typeof value.reason === "string" &&
      value.reason.trim().length > 0 &&
      textLength(value.reason) <= 1000 &&
      (value.startupOutput === undefined ||
        (typeof value.startupOutput === "string" &&
          new TextEncoder().encode(value.startupOutput).length <= 4096))
    );
  }
  return hasOnlyKeys(value, allowedConfigurationKeys);
}

export function factoryPullRequestNumber(url: string): number | null {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      if (["pull", "pulls", "pullrequest"].includes(segment ?? "")) {
        const number = Number(segments[index + 1]);
        return Number.isSafeInteger(number) && number > 0 ? number : null;
      }
      if (segment === "merge_requests" && segments[index - 1] === "-") {
        const number = Number(segments[index + 1]);
        return Number.isSafeInteger(number) && number > 0 ? number : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function validPullRequest(value: unknown): value is FactoryPullRequest {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "url",
      "number",
      "state",
      "checkResults",
      "reviewHandoff",
    ]) ||
    !isValidUrl(value.url, true) ||
    typeof value.number !== "number" ||
    !Number.isSafeInteger(value.number) ||
    value.number < 1 ||
    !PULL_REQUEST_STATES.has(String(value.state)) ||
    !Array.isArray(value.checkResults) ||
    value.checkResults.length > 100
  ) {
    return false;
  }
  if (factoryPullRequestNumber(value.url) !== value.number) return false;
  for (const check of value.checkResults) {
    if (
      !isRecord(check) ||
      !hasOnlyKeys(check, ["name", "status", "detailsUrl"]) ||
      typeof check.name !== "string" ||
      check.name.trim().length === 0 ||
      textLength(check.name) > 120 ||
      !CHECK_STATES.has(String(check.status)) ||
      (check.detailsUrl !== undefined && !isValidUrl(check.detailsUrl, true))
    ) {
      return false;
    }
  }
  return (
    value.reviewHandoff === undefined ||
    (typeof value.reviewHandoff === "string" &&
      value.reviewHandoff.trim().length > 0 &&
      textLength(value.reviewHandoff) <= 4000)
  );
}

function validFactoryRunHead(
  value: unknown,
  expectedRunId: string,
): value is FactoryRunHead {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "runId",
      "runOwnerPubkey",
      "preview",
      "pullRequest",
      "updatedAt",
    ]) ||
    value.schemaVersion !== 1 ||
    typeof value.runId !== "string" ||
    !UUID_PATTERN.test(value.runId) ||
    value.runId.toLowerCase() !== expectedRunId.toLowerCase() ||
    typeof value.runOwnerPubkey !== "string" ||
    !PUBKEY_PATTERN.test(value.runOwnerPubkey) ||
    !isValidFactoryPreviewState(value.preview) ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    (value.pullRequest !== undefined && !validPullRequest(value.pullRequest))
  ) {
    return false;
  }
  return true;
}

export function decodeFactoryRunHead(
  event: RelayEvent,
  relaySelfPubkey: string,
  expectedRunId: string,
): FactoryRunRecord | null {
  if (
    event.kind !== KIND_FACTORY_RUN_HEAD ||
    event.pubkey.toLowerCase() !== relaySelfPubkey.toLowerCase()
  ) {
    return null;
  }
  const expectedDTag = factoryRunDTag(expectedRunId);
  if (
    oneTagValue(event, "d") !== expectedDTag ||
    event.tags.length !== 1 ||
    !EVENT_ID_PATTERN.test(event.id)
  ) {
    return null;
  }
  try {
    if (!verifyEvent(event)) return null;
    const content: unknown = JSON.parse(event.content);
    if (!validFactoryRunHead(content, expectedRunId)) return null;
    return { event, head: content };
  } catch {
    return null;
  }
}

export const factoryRunRecordQueryKey = (
  relayUrl: string | null,
  runId: string,
) => ["factory-run-record", relayUrl, runId] as const;

async function fetchFactoryRunRecord(runId: string) {
  const relaySelf = await getRelaySelf();
  if (!relaySelf) {
    throw new Error("This relay does not advertise a signing identity.");
  }
  const events = await relayClient.fetchEvents({
    kinds: [KIND_FACTORY_RUN_HEAD],
    authors: [relaySelf],
    "#d": [factoryRunDTag(runId)],
    limit: FACTORY_RUN_QUERY_LIMIT,
  });
  if (events.length > 1) {
    throw new Error("The relay returned duplicate Factory run records.");
  }
  const event = events[0];
  if (!event) return null;
  const record = decodeFactoryRunHead(event, relaySelf, runId);
  if (!record) {
    throw new Error("The relay returned an invalid signed Factory run record.");
  }
  return record;
}

export function useFactoryRunRecordQuery(runId: string, enabled = true) {
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useQuery({
    enabled: enabled && relayUrl !== null && UUID_PATTERN.test(runId),
    queryKey: factoryRunRecordQueryKey(relayUrl, runId),
    queryFn: () => fetchFactoryRunRecord(runId),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
}

export function useFactoryRunActionMutation(runId: string) {
  const queryClient = useQueryClient();
  const { activeCommunity } = useCommunities();
  const relayUrl = activeCommunity?.relayUrl ?? null;
  return useMutation({
    mutationFn: async ({ action }: { action: FactoryRunAction }) => {
      const event = await signRelayEvent({
        kind: KIND_FACTORY_RUN_ACTION,
        content: JSON.stringify(action),
        tags: [["d", factoryRunDTag(runId)]],
      });
      await relayClient.publishEvent(
        event,
        "Timed out saving the Factory run record.",
        "The Factory run record could not be saved.",
      );
      return event;
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({
        queryKey: factoryRunRecordQueryKey(relayUrl, runId),
      });
    },
  });
}
