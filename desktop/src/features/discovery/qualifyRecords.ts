import type { TenantCommunityId } from "@/features/communities/tenantCommunity";
import type { RelayEvent } from "@/shared/api/types";
import {
  businessDTag,
  KIND_QUALIFY_OBSERVATION_HEAD,
  QUALIFY_SIGNAL_CODES,
  tryParseContent,
  type QualifyObservation,
  type QualifyObservationAction,
  type QualifyObservationHead,
  type QualifyObservationState,
  type QualifySignal,
} from "./businessRecordContract";

const UUID_PATTERN =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HEX64_PATTERN = /^[a-f0-9]{64}$/;
const MAX_OBSERVATIONS = 13;
const MAX_EVIDENCE_URLS = 5;
const MAX_VALUE_CHARS = 1_000;
const MAX_REASON_CHARS = 160;

export type QualifyObservationHeadView = {
  eventId: string;
  dTag: string;
  record: QualifyObservationHead;
};

function objectValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): value is string {
  return typeof value === "string";
}

function numberValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validSignal(value: unknown): value is QualifySignal {
  return (
    stringValue(value) &&
    (QUALIFY_SIGNAL_CODES as readonly string[]).includes(value)
  );
}

function validUrl(value: unknown): value is string {
  if (!stringValue(value) || value.length > 2_048) return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      Boolean(parsed.hostname) &&
      !parsed.username &&
      !parsed.password &&
      (!parsed.port || parsed.port === "80" || parsed.port === "443")
    );
  } catch {
    return false;
  }
}

function validSignalConfidence(
  signal: QualifySignal,
  state: QualifyObservationState,
  confidence: number,
): boolean {
  if (state !== "observed") return confidence === 0;
  if (signal === "NO_ONLINE_BOOKING") return confidence <= 0.6;
  if (signal === "NO_WHATSAPP_LINK") return confidence <= 0.7;
  if (signal === "INCUMBENT_BUILDER") return confidence >= 0.75;
  return true;
}

