import * as React from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Globe2,
  History,
  Home,
  KeyRound,
  Link2,
  LockKeyhole,
  Mail,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";

import claudeLogoUrl from "../assets/harness-logos/claude.png?inline";
import codexLogoUrl from "../assets/harness-logos/codex.webp?url";
import openRouterDarkLogoUrl from "../assets/harness-logos/openrouter-dark.svg?url";
import openRouterLogoUrl from "../assets/harness-logos/openrouter.svg?url";
import "./onboardingCalibration.css";
import "./onboardingTypography.css";
import {
  onboardingSceneStage,
  type OnboardingSceneId,
} from "./onboardingScenes";
import type { CreditsSnapshot } from "./creditsOnboardingApi";

export type OnboardingSceneData = {
  name: string;
  email: string;
  business: string;
  website: string;
  description: string;
  logoUrl?: string | null;
  harnessLabel?: string;
  harnessStatus?: string;
  error?: string | null;
  pending?: boolean;
  visualOnly?: boolean;
  creditsSnapshot?: CreditsSnapshot;
};

export type OnboardingBusinessChoice = {
  id: string;
  name: string;
  role: string;
};

export type OnboardingSceneActions = {
  error?: string | null;
  onNavigate?: (scene: OnboardingSceneId) => void;
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  onNameChange?: (value: string) => void;
  onEmailChange?: (value: string) => void;
  onPasswordChange?: (value: string) => void;
  onBusinessChange?: (value: string) => void;
  onWebsiteChange?: (value: string) => void;
  onDescriptionChange?: (value: string) => void;
  onLogoChange?: (file: File | null) => void;
  onLogoError?: () => void;
  onReadWebsite?: () => void;
  onResend?: () => void;
  onCreditsRetry?: () => void;
  onRuntimeContinue?: () => void;
  onSelectConnection?: (scene: OnboardingSceneId) => void;
  pending?: boolean;
  contentOverride?: React.ReactNode;
  connectionContentOverride?: React.ReactNode;
  harnessMark?: React.ReactNode;
  businessChoices?: OnboardingBusinessChoice[];
  onSelectBusiness?: (id: string) => void;
  onCreateBusiness?: () => void;
  canSubmit?: boolean;
};

type PresentationProps = {
  scene: OnboardingSceneId;
  data: OnboardingSceneData;
} & OnboardingSceneActions;

const ICONS = {
  alert: AlertCircle,
  arrow: ArrowRight,
  back: ArrowLeft,
  check: Check,
  chevron: ChevronRight,
  down: ChevronDown,
  document: FileText,
  folder: Folder,
  globe: Globe2,
  history: History,
  home: Home,
  key: KeyRound,
  link: Link2,
  lock: LockKeyhole,
  mail: Mail,
  plus: Plus,
  restart: RefreshCw,
  send: Send,
  subscription: Star,
  team: Users,
  chat: MessageSquare,
  sparkles: Sparkles,
  verified: ShieldCheck,
  x: X,
};

function Glyph({
  name,
  className,
}: {
  name: keyof typeof ICONS;
  className?: string;
}) {
  const Icon = ICONS[name];
  return <Icon aria-hidden="true" className={`icon ${className ?? ""}`} />;
}

function AntMark({ className = "ant" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      viewBox="0 0 466 309"
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="14"
      >
        <path d="M198 201Q176 230 163 265M229 211Q226 243 232 274M259 190Q281 221 296 252M327 114Q340 82 371 74M343 126Q367 106 395 105" />
      </g>
      <circle cx="104" cy="172" r="80" />
      <circle cx="226" cy="164" r="52" />
      <circle cx="313" cy="148" r="46" />
    </svg>
  );
}

function Brand() {
  return (
    <div className="brand">
      <AntMark />
      <span>colony</span>
    </div>
  );
}

function PrimaryButton({
  children,
  disabled,
  onClick,
  testId,
  type = "button",
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  testId?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      className="primary full form-submit"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
      <Glyph name="arrow" />
    </button>
  );
}

function BackButton({
  children = "Back",
  onClick,
}: {
  children?: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button className="back" onClick={onClick} type="button">
      <Glyph name="back" />
      {children}
    </button>
  );
}

function InlineAlert({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-alert" role="alert">
      <Glyph name="alert" />
      <p>{children}</p>
    </div>
  );
}

