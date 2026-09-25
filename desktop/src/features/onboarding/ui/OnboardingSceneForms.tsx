import * as React from "react";
import {
  onboardingSceneStage,
  type OnboardingSceneId,
} from "./onboardingScenes";
import type {
  OnboardingBusinessChoice,
  OnboardingSceneData,
  PresentationProps,
} from "./OnboardingSceneTypes";
import {
  BackButton,
  Brand,
  Glyph,
  InlineAlert,
  PrimaryButton,
  type GlyphName,
} from "./OnboardingScenePrimitives";

export function StepProgress({ scene }: { scene: OnboardingSceneId }) {
  const stage = onboardingSceneStage(scene);
  const labels =
    scene === "additional"
      ? ["Business", "Connect"]
      : ["Account", "Business", "Connect"];
  return (
    <ol aria-label="Setup progress" className="steps">
      {labels.map((label, index) => {
        const step = scene === "additional" ? index + 1 : index;
        const state = step === stage ? "active" : step < stage ? "done" : "";
        return (
          <React.Fragment key={label}>
            {index > 0 ? <li aria-hidden="true" className="between" /> : null}
            <li
              aria-current={step === stage ? "step" : undefined}
              className={state}
            >
              <span className="number">
                {step < stage ? <Glyph name="check" /> : index + 1}
              </span>
              {label}
            </li>
          </React.Fragment>
        );
      })}
    </ol>
  );
}

export function accessScene(scene: OnboardingSceneId) {
  return [
    "signin",
    "forgot",
    "email-sent",
    "new-password",
    "reset-done",
    "reset-expired",
    "businesses",
    "invite",
  ].includes(scene);
}

export function StoryPanel({
  scene,
  data,
  onLogoError,
}: {
  scene: OnboardingSceneId;
  data: OnboardingSceneData;
  onLogoError?: () => void;
}) {
  const stage = onboardingSceneStage(scene);
  let heading = (
    <>
      A little Colony.
      <br />A bigger
      <br />
      <em>possibility.</em>
    </>
  );
  let description = (
    <>
      Your ideas. Your AI team.
      <br />A place to make things happen.
    </>
  );
  if (stage === 1) {
    heading = (
      <>
        Make it
        <br />
        <em>your own.</em>
      </>
    );
    description = (
      <>
        A little context helps your team
        <br />
        get off to a good start.
      </>
    );
  }
  if (stage === 2) {
    heading = (
      <>
        Your choice.
        <br />
        <em>Your AI.</em>
      </>
    );
    description = (
      <>
        A familiar account.
        <br />A new way to work.
      </>
    );
  }
  if (
    [
      "signin",
      "forgot",
      "email-sent",
      "new-password",
      "reset-done",
      "reset-expired",
      "businesses",
    ].includes(scene)
  ) {
    heading = (
      <>
        Your Colony.
        <br />
        <em>
          Right where
          <br /> you left it.
        </em>
      </>
    );
    description = (
      <>
        Your business, your team
        <br />
        and your next chapter.
      </>
    );
  }
  if (scene === "invite") {
    heading = (
      <>
        There’s room
        <br />
        for <em>you here.</em>
      </>
    );
    description = (
      <>
        Good work starts with
        <br />
        the right people.
      </>
    );
  }
  const businessPreview = stage === 1;
  return (
    <aside className="story">
      <Brand />
      <div className="story-main">
        <h1>{heading}</h1>
        <p>{description}</p>
        {businessPreview ? (
          <div className="business-preview">
            <span className="business-initial">
              {data.logoUrl ? (
                <img alt="" onError={onLogoError} src={data.logoUrl} />
              ) : (
                data.business.trim().slice(0, 1).toUpperCase() || (
                  <Glyph name="plus" />
                )
              )}
            </span>
            <div className="business-name">
              {data.business || "Your business"}
            </div>
            <p>{data.description || "Your idea takes shape here."}</p>
          </div>
        ) : null}
      </div>
      {accessScene(scene) ? (
        <div className="story-bottom" aria-hidden="true" />
      ) : (
        <StepProgress scene={scene} />
      )}
    </aside>
  );
}

