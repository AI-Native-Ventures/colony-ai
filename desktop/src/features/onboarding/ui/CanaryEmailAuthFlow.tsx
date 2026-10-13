import * as React from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeft, ArrowRight, Mail } from "lucide-react";

import { normalizeAccountAuthFailure } from "../accountAuthFlow";
import type {
  AccountAuthClient,
  AccountAuthRecord,
} from "../accountAuthClient";
import { getJoinPolicy, type JoinPolicy } from "@/shared/api/invites";
import { getRelayHttpUrl, getRelayWsUrl } from "@/shared/api/tauri";
import { ColonyAntAvatar } from "@/shared/ui/ColonyAntAvatar";
import { StartupWindowDragRegion } from "@/shared/ui/StartupWindowDragRegion";
import { AntMark } from "./OnboardingScenePrimitives";

type Step = "email" | "code" | "google" | "complete";
const FIRST_RUN_VERSION_WITHOUT_JOIN_POLICY = "colony-first-run-2026-10-13";

function useSecondsUntil(deadline: number) {
  const [remaining, setRemaining] = React.useState(0);
  React.useEffect(() => {
    const update = () =>
      setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1_000)));
    update();
    if (!deadline) return;
    const interval = window.setInterval(update, 1_000);
    return () => window.clearInterval(interval);
  }, [deadline]);
  return remaining;
}

function failureText(error: unknown, step: Step): string {
  const failure = normalizeAccountAuthFailure(error);
  switch (failure.code) {
    case "wrong_code":
    case "invalid_code":
    case "invalid_credentials":
      return "That code didn't work. Check it and try again.";
    case "code_expired":
      return "That code has expired. Send a new code.";
    case "too_many_attempts":
      return "Too many tries. Wait, then request a new code or use Google.";
    case "rate_limited":
    case "resend_cooldown":
      return "Too many tries. Wait a minute, then try again.";
    case "unreachable":
      return "Colony isn't answering right now. Try again in a minute.";
    case "google_sign_in_cancelled":
      return "You closed Google sign-in. Try again, or use your email instead.";
    case "google_sign_in_unavailable":
    case "google_sign_in_timed_out":
    case "google_sign_in_failed":
      return "Google sign-in couldn't finish. Try again or use email.";
    case "invalid_request":
      return step === "email"
        ? "That email doesn't look right. Check it and try again."
        : "Check the six digits and try again.";
    default:
      return "We couldn't finish signing in. Try again.";
  }
}

