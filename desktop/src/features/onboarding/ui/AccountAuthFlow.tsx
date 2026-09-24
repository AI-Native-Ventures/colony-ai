import * as React from "react";

import { Button } from "@/shared/ui/button";
import { OnboardingInput } from "./OnboardingInput";
import {
  ONBOARDING_PRIMARY_CTA_CLASS,
  ONBOARDING_SECONDARY_CTA_CLASS,
} from "./OnboardingChrome";
import {
  accountAuthFailureMessage,
  accountAuthFlowReducer,
  createAccountAuthFlowState,
  normalizeAccountAuthFailure,
  type AccountAuthFlowAction,
  type AccountAuthFlowState,
} from "../accountAuthFlow";
import type {
  AccountAuthClient,
  AccountAuthRecord,
} from "../accountAuthClient";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";
import { LandingBees } from "./LandingBees";
import { OnboardingCard } from "./OnboardingCard";
import {
  OnboardingScenePresentation,
  type OnboardingSceneData,
} from "./OnboardingScenePresentation";
import {
  GoogleAccountPresentation,
  type GoogleAccountScene,
} from "./GoogleAccountPresentation";
import type { OnboardingSceneId } from "./onboardingScenes";

const MIN_PASSWORD_LENGTH = 10;
const RESEND_COOLDOWN_SECONDS = 60;

type AccountAuthFlowProps = {
  authClient: AccountAuthClient;
  mode?: "onboarding" | "claim";
  onAdvanced?: () => void;
  onAuthenticated: (account: AccountAuthRecord) => Promise<void> | void;
  onCancel?: () => void;
  standalone?: boolean;
};

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

function clampCooldown(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) {
    return RESEND_COOLDOWN_SECONDS;
  }
  return Math.max(0, Math.floor(value));
}

