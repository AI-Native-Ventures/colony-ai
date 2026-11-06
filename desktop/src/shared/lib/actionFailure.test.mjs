import assert from "node:assert/strict";
import test from "node:test";

import {
  ActionFailureError,
  actionFailureFromError,
  logActionFailure,
} from "./actionFailure.ts";

test("a native signing failure is safe to display and copy", () => {
  const secret = "nsec1thismustneverreachthedesktoplog";
  const failure = actionFailureFromError({
    action: "prospect-search",
    stage: "nip98-sign",
    error: new Error(`identity is in recovery mode: ${secret}`),
  });

  assert.equal(failure.failureClass, "signing");
  assert.equal(failure.code, "identity_recovery");
  assert.equal(failure.title, "Signing failed");
  assert.match(failure.message, /could not sign/i);
  assert.match(failure.details, /class=signing/);
  assert.doesNotMatch(failure.message, /nsec/i);
  assert.doesNotMatch(failure.details, /nsec/i);
  assert.doesNotMatch(failure.details, new RegExp(secret));
});

test("credential-shaped machine codes are not copied to details", () => {
  const failure = actionFailureFromError({
    action: "feedback",
    stage: "event-sign",
    error: Object.assign(new Error("identity signing failed"), {
      code: "nsec1stillnotfordiagnostics",
    }),
  });

  assert.equal(failure.code, "identity_recovery");
  assert.doesNotMatch(failure.details, /nsec/i);
});

test("a relay response retains only its structured status and code", () => {
  const failure = actionFailureFromError({
    action: "prospect-search",
    stage: "relay-response",
    error: Object.assign(new Error("provider says account token is invalid"), {
      code: "discovery_provider_credits",
      status: 402,
    }),
  });

  assert.equal(failure.failureClass, "server");
  assert.equal(failure.status, 402);
  assert.equal(failure.code, "discovery_provider_credits");
  assert.match(failure.message, /HTTP 402/);
  assert.match(failure.message, /discovery_provider_credits/);
  assert.doesNotMatch(failure.details, /account token/i);
});

test("a connection failure has safe retry details", () => {
  const failure = actionFailureFromError({
    action: "feedback",
    stage: "relay-publish",
    error: new Error("Relay connection unavailable for nsec1never-log-this"),
  });

  assert.equal(failure.failureClass, "connection");
  assert.equal(failure.code, "connection_unavailable");
  assert.match(failure.message, /could not reach the relay/i);
  assert.doesNotMatch(failure.details, /nsec/i);
});

test("the desktop log writes only compact safe failure details", () => {
  const originalWarn = console.warn;
  const logged = [];
  console.warn = (message) => logged.push(message);
  try {
    const failure = actionFailureFromError({
      action: "prospect-search",
      stage: "nip98-sign",
      error: new Error("nsec1never-log-this identity signing failed"),
    });
    logActionFailure(failure);
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(logged, [
    "[colony-action-failure] action=prospect-search stage=nip98-sign class=signing status=none code=identity_recovery",
  ]);
});

test("an untrusted embedded failure cannot inject text into the UI or log", () => {
  const secret = "nsec1never-copy-this";
  const failure = actionFailureFromError({
    action: "feedback",
    stage: "feedback-submit",
    error: {
      actionFailure: {
        action: "feedback",
        stage: "relay-publish",
        failureClass: "connection",
        title: secret,
        message: secret,
        details: secret,
        status: null,
        code: null,
      },
    },
  });

  assert.equal(failure.failureClass, "unknown");
  assert.doesNotMatch(failure.message, /nsec/i);
  assert.doesNotMatch(failure.details, /nsec/i);
});

test("a wrapped failure keeps the producer's diagnostic class and details", () => {
  const original = actionFailureFromError({
    action: "feedback",
    stage: "event-sign",
    error: new Error("identity keyring is locked"),
  });
  const failure = actionFailureFromError({
    action: "feedback",
    stage: "feedback-submit",
    error: new ActionFailureError(original),
  });

  assert.equal(failure, original);
  assert.equal(failure.stage, "event-sign");
  assert.equal(failure.failureClass, "signing");
});
