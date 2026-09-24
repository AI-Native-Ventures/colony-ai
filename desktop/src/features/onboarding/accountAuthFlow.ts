export type AccountAuthScreen =
  | "choice"
  | "signup"
  | "signin"
  | "claim"
  | "verify"
  | "reset-request"
  | "reset-confirm"
  | "complete";

export type AccountAuthVerificationPurpose = "verify" | "claim";

export type AccountAuthFailureCode =
  | "invalid_request"
  | "invalid_credentials"
  | "email_unverified"
  | "email_taken"
  | "identity_taken"
  | "code_expired"
  | "weak_password"
  | "rate_limited"
  | "unreachable"
  | "unknown";

export type AccountAuthFailure = {
  code: AccountAuthFailureCode;
  retryAfterSecs?: number;
};

export type AccountAuthFlowState = {
  screen: AccountAuthScreen;
  email: string;
  verificationPurpose?: AccountAuthVerificationPurpose;
  returnScreen?: "signup" | "signin" | "claim";
  notice?: "verification_sent" | "email_unverified" | "reset_requested";
  failure?: AccountAuthFailure;
};

export type AccountAuthFlowAction =
  | { type: "begin_signup" }
  | { type: "begin_signin" }
  | { type: "begin_claim" }
  | { type: "begin_reset" }
  | { type: "set_email"; email: string }
  | { type: "signup_sent"; email: string }
  | { type: "signin_unverified"; email: string }
  | { type: "claim_sent"; email: string }
  | { type: "reset_requested"; email: string }
  | { type: "show_signin" }
  | { type: "back" }
  | { type: "complete" }
  | { type: "set_failure"; failure: AccountAuthFailure }
  | { type: "clear_feedback" };

export function createAccountAuthFlowState(
  mode: "onboarding" | "claim" = "onboarding",
): AccountAuthFlowState {
  return {
    screen: mode === "claim" ? "claim" : "choice",
    email: "",
  };
}

export function accountAuthFlowReducer(
  state: AccountAuthFlowState,
  action: AccountAuthFlowAction,
): AccountAuthFlowState {
  switch (action.type) {
    case "begin_signup":
      return { screen: "signup", email: state.email };
    case "begin_signin":
      return { screen: "signin", email: state.email };
    case "begin_claim":
      return { screen: "claim", email: state.email };
    case "begin_reset":
      return { screen: "reset-request", email: state.email };
    case "set_email":
      return { ...state, email: action.email, failure: undefined };
    case "signup_sent":
      return {
        screen: "verify",
        email: action.email,
        verificationPurpose: "verify",
        returnScreen: "signup",
        notice: "verification_sent",
      };
    case "signin_unverified":
      return {
        screen: "verify",
        email: action.email,
        verificationPurpose: "verify",
        returnScreen: "signin",
        notice: "email_unverified",
      };
    case "claim_sent":
      return {
        screen: "verify",
        email: action.email,
        verificationPurpose: "claim",
        returnScreen: "claim",
        notice: "verification_sent",
      };
    case "reset_requested":
      return {
        screen: "reset-confirm",
        email: action.email,
        notice: "reset_requested",
      };
    case "show_signin":
      return { screen: "signin", email: state.email };
    case "back":
      if (state.screen === "verify") {
        return {
          screen: state.returnScreen ?? "choice",
          email: state.email,
        };
      }
      if (state.screen === "reset-confirm") {
        return { screen: "reset-request", email: state.email };
      }
      if (state.screen === "reset-request") {
        return { screen: "signin", email: state.email };
      }
      return { screen: "choice", email: state.email };
    case "complete":
      return { screen: "complete", email: state.email };
    case "set_failure":
      return { ...state, failure: action.failure };
    case "clear_feedback":
      return { ...state, failure: undefined, notice: undefined };
  }
}

function readErrorField(error: unknown, field: string): unknown {
  if (typeof error !== "object" || error === null) return undefined;
  return (error as Record<string, unknown>)[field];
}

function normalizedFailureCode(raw: unknown): AccountAuthFailureCode {
  switch (raw) {
    case "invalid_request":
    case "invalid_credentials":
    case "email_unverified":
    case "email_taken":
    case "identity_taken":
    case "code_expired":
    case "weak_password":
    case "rate_limited":
      return raw;
    default:
      return "unknown";
  }
}

export function normalizeAccountAuthFailure(
  error: unknown,
): AccountAuthFailure {
  const rawCode =
    readErrorField(error, "code") ??
    readErrorField(error, "error") ??
    readErrorField(error, "kind");
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const code =
    rawCode === "network_error" ||
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("econnrefused") ||
    message.includes("relay unreachable") ||
    message.includes("timeout")
      ? "unreachable"
      : normalizedFailureCode(rawCode);
  const retryAfter =
    readErrorField(error, "retry_after_secs") ??
    readErrorField(error, "retryAfterSecs");

  return {
    code,
    ...(code === "rate_limited" &&
    typeof retryAfter === "number" &&
    Number.isFinite(retryAfter)
      ? { retryAfterSecs: Math.max(0, Math.floor(retryAfter)) }
      : {}),
  };
}

export function accountAuthFailureMessage(
  failure: AccountAuthFailure,
  screen: AccountAuthScreen,
): string {
  switch (failure.code) {
    case "invalid_request":
      return "Please check the information and try again.";
    case "invalid_credentials":
      return screen === "verify" || screen === "reset-confirm"
        ? "That code was not accepted. Check it and try again."
        : "The email or password was not accepted.";
    case "email_unverified":
      return "Check your email for a verification code.";
    case "email_taken":
      return "An account with this email already exists. Sign in instead.";
    case "identity_taken":
      return "This identity is already linked to an account. Sign in instead.";
    case "code_expired":
      return "This code has expired. Request a new one to continue.";
    case "weak_password":
      return "Use a password with at least 10 characters.";
    case "rate_limited":
      return failure.retryAfterSecs && failure.retryAfterSecs > 0
        ? `Too many attempts. Try again in ${failure.retryAfterSecs} seconds.`
        : "Too many attempts. Please try again shortly.";
    case "unreachable":
      return "Can't reach the server right now. Try again later.";
    case "unknown":
      return "Something went wrong. Please try again.";
  }
}
