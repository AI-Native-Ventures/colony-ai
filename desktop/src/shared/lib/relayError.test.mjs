import assert from "node:assert/strict";
import test from "node:test";

import {
  isRelayUnreachableError,
  isTechnicalRelayError,
  plainRelayErrorMessage,
  RELAY_GENERIC_ERROR_MESSAGE,
  RELAY_UNREACHABLE_SHORT,
} from "./relayError.ts";

test("isRelayUnreachableError: Error with prefix returns true", () => {
  assert.equal(
    isRelayUnreachableError(new Error("relay unreachable: connection refused")),
    true,
  );
});

test("isRelayUnreachableError: string with prefix returns true", () => {
  assert.equal(
    isRelayUnreachableError("relay unreachable: 403 Forbidden"),
    true,
  );
});

test("isRelayUnreachableError: prefix alone (no detail) returns true", () => {
  assert.equal(isRelayUnreachableError("relay unreachable:"), true);
});

test("isRelayUnreachableError: unrelated Error returns false", () => {
  assert.equal(isRelayUnreachableError(new Error("network timeout")), false);
});

test("isRelayUnreachableError: unrelated string returns false", () => {
  assert.equal(isRelayUnreachableError("something went wrong"), false);
});

test("isRelayUnreachableError: malformed-response message returns false", () => {
  // The backend relabels a reached-but-malformed 2xx body to this exact string
  // so it drops out of the unreachable bucket. Pin that the classifier agrees —
  // if the backend re-prefixes it, this catches the misroute.
  assert.equal(
    isRelayUnreachableError(
      "relay returned malformed response: not valid JSON",
    ),
    false,
  );
});

test("isRelayUnreachableError: null returns false", () => {
  assert.equal(isRelayUnreachableError(null), false);
});

test("isRelayUnreachableError: number returns false", () => {
  assert.equal(isRelayUnreachableError(42), false);
});

test("isRelayUnreachableError: plain object returns false", () => {
  assert.equal(
    isRelayUnreachableError({ message: "relay unreachable: oops" }),
    false,
  );
});

test("plainRelayErrorMessage never exposes raw relay text", () => {
  for (const raw of [
    "relay returned 403 Forbidden: You must be a relay member to access this relay",
    "relay returned 500 Internal Server Error: boom",
    "something unexpected",
  ]) {
    const plain = plainRelayErrorMessage(raw);
    assert.equal(plain, RELAY_GENERIC_ERROR_MESSAGE);
    assert.doesNotMatch(plain, /relay returned|403|500/);
  }
  assert.equal(
    RELAY_GENERIC_ERROR_MESSAGE,
    "Colony could not reach this community. Try again.",
  );
});

test("plainRelayErrorMessage keeps the unreachable wording for unreachable errors", () => {
  assert.equal(
    plainRelayErrorMessage("relay unreachable: connection refused"),
    RELAY_UNREACHABLE_SHORT,
  );
});

test("plainRelayErrorMessage sees through a nested wrapper", () => {
  assert.equal(
    plainRelayErrorMessage(
      "relay owned-agent query failed: relay unreachable: request timed out",
    ),
    RELAY_UNREACHABLE_SHORT,
  );
  assert.equal(
    plainRelayErrorMessage(
      "relay owned-agent query failed: relay returned 500 Internal Server Error: boom",
    ),
    RELAY_GENERIC_ERROR_MESSAGE,
  );
});

test("isTechnicalRelayError flags relay wrapper text and nothing else", () => {
  for (const raw of [
    "relay returned 403 Forbidden: nope",
    "relay returned 503",
    "relay returned malformed response: not valid JSON",
    "relay unreachable: request timed out",
    "relay owned-agent query failed: relay returned 403 Forbidden: nope",
    "relay owned-agent query failed: relay unreachable: network error",
  ]) {
    assert.equal(isTechnicalRelayError(raw), true, raw);
    assert.equal(isTechnicalRelayError(new Error(raw)), true, raw);
  }
  for (const plain of [
    "Temporary community connection failure.",
    "Failed to apply community configuration",
    "",
  ]) {
    assert.equal(isTechnicalRelayError(plain), false, plain);
  }
  assert.equal(isTechnicalRelayError(null), false);
});