function StepProgress({ scene }: { scene: OnboardingSceneId }) {
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

function accessScene(scene: OnboardingSceneId) {
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

function StoryPanel({
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

function AccountForm({
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

function SignInForm({
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

function BusinessForm({
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

function StatusScene({
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
    { icon: keyof typeof ICONS; title: string; lede: React.ReactNode }
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

function BusinessChooser({
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

function InviteScene({ data, onSubmit, onNavigate }: PresentationProps) {
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

function ConnectionShell({
  scene,
  data,
  content,
  harnessMark,
  onNavigate,
  onSelectConnection,
}: {
  scene: OnboardingSceneId;
  data: OnboardingSceneData;
  content: React.ReactNode;
  harnessMark?: React.ReactNode;
  onNavigate?: (scene: OnboardingSceneId) => void;
  onSelectConnection?: (scene: OnboardingSceneId) => void;
}) {
  return (
    <>
      <div className="power-heading">
        <h2>Connect your AI.</h2>
        <p className="lede">Your harness. Your models. Your way.</p>
      </div>
      <div className="harness-row">
        <span
          className={`harness-mark ${data.harnessLabel === "Claude Code" ? "claude-mark" : data.harnessLabel === "Codex" ? "codex-mark" : ""}`}
          aria-hidden="true"
        >
          {harnessMark ??
            (data.visualOnly && data.harnessLabel === "Claude Code" ? (
              <img alt="" className="harness-mark-image" src={claudeLogoUrl} />
            ) : (
              <AntMark />
            ))}
        </span>
        <span>
          <small>Agent harness</small>
          <strong>{data.harnessLabel ?? "Finding harnesses"}</strong>
        </span>
        <span className="harness-state">
          {data.harnessStatus ?? "Checking"}
        </span>
        <button
          className="link"
          onClick={() => {
            const runtimeList = document.getElementById(
              "onboarding-runtime-list",
            );
            runtimeList?.scrollIntoView({ block: "center" });
            runtimeList?.focus({ preventScroll: true });
          }}
          type="button"
        >
          Change <Glyph name="chevron" />
        </button>
      </div>
      <fieldset className="power-routes">
        <legend className="sr-only">AI connection</legend>
        {[
          ["subscription", "Subscriptions", "subscription"],
          ["credits", "Colony credits", "sparkles"],
          ["openrouter", "OpenRouter", "globe"],
          ["api", "Bring your own key", "lock"],
        ].map(([id, label, icon]) => (
          <button
            aria-pressed={
              scene === "connect" || scene.startsWith("subscription")
                ? id === "subscription"
                : scene.startsWith("credits") || scene === "funding"
                  ? id === "credits"
                  : scene.startsWith("openrouter")
                    ? id === "openrouter"
                    : id === "api"
            }
            className="power-route"
            key={id}
            onClick={() => {
              if (id === "subscription") onSelectConnection?.("connect");
              if (id === "credits") onSelectConnection?.("credits-price-error");
              if (id === "openrouter")
                onSelectConnection?.("openrouter-unlinked");
              if (id === "api") onSelectConnection?.("api-key");
            }}
            type="button"
          >
            {id === "credits" ? (
              <AntMark />
            ) : id === "openrouter" ? (
              <span className="harness-logo openrouter-logo" aria-hidden="true">
                <img alt="" className="logo-light" src={openRouterLogoUrl} />
                <img alt="" className="logo-dark" src={openRouterDarkLogoUrl} />
              </span>
            ) : (
              <Glyph name={icon as keyof typeof ICONS} />
            )}
            <strong>{label}</strong>
          </button>
        ))}
      </fieldset>
      <section aria-label="Connection options" className="power-body">
        {content}
      </section>
      <BackButton onClick={() => onNavigate?.("business")}>Back</BackButton>
      {scene === "credits-checkout" && data.visualOnly ? (
        <CreditReviewDialog data={data} />
      ) : null}
    </>
  );
}

function DiscoveryPreview() {
  return (
    <div className="discovery-wait" role="status">
      <span className="spinner" />
      <h3>Finding your AI apps.</h3>
      <p>Checking installations, signed-in accounts and available usage.</p>
      <div className="scan-grid">
        {[
          "Claude Code",
          "Codex",
          "OpenCode",
          "Pi",
          "Oh My Pi",
          "Prime Agent",
        ].map((name) => (
          <div className="scan-row" key={name}>
            <span className="provider-glyph">{name.slice(0, 1)}</span>
            {name}
            <span>Checking…</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReadySubscriptionPreview({ scene }: { scene: OnboardingSceneId }) {
  const missing = scene === "subscription-missing";
  const apiAuth = scene === "subscription-api-auth";
  const exhausted = scene === "subscription-exhausted";
  const usageUnknown = scene === "subscription-usage-unknown";
  const stale = scene === "subscription-stale";
  const modelsError = scene === "subscription-models-error";
  const providers = [
    {
      name: "Claude Code",
      logo: claudeLogoUrl,
      plan: "Pro",
      left: [exhausted ? 0 : 72, 46],
      resets: ["2h 18m", "4 days"],
      installed: !missing,
      auth: apiAuth
        ? "api"
        : exhausted || modelsError
          ? "connected"
          : "detected",
    },
    {
      name: "Codex",
      logo: codexLogoUrl,
      plan: "ChatGPT Plus",
      left: [38, 81],
      resets: ["3h 40m", "4 days"],
      installed: !missing,
      auth: "detected",
    },
  ] as const;
  const selected = providers[0];
  const selectedConnected = selected.auth === "connected";

  return (
    <>
      <div className="section-heading">
        <h3>On this computer</h3>
        <button className="link" type="button">
          <Glyph name="restart" />
          Check again
        </button>
      </div>
      <fieldset className="subscription-cards">
        <legend className="sr-only">Detected AI apps</legend>
        {providers.map((provider, index) => (
          <button
            aria-pressed={index === 0}
            className={`subscription-card ${index === 0 ? "selected" : ""}`}
            key={provider.name}
            type="button"
          >
            <span className="provider-top">
              <span
                className={`provider-monogram ${index === 0 ? "claude" : "codex"}`}
              >
                <img
                  alt=""
                  className="provider-logo-image"
                  src={provider.logo}
                />
              </span>
              <strong>{provider.name}</strong>
              <span className="selection-dot" />
            </span>
            <span className="provider-account">
              {!provider.installed
                ? "Not installed"
                : provider.auth === "api"
                  ? "Installed · API key detected"
                  : `Installed · ${provider.plan}`}
            </span>
            {provider.installed && usageUnknown ? (
              <p className="usage-unavailable">
                Usage unavailable
                <span>Your allowance may still be available.</span>
              </p>
            ) : provider.installed && provider.auth !== "api" ? (
              <div className="allowances">
                {provider.left.map((remaining, allowanceIndex) => (
                  <div
                    className="allowance"
                    key={allowanceIndex === 0 ? "five-hour" : "weekly"}
                  >
                    <div>
                      <span>
                        {allowanceIndex === 0
                          ? "5-hour allowance"
                          : "Weekly allowance"}
                      </span>
                      <strong>{remaining}% left</strong>
                    </div>
                    <progress
                      aria-label={`${provider.name} ${allowanceIndex === 0 ? "5-hour" : "weekly"} allowance remaining`}
                      max="100"
                      value={remaining}
                    />
                    <small>Resets in {provider.resets[allowanceIndex]}</small>
                  </div>
                ))}
              </div>
            ) : null}
            <span
              className={`provider-status ${provider.auth === "connected" ? "is-connected" : ""}`}
            >
              {provider.auth === "connected"
                ? "Connected to Colony"
                : provider.installed && provider.auth === "detected"
                  ? "Subscription found"
                  : provider.installed
                    ? "Not connected"
                    : "Installation needed"}
            </span>
          </button>
        ))}
      </fieldset>
      <p className="power-caption">
        {stale
          ? "Last reported usage · 1 hour ago. Check again for a fresh reading."
          : "Your AI teammates share these allowances with your other usage."}
      </p>
      {!selected.installed ? (
        <div className="selected-connection">
          <h4>Install {selected.name}</h4>
          <p>
            Install the provider’s app, then sign in with your subscription.
          </p>
        </div>
      ) : null}
      {apiAuth ? (
        <div className="power-notice" role="status">
          <Glyph name="check" />
          <p>
            An API key was found. Sign in with a subscription for this route, or
            choose Bring your own key.
          </p>
        </div>
      ) : null}
      {exhausted ? (
        <div className="power-notice is-error" role="alert">
          <Glyph name="alert" />
          <p>
            This account’s allowance is used up. Wait for its reset or choose
            another connection.
          </p>
        </div>
      ) : null}
      {modelsError ? (
        <div className="power-notice is-error" role="alert">
          <Glyph name="alert" />
          <p>
            Connected, but available models could not be loaded. Check again
            before testing.
          </p>
        </div>
      ) : null}
      {selectedConnected && !modelsError ? (
        <div className="power-model-controls">
          <div className="model-grid">
            <div className="field">
              <label htmlFor="visual-subscription-model">
                Model<span className="field-note">Claude models only</span>
              </label>
              <select id="visual-subscription-model">
                <option>Claude Sonnet · recommended</option>
              </select>
            </div>
          </div>
        </div>
      ) : null}
      <div className="power-cta">
        <button
          className="primary full"
          disabled={selectedConnected && (exhausted || modelsError)}
          type="button"
        >
          {!selected.installed
            ? `Install ${selected.name}`
            : selectedConnected
              ? "Test connection"
              : `Connect ${selected.name}`}{" "}
          <Glyph name="arrow" />
        </button>
        <p>
          {selectedConnected
            ? "A short reply confirms this connection works."
            : "Sign-in stays with the provider."}
        </p>
      </div>
    </>
  );
}

function SubscriptionState({
  scene,
  visualReady = false,
}: {
  scene: OnboardingSceneId;
  visualReady?: boolean;
}) {
  if (scene === "subscription-error") {
    return (
      <div className="power-empty">
        <Glyph name="alert" />
        <h3>We couldn’t check this computer.</h3>
        <p>Your other connection options are still available.</p>
        <button className="secondary" type="button">
          Try discovery again
        </button>
      </div>
    );
  }
  if (
    visualReady &&
    (scene === "connect" || scene.startsWith("subscription-"))
  ) {
    return <ReadySubscriptionPreview scene={scene} />;
  }
  if (scene === "subscription-scan" || scene === "connect")
    return <DiscoveryPreview />;
  const missing = scene === "subscription-missing";
  const exhausted = scene === "subscription-exhausted";
  const usageUnknown = scene === "subscription-usage-unknown";
  const stale = scene === "subscription-stale";
  const rows = ["Claude Code", "Codex"];
  return (
    <>
      <div className="section-heading">
        <h3>On this computer</h3>
        <button className="link" type="button">
          <Glyph name="restart" />
          Check again
        </button>
      </div>
      <fieldset className="subscription-cards">
        <legend className="sr-only">Detected AI apps</legend>
        {rows.map((name, index) => {
          const unavailable = missing || index === 1;
          return (
            <button
              aria-pressed={index === 0}
              className={`subscription-card ${index === 0 ? "selected" : ""}`}
              key={name}
              type="button"
            >
              <span className="provider-top">
                <span className="provider-glyph">{name.slice(0, 1)}</span>
                <strong>{name}</strong>
                <span className="selection-dot" />
              </span>
              <span className="provider-account">
                {unavailable ? "Not installed" : "Installed · Sign-in needed"}
              </span>
              {usageUnknown && !unavailable ? (
                <p className="usage-unavailable">
                  Usage unavailable
                  <span>Your allowance may still be available.</span>
                </p>
              ) : null}
              {exhausted && !unavailable ? (
                <div className="allowance">
                  <div>
                    <span>5-hour allowance</span>
                    <strong>0% left</strong>
                  </div>
                  <progress
                    aria-label="Claude Code 5-hour allowance remaining"
                    max="100"
                    value="0"
                  />
                  <small>Resets in 2h 18m</small>
                </div>
              ) : null}
              <span className="provider-status">
                {unavailable
                  ? "Installation needed"
                  : exhausted
                    ? "Subscription limit reached"
                    : "Subscription found"}
              </span>
            </button>
          );
        })}
      </fieldset>
      {scene === "subscription-api-auth" ? (
        <div className="power-notice is-error" role="alert">
          <Glyph name="alert" />
          <p>
            An API key was found. Sign in with a subscription for this route, or
            choose Bring your own key.
          </p>
        </div>
      ) : null}
      {scene === "subscription-models-error" ? (
        <div className="power-notice is-error" role="alert">
          <Glyph name="alert" />
          <p>
            Models could not be loaded. Your account and connection are
            unchanged.
          </p>
        </div>
      ) : null}
      <p className="power-caption">
        {stale
          ? "Last reported usage · 1 hour ago. Check again for a fresh reading."
          : "Your AI teammates share these allowances with your other usage."}
      </p>
    </>
  );
}

function CreditState({
  scene,
  data,
  onCreditsRetry,
}: {
  scene: OnboardingSceneId;
  data: OnboardingSceneData;
  onCreditsRetry?: () => void;
}) {
  const canPreview = data.visualOnly === true;
  const hasBalance = canPreview
    ? scene === "credits-success"
    : data.creditsSnapshot?.status === "available" &&
      data.creditsSnapshot.balanceUsdCents > 0;
  const balance = canPreview
    ? scene === "credits-success"
      ? "$10.00"
      : "$0.00"
    : data.creditsSnapshot?.status === "available"
      ? `$${(data.creditsSnapshot.balanceUsdCents / 100).toFixed(2)}`
      : data.creditsSnapshot?.status === "loading"
        ? "Checking"
        : "Unavailable";
  const priceUnavailable = scene === "credits-price-error";
  const pending = [
    "credits-pending",
    "credits-delayed",
    "credits-uncertain",
  ].includes(scene);
  const canCheckPayment = canPreview || Boolean(onCreditsRetry);

  return (
    <>
      <div className="balance-header">
        <div>
          <span>Available for {data.business}</span>
          <strong>
            {balance}
            <small>Colony credits</small>
          </strong>
        </div>
        <span className="balance-symbol">
          <AntMark />
        </span>
      </div>
      {priceUnavailable ? (
        <>
          <div className="power-notice is-error" role="alert">
            <Glyph name="alert" />
            <p>Current prices are unavailable. Your balance has not changed.</p>
          </div>
          <button
            className="secondary full"
            disabled={!canPreview && !onCreditsRetry}
            onClick={onCreditsRetry}
            type="button"
          >
            Reload prices
          </button>
        </>
      ) : pending ? (
        <>
          <div className="payment-state">
            <span className="payment-icon">
              <Glyph
                name={
                  scene === "credits-delayed"
                    ? "check"
                    : scene === "credits-uncertain"
                      ? "alert"
                      : "history"
                }
              />
            </span>
            <h3>
              {scene === "credits-delayed"
                ? "Payment received. Credits are on their way."
                : scene === "credits-uncertain"
                  ? "Let’s check that payment."
                  : "Finish your payment in checkout."}
            </h3>
            <p>
              {scene === "credits-delayed"
                ? "Your payment is confirmed. The spendable balance has not updated yet."
                : scene === "credits-uncertain"
                  ? "We haven’t confirmed the outcome. Check this payment before starting another."
                  : "Your checkout is saved. You can reopen it or check after paying."}
            </p>
            {canPreview ? (
              <div className="payment-reference">
                <span>R99 · $5 credits</span>
                <span>CLY-DEMO-001</span>
              </div>
            ) : null}
            <button
              className="primary full"
              disabled={!canCheckPayment}
              onClick={onCreditsRetry}
              type="button"
            >
              {scene === "credits-delayed" ? "Check balance" : "Check payment"}{" "}
              <Glyph name="restart" />
            </button>
            {scene === "credits-pending" ? (
              <button
                className="secondary full"
                disabled={!canCheckPayment}
                onClick={onCreditsRetry}
                type="button"
              >
                Open checkout again
              </button>
            ) : null}
          </div>
          <p className="power-caption">
            Connection testing unlocks when credits are available.
          </p>
        </>
      ) : hasBalance ? (
        <>
          <div className="credit-success">
            <Glyph name="check" />
            <div>
              <strong>Payment confirmed</strong>
              <p>
                {data.creditsSnapshot?.status === "available"
                  ? `$${(data.creditsSnapshot.balanceUsdCents / 100).toFixed(2)} added to this business.`
                  : "$10.00 added to this business."}
              </p>
            </div>
            <button className="link" type="button">
              Receipt
            </button>
          </div>
          <button className="link add-another" type="button">
            Add more credits
          </button>
          <div className="credits-model">
            <span>
              <Glyph name="check" /> Colony recommended model
            </span>
            <button className="link" type="button">
              Change
            </button>
          </div>
          <div className="power-cta">
            <button className="primary full" type="button">
              Test connection <Glyph name="arrow" />
            </button>
            <p>The test uses a small amount of your balance.</p>
          </div>
        </>
      ) : (
        <>
          {scene === "credits-failed" || scene === "credits-cancelled" ? (
            <div
              className={`power-notice ${scene === "credits-failed" ? "is-error" : ""}`}
              role={scene === "credits-failed" ? "alert" : "status"}
            >
              <Glyph name={scene === "credits-failed" ? "alert" : "check"} />
              <p>
                {scene === "credits-failed"
                  ? "The payment was declined. No credits were added. You can try another payment method."
                  : "Checkout was cancelled. No credits were added."}
              </p>
            </div>
          ) : null}
          <div className="section-heading">
            <h3>Add credits to get started</h3>
            <span>One-off purchase</span>
          </div>
          <fieldset className="credit-packs">
            <legend className="sr-only">Credit amount</legend>
            {["$5", "$10", "$25"].map((amount, index) => (
              <button
                aria-pressed={index === 0}
                disabled={!canPreview}
                key={amount}
                type="button"
              >
                <strong>{amount}</strong>
                <span>Pay R{[99, 199, 499][index]}</span>
              </button>
            ))}
          </fieldset>
          <div className="field">
            <label htmlFor="receipt-email">Receipt email</label>
            <input
              autoComplete="email"
              id="receipt-email"
              type="email"
              value={data.email}
              readOnly
            />
          </div>
          <p className="power-caption">
            You pay in rands. AI usage is counted in US dollars.
          </p>
          <div className="power-cta">
            <button
              className="primary full"
              disabled={!canPreview}
              type="button"
            >
              Review top-up <Glyph name="arrow" />
            </button>
          </div>
        </>
      )}
    </>
  );
}

function OpenRouterState({
  scene,
  enabled,
}: {
  scene: OnboardingSceneId;
  enabled: boolean;
}) {
  const connected =
    scene === "openrouter-connected" || scene === "openrouter-limit";
  return (
    <>
      <div className="route-intro">
        <span className="route-brand">◈</span>
        <div>
          <h3>Your OpenRouter account</h3>
          <p>One connection, a choice of models.</p>
        </div>
        {connected ? <span className="connected-pill">Connected</span> : null}
      </div>
      {scene === "openrouter-error" ? (
        <div className="power-notice is-error" role="alert">
          <Glyph name="alert" />
          <p>OpenRouter sign-in did not finish. Try again.</p>
        </div>
      ) : null}
      {!connected ? (
        <>
          <div className="openrouter-intro">
            <p>Connect in your browser, then choose a free or paid model.</p>
            <ul>
              <li>Keep your existing OpenRouter account.</li>
              <li>Review its balance and limits here.</li>
              <li>OpenRouter billing stays separate from Colony credits.</li>
            </ul>
          </div>
          <button className="primary full" disabled={!enabled} type="button">
            Connect OpenRouter <Glyph name="arrow" />
          </button>
        </>
      ) : (
        <>
          <div className="openrouter-balance">
            <span>
              OpenRouter balance<strong>$12.50</strong>
            </span>
            <button className="link" disabled={!enabled} type="button">
              Manage on OpenRouter <Glyph name="arrow" />
            </button>
          </div>
          <fieldset className="model-modes">
            <legend className="sr-only">OpenRouter model type</legend>
            <button
              aria-pressed={scene !== "openrouter-limit"}
              disabled={!enabled}
              type="button"
            >
              Free models
            </button>
            <button
              aria-pressed={scene === "openrouter-limit"}
              disabled={!enabled}
              type="button"
            >
              Paid models
            </button>
          </fieldset>
          <div className="openrouter-model">
            <div className="field">
              <label htmlFor="router-model">Model</label>
              <select disabled={!enabled} id="router-model">
                <option>Choose a free model automatically</option>
                <option>Qwen3.8 27B (free)</option>
              </select>
            </div>
            <div className="quota-line">
              <span>Daily free allowance</span>
              <strong>
                {scene === "openrouter-limit" ? "0" : "38"} / 50 requests left
              </strong>
            </div>
            <progress
              aria-label="OpenRouter daily free requests remaining"
              max="50"
              value={scene === "openrouter-limit" ? "0" : "38"}
            />
            <p className="power-caption">
              Resets at midnight UTC. Limits are shared across OpenRouter usage.
            </p>
          </div>
          {scene === "openrouter-limit" ? (
            <div className="power-notice is-error" role="alert">
              <Glyph name="alert" />
              <p>
                The free allowance is used up. Wait for the reset or choose a
                paid model.
              </p>
            </div>
          ) : null}
          <div className="power-cta">
            <button
              className="primary full"
              disabled={!enabled || scene === "openrouter-limit"}
              type="button"
            >
              Test connection <Glyph name="arrow" />
            </button>
            <p>Uses the selected OpenRouter model.</p>
          </div>
        </>
      )}
    </>
  );
}

function ApiKeyState({
  scene,
  enabled,
}: {
  scene: OnboardingSceneId;
  enabled: boolean;
}) {
  return (
    <>
      <div className="section-heading">
        <h3>Connect directly to a provider</h3>
      </div>
      <div className="key-fields">
        <div className="field">
          <label htmlFor="key-provider">Provider</label>
          <select disabled={!enabled} id="key-provider">
            <option>Anthropic</option>
            <option>OpenAI</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="provider-key">API key</label>
          <div className="input-wrap">
            <input
              autoComplete="off"
              disabled={!enabled}
              id="provider-key"
              placeholder="Paste your provider’s key"
              type="password"
            />
            <button aria-label="Show API key" disabled={!enabled} type="button">
              Show
            </button>
          </div>
        </div>
      </div>
      <p className="power-caption">
        Usage is billed by your provider, separately from any subscription.
      </p>
      {scene === "api-error" ? (
        <div className="power-notice is-error" role="alert">
          <Glyph name="alert" />
          <p>
            This key could not be verified. Check the provider, key and
            available billing balance.
          </p>
        </div>
      ) : null}
      <button className="primary full" disabled={!enabled} type="button">
        {scene === "api-error" ? "Check key again" : "Check key"}{" "}
        <Glyph name="arrow" />
      </button>
      <p className="power-demo-note">
        Preview only: enter a sample key, not a real credential.
      </p>
    </>
  );
}

function StaticConnectContent({
  scene,
  data,
  onCreditsRetry,
}: {
  scene: OnboardingSceneId;
  data: OnboardingSceneData;
  onCreditsRetry?: () => void;
}) {
  if (
    scene === "openrouter-unlinked" ||
    scene === "openrouter-connected" ||
    scene === "openrouter-limit" ||
    scene === "openrouter-error"
  )
    return <OpenRouterState enabled={data.visualOnly === true} scene={scene} />;
  if (scene === "api-key" || scene === "api-error")
    return <ApiKeyState enabled={data.visualOnly === true} scene={scene} />;
  if (scene.startsWith("credits") || scene === "funding")
    return (
      <CreditState data={data} onCreditsRetry={onCreditsRetry} scene={scene} />
    );
  return (
    <SubscriptionState scene={scene} visualReady={data.visualOnly === true} />
  );
}

function HistoryDialog({ review = false }: { review?: boolean }) {
  return (
    <ReferenceDialog>
      {!review ? (
        <div className="status-icon">
          <Glyph name="history" />
        </div>
      ) : null}
      <h2 id="onboarding-reference-dialog-title" tabIndex={-1}>
        {review ? "Keep what’s useful." : "Bring your context with you."}
      </h2>
      <p className="lede">
        {review
          ? "Edit or uncheck anything that doesn’t belong."
          : "Turn useful details from past AI conversations into memories for your Colony. You choose what to keep."}
      </p>
      {review ? (
        <div className="memory-list">
          {[
            ["I run a small homeware studio in Johannesburg.", "Claude Code"],
            [
              "I prefer warm, straightforward copy without sales jargon.",
              "Claude Code",
            ],
            ["I’m preparing a spring collection launch.", "Codex"],
          ].map(([item, source]) => (
            <label className="memory-row" key={item}>
              <input aria-label="Keep memory" defaultChecked type="checkbox" />
              <span>
                <textarea aria-label="Memory" defaultValue={item} />
                <small>{source} · Sample conversation</small>
              </span>
            </label>
          ))}
        </div>
      ) : null}
      {review ? (
        <div className="modal-actions">
          <button className="link" type="button">
            Skip for now
          </button>
          <button className="primary" type="button">
            Save memories <Glyph name="check" />
          </button>
        </div>
      ) : (
        <>
          <button className="primary full" type="button">
            Find my history <Glyph name="arrow" />
          </button>
          <button className="back" type="button">
            Choose a conversation export
          </button>
          <p className="hint">
            Nothing is imported until you review and save it.
          </p>
        </>
      )}
    </ReferenceDialog>
  );
}

function ReferenceDialog({ children }: { children: React.ReactNode }) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return createPortal(
    <div className="colony-onboarding-root">
      <dialog
        aria-labelledby="onboarding-reference-dialog-title"
        className="onboarding-reference-dialog"
        id="onboarding-reference-dialog"
        ref={dialogRef}
      >
        <div className="modal">
          <button
            aria-label="Close dialog"
            className="icon-button close"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            <Glyph name="x" />
          </button>
          {children}
        </div>
      </dialog>
    </div>,
    document.body,
  );
}

function CreditReviewDialog({ data }: { data: OnboardingSceneData }) {
  return (
    <ReferenceDialog>
      <h2 id="onboarding-reference-dialog-title" tabIndex={-1}>
        Review your top-up.
      </h2>
      <p className="lede">A one-off purchase for {data.business}.</p>
      <dl className="purchase-summary">
        <div>
          <dt>Colony credits</dt>
          <dd>$5.00</dd>
        </div>
        <div>
          <dt>Receipt to</dt>
          <dd>{data.email}</dd>
        </div>
        <div className="total">
          <dt>You pay</dt>
          <dd>
            R99.00 <small>ZAR</small>
          </dd>
        </div>
      </dl>
      <p className="power-caption">No recurring charge or automatic top-up.</p>
      <button className="primary full" type="button">
        Continue to checkout <Glyph name="arrow" />
      </button>
      <button
        className="back"
        onClick={() =>
          (
            document.getElementById(
              "onboarding-reference-dialog",
            ) as HTMLDialogElement | null
          )?.close()
        }
        type="button"
      >
        Change amount
      </button>
    </ReferenceDialog>
  );
}

function WorkspacePreview({
  data,
  scene,
}: {
  data: OnboardingSceneData;
  scene: OnboardingSceneId;
}) {
  const history = scene === "history" || scene === "history-review";
  return (
    <>
      <section className="workspace">
        <div className="windowbar">
          <span className="traffic">
            <i />
            <i />
            <i />
          </span>
          <span>{data.business}</span>
        </div>
        <aside className="sidebar">
          <Brand />
          <button className="business-switch" type="button">
            <span className="business-initial">
              {data.business.slice(0, 1) || "L"}
            </span>
            <strong>{data.business || "Lerato Studio"}</strong>
            <Glyph name="down" />
          </button>
          <nav aria-label="Workspace">
            <button
              aria-current="page"
              className="side-item active"
              type="button"
            >
              <Glyph name="home" />
              Today
            </button>
            <button className="side-item" type="button">
              <Glyph name="team" />
              Your team
            </button>
            <button className="side-item" type="button">
              <Glyph name="chat" />
              Conversations
            </button>
            <button className="side-item" type="button">
              <Glyph name="folder" />
              Files &amp; knowledge
            </button>
          </nav>
          <div className="sidebar-bottom">
            <button className="import-link" type="button">
              <Glyph name="history" />
              Bring your AI history
            </button>
            <div className="profile">
              <span className="initials">LM</span>
              {data.name || "Lerato Molefe"}
            </div>
          </div>
        </aside>
        <div className="workspace-main">
          <header className="workspace-top">
            <span>Today</span>
            <span>
              <Glyph name="check" />
              Your Colony is ready
            </span>
          </header>
          <div className="arrival">
            <h1>You’re in, {data.name.trim().split(" ")[0] || "Lerato"}.</h1>
            <p className="lede">
              A good place to start is one small piece of work.
            </p>
            <div className="greeting-agent">
              <span className="agent-avatar" />
              <strong>Scout</strong>
              <span>Your AI teammate</span>
            </div>
            <p className="welcome-message">
              I can help you plan, write and keep track of the work that moves
              your business forward.
            </p>
            <div className="suggestions">
              <button className="suggestion" type="button">
                <Glyph name="sparkles" />
                Plan my next launch
              </button>
              <button className="suggestion" type="button">
                <Glyph name="document" />
                Draft something for my business
              </button>
            </div>
            <div className="composer">
              <textarea
                aria-label="Message Scout"
                placeholder="What would you like to work on?"
              />
              <div className="composer-bottom">
                <span>Your team works with you here.</span>
                <button className="send-button" type="button">
                  <Glyph name="send" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
      {history ? <HistoryDialog review={scene === "history-review"} /> : null}
    </>
  );
}

function ConnectedScene({
  data,
  onNavigate,
  focusTitle = false,
}: Pick<PresentationProps, "data" | "onNavigate"> & {
  focusTitle?: boolean;
}) {
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    if (focusTitle) headingRef.current?.focus({ preventScroll: true });
  }, [focusTitle]);

  return (
    <>
      <div className="agent-avatar large" />
      <h2 ref={headingRef} tabIndex={-1}>
        That’s a good start.
      </h2>
      <p className="lede">Your agent is connected and ready to work.</p>
      <div className="reply">
        <div className="reply-header">
          <span className="agent-avatar" />
          <strong>Scout</strong>
          <span>
            <Glyph name="check" />
            Replied
          </span>
        </div>
        <p>
          Hello {data.name.trim().split(" ")[0] || "Lerato"}, I’m here.
          <br />
          What shall we work on first?
        </p>
      </div>
      <div className="connection-meta">
        <span>Claude Code subscription</span>
        <span>
          <i className="status-dot" />
          Connection verified
        </span>
      </div>
      <PrimaryButton onClick={() => onNavigate?.("workspace")}>
        Open my Colony
      </PrimaryButton>
      <BackButton onClick={() => onNavigate?.("connect")}>
        Change connection
      </BackButton>
    </>
  );
}

function SceneBody(props: PresentationProps) {
  const {
    data,
    scene,
    onNavigate,
    onResend,
    contentOverride,
    connectionContentOverride,
    onSelectConnection,
    onCreditsRetry,
  } = props;
  if (contentOverride) return <>{contentOverride}</>;
  if (scene === "account" || scene === "account-error") {
    return (
      <AccountForm
        {...props}
        error={
          scene === "account-error"
            ? "This email already has an account. Sign in instead."
            : props.error
        }
      />
    );
  }
  if (scene === "signin") return <SignInForm {...props} />;
  if (
    scene === "forgot" ||
    scene === "email-sent" ||
    scene === "new-password" ||
    scene === "reset-done" ||
    scene === "reset-expired"
  ) {
    return <StatusScene {...props} onResend={onResend} />;
  }
  if (
    scene === "business" ||
    scene === "business-error" ||
    scene === "additional"
  ) {
    return (
      <BusinessForm
        {...props}
        error={
          scene === "business-error"
            ? (props.error ??
              "We couldn’t read that website. You can add a logo and description yourself.")
            : props.error
        }
      />
    );
  }
  if (scene === "businesses")
    return (
      <BusinessChooser
        businessChoices={props.businessChoices}
        data={data}
        error={props.error}
        onCreateBusiness={props.onCreateBusiness}
        onNavigate={onNavigate}
        onSelectBusiness={props.onSelectBusiness}
      />
    );
  if (scene === "invite") return <InviteScene {...props} />;
  if (
    scene === "connect" ||
    scene === "funding" ||
    scene.startsWith("subscription") ||
    scene.startsWith("credits") ||
    scene.startsWith("openrouter") ||
    scene === "api-key" ||
    scene === "api-error"
  ) {
    return (
      <ConnectionShell
        content={
          connectionContentOverride ?? (
            <StaticConnectContent
              data={data}
              onCreditsRetry={onCreditsRetry}
              scene={scene}
            />
          )
        }
        data={data}
        harnessMark={props.harnessMark}
        onNavigate={onNavigate}
        onSelectConnection={onSelectConnection}
        scene={scene}
      />
    );
  }
  if (scene === "testing") {
    return (
      <>
        <div className="agent-avatar large" />
        <h2>A first hello.</h2>
        <p className="lede">We’re checking that your agent can reply.</p>
        <ol className="progress-list">
          <li className="complete">
            <Glyph name="check" />
            Connection saved
          </li>
          <li>
            <span className="spinner" />
            Starting your agent
          </li>
          <li>
            <span className="waiting-dot" />
            Waiting for a reply
          </li>
        </ol>
        <button className="secondary full" type="button">
          Cancel test
        </button>
      </>
    );
  }
  if (scene === "connected") {
    return (
      <ConnectedScene
        data={data}
        focusTitle={data.visualOnly}
        onNavigate={onNavigate}
      />
    );
  }
  if (scene === "connection-error") {
    return (
      <>
        <div className="status-icon">
          <Glyph name="link" />
        </div>
        <h2>No reply just yet.</h2>
        <p className="lede">We couldn’t get a response from your agent.</p>
        <InlineAlert>
          Your connection isn’t working yet. Check that you’re signed in and
          that your account has usage available.
        </InlineAlert>
        <div className="notice">
          Your account and business details are saved. You won’t need to start
          again.
        </div>
        <PrimaryButton onClick={() => onNavigate?.("testing")}>
          Try again
        </PrimaryButton>
        <button
          className="secondary full alternate-connection"
          onClick={() => onNavigate?.("connect")}
          type="button"
        >
          Choose another connection
        </button>
      </>
    );
  }
  return null;
}

export function OnboardingScenePresentation(props: PresentationProps) {
  const workspaceScene =
    props.scene === "workspace" ||
    props.scene === "history" ||
    props.scene === "history-review";
  if (workspaceScene) {
    return (
      <div className="colony-onboarding-root">
        <div className="onboarding-viewport">
          <div className="app-frame onboarding-app-frame">
            <WorkspacePreview data={props.data} scene={props.scene} />
          </div>
        </div>
      </div>
    );
  }
  const access = accessScene(props.scene);
  const switchText = access ? null : props.scene === "account" ||
    props.scene === "account-error" ? (
    <span>
      Already have an account?{" "}
      <button
        className="link"
        onClick={() => props.onNavigate?.("signin")}
        type="button"
      >
        Sign in
      </button>
    </span>
  ) : props.scene === "additional" ? (
    <button
      className="link"
      onClick={() => props.onNavigate?.("workspace")}
      type="button"
    >
      Cancel setup
    </button>
  ) : null;
  const power = onboardingSceneStage(props.scene) === 2;
  return (
    <div className="colony-onboarding-root">
      <div className="onboarding-viewport">
        <section className="app-frame onboarding-app-frame">
          <div
            className={`setup ${power ? "power-setup" : ""}`}
            data-testid={`onboarding-scene-${props.scene}`}
          >
            <div className="windowbar">
              <span className="traffic" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>Colony</span>
            </div>
            <StoryPanel
              data={props.data}
              onLogoError={props.onLogoError}
              scene={props.scene}
            />
            <div className="form-side">
              <div className="account-switch">{switchText}</div>
              <div
                className={`form-content screen-enter ${power ? "wide power-content" : ""} ${onboardingSceneStage(props.scene) === 1 ? "business-content" : ""}`}
              >
                <SceneBody {...props} />
              </div>
              <div className="form-side-foot" aria-hidden="true" />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
