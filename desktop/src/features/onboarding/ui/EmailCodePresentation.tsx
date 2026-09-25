import * as React from "react";

import type { PresentationProps } from "./OnboardingSceneTypes";
import type { OnboardingSceneId } from "./onboardingScenes";
import "./emailCodePresentation.css";

type CodePurpose = "verify" | "reset";
type CodeView =
  | "request"
  | "entry"
  | "wrong"
  | "verifying"
  | "expired"
  | "locked"
  | "resent"
  | "network"
  | "change-email"
  | "password"
  | "success";

type CodeRoute = { purpose: CodePurpose; view: CodeView };
const digitLabels = [
  "Digit 1 of 6",
  "Digit 2 of 6",
  "Digit 3 of 6",
  "Digit 4 of 6",
  "Digit 5 of 6",
  "Digit 6 of 6",
] as const;

const routeMap: Partial<Record<OnboardingSceneId, CodeRoute>> = {
  forgot: { purpose: "reset", view: "request" },
  "email-sent": { purpose: "reset", view: "entry" },
  "new-password": { purpose: "reset", view: "password" },
  "reset-done": { purpose: "reset", view: "success" },
  "reset-expired": { purpose: "reset", view: "expired" },
  verify: { purpose: "verify", view: "entry" },
  "verify-error": { purpose: "verify", view: "wrong" },
  "verify-verifying": { purpose: "verify", view: "verifying" },
  "verify-expired": { purpose: "verify", view: "expired" },
  "verify-locked": { purpose: "verify", view: "locked" },
  "verify-resent": { purpose: "verify", view: "resent" },
  "verify-network": { purpose: "verify", view: "network" },
  "verify-change-email": { purpose: "verify", view: "change-email" },
  "verify-done": { purpose: "verify", view: "success" },
  "reset-verifying": { purpose: "reset", view: "verifying" },
  "reset-error": { purpose: "reset", view: "wrong" },
  "reset-locked": { purpose: "reset", view: "locked" },
  "reset-resent": { purpose: "reset", view: "resent" },
  "reset-network": { purpose: "reset", view: "network" },
  "reset-change-email": { purpose: "reset", view: "change-email" },
};

export function isEmailCodeScene(scene: OnboardingSceneId): boolean {
  return routeMap[scene] !== undefined;
}

function fixtureCode(scene: OnboardingSceneId, visualOnly?: boolean) {
  if (!visualOnly) return "";
  return scene.endsWith("-network") || scene.endsWith("-verifying")
    ? "123456"
    : "";
}

function fixtureCountdown(view: CodeView, visualOnly?: boolean) {
  if (!visualOnly) return 0;
  if (view === "locked") return 60;
  if (
    view === "entry" ||
    view === "wrong" ||
    view === "resent" ||
    view === "network" ||
    view === "verifying"
  )
    return 30;
  return 0;
}