export function AccountForm({
  data,
  error,
  onEmailChange,
  onNameChange,
  onPasswordChange,
  onSubmit,
}: PresentationProps) {
  return (
    <>
      <h2>Let’s get you started.</h2>
      <p className="lede">Create an account. Make room for what’s next.</p>
      <form className="account-form" onSubmit={onSubmit}>
        <div className="fields">
          <div className="field">
            <label htmlFor="full-name">Your name</label>
            <input
              autoComplete="name"
              defaultValue={data.visualOnly ? undefined : data.name}
              id="full-name"
              name="full-name"
              onChange={(event) => onNameChange?.(event.currentTarget.value)}
              required
              value={data.visualOnly ? data.name : undefined}
            />
          </div>
          <div className="field">
            <label htmlFor="account-email">Email address</label>
            <input
              autoComplete="email"
              defaultValue={data.visualOnly ? undefined : data.email}
              id="account-email"
              name="email"
              onChange={(event) => onEmailChange?.(event.currentTarget.value)}
              required
              type="email"
              value={data.visualOnly ? data.email : undefined}
            />
          </div>
          <PasswordInput
            id="account-password"
            label="Password"
            onChange={(event) => onPasswordChange?.(event.currentTarget.value)}
            visualOnly={data.visualOnly}
          />
        </div>
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        <PrimaryButton
          disabled={data.pending}
          testId="account-auth-submit-signup"
          type="submit"
        >
          {data.pending ? "Please wait…" : "Create account"}
        </PrimaryButton>
      </form>
    </>
  );
}

function PasswordInput({
  id,
  label,
  onChange,
  visualOnly,
}: {
  id: string;
  label: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  visualOnly?: boolean;
}) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <input
          autoComplete={
            id === "signin-password" ? "current-password" : "new-password"
          }
          defaultValue={visualOnly ? "colony-demo-only" : undefined}
          id={id}
          minLength={id === "signin-password" ? undefined : 10}
          name={id}
          onChange={onChange}
          required
          type={visible ? "text" : "password"}
        />
        <button
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          onClick={() => setVisible((current) => !current)}
          type="button"
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}

export function SignInForm({
  data,
  error,
  onEmailChange,
  onNavigate,
  onPasswordChange,
  onSubmit,
}: PresentationProps) {
  return (
    <>
      <h2>Welcome back.</h2>
      <p className="lede">Let’s pick up where you left off.</p>
      <form onSubmit={onSubmit}>
        <div className="fields">
          <div className="field">
            <label htmlFor="signin-email">Email address</label>
            <input
              autoComplete="email"
              defaultValue={data.visualOnly ? undefined : data.email}
              id="signin-email"
              onChange={(event) => onEmailChange?.(event.currentTarget.value)}
              required
              type="email"
              value={data.visualOnly ? data.email : undefined}
            />
          </div>
          <PasswordInput
            id="signin-password"
            label="Password"
            onChange={(event) => onPasswordChange?.(event.currentTarget.value)}
            visualOnly={data.visualOnly}
          />
        </div>
        <div className="row-between">
          <span />
          <button
            className="link forgot-link"
            onClick={() => onNavigate?.("forgot")}
            type="button"
          >
            Forgot password?
          </button>
        </div>
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        <PrimaryButton
          disabled={data.pending}
          testId="account-auth-submit-signin"
          type="submit"
        >
          {data.pending ? "Please wait…" : "Sign in"}
        </PrimaryButton>
      </form>
      <div className="form-end">
        New to Colony?
        <button
          className="link"
          onClick={() => onNavigate?.("account")}
          type="button"
        >
          Create an account
        </button>
      </div>
    </>
  );
}

