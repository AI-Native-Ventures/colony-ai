import assert from "node:assert/strict";
import test from "node:test";

import {
  accountAuthFailureMessage,
  accountAuthFlowReducer,
  createAccountAuthFlowState,
  normalizeAccountAuthFailure,
} from "./accountAuthFlow.ts";

test("account onboarding reducer covers signup and verified sign in", () => {
  let state = createAccountAuthFlowState();
  assert.equal(state.screen, "choice");

  state = accountAuthFlowReducer(state, { type: "begin_signup" });
  assert.equal(state.screen, "signup");

  state = accountAuthFlowReducer(state, {
    type: "signup_sent",
    email: "person@example.com",
  });
  assert.deepEqual(
    {
      screen: state.screen,
      email: state.email,
      purpose: state.verificationPurpose,
      returnScreen: state.returnScreen,
    },
    {
      screen: "verify",
      email: "person@example.com",
      purpose: "verify",
      returnScreen: "signup",
    },
  );
  state = accountAuthFlowReducer(state, { type: "complete" });
  assert.equal(state.screen, "complete");

  state = accountAuthFlowReducer(createAccountAuthFlowState(), {
    type: "begin_signin",
  });
  state = accountAuthFlowReducer(state, {
    type: "signin_unverified",
    email: "person@example.com",
  });
  assert.equal(state.screen, "verify");
  assert.equal(state.notice, "email_unverified");
  assert.equal(state.returnScreen, "signin");
});

test("claim and password reset transitions retain the submitted email", () => {
  let claim = createAccountAuthFlowState("claim");
  assert.equal(claim.screen, "claim");
  claim = accountAuthFlowReducer(claim, {
    type: "claim_sent",
    email: "claim@example.com",
  });
  assert.equal(claim.screen, "verify");
  assert.equal(claim.verificationPurpose, "claim");
  assert.deepEqual(accountAuthFlowReducer(claim, { type: "back" }), {
    screen: "claim",
    email: "claim@example.com",
  });

  let reset = accountAuthFlowReducer(createAccountAuthFlowState(), {
    type: "begin_signin",
  });
  reset = accountAuthFlowReducer(reset, { type: "begin_reset" });
  assert.equal(reset.screen, "reset-request");
  reset = accountAuthFlowReducer(reset, {
    type: "reset_requested",
    email: "reset@example.com",
  });
  assert.equal(reset.screen, "reset-confirm");
  reset = accountAuthFlowReducer(reset, { type: "begin_reset_password" });
  assert.equal(reset.screen, "reset-password");
  reset = accountAuthFlowReducer(reset, { type: "back" });
  assert.equal(reset.screen, "reset-confirm");
  reset = accountAuthFlowReducer(reset, { type: "change_email" });
  assert.equal(reset.screen, "reset-change-email");
  reset = accountAuthFlowReducer(reset, {
    type: "code_resent",
    email: "new@example.com",
  });
  assert.equal(reset.screen, "reset-confirm");
  assert.equal(reset.email, "new@example.com");
  assert.equal(reset.notice, "code_resent");
  assert.deepEqual(accountAuthFlowReducer(reset, { type: "back" }), {
    screen: "reset-request",
    email: "new@example.com",
  });
});

test("back navigation returns each screen to its originating form", () => {
  const cases = [
    ["signup", "choice"],
    ["signin", "choice"],
    ["claim", "choice"],
    ["reset-request", "signin"],
  ];

  for (const [screen, expected] of cases) {
    const state = { screen, email: "person@example.com" };
    assert.equal(
      accountAuthFlowReducer(state, { type: "back" }).screen,
      expected,
    );
  }

  for (const returnScreen of ["signup", "signin", "claim"]) {
    const state = {
      screen: "verify",
      email: "person@example.com",
      returnScreen,
    };
    assert.equal(
      accountAuthFlowReducer(state, { type: "back" }).screen,
      returnScreen,
    );
  }
});

test("contract errors normalize snake case retry windows and network failures", () => {
  assert.deepEqual(
    normalizeAccountAuthFailure({
      error: "rate_limited",
      retry_after_secs: 9.8,
    }),
    { code: "rate_limited", retryAfterSecs: 9 },
  );
  assert.deepEqual(normalizeAccountAuthFailure({ code: "weak_password" }), {
    code: "weak_password",
  });
  assert.deepEqual(normalizeAccountAuthFailure(new Error("Failed to fetch")), {
    code: "unreachable",
  });
  assert.deepEqual(normalizeAccountAuthFailure({ code: "network_error" }), {
    code: "unreachable",
  });
  assert.deepEqual(
    normalizeAccountAuthFailure({
      code: "invalid_credentials",
      remainingAttempts: 2.9,
    }),
    { code: "invalid_credentials", remainingAttempts: 2 },
  );
  assert.deepEqual(
    normalizeAccountAuthFailure({
      error: "invalid_credentials",
      remaining_attempts: 1,
    }),
    { code: "invalid_credentials", remainingAttempts: 1 },
  );
});

test("every contract error has screen-appropriate feedback", () => {
  const expected = new Map([
    ["invalid_request", "Please check the information and try again."],
    ["invalid_credentials", "The email or password was not accepted."],
    ["email_unverified", "Check your email for a verification code."],
    [
      "email_taken",
      "An account with this email already exists. Sign in instead.",
    ],
    [
      "identity_taken",
      "This identity is already linked to an account. Sign in instead.",
    ],
    ["code_expired", "This code has expired. Request a new one to continue."],
    ["weak_password", "Use a password with at least 10 characters."],
    ["rate_limited", "Too many attempts. Try again in 4 seconds."],
    ["unreachable", "Can't reach the server right now. Try again later."],
    ["unknown", "Something went wrong. Please try again."],
  ]);

  for (const [code, message] of expected) {
    const failure = {
      code,
      ...(code === "rate_limited" ? { retryAfterSecs: 4 } : {}),
    };
    assert.equal(accountAuthFailureMessage(failure, "signup"), message);
  }

  assert.equal(
    accountAuthFailureMessage({ code: "invalid_credentials" }, "verify"),
    "That code was not accepted. Check it and try again.",
  );
});