function parseObservation(
  value: unknown,
  runId: string,
): QualifyObservation | null {
  if (!objectValue(value)) return null;
  if (
    !validSignal(value.signal) ||
    (value.state !== "observed" && value.state !== "not_checked") ||
    !numberValue(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1 ||
    !numberValue(value.observedAt) ||
    !Number.isSafeInteger(value.observedAt) ||
    value.observedAt <= 0 ||
    value.runId !== runId ||
    !Array.isArray(value.evidenceUrls) ||
    value.evidenceUrls.length > MAX_EVIDENCE_URLS ||
    !value.evidenceUrls.every(validUrl) ||
    typeof value.personalData !== "boolean"
  ) {
    return null;
  }
  const evidenceUrls = [...new Set(value.evidenceUrls)];
  if (evidenceUrls.length !== value.evidenceUrls.length) return null;
  const signal = value.signal;
  if (!validSignalConfidence(signal, value.state, value.confidence))
    return null;
  if (value.state === "observed") {
    const validValue =
      (stringValue(value.value) &&
        value.value.trim().length > 0 &&
        value.value.length <= MAX_VALUE_CHARS) ||
      numberValue(value.value);
    if (
      !validValue ||
      (value.notCheckedReason !== undefined &&
        value.notCheckedReason !== null) ||
      (signal !== "NO_WEBSITE" && evidenceUrls.length === 0) ||
      (value.personalData && signal !== "PUBLIC_EMAIL")
    ) {
      return null;
    }
    return {
      signal,
      state: "observed",
      value: value.value as string | number,
      confidence: value.confidence,
      evidenceUrls,
      observedAt: value.observedAt,
      runId,
      notCheckedReason: null,
      personalData: value.personalData,
    };
  }
  if (
    value.value !== undefined ||
    value.confidence !== 0 ||
    evidenceUrls.length !== 0 ||
    value.personalData ||
    !stringValue(value.notCheckedReason) ||
    !value.notCheckedReason.trim() ||
    value.notCheckedReason.length > MAX_REASON_CHARS
  ) {
    return null;
  }
  return {
    signal,
    state: "not_checked",
    value: null,
    confidence: 0,
    evidenceUrls: [],
    observedAt: value.observedAt,
    runId,
    notCheckedReason: value.notCheckedReason.trim(),
    personalData: false,
  };
}

function readTag(event: RelayEvent, name: string): string | null {
  return event.tags.find((tag) => tag[0] === name)?.[1] ?? null;
}

/** Return the NIP-33 coordinate for a lead's qualification observations. */
export function qualifyObservationDTag(
  communityId: TenantCommunityId,
  leadId: string,
): string {
  return businessDTag(communityId, "qualify_observation", leadId.toLowerCase());
}

/** Parse one relay-authored qualification head without affecting older record parsing. */
export function parseQualifyObservationHead(
  event: RelayEvent,
  communityId: TenantCommunityId,
  channelId: string,
): QualifyObservationHeadView | null {
  if (event.kind !== KIND_QUALIFY_OBSERVATION_HEAD) return null;
  if (readTag(event, "h") !== channelId) return null;
  const content = tryParseContent<Record<string, unknown>>(event);
  if (!content) return null;
  const { schemaVersion } = content;
  const leadId = content.leadId;
  const runId = content.runId;
  const checkedAt = content.checkedAt;
  const sourceActionEventId = content.sourceActionEventId;
  const rawCheckedSignals = content.checkedSignals;
  const rawObservations = content.observations;
  if (schemaVersion !== 1) return null;
  if (!stringValue(leadId) || !UUID_PATTERN.test(leadId)) return null;
  if (!stringValue(runId) || !UUID_PATTERN.test(runId)) return null;
  if (
    !numberValue(checkedAt) ||
    !Number.isSafeInteger(checkedAt) ||
    checkedAt <= 0
  )
    return null;
  if (
    !stringValue(sourceActionEventId) ||
    !HEX64_PATTERN.test(sourceActionEventId)
  )
    return null;
  if (
    !Array.isArray(rawCheckedSignals) ||
    rawCheckedSignals.length === 0 ||
    rawCheckedSignals.length > MAX_OBSERVATIONS
  )
    return null;
  const checkedSignals: QualifySignal[] = [];
  for (const signal of rawCheckedSignals) {
    if (!validSignal(signal)) return null;
    checkedSignals.push(signal);
  }
  if (new Set(checkedSignals).size !== checkedSignals.length) return null;
  if (
    !Array.isArray(rawObservations) ||
    rawObservations.length > MAX_OBSERVATIONS ||
    readTag(event, "d") !== qualifyObservationDTag(communityId, leadId)
  )
    return null;
  const observations = rawObservations.map((value) =>
    parseObservation(value, runId),
  );
  if (
    observations.some((observation) => observation === null) ||
    new Set(observations.map((observation) => observation?.signal)).size !==
      observations.length ||
    observations.some(
      (observation) =>
        observation !== null && !checkedSignals.includes(observation.signal),
    )
  ) {
    return null;
  }
  return {
    eventId: event.id,
    dTag: qualifyObservationDTag(communityId, leadId),
    record: {
      schemaVersion: 1,
      leadId,
      runId,
      checkedSignals,
      observations: observations as QualifyObservation[],
      checkedAt,
      sourceActionEventId,
    },
  };
}

function assertValidActionObservation(
  observation: QualifyObservation,
  runId: string,
): void {
  const parsed = parseObservation(
    {
      ...observation,
      value: observation.value ?? undefined,
      notCheckedReason: observation.notCheckedReason ?? undefined,
    },
    runId,
  );
  if (!parsed) throw new Error("Invalid qualification observation.");
}

/** Build a client action using the exact storage contract accepted by the relay. */
export function buildQualifyObservationAction(input: {
  leadId: string;
  runId: string;
  expectedHeadEventId?: string;
  checkedSignals: readonly QualifySignal[];
  observations: readonly QualifyObservation[];
}): QualifyObservationAction {
  if (!UUID_PATTERN.test(input.leadId) || !UUID_PATTERN.test(input.runId)) {
    throw new Error(
      "A qualification action needs valid lead and run identifiers.",
    );
  }
  if (
    input.expectedHeadEventId !== undefined &&
    !HEX64_PATTERN.test(input.expectedHeadEventId)
  ) {
    throw new Error("The qualification head fence is invalid.");
  }
  if (
    input.checkedSignals.length === 0 ||
    input.checkedSignals.length > MAX_OBSERVATIONS ||
    input.observations.length > MAX_OBSERVATIONS
  ) {
    throw new Error(
      "A qualification action needs one through thirteen selected signals.",
    );
  }
  const checkedSignals = [...input.checkedSignals];
  if (
    checkedSignals.some((signal) => !validSignal(signal)) ||
    new Set(checkedSignals).size !== checkedSignals.length
  ) {
    throw new Error("A qualification action cannot repeat a selected signal.");
  }
  const observations = input.observations.map((observation) => ({
    ...observation,
    evidenceUrls: [...observation.evidenceUrls],
  }));
  if (
    new Set(observations.map((observation) => observation.signal)).size !==
    observations.length
  ) {
    throw new Error("A qualification action cannot repeat a signal.");
  }
  for (const observation of observations) {
    if (!checkedSignals.includes(observation.signal)) {
      throw new Error("A qualification observation must be selected.");
    }
    assertValidActionObservation(observation, input.runId);
  }
  return {
    schemaVersion: 1,
    leadId: input.leadId.toLowerCase(),
    runId: input.runId.toLowerCase(),
    ...(input.expectedHeadEventId
      ? { expectedHeadEventId: input.expectedHeadEventId }
      : {}),
    checkedSignals,
    observations,
  };
}

/** True when a head was observed within the supplied freshness window. */
export function isQualifyHeadFresh(
  head: QualifyObservationHead,
  nowSeconds: number,
  maxAgeSeconds = 30 * 24 * 60 * 60,
): boolean {
  return (
    head.checkedAt <= nowSeconds && nowSeconds - head.checkedAt <= maxAgeSeconds
  );
}