/** The approved O-01/O-02 first-run path over the real account service. */
export function CanaryEmailAuthFlow({
  authClient,
  inviteBrand,
  onAdvanced,
  onAuthenticated,
  onHaveInviteLink,
}: {
  authClient: AccountAuthClient;
  inviteBrand?: React.ReactNode;
  onAdvanced?: () => void;
  onAuthenticated: (account: AccountAuthRecord) => Promise<void> | void;
  onHaveInviteLink?: () => void;
}) {
  const [step, setStep] = React.useState<Step>("email");
  const [email, setEmail] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [policy, setPolicy] = React.useState<JoinPolicy | null>(null);
  const [policyStatus, setPolicyStatus] = React.useState<
    "loading" | "ready" | "error"
  >("loading");
  const [ageConfirmed, setAgeConfirmed] = React.useState(false);
  const [offline, setOffline] = React.useState(
    () => typeof navigator !== "undefined" && !navigator.onLine,
  );
  const [cooldownUntil, setCooldownUntil] = React.useState(0);
  const [sentAt, setSentAt] = React.useState(0);
  const remaining = useSecondsUntil(cooldownUntil);
  const noMailWait = useSecondsUntil(sentAt ? sentAt + 120_000 : 0);
  const codeInput = React.useRef<HTMLInputElement>(null);
  const requestInFlight = React.useRef(false);
  const termsVersion = policy?.version ?? FIRST_RUN_VERSION_WITHOUT_JOIN_POLICY;

  const loadPolicy = React.useCallback(async () => {
    setPolicyStatus("loading");
    try {
      const relayUrl = await getRelayWsUrl();
      setPolicy(await getJoinPolicy(relayUrl, "native"));
      setPolicyStatus("ready");
    } catch {
      setPolicyStatus("error");
    }
  }, []);

  React.useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  React.useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  React.useEffect(() => {
    if (step === "code") codeInput.current?.focus();
  }, [step]);

  const sendCode = async (resend: boolean) => {
    if (
      requestInFlight.current ||
      offline ||
      policyStatus !== "ready" ||
      (policy?.ageAttestationRequired && !ageConfirmed) ||
      (resend && remaining > 0)
    )
      return;
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("That email doesn't look right. Check it and try again.");
      return;
    }
    requestInFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const sent = await authClient.startEmailSignIn(normalizedEmail);
      setEmail(normalizedEmail);
      setCode("");
      setSentAt(Date.now());
      setCooldownUntil(Date.now() + (sent.retryAfterSecs ?? 30) * 1_000);
      setStep("code");
      if (resend) setNotice("Check your email for a new code.");
      window.setTimeout(() => codeInput.current?.focus(), 0);
    } catch (cause) {
      setError(failureText(cause, resend ? "code" : "email"));
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  };

  const verifyCode = async (candidate: string) => {
    if (requestInFlight.current || offline || candidate.length !== 6) return;
    requestInFlight.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const account = await authClient.verifyEmailSignIn(
        email,
        candidate,
        termsVersion,
      );
      await onAuthenticated(account);
      setStep("complete");
    } catch (cause) {
      setError(failureText(cause, "code"));
      const failure = normalizeAccountAuthFailure(cause);
      if (failure.code !== "unreachable") {
        setCode("");
        window.setTimeout(() => codeInput.current?.focus(), 0);
      }
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  };

  const continueWithGoogle = async () => {
    if (
      requestInFlight.current ||
      offline ||
      policyStatus !== "ready" ||
      (policy?.ageAttestationRequired && !ageConfirmed)
    )
      return;
    requestInFlight.current = true;
    setStep("google");
    setBusy(true);
    setError(null);
    try {
      const account = await authClient.signInWithGoogle(termsVersion);
      await onAuthenticated(account);
      setStep("complete");
    } catch (cause) {
      setStep("email");
      setError(failureText(cause, "google"));
    } finally {
      requestInFlight.current = false;
      setBusy(false);
    }
  };

  const openPolicy = async (document: "terms" | "privacy") => {
    try {
      const base = (await getRelayHttpUrl()).replace(/\/+$/, "");
      await openUrl(`${base}/api/join-policy/${document}`);
    } catch {
      setError("The policy page couldn't open. Try again.");
    }
  };

  return (
    <div
      className="colony-canary-first-run"
      data-testid={`canary-auth-${step}`}
    >
      <StartupWindowDragRegion />
      <aside className="colony-canary-first-run-aside">
        <div className="colony-canary-first-run-brand">
          <AntMark />
          <strong>Colony</strong>
        </div>
        <p>Your AI team, running your business with you.</p>
        <div className="colony-canary-first-run-scout">
          <ColonyAntAvatar decorative name="Scout" />
          <span>Scout will guide you.</span>
        </div>
      </aside>
      <main className="colony-canary-first-run-main">
        {step === "code" ? (
          <button
            className="colony-canary-first-run-back"
            onClick={() => {
              setStep("email");
              setCode("");
              setError(null);
            }}
            type="button"
          >
            <ArrowLeft aria-hidden="true" size={16} /> Back
          </button>
        ) : null}
        <div className="colony-canary-first-run-form">
          <span className="colony-canary-first-run-eyebrow">COLONY</span>
          {step === "email" ? (
            <>
              <h1>Welcome and sign in</h1>
              <p className="colony-canary-first-run-subtitle">
                A small team to help run the business with you.
              </p>
              {inviteBrand}
              <button
                className="colony-canary-first-run-google"
                disabled={
                  busy ||
                  offline ||
                  policyStatus !== "ready" ||
                  (policy?.ageAttestationRequired && !ageConfirmed)
                }
                onClick={() => void continueWithGoogle()}
                type="button"
              >
                Continue with Google <ArrowRight aria-hidden="true" size={18} />
              </button>
              <div className="colony-canary-first-run-divider">
                <span>or</span>
              </div>
              <form
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendCode(false);
                }}
              >
                <label htmlFor="canary-auth-email-input">Email address</label>
                <input
                  autoComplete="email"
                  disabled={busy || offline}
                  id="canary-auth-email-input"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@yourbusiness.com"
                  required
                  type="email"
                  value={email}
                />
                <button
                  className="colony-canary-first-run-primary"
                  disabled={
                    busy ||
                    offline ||
                    policyStatus !== "ready" ||
                    (policy?.ageAttestationRequired && !ageConfirmed)
                  }
                  type="submit"
                >
                  {busy ? "Sending code…" : "Continue with email"}
                  {!busy ? <ArrowRight aria-hidden="true" size={17} /> : null}
                </button>
              </form>
              {policy?.ageAttestationRequired ? (
                <label className="colony-canary-first-run-age">
                  <input
                    checked={ageConfirmed}
                    onChange={(event) => setAgeConfirmed(event.target.checked)}
                    type="checkbox"
                  />
                  I am at least 18 years old.
                </label>
              ) : null}
              {policy?.termsMarkdown || policy?.privacyMarkdown ? (
                <p className="colony-canary-first-run-legal">
                  By continuing, you agree to Colony's{" "}
                  {policy.termsMarkdown ? (
                    <button
                      onClick={() => void openPolicy("terms")}
                      type="button"
                    >
                      Terms
                    </button>
                  ) : null}
                  {policy.termsMarkdown && policy.privacyMarkdown
                    ? " and "
                    : null}
                  {policy.privacyMarkdown ? (
                    <button
                      onClick={() => void openPolicy("privacy")}
                      type="button"
                    >
                      Privacy Policy
                    </button>
                  ) : null}
                  .
                </p>
              ) : null}
              <button
                className="colony-canary-first-run-help-link"
                onClick={() => setHelpOpen((open) => !open)}
                type="button"
              >
                Trouble signing in?
              </button>
              {helpOpen ? (
                <div className="colony-canary-first-run-help">
                  Check your email address, or try Google sign-in.
                  {onAdvanced ? (
                    <button onClick={onAdvanced} type="button">
                      Use an existing recovery key
                    </button>
                  ) : null}
                  {onHaveInviteLink ? (
                    <button onClick={onHaveInviteLink} type="button">
                      Have an invite link?
                    </button>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : step === "code" ? (
            <>
              <h1>Email code</h1>
              <div className="colony-canary-first-run-mail-icon">
                <Mail aria-hidden="true" size={24} />
              </div>
              <p className="colony-canary-first-run-code-intro">
                We sent a 6-digit code to <strong>{email}</strong>.
              </p>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void verifyCode(code);
                }}
              >
                <label htmlFor="canary-auth-code-input">6-digit code</label>
                <input
                  autoComplete="one-time-code"
                  disabled={busy || offline}
                  id="canary-auth-code-input"
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) => {
                    const digits = event.target.value
                      .replace(/\D/g, "")
                      .slice(0, 6);
                    setCode(digits);
                    if (digits.length === 6) void verifyCode(digits);
                  }}
                  pattern="[0-9]{6}"
                  ref={codeInput}
                  required
                  type="text"
                  value={code}
                />
                <p className="colony-canary-first-run-hint">
                  The code works for 15 minutes. Check your spam folder if it's
                  not there.
                </p>
                <button
                  className="colony-canary-first-run-primary"
                  disabled={busy || offline || code.length !== 6}
                  type="submit"
                >
                  {busy ? "Checking…" : "Continue"}
                </button>
              </form>
              <div className="colony-canary-first-run-code-actions">
                <button
                  disabled={busy || offline || remaining > 0}
                  onClick={() => void sendCode(true)}
                  type="button"
                >
                  {remaining > 0
                    ? `Send a new code in ${remaining} seconds`
                    : "Send a new code"}
                </button>
                <button
                  onClick={() => {
                    setStep("email");
                    setError(null);
                  }}
                  type="button"
                >
                  Use a different email
                </button>
              </div>
              {sentAt > 0 &&
              noMailWait === 0 &&
              Date.now() >= sentAt + 120_000 ? (
                <p className="colony-canary-first-run-hint">
                  Still nothing? Check your spam folder, or use Google.
                </p>
              ) : null}
            </>
          ) : (
            <>
              <h1>
                {step === "google" ? "Finish signing in" : "You're signed in"}
              </h1>
              <p className="colony-canary-first-run-subtitle">
                {step === "google"
                  ? "Finish signing in in your browser. We'll bring you back here."
                  : "Opening your business…"}
              </p>
            </>
          )}
          {offline ? (
            <p className="colony-canary-first-run-feedback" role="status">
              Connect to the internet to sign in.
            </p>
          ) : null}
          {policyStatus === "error" ? (
            <div className="colony-canary-first-run-feedback" role="alert">
              Sign-in terms couldn't load.{" "}
              <button onClick={() => void loadPolicy()} type="button">
                Try again
              </button>
            </div>
          ) : null}
          {error ? (
            <p className="colony-canary-first-run-feedback" role="alert">
              {error}
            </p>
          ) : null}
          {notice ? <p role="status">{notice}</p> : null}
        </div>
      </main>
    </div>
  );
}
