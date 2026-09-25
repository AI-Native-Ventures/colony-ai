import type * as React from "react";

import "./googleAccount.css";
import "./onboardingTypography.css";

export const GOOGLE_ACCOUNT_SCENES = [
  "sign-in",
  "sign-up",
  "cancelled",
  "password-account",
  "unverified",
  "loading",
] as const;

export type GoogleAccountScene = (typeof GOOGLE_ACCOUNT_SCENES)[number];

type GoogleAccountPresentationProps = {
  scene: GoogleAccountScene;
  name: string;
  email: string;
  password: string;
  error?: string | null;
  onNameChange?: (value: string) => void;
  onEmailChange?: (value: string) => void;
  onPasswordChange?: (value: string) => void;
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  onGoogleSignIn?: () => void;
  onCancel?: () => void;
  onNavigate?: (scene: "sign-in" | "sign-up" | "forgot") => void;
};

const noticeCopy: Partial<
  Record<GoogleAccountScene, [string, string, "error" | "info" | "warning"]>
> = {
  cancelled: [
    "Google sign-in was cancelled",
    "Nothing has changed. Try again or use your email.",
    "info",
  ],
  "password-account": [
    "This email already uses a password",
    "Sign in with your password first. You can connect Google from Account settings.",
    "warning",
  ],
  unverified: [
    "Verify your Google email first",
    "Colony needs a verified email. Verify it with Google, then try again.",
    "error",
  ],
};

function GoogleMark() {
  return (
    <svg aria-hidden="true" className="google-mark" viewBox="0 0 48 48">
      <path
        d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.5 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.3 13.7 17.7 9.5 24 9.5Z"
        fill="#EA4335"
      />
      <path
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6C44.4 38.04 46.98 31.9 46.98 24.55Z"
        fill="#4285F4"
      />
      <path
        d="M10.5 28.7a14.4 14.4 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1Z"
        fill="#FBBC05"
      />
      <path
        d="M24 48c6.5 0 11.8-2.14 15.72-5.8l-7.73-6c-2.14 1.44-4.85 2.3-7.99 2.3-6.3 0-11.65-4.25-13.5-9.95l-7.9 6.1C6.5 42.57 14.6 48 24 48Z"
        fill="#34A853"
      />
    </svg>
  );
}

function PrimaryButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      className="ga-button ga-button-primary ga-button-full"
      type="submit"
    >
      {children}
    </button>
  );
}

export function GoogleAccountPresentation({
  scene,
  name,
  email,
  password,
  error,
  onNameChange,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onGoogleSignIn,
  onCancel,
  onNavigate,
}: GoogleAccountPresentationProps) {
  const signingUp = scene === "sign-up";
  const loading = scene === "loading";
  const notice = noticeCopy[scene];

  return (
    <div
      className="colony-google-account-root"
      data-testid="google-account-scene"
    >
      <main className="ga-auth-scene">
        <section aria-label="Colony" className="ga-auth-brand">
          <a
            aria-label="Colony home"
            className="ga-wordmark"
            href="#01/sign-in"
          >
            colony
          </a>
          <h2>
            Your business.
            <br />
            In good company.
          </h2>
          <p>
            A shared home for your people,
            <br />
            your agents and your ambition.
          </p>
        </section>

        <section aria-label="Account access" className="ga-auth-pane">
          <div className="ga-auth-form">
            <h1>{signingUp ? "Create your account" : "Welcome back"}</h1>
            <p className="ga-muted">
              {signingUp
                ? "Make room for your next chapter."
                : "Sign in to your Colony account."}
            </p>

            {notice ? (
              <div className={`ga-notice ${notice[2]}`} role="alert">
                <strong>{notice[0]}</strong>
                <p>{notice[1]}</p>
              </div>
            ) : null}

            {error ? (
              <div
                aria-live="assertive"
                className="ga-notice error"
                role="alert"
              >
                <p>{error}</p>
              </div>
            ) : null}

            {loading ? (
              <div aria-live="polite" className="ga-loading" role="status">
                <span aria-hidden="true" className="ga-spinner" />
                <h2>Opening Google…</h2>
                <p>Complete sign-in in your browser. Keep this window open.</p>
              </div>
            ) : (
              <>
                <button
                  className="ga-button ga-google-button"
                  data-testid="account-auth-google"
                  onClick={onGoogleSignIn}
                  type="button"
                >
                  <GoogleMark />
                  Continue with Google
                </button>

                <div aria-hidden="true" className="ga-divider">
                  <span>or continue with email</span>
                </div>

                <form
                  aria-label={signingUp ? "Create account" : "Sign in"}
                  onSubmit={(event) => {
                    event.preventDefault();
                    onSubmit?.(event);
                  }}
                >
                  {signingUp ? (
                    <label className="ga-field">
                      Your name
                      <input
                        autoComplete="name"
                        data-testid="account-auth-name"
                        name="name"
                        onChange={(event) => onNameChange?.(event.target.value)}
                        required
                        value={name}
                      />
                    </label>
                  ) : null}

                  <label className="ga-field">
                    Email address
                    <input
                      autoComplete="email"
                      data-testid="account-auth-email"
                      name="email"
                      onChange={(event) => onEmailChange?.(event.target.value)}
                      required
                      type="email"
                      value={email}
                    />
                  </label>

                  <label className="ga-field">
                    Password
                    <input
                      autoComplete={
                        signingUp ? "new-password" : "current-password"
                      }
                      data-testid="account-auth-password"
                      minLength={signingUp ? 10 : undefined}
                      name="password"
                      onChange={(event) =>
                        onPasswordChange?.(event.target.value)
                      }
                      required
                      type="password"
                      value={password}
                    />
                  </label>

                  {!signingUp ? (
                    <button
                      className="ga-text-link"
                      onClick={() => onNavigate?.("forgot")}
                      type="button"
                    >
                      Forgot password?
                    </button>
                  ) : null}

                  <PrimaryButton>
                    {signingUp ? "Create account" : "Sign in"}
                  </PrimaryButton>
                </form>

                <p className="ga-auth-switch">
                  {signingUp ? "Already have an account?" : "New to Colony?"}{" "}
                  <button
                    className="ga-text-button"
                    onClick={() =>
                      onNavigate?.(signingUp ? "sign-in" : "sign-up")
                    }
                    type="button"
                  >
                    {signingUp ? "Sign in" : "Create an account"}
                  </button>
                </p>
              </>
            )}

            {loading && onCancel ? (
              <button
                className="ga-button ga-cancel-button"
                data-testid="account-auth-google-cancel"
                onClick={onCancel}
                type="button"
              >
                Cancel
              </button>
            ) : null}

            <p className="ga-legal">
              By continuing, you agree to the Terms and Privacy Policy.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
