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
  assert.equal(
    failure.message,
    "The prospect search provider has no credits left. The server owner needs to top up Outscraper.",
  );
  assert.doesNotMatch(failure.message, /HTTP 402|discovery_provider_credits/);
  assert.doesNotMatch(failure.details, /account token/i);
});

test("allowlisted Discovery codes retain their specific safe recovery guidance", () => {
  const search = actionFailureFromError({
    action: "prospect-search",
    stage: "relay-response",
    error: Object.assign(new Error("untrusted provider text"), {
      code: "discovery_not_configured",
      status: 503,
    }),
  });
  const sales = actionFailureFromError({
    action: "prospect-search",
    stage: "campaign-start",
    error: new Error("untrusted channel text"),
    code: "sales_channel_not_allowed",
  });

  assert.equal(
    search.message,
    "Prospect search is not set up on this server yet. The server owner needs to add the Outscraper key.",
  );
  assert.equal(
    sales.message,
    "The private Sales channel is not set up yet. An owner or admin of this business sets it up by opening Leads once. Ask one of them, then retry.",
  );
  assert.doesNotMatch(search.message, /untrusted/i);
  assert.doesNotMatch(sales.message, /untrusted/i);
});

test("a monthly Discovery limit keeps its reset date in plain customer copy", () => {
  const dated = actionFailureFromError({
    action: "prospect-search",
    stage: "relay-response",
    error: Object.assign(new Error("untrusted relay text"), {
      code: "monthly_limit",
      status: 429,
      resets_at: "2026-12-01T00:00:00Z",
    }),
  });
  const undated = actionFailureFromError({
    action: "prospect-search",
    stage: "relay-response",
    error: Object.assign(new Error("untrusted relay text"), {
      code: "monthly_limit",
      status: 429,
    }),
  });

  assert.equal(
    dated.message,
    "You have used this month’s prospect searches. They reset on 2026-12-01.",
  );
  assert.equal(dated.resetDate, "2026-12-01");
  assert.match(dated.details, /reset_date=2026-12-01/);
  assert.equal(
    undated.message,
    "You have used this month’s prospect searches. They reset at the start of next month.",
  );
  assert.equal(undated.resetDate, null);
  assert.doesNotMatch(dated.message, /relay returned|untrusted/i);
  assert.doesNotMatch(undated.message, /relay returned|untrusted/i);
});

test("known Discovery error codes never expose raw relay code copy", () => {
  const expectedMessages = new Map([
    [
      "relay_membership_required",
      "Join this community to search for prospects.",
    ],
    [
      "discovery_unsupported",
      "This server does not support prospect search yet. The server owner needs to update it.",
    ],
    [
      "discovery_provider_auth",
      "The prospect search provider rejected the server key. The server owner should check the Outscraper key.",
    ],
    [
      "discovery_provider_busy",
      "The prospect search provider is busy. Try again in a minute.",
    ],
    [
      "discovery_provider_unavailable",
      "The prospect search provider did not answer. Try again.",
    ],
    [
      "discovery_usage_unavailable",
      "Prospect search could not check this month’s usage. Try again.",
    ],
  ]);

  for (const [code, message] of expectedMessages) {
    const failure = actionFailureFromError({
      action: "prospect-search",
      stage: "relay-response",
      error: Object.assign(new Error("untrusted relay text"), {
        code,
        status: 503,
      }),
    });

    assert.equal(failure.message, message);
    assert.doesNotMatch(failure.message, /relay returned|untrusted/i);
    assert.doesNotMatch(failure.message, new RegExp(code));
  }
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
    "[colony-action-failure] action=prospect-search stage=nip98-sign class=signing status=none code=identity_recovery reset_date=none",
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