function useCountdown(request: { seconds: number }) {
  const [remaining, setRemaining] = React.useState(0);

  React.useEffect(() => {
    if (request.seconds <= 0) {
      setRemaining(0);
      return;
    }

    const deadline = Date.now() + request.seconds * 1000;
    setRemaining(request.seconds);
    const timer = window.setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [request]);

  return remaining;
}

function noticeMessage(state: AccountAuthFlowState) {
  switch (state.notice) {
    case "verification_sent":
      return "Check your email for a 6-digit verification code.";
    case "email_unverified":
      return "Your email still needs verification. Enter the code we sent.";
    case "reset_requested":
      return "If an account exists for this email, a reset code is on its way.";
    default:
      return null;
  }
}

function screenTitle(
  state: AccountAuthFlowState,
  mode: "onboarding" | "claim",
) {
  switch (state.screen) {
    case "choice":
      return "Welcome to Buzz";
    case "signup":
      return "Create your account";
    case "signin":
      return "Sign in";
    case "claim":
      return "Add sign-in details";
    case "verify":
      return state.verificationPurpose === "claim"
        ? "Verify your email"
        : "Check your email";
    case "reset-request":
      return "Reset your password";
    case "reset-confirm":
      return "Choose a new password";
    case "complete":
      return mode === "claim" ? "Account connected" : "You're signed in";
  }
}

function failureMessage(
  state: AccountAuthFlowState,
  mode: "onboarding" | "claim",
) {
  if (!state.failure) return null;
  if (mode === "claim" && state.failure.code === "unreachable") {
    return "Account setup is unavailable right now. Your workspace is still ready to use. Try again later.";
  }
  return accountAuthFailureMessage(state.failure, state.screen);
}

function FlowHeading({
  state,
  mode,
  headingRef,
}: {
  state: AccountAuthFlowState;
  mode: "onboarding" | "claim";
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const title = screenTitle(state, mode);
  const description =
    state.screen === "choice"
      ? "Create an account, or sign in to continue."
      : state.screen === "signup"
        ? "Use an email address and a password with at least 10 characters."
        : state.screen === "claim"
          ? "Add sign-in details so you can return to this identity."
          : state.screen === "signin"
            ? "Use the email address and password for your account."
            : state.screen === "verify"
              ? `Enter the 6-digit code sent to ${state.email}.`
              : state.screen === "reset-request"
                ? "We'll send a reset code if an account exists for that email."
                : state.screen === "reset-confirm"
                  ? "Enter the code from your email and choose a new password."
                  : state.screen === "complete"
                    ? "Your account is ready."
                    : "";

  return (
    <div className="w-full text-left">
      <h1
        className="text-title font-normal text-foreground"
        id="account-auth-title"
        ref={headingRef}
        tabIndex={-1}
      >
        {title}
      </h1>
      {description ? (
        <p className="mt-2 text-base leading-6 text-foreground/75">
          {description}
        </p>
      ) : null}
    </div>
  );
}

export function AccountAuthFlow({
  authClient,
  mode = "onboarding",
  onAdvanced,
  onAuthenticated,
  onCancel,
  standalone = false,
}: AccountAuthFlowProps) {
  const [state, dispatch] = React.useReducer(
    accountAuthFlowReducer,
    mode,
    createAccountAuthFlowState,
  );
  const [password, setPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const [googleScene, setGoogleScene] =
    React.useState<GoogleAccountScene | null>(null);
  const [pending, setPending] = React.useState(false);
  const [cooldownRequest, setCooldownRequest] = React.useState({
    seconds: 0,
  });
  const resendCooldown = useCountdown(cooldownRequest);
  const requestCooldown = React.useCallback((seconds: number) => {
    setCooldownRequest({ seconds });
  }, []);
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  // Clear credentials and restore heading focus whenever the view changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: screen changes intentionally reset this form state.
  React.useEffect(() => {
    headingRef.current?.focus();
    setPassword("");
    setNewPassword("");
    setCode("");
  }, [state.screen]);

  const send = React.useCallback(
    async (action: () => Promise<void>) => {
      if (pending) return;
      setPending(true);
      dispatch({ type: "clear_feedback" });
      try {
        await action();
      } catch (error) {
        const failure = normalizeAccountAuthFailure(error);
        if (failure.code === "rate_limited") {
          requestCooldown(clampCooldown(failure.retryAfterSecs));
        }
        dispatch({ type: "set_failure", failure });
      } finally {
        setPending(false);
      }
    },
    [pending, requestCooldown],
  );

  const authenticate = React.useCallback(
    async (account: AccountAuthRecord) => {
      try {
        await onAuthenticated(account);
        dispatch({ type: "complete" });
      } catch (error) {
        dispatch({
          type: "set_failure",
          failure: normalizeAccountAuthFailure(error),
        });
      }
    },
    [onAuthenticated],
  );

  const submitSignup = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = normalizedEmail(state.email);
    void send(async () => {
      await authClient.signUp(email, password);
      setPassword("");
      requestCooldown(RESEND_COOLDOWN_SECONDS);
      dispatch({ type: "signup_sent", email });
    });
  };

  const submitSignin = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = normalizedEmail(state.email);
    void send(async () => {
      try {
        await authenticate(await authClient.signIn(email, password));
      } catch (error) {
        const failure = normalizeAccountAuthFailure(error);
        if (failure.code === "email_unverified") {
          setPassword("");
          requestCooldown(RESEND_COOLDOWN_SECONDS);
          dispatch({ type: "signin_unverified", email });
          return;
        }
        throw error;
      }
    });
  };

  const submitClaim = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = normalizedEmail(state.email);
    void send(async () => {
      await authClient.claimAccount(email, password);
      setPassword("");
      requestCooldown(RESEND_COOLDOWN_SECONDS);
      dispatch({ type: "claim_sent", email });
    });
  };

  const submitVerify = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = normalizedEmail(state.email);
    void send(async () => {
      await authenticate(await authClient.verifyEmail(email, code));
    });
  };

  const submitResetRequest = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = normalizedEmail(state.email);
    void send(async () => {
      await authClient.requestReset(email);
      requestCooldown(RESEND_COOLDOWN_SECONDS);
      dispatch({ type: "reset_requested", email });
    });
  };

  const submitResetConfirm = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const email = normalizedEmail(state.email);
    void send(async () => {
      await authenticate(
        await authClient.confirmReset(email, code, newPassword),
      );
    });
  };

  const submitGoogle = () => {
    if (pending) return;
    setPending(true);
    setGoogleScene("loading");
    dispatch({ type: "clear_feedback" });
    void (async () => {
      try {
        const account = await authClient.signInWithGoogle();
        setGoogleScene(null);
        await authenticate(account);
      } catch (error) {
        const failure = normalizeAccountAuthFailure(error);
        if (failure.code === "email_unverified") {
          setGoogleScene("unverified");
        } else if (
          failure.code === "email_taken" ||
          failure.code === "identity_taken"
        ) {
          setGoogleScene("password-account");
        } else {
          setGoogleScene(null);
          dispatch({ type: "set_failure", failure });
        }
      } finally {
        setPending(false);
      }
    })();
  };

  const resendCode = () => {
    if (resendCooldown > 0 || pending) return;
    const purpose = state.screen === "reset-confirm" ? "reset" : "verify";
    void send(async () => {
      await authClient.resendCode(normalizedEmail(state.email), purpose);
      requestCooldown(RESEND_COOLDOWN_SECONDS);
      dispatch({ type: "clear_feedback" });
    });
  };

  const dispatchAndClear = (action: AccountAuthFlowAction) => {
    dispatch({ type: "clear_feedback" });
    dispatch(action);
  };

  const isPasswordShort =
    (state.screen === "signup" || state.screen === "claim") &&
    password.length > 0 &&
    password.length < MIN_PASSWORD_LENGTH;
  const isNewPasswordShort =
    state.screen === "reset-confirm" &&
    newPassword.length > 0 &&
    newPassword.length < MIN_PASSWORD_LENGTH;
  const failureText = failureMessage(state, mode);
  const showSignInRecovery =
    state.failure?.code === "email_taken" ||
    state.failure?.code === "identity_taken";
  const rateLimitLocked =
    state.failure?.code === "rate_limited" && resendCooldown > 0;
  const waitLabel = rateLimitLocked ? `Try again in ${resendCooldown}s` : null;

  if (
    standalone &&
    mode === "onboarding" &&
    !(state.screen === "signup" && state.failure?.code === "email_taken") &&
    (state.screen === "choice" ||
      state.screen === "signup" ||
      state.screen === "signin")
  ) {
    const scene =
      googleScene ?? (state.screen === "signup" ? "sign-up" : "sign-in");
    const submit = state.screen === "signup" ? submitSignup : submitSignin;

    return (
      <GoogleAccountPresentation
        email={state.email}
        error={googleScene ? null : failureText}
        name={name}
        onEmailChange={(email) =>
          dispatchAndClear({ type: "set_email", email })
        }
        onGoogleSignIn={submitGoogle}
        onNameChange={setName}
        onNavigate={(destination) => {
          setGoogleScene(null);
          if (destination === "sign-up") {
            dispatchAndClear({ type: "begin_signup" });
          } else if (destination === "sign-in") {
            dispatchAndClear({ type: "show_signin" });
          } else {
            dispatchAndClear({ type: "begin_reset" });
          }
        }}
        onPasswordChange={setPassword}
        onSubmit={submit}
        password={password}
        scene={scene}
      />
    );
  }

  const legacyContent = (
    <section
      aria-labelledby="account-auth-title"
      className="mx-auto flex w-full max-w-[440px] flex-col items-stretch gap-6"
      data-testid={`account-auth-screen-${state.screen}`}
    >
      <FlowHeading headingRef={headingRef} mode={mode} state={state} />

      {noticeMessage(state) ? (
        <p
          aria-live="polite"
          className="rounded-lg border border-border/70 bg-muted/40 px-4 py-3 text-sm text-foreground"
          role="status"
        >
          {noticeMessage(state)}
        </p>
      ) : null}

      {failureText ? (
        <div
          aria-live="assertive"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          role="alert"
        >
          {failureText}
          {state.failure?.code === "rate_limited" && resendCooldown > 0 ? (
            <span className="sr-only">
              {" "}
              Retry available in {resendCooldown} seconds.
            </span>
          ) : null}
        </div>
      ) : null}

      {showSignInRecovery ? (
        <Button
          className={ONBOARDING_SECONDARY_CTA_CLASS}
          onClick={() => dispatchAndClear({ type: "show_signin" })}
          type="button"
          variant="ghost"
        >
          Go to sign in
        </Button>
      ) : null}

      {state.screen === "choice" ? (
        <div className="flex flex-col gap-3">
          <Button
            className={ONBOARDING_PRIMARY_CTA_CLASS}
            data-testid="account-auth-create"
            onClick={() => dispatchAndClear({ type: "begin_signup" })}
            type="button"
          >
            Create account
          </Button>
          <Button
            className={ONBOARDING_SECONDARY_CTA_CLASS}
            data-testid="account-auth-google"
            disabled={pending || rateLimitLocked}
            onClick={submitGoogle}
            type="button"
            variant="outline"
          >
            {pending ? "Connecting…" : (waitLabel ?? "Continue with Google")}
          </Button>
          <Button
            className={ONBOARDING_SECONDARY_CTA_CLASS}
            data-testid="account-auth-signin"
            onClick={() => dispatchAndClear({ type: "begin_signin" })}
            type="button"
            variant="ghost"
          >
            Sign in
          </Button>
          <button
            className="self-center rounded-sm px-2 py-1 text-sm text-muted-foreground underline decoration-muted-foreground/50 underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid="account-auth-advanced"
            onClick={onAdvanced}
            type="button"
          >
            Advanced: use an existing Nostr identity
          </button>
        </div>
      ) : null}

      {state.screen === "signup" ||
      state.screen === "signin" ||
      state.screen === "claim" ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={
            state.screen === "signup"
              ? submitSignup
              : state.screen === "claim"
                ? submitClaim
                : submitSignin
          }
        >
          <div className="flex flex-col gap-2">
            <label
              className="text-sm font-medium text-foreground"
              htmlFor="account-auth-email"
            >
              Email
            </label>
            <OnboardingInput
              autoComplete="email"
              autoFocus
              id="account-auth-email"
              name="email"
              onChange={(event) =>
                dispatchAndClear({
                  type: "set_email",
                  email: event.target.value,
                })
              }
              required
              type="email"
              value={state.email}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label
              className="text-sm font-medium text-foreground"
              htmlFor="account-auth-password"
            >
              Password
              {state.screen === "signup" || state.screen === "claim"
                ? " (at least 10 characters)"
                : ""}
            </label>
            <OnboardingInput
              autoComplete={
                state.screen === "signin" ? "current-password" : "new-password"
              }
              id="account-auth-password"
              minLength={
                state.screen === "signin" ? undefined : MIN_PASSWORD_LENGTH
              }
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
            {isPasswordShort ? (
              <p
                className="text-sm text-destructive"
                data-testid="account-auth-password-issue"
              >
                Use at least 10 characters.
              </p>
            ) : null}
          </div>

          {state.screen === "signin" ? (
            <button
              className="self-start rounded-sm text-sm text-muted-foreground underline decoration-muted-foreground/50 underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              onClick={() => dispatchAndClear({ type: "begin_reset" })}
              type="button"
            >
              Forgot password?
            </button>
          ) : null}

          <Button
            className={ONBOARDING_PRIMARY_CTA_CLASS}
            data-testid={`account-auth-submit-${state.screen}`}
            disabled={pending || isPasswordShort || rateLimitLocked}
            type="submit"
          >
            {pending
              ? "Please wait…"
              : (waitLabel ??
                (state.screen === "signup"
                  ? "Create account"
                  : state.screen === "claim"
                    ? "Continue"
                    : "Sign in"))}
          </Button>
          <Button
            className={ONBOARDING_SECONDARY_CTA_CLASS}
            disabled={pending}
            onClick={() => {
              if (mode === "claim") {
                onCancel?.();
                return;
              }
              dispatchAndClear({ type: "back" });
            }}
            type="button"
            variant="ghost"
          >
            {mode === "claim" ? "Later" : "Back"}
          </Button>
        </form>
      ) : null}

      {state.screen === "verify" ? (
        <form className="flex flex-col gap-4" onSubmit={submitVerify}>
          <div className="flex flex-col gap-2">
            <label
              className="text-sm font-medium text-foreground"
              htmlFor="account-auth-code"
            >
              6-digit code
            </label>
            <OnboardingInput
              autoComplete="one-time-code"
              autoFocus
              id="account-auth-code"
              inputMode="numeric"
              maxLength={6}
              name="code"
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              pattern="[0-9]{6}"
              required
              value={code}
            />
          </div>
          <Button
            className={ONBOARDING_PRIMARY_CTA_CLASS}
            data-testid="account-auth-verify"
            disabled={pending || code.length !== 6}
            type="submit"
          >
            {pending ? "Checking…" : "Verify email"}
          </Button>
          <Button
            className={ONBOARDING_SECONDARY_CTA_CLASS}
            disabled={pending || resendCooldown > 0}
            onClick={resendCode}
            type="button"
            variant="ghost"
          >
            {resendCooldown > 0
              ? `Resend code in ${resendCooldown}s`
              : "Resend code"}
          </Button>
          {mode === "onboarding" ? (
            <Button
              className={ONBOARDING_SECONDARY_CTA_CLASS}
              disabled={pending}
              onClick={() => dispatchAndClear({ type: "back" })}
              type="button"
              variant="ghost"
            >
              Back
            </Button>
          ) : (
            <Button
              className={ONBOARDING_SECONDARY_CTA_CLASS}
              disabled={pending}
              onClick={() => onCancel?.()}
              type="button"
              variant="ghost"
            >
              Later
            </Button>
          )}
        </form>
      ) : null}

      {state.screen === "reset-request" ? (
        <form className="flex flex-col gap-4" onSubmit={submitResetRequest}>
          <div className="flex flex-col gap-2">
            <label
              className="text-sm font-medium text-foreground"
              htmlFor="account-reset-email"
            >
              Email
            </label>
            <OnboardingInput
              autoComplete="email"
              autoFocus
              id="account-reset-email"
              name="email"
              onChange={(event) =>
                dispatchAndClear({
                  type: "set_email",
                  email: event.target.value,
                })
              }
              required
              type="email"
              value={state.email}
            />
          </div>
          <Button
            className={ONBOARDING_PRIMARY_CTA_CLASS}
            disabled={pending || rateLimitLocked}
            type="submit"
          >
            {pending ? "Sending…" : (waitLabel ?? "Send reset code")}
          </Button>
          <Button
            className={ONBOARDING_SECONDARY_CTA_CLASS}
            disabled={pending}
            onClick={() => dispatchAndClear({ type: "back" })}
            type="button"
            variant="ghost"
          >
            Back
          </Button>
        </form>
      ) : null}

      {state.screen === "reset-confirm" ? (
        <form className="flex flex-col gap-4" onSubmit={submitResetConfirm}>
          <div className="flex flex-col gap-2">
            <label
              className="text-sm font-medium text-foreground"
              htmlFor="account-reset-code"
            >
              6-digit code
            </label>
            <OnboardingInput
              autoComplete="one-time-code"
              autoFocus
              id="account-reset-code"
              inputMode="numeric"
              maxLength={6}
              name="code"
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              pattern="[0-9]{6}"
              required
              value={code}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label
              className="text-sm font-medium text-foreground"
              htmlFor="account-reset-password"
            >
              New password (at least 10 characters)
            </label>
            <OnboardingInput
              autoComplete="new-password"
              id="account-reset-password"
              minLength={MIN_PASSWORD_LENGTH}
              name="new-password"
              onChange={(event) => setNewPassword(event.target.value)}
              required
              type="password"
              value={newPassword}
            />
            {isNewPasswordShort ? (
              <p
                className="text-sm text-destructive"
                data-testid="account-auth-password-issue"
              >
                Use at least 10 characters.
              </p>
            ) : null}
          </div>
          <Button
            className={ONBOARDING_PRIMARY_CTA_CLASS}
            data-testid="account-auth-reset-confirm"
            disabled={
              pending ||
              code.length !== 6 ||
              isNewPasswordShort ||
              rateLimitLocked
            }
            type="submit"
          >
            {pending ? "Updating…" : (waitLabel ?? "Set new password")}
          </Button>
          <Button
            className={ONBOARDING_SECONDARY_CTA_CLASS}
            disabled={pending || resendCooldown > 0}
            onClick={resendCode}
            type="button"
            variant="ghost"
          >
            {resendCooldown > 0
              ? `Resend code in ${resendCooldown}s`
              : "Resend code"}
          </Button>
          <Button
            className={ONBOARDING_SECONDARY_CTA_CLASS}
            disabled={pending}
            onClick={() => dispatchAndClear({ type: "back" })}
            type="button"
            variant="ghost"
          >
            Back
          </Button>
        </form>
      ) : null}

      {state.screen === "complete" ? (
        <p
          aria-live="polite"
          className="text-sm text-muted-foreground"
          role="status"
        >
          Continue setup to open your workspace.
        </p>
      ) : null}
    </section>
  );

  const designedScene =
    state.screen === "signup"
      ? state.failure?.code === "email_taken"
        ? "account-error"
        : "account"
      : state.screen === "signin"
        ? "signin"
        : state.screen === "reset-request"
          ? "forgot"
          : null;

  if (standalone && mode === "onboarding" && designedScene) {
    const data: OnboardingSceneData = {
      name,
      email: state.email,
      business: "",
      website: "",
      description: "",
      pending,
    };
    const navigate = (scene: OnboardingSceneId) => {
      if (scene === "account") dispatchAndClear({ type: "begin_signup" });
      else if (scene === "signin") dispatchAndClear({ type: "show_signin" });
      else if (scene === "forgot") dispatchAndClear({ type: "begin_reset" });
    };
    const submit =
      state.screen === "signup"
        ? submitSignup
        : state.screen === "signin"
          ? submitSignin
          : submitResetRequest;

    return (
      <div
        className="colony-onboarding-auth-root"
        data-testid="machine-onboarding-gate"
      >
        <div data-testid={`account-auth-screen-${state.screen}`}>
          <StartupWindowDragRegion />
          <OnboardingScenePresentation
            data={data}
            error={failureText}
            onEmailChange={(email) =>
              dispatchAndClear({ type: "set_email", email })
            }
            onNameChange={setName}
            onNavigate={navigate}
            onPasswordChange={setPassword}
            onSubmit={submit}
            scene={designedScene}
          />
        </div>
      </div>
    );
  }

  if (standalone && mode === "onboarding") {
    return (
      <div
        className="buzz-onboarding-neutral-theme buzz-startup-shell buzz-onboarding-welcome flex max-h-dvh items-start justify-center overflow-x-hidden overflow-y-auto px-4 py-8 text-foreground"
        data-testid="machine-onboarding-gate"
      >
        <StartupWindowDragRegion />
        <LandingBees />
        <OnboardingCard current={1} testId="machine-onboarding-card">
          {legacyContent}
        </OnboardingCard>
      </div>
    );
  }

  return legacyContent;
}