export function BusinessForm({
  scene,
  data,
  error,
  onBusinessChange,
  onDescriptionChange,
  onLogoChange,
  onLogoError,
  onNavigate,
  onReadWebsite,
  onSubmit,
  onWebsiteChange,
  canSubmit,
  pending,
}: PresentationProps) {
  return (
    <>
      <h2>
        {scene === "additional" || (data.visualOnly && data.business === "")
          ? "Your next business."
          : "What are you building?"}
      </h2>
      <p className="lede">
        An idea or an existing business. Start with the essentials.
      </p>
      <form onSubmit={onSubmit}>
        <div className="fields">
          <div className="field">
            <label htmlFor="business-name">Business name</label>
            <input
              autoComplete="organization"
              id="business-name"
              maxLength={200}
              onChange={(event) =>
                onBusinessChange?.(event.currentTarget.value)
              }
              placeholder="A working name is fine"
              required
              value={data.business}
            />
          </div>
          <div className="field">
            <label htmlFor="business-website">
              Website <small>optional</small>
            </label>
            <div className="website-row">
              <input
                autoComplete="url"
                id="business-website"
                inputMode="url"
                onChange={(event) =>
                  onWebsiteChange?.(event.currentTarget.value)
                }
                placeholder="yourbusiness.com"
                value={data.website}
              />
              <button
                className="secondary"
                onClick={onReadWebsite}
                type="button"
              >
                Read website
              </button>
            </div>
          </div>
          <div className="field" id="business-logo-field">
            <input
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              aria-label="Upload business logo"
              className="sr-only"
              id="business-logo"
              onChange={(event) =>
                onLogoChange?.(event.currentTarget.files?.[0] ?? null)
              }
              type="file"
            />
            <div className="logo-editor">
              <label
                aria-label={
                  data.logoUrl ? "Change business logo" : "Upload business logo"
                }
                className={`logo-tile ${data.logoUrl ? "has-logo" : ""}`}
                htmlFor="business-logo"
              >
                {data.logoUrl ? (
                  <img alt="" onError={onLogoError} src={data.logoUrl} />
                ) : (
                  data.business.trim().slice(0, 1).toUpperCase() || (
                    <Glyph name="plus" />
                  )
                )}
              </label>
              <div className="logo-actions">
                <span className="field-label">
                  Business logo <small>optional</small>
                </span>
                <div className="logo-buttons">
                  <label className="link" htmlFor="business-logo">
                    {data.logoUrl ? "Change logo" : "Upload logo"}
                  </label>
                </div>
                <p className="logo-hint">
                  {data.logoUrl
                    ? "Your uploaded logo"
                    : "Or we’ll use your website’s icon."}
                </p>
              </div>
            </div>
          </div>
          <div className="field">
            <label htmlFor="business-description">
              What does your business do?
            </label>
            <textarea
              id="business-description"
              maxLength={4000}
              onChange={(event) =>
                onDescriptionChange?.(event.currentTarget.value)
              }
              placeholder="We help…"
              required
              rows={3}
              value={data.description}
            />
          </div>
        </div>
        {error ? <InlineAlert>{error}</InlineAlert> : null}
        <PrimaryButton
          disabled={(pending ?? data.pending) || canSubmit === false}
          type="submit"
        >
          {pending || data.pending ? "Creating…" : "Continue"}
        </PrimaryButton>
        <BackButton
          onClick={() =>
            onNavigate?.(scene === "additional" ? "workspace" : "account")
          }
        >
          {scene === "additional" ? "Cancel" : "Back"}
        </BackButton>
      </form>
    </>
  );
}

export function StatusScene({
  scene,
  data,
  error,
  onEmailChange,
  onNavigate,
  onResend,
  onSubmit,
}: PresentationProps) {
  const details: Record<
    string,
    { icon: GlyphName; title: string; lede: React.ReactNode }
  > = {
    forgot: {
      icon: "mail",
      title: "Forgot your password?",
      lede: "We’ll email you a link to set a new one.",
    },
    "email-sent": {
      icon: "mail",
      title: "Check your inbox.",
      lede: (
        <>
          If there’s an account for{" "}
          <strong className="mail-address">{data.email}</strong>, you’ll receive
          a password reset link.
        </>
      ),
    },
    "new-password": {
      icon: "lock",
      title: "A fresh password.",
      lede: "Choose a new password for your Colony account.",
    },
    "reset-done": {
      icon: "check",
      title: "You’re all set.",
      lede: (
        <>
          Your password has been updated.
          <br />
          Your Colony is right where it left it.
        </>
      ),
    },
    "reset-expired": {
      icon: "history",
      title: "Let’s get a fresh link.",
      lede: "This password reset link has expired or has already been used.",
    },
  };
  const detail = details[scene];
  if (!detail) return null;
  const success = scene === "reset-done";
  const showBack = scene === "forgot" || scene === "reset-expired";
  return (
    <>
      <div className={`status-icon ${success ? "success" : ""}`}>
        <Glyph name={detail.icon} />
      </div>
      <h2>{detail.title}</h2>
      <p className="lede">{detail.lede}</p>
      {scene === "forgot" ? (
        <form onSubmit={onSubmit}>
          <div className="field">
            <label htmlFor="reset-email">Email address</label>
            <input
              autoComplete="email"
              defaultValue={data.visualOnly ? undefined : data.email}
              id="reset-email"
              onChange={(event) => onEmailChange?.(event.currentTarget.value)}
              required
              type="email"
              value={data.visualOnly ? data.email : undefined}
            />
          </div>
          <PrimaryButton
            disabled={data.pending}
            testId="account-auth-submit-reset-request"
            type="submit"
          >
            Send reset link
          </PrimaryButton>
          {error ? <InlineAlert>{error}</InlineAlert> : null}
        </form>
      ) : null}
      {scene === "email-sent" ? (
        <>
          <div className="notice">
            Follow the link in the email to choose a new password.
          </div>
          <button className="secondary full" onClick={onResend} type="button">
            Send another link
          </button>
          <BackButton onClick={() => onNavigate?.("signin")}>
            Back to sign in
          </BackButton>
        </>
      ) : null}
      {scene === "new-password" ? (
        <form onSubmit={(event) => event.preventDefault()}>
          <div className="fields">
            <PasswordInput
              id="new-password"
              label="New password"
              visualOnly={data.visualOnly}
            />
            <PasswordInput
              id="confirm-password"
              label="Confirm password"
              visualOnly={data.visualOnly}
            />
          </div>
          <p className="hint">Use at least 10 characters.</p>
          <PrimaryButton type="submit">Update password</PrimaryButton>
        </form>
      ) : null}
      {scene === "reset-done" ? (
        <PrimaryButton onClick={() => onNavigate?.("signin")}>
          Back to sign in
        </PrimaryButton>
      ) : null}
      {scene === "reset-expired" ? (
        <>
          <PrimaryButton onClick={() => onNavigate?.("forgot")}>
            Send a new link
          </PrimaryButton>
          <BackButton onClick={() => onNavigate?.("signin")}>
            Back to sign in
          </BackButton>
        </>
      ) : null}
      {showBack ? null : null}
    </>
  );
}

