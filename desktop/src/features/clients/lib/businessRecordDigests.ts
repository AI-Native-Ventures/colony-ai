import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

import { BusinessRecordLimitError } from "./businessRecordErrors";

export const MAX_DELIVERABLE_BODY_BYTES = 500_000;

const HEX_32_RE = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertHex32(value: string, label: string): void {
  if (!HEX_32_RE.test(value)) {
    throw new Error(`${label} must be 32-byte lowercase hex`);
  }
}

export function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) {
      throw new Error(
        "deliverable bodies support only safe integer JSON numbers",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error("deliverable body must contain JSON values");
}

function digestHex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

export function computeDeliverableContentDigest(body: unknown): string {
  const contentBytes = utf8ToBytes(canonicalJson(body));
  if (contentBytes.byteLength > MAX_DELIVERABLE_BODY_BYTES) {
    throw new BusinessRecordLimitError(
      "deliverable body exceeds the content limit",
    );
  }
  return digestHex(contentBytes);
}

export function computeDeliverableDigests(
  body: unknown,
  mediaDigests: readonly string[],
) {
  const sortedMediaDigests = [
    ...new Set(mediaDigests.map((item) => item.toLowerCase())),
  ].sort();
  for (const digest of sortedMediaDigests) {
    assertHex32(digest, "media digest");
  }
  const contentDigest = computeDeliverableContentDigest(body);
  const mediaDigest = digestHex(
    utf8ToBytes(JSON.stringify(sortedMediaDigests)),
  );
  const combined = new Uint8Array([
    ...hexToBytes(contentDigest),
    ...hexToBytes(mediaDigest),
  ]);
  return {
    contentDigest,
    mediaDigest,
    sortedMediaDigests,
    versionDigest: digestHex(combined),
  };
}