function useCountdown(seconds: number) {
  const [remaining, setRemaining] = React.useState(seconds);
  React.useEffect(() => {
    setRemaining(seconds);
    if (seconds <= 0) return;
    const endsAt = Date.now() + seconds * 1000;
    const timer = window.setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [seconds]);
  return remaining;
}

function initialViewCode(view: CodeView, visualOnly: boolean) {
  return view === "network" || view === "verifying"
    ? fixtureCode(
        view === "network" ? "verify-network" : "verify-verifying",
        visualOnly,
      )
    : "";
}

function CodeFields({
  code,
  disabled,
  invalid,
  purpose,
  onChange,
}: {
  code: string;
  disabled: boolean;
  invalid: boolean;
  purpose: CodePurpose;
  onChange: (value: string) => void;
}) {
  const fields = React.useRef<Array<HTMLInputElement | null>>([]);
  const groupLabel =
    purpose === "reset"
      ? "Six-digit password reset code"
      : "Six-digit email verification code";
  const setDigit = (index: number, value: string) => {
    const next = code.padEnd(6, " ").split("");
    next[index] = value.slice(-1);
    onChange(next.join("").replace(/\s/g, ""));
  };

  return (
    <fieldset className="otp-fields" disabled={disabled}>
      <legend className="otp-sr">{groupLabel}</legend>
      {digitLabels.map((label, index) => (
        <input
          aria-describedby="otp-entry-help"
          aria-invalid={invalid || undefined}
          aria-label={label}
          autoComplete={index === 0 ? "one-time-code" : "off"}
          inputMode="numeric"
          key={label}
          maxLength={1}
          onChange={(event) => {
            const digits = event.currentTarget.value.replace(/\D/g, "");
            if (digits.length > 1) {
              onChange(digits.slice(0, 6));
              fields.current[Math.min(digits.length, 5)]?.focus();
              return;
            }
            setDigit(index, digits);
            if (digits && index < 5) fields.current[index + 1]?.focus();
          }}
          onKeyDown={(event) => {
            if (event.key === "Backspace" && !code[index] && index > 0) {
              event.preventDefault();
              setDigit(index - 1, "");
              fields.current[index - 1]?.focus();
            } else if (
              event.key === "ArrowLeft" ||
              event.key === "ArrowRight"
            ) {
              event.preventDefault();
              const direction = event.key === "ArrowLeft" ? -1 : 1;
              fields.current[
                Math.max(0, Math.min(5, index + direction))
              ]?.focus();
            }
          }}
          onPaste={(event) => {
            const digits = event.clipboardData
              .getData("text")
              .replace(/\D/g, "")
              .slice(0, 6);
            if (!digits) return;
            event.preventDefault();
            onChange(digits);
            fields.current[Math.min(digits.length, 5)]?.focus();
          }}
          pattern="[0-9]"
          ref={(node) => {
            fields.current[index] = node;
          }}
          type="text"
          value={code[index] ?? ""}
        />
      ))}
    </fieldset>
  );
}

function EmailCodeBody(props: PresentationProps) {
  const route = routeMap[props.scene] ?? { purpose: "verify", view: "entry" };
  const { purpose, view } = route;
  const isReset = purpose === "reset";
  const code =
    props.authCode?.value ?? initialViewCode(view, !!props.data.visualOnly);
  const [localCode, setLocalCode] = React.useState(code);
  const codeValue = props.authCode?.value ?? localCode;
  const onCodeChange = props.authCode?.onCodeChange ?? setLocalCode;
  const fixtureRemaining = useCountdown(
    fixtureCountdown(view, props.data.visualOnly),
  );
  const remaining = props.authCode
    ? (props.authCode.cooldownSecs ?? 0)
    : fixtureRemaining;
  const pending = props.authCode?.pending ?? props.pending ?? false;
  const locked = view === "locked";
  const expired = view === "expired";
  const disabled = pending || locked || expired;
  const attempts =
    props.authCode?.attemptsLeft ??
    (props.data.visualOnly && view === "wrong" ? 2 : undefined);
  const emailValue = props.data.visualOnly
    ? props.data.email || "lerato@example.com"
    : props.data.email;
  const [localEmail, setLocalEmail] = React.useState(emailValue);
  const [showPasswords, setShowPasswords] = React.useState(false);
  const [password, setPassword] = React.useState("");
  const [confirmation, setConfirmation] = React.useState("");
  const email = props.data.visualOnly ? emailValue : localEmail;

  const setEmail = (value: string) => {
    setLocalEmail(value);
    props.onEmailChange?.(value);
  };
  const routeSubmit =
    view === "request" || view === "change-email"
      ? props.onSubmit
      : view === "password"
        ? (props.authCode?.onPasswordSubmit ?? props.onSubmit)
        : (props.authCode?.onCodeSubmit ?? props.onSubmit);
  const error = props.authCode?.error || props.error;

  if (view === "request" || view === "change-email") {
    const changing = view === "change-email";
    return (
      <div className="otp-content" data-otp-state={view}>
        <h2 id="account-auth-title" ref={props.headingRef} tabIndex={-1}>
          {changing ? "Change email" : "Forgot your password?"}
        </h2>
        <p className="otp-lede">
          {changing
            ? "We’ll send a new code to this address. The previous code won’t be used here."
            : "We’ll email you a six-digit code to set a new one."}
        </p>
        <form id="email-code-form" onSubmit={routeSubmit}>
          <label className="otp-field" htmlFor="otp-email">
            Email address
            <input
              autoComplete="email"
              id="otp-email"
              onChange={(event) => setEmail(event.currentTarget.value)}
              required
              type="email"
              value={email}
            />
          </label>
          {error ? (
            <p className="otp-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="otp-actions">
            <button
              className="otp-button otp-primary"
              disabled={pending}
              type="submit"
            >
              {pending ? "Sending…" : "Send code"}
            </button>
            <button
              className="otp-button otp-text"
              disabled={pending}
              onClick={() => props.onNavigate?.("signin")}
              type="button"
            >
              Back to sign in
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (view === "password") {
    return (
      <div className="otp-content" data-otp-state={view}>
        <h2 id="account-auth-title" ref={props.headingRef} tabIndex={-1}>
          Choose a new password
        </h2>
        <p className="otp-lede">
          Your email is verified.
          <br />
          <strong>{email}</strong>
        </p>
        <form id="email-code-form" onSubmit={routeSubmit}>
          <label className="otp-field" htmlFor="otp-password">
            New password
            <input
              autoComplete="new-password"
              id="otp-password"
              minLength={props.data.visualOnly ? 8 : 10}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (props.authCode?.onNewPasswordChange) {
                  props.authCode.onNewPasswordChange(value);
                } else {
                  setPassword(value);
                }
              }}
              required
              type={showPasswords ? "text" : "password"}
              value={props.authCode?.newPassword ?? password}
            />
          </label>
          <label className="otp-field" htmlFor="otp-confirm">
            Confirm new password
            <input
              autoComplete="new-password"
              id="otp-confirm"
              minLength={props.data.visualOnly ? 8 : 10}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (props.authCode?.onConfirmPasswordChange) {
                  props.authCode.onConfirmPasswordChange(value);
                } else {
                  setConfirmation(value);
                }
              }}
              required
              type={showPasswords ? "text" : "password"}
              value={props.authCode?.confirmPassword ?? confirmation}
            />
          </label>
          <label className="otp-show">
            <input
              checked={showPasswords}
              onChange={(event) =>
                setShowPasswords(event.currentTarget.checked)
              }
              type="checkbox"
            />
            Show passwords
          </label>
          <p className="otp-help">
            {props.data.visualOnly
              ? "Use at least 8 characters in this preview."
              : "Use at least 10 characters."}
          </p>
          {error ? (
            <p className="otp-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="otp-actions">
            <button
              className="otp-button otp-primary"
              disabled={pending}
              type="submit"
            >
              {pending ? "Updating…" : "Update password"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (view === "success") {
    return (
      <div className="otp-content" data-otp-state={view}>
        <h2 id="account-auth-title" ref={props.headingRef} tabIndex={-1}>
          {isReset ? "Password updated" : "Email verified"}
        </h2>
        <div aria-hidden="true" className="otp-success">
          ✓
        </div>
        <p className="otp-lede">
          {isReset
            ? "You can now sign in with your new password."
            : "You’re ready to set up your business."}
        </p>
        <div className="otp-actions">
          <button
            className="otp-button otp-primary"
            onClick={() => props.onNavigate?.(isReset ? "signin" : "business")}
            type="button"
          >
            {isReset ? "Back to sign in" : "Continue to setup"}
          </button>
        </div>
      </div>
    );
  }

  const status =
    view === "wrong"
      ? [
          "That code isn’t right.",
          attempts === undefined
            ? "Check the six digits and try again."
            : `${attempts} ${attempts === 1 ? "attempt" : "attempts"} left. Check the six digits and try again.`,
          "error",
        ]
      : view === "expired"
        ? [
            "This code has expired.",
            "Resend a code to continue. Your email is kept.",
            "error",
          ]
        : view === "locked"
          ? [
              "Too many attempts.",
              remaining > 0
                ? `Try again in ${remaining}s. You can resend a code after the wait.`
                : "The wait is over. Resend a fresh code to continue.",
              "error",
            ]
          : view === "network"
            ? [
                "Couldn’t verify your code.",
                "Check your connection and try again. No attempt was used.",
                "error",
              ]
            : view === "resent"
              ? [
                  "A new code is on its way.",
                  "Use the latest email. Your previous code is no longer valid.",
                  "sent",
                ]
              : view === "verifying"
                ? ["Verifying your code…", "", "pending"]
                : null;
  const isEntry =
    view === "entry" ||
    view === "wrong" ||
    view === "expired" ||
    view === "locked" ||
    view === "resent" ||
    view === "network" ||
    view === "verifying";
  if (!isEntry) return null;
  const codeLabel = isReset ? "password reset" : "email verification";
  const lede = isReset
    ? "If an account exists for this address, we’ve sent a six-digit reset code."
    : "Enter the six-digit code sent to your email.";

  return (
    <div className="otp-content" data-otp-state={view}>
      <h2 id="account-auth-title" ref={props.headingRef} tabIndex={-1}>
        Check your email
      </h2>
      <p className="otp-lede">{lede}</p>
      <div className="otp-address">
        <strong>{email}</strong>
        <button
          className="otp-button otp-text"
          disabled={pending}
          onClick={
            props.authCode?.onChangeEmail ??
            (() =>
              props.onNavigate?.(
                isReset ? "reset-change-email" : "verify-change-email",
              ))
          }
          type="button"
        >
          Change email
        </button>
      </div>
      {status ? (
        <div
          className={`otp-status ${status[2] === "error" ? "otp-status-error" : status[2] === "sent" ? "otp-status-sent" : ""}`}
          role={
            status[2] === "pending"
              ? "status"
              : status[2] === "sent"
                ? "status"
                : "alert"
          }
        >
          {status[2] === "pending" ? (
            <span aria-hidden="true" className="otp-spinner" />
          ) : null}
          <strong>{status[0]}</strong>
          {status[1] ? <span>{status[1]}</span> : null}
        </div>
      ) : null}
      <form id="email-code-form" onSubmit={routeSubmit}>
        <CodeFields
          code={codeValue}
          disabled={disabled}
          invalid={view === "wrong"}
          onChange={onCodeChange}
          purpose={purpose}
        />
        <p className="otp-help" id="otp-entry-help">
          You can paste the whole code.
        </p>
        <p className="otp-error" role={status || !error ? undefined : "alert"}>
          {status ? null : error}
        </p>
        <div className="otp-resend">
          <span>Didn’t get an email?</span>
          <button
            className="otp-button otp-text"
            disabled={remaining > 0 || pending}
            onClick={props.authCode?.onResend ?? props.onResend}
            type="button"
          >
            {remaining > 0 ? `Resend code in ${remaining}s` : "Resend code"}
          </button>
        </div>
        <div className="otp-actions">
          <button
            className="otp-button otp-primary"
            data-testid="otp-continue"
            disabled={pending || disabled || codeValue.length !== 6}
            type="submit"
          >
            {pending ? "Verifying…" : "Continue"}
          </button>
        </div>
      </form>
      <span className="otp-sr">Code purpose: {codeLabel}</span>
    </div>
  );
}

export function EmailCodePresentation(props: PresentationProps) {
  return <EmailCodeBody {...props} />;
}