export function BusinessChooser({
  data,
  businessChoices,
  error,
  onNavigate,
  onCreateBusiness,
  onSelectBusiness,
}: {
  data: OnboardingSceneData;
  businessChoices?: OnboardingBusinessChoice[];
  error?: string | null;
  onNavigate?: (scene: OnboardingSceneId) => void;
  onCreateBusiness?: () => void;
  onSelectBusiness?: (id: string) => void;
}) {
  const choices =
    businessChoices ??
    (data.visualOnly
      ? [
          {
            id: "studio",
            name: data.business || "Lerato Studio",
            role: "Owner",
          },
          { id: "rosebank", name: "Rosebank Studio", role: "Team member" },
        ]
      : []);
  return (
    <>
      <h2>Where shall we go?</h2>
      <p className="lede">Choose a business to pick up your work.</p>
      {error ? <InlineAlert>{error}</InlineAlert> : null}
      <div className="business-list" data-testid="onboarding-business-list">
        {choices.map((choice) => (
          <button
            className="business-choice"
            data-testid={`onboarding-business-${choice.id}`}
            key={choice.id}
            onClick={() => onSelectBusiness?.(choice.id)}
            type="button"
          >
            <span className="business-initial">{choice.name.slice(0, 1)}</span>
            <span>
              <strong>{choice.name}</strong>
              <small>{choice.role}</small>
            </span>
            <Glyph name="chevron" />
          </button>
        ))}
      </div>
      <button
        className="back"
        onClick={onCreateBusiness ?? (() => onNavigate?.("additional"))}
        type="button"
        data-testid="onboarding-create-business"
      >
        <Glyph name="plus" />
        Start another business
      </button>
    </>
  );
}

export function InviteScene({ data, onSubmit, onNavigate }: PresentationProps) {
  return (
    <>
      <div className="invite-brand">
        <span className="business-initial">R</span>
        <span>
          <strong>Rosebank Studio</strong>
          <small>Invited by Ayesha</small>
        </span>
      </div>
      <h2>You’re invited.</h2>
      <p className="lede">Join your team’s workspace on Colony.</p>
      <form onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="invite-name">Your name</label>
          <input
            autoComplete="name"
            id="invite-name"
            value={data.name}
            readOnly
          />
        </div>
        <div className="notice">
          You’ll join as a team member using{" "}
          <strong className="mail-address">{data.email}</strong>.
        </div>
        <PrimaryButton type="submit">Join Rosebank Studio</PrimaryButton>
      </form>
      <BackButton onClick={() => onNavigate?.("signin")}>
        Use another account
      </BackButton>
    </>
  );
}
