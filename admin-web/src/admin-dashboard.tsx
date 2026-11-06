import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ApiFailure,
  createGoogleAdminSession,
  probeAuthMode,
  request,
  requestOperatorProbe,
  startEmailAdminSession,
  verifyEmailAdminSession,
  type AuthMode,
} from "./api";
import type {
  AiUsageMetrics,
  AttentionItem,
  BusinessDetailMetrics,
  BusinessSort,
  BusinessesMetrics,
  HealthMetrics,
  MetricDelta,
  MetricValue,
  OnboardingProgress,
  OverviewMetrics,
} from "./admin-metrics";
import { useResource } from "./useResource";
import { ColonyAdminMark } from "./colony-admin-mark";
import "./admin-dashboard.css";

const googleClientId =
  import.meta.env.VITE_COLONY_ADMIN_GOOGLE_CLIENT_ID?.trim() ?? "";
const nonceStorageKey = "colony_admin_oidc_nonce";
const authModeStorageKey = "colony_admin_auth_mode";

type OperatorSession =
  | { status: "checking" }
  | { status: "signed-out"; message?: string }
  | { status: "denied" }
  | { status: "error"; message: string }
  | { status: "signed-in"; authMode: AuthMode };

export function isOperatorAdminPath(path: string): boolean {
  return (
    path === "/" ||
    path === "/overview" ||
    path === "/businesses" ||
    /^\/businesses\/[^/]+$/.test(path) ||
    path === "/ai-usage" ||
    path === "/system" ||
    path === "/sign-in" ||
    path === "/reports" ||
    /^\/reports\/[^/]+$/.test(path) ||
    path === "/feedback" ||
    /^\/feedback\/[^/]+$/.test(path)
  );
}

export type OperatorPageRenderer = (
  path: string,
  authMode: AuthMode,
) => ReactNode | null;

export function OperatorAdminApp({
  path,
  renderPage,
}: {
  path: string;
  renderPage?: OperatorPageRenderer;
}) {
  const [session, setSession] = useState<OperatorSession>({
    status: "checking",
  });
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [fallbackBusy, setFallbackBusy] = useState(false);
  const route = path === "/" ? "/overview" : path;
  const isCallback = path === "/sign-in" && location.hash.length > 1;
  const callbackSession = useRef<Promise<OperatorSession> | null>(null);
  const [localHealthBadge, setLocalHealthBadge] = useState<number>();

  useEffect(() => {
    let active = true;
    const verifyCookie = async (): Promise<OperatorSession> => {
      try {
        const probe = await requestOperatorProbe("cookie");
        if (probe.role === "operator") {
          sessionStorage.removeItem(authModeStorageKey);
          return { status: "signed-in", authMode: "cookie" };
        }
        const fallbackMode = await probeAuthMode();
        if (fallbackMode === "disabled") {
          return { status: "signed-in", authMode: "disabled" };
        }
        sessionStorage.removeItem(authModeStorageKey);
        return { status: "denied" };
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 401) {
          return { status: "signed-out" };
        } else if (error instanceof ApiFailure && error.status === 403) {
          return { status: "denied" };
        } else {
          return {
            status: "error",
            message:
              error instanceof Error
                ? error.message
                : "The admin service is unavailable.",
          };
        }
      }
    };
    const verifyNip98 = async (): Promise<OperatorSession> => {
      try {
        const probe = await requestOperatorProbe("nip98");
        if (probe.role === "operator")
          return { status: "signed-in", authMode: "nip98" };
        sessionStorage.removeItem(authModeStorageKey);
        return { status: "denied" };
      } catch (error) {
        if (error instanceof ApiFailure && error.status === 401) {
          sessionStorage.removeItem(authModeStorageKey);
          return { status: "signed-out" };
        }
        if (error instanceof ApiFailure && error.status === 403) {
          sessionStorage.removeItem(authModeStorageKey);
          return { status: "denied" };
        }
        return {
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "The admin service is unavailable.",
        };
      }
    };
    const completeGoogleSignIn = async (): Promise<OperatorSession> => {
      const callback = consumeGoogleCallback();
      if (callback.error) {
        return {
          status: "signed-out",
          message: "Google sign-in was not completed. Try again.",
        };
      }
      if (!callback.idToken || !callback.nonce) {
        return {
          status: "signed-out",
          message: "The sign-in response expired. Try again.",
        };
      }
      try {
        await createGoogleAdminSession(callback.idToken, callback.nonce);
        sessionStorage.removeItem(authModeStorageKey);
        return await verifyCookie();
      } catch (error) {
        return {
          status: "signed-out",
          message:
            error instanceof ApiFailure && error.status === 403
              ? "We could not verify this account as a Colony operator."
              : "Colony sign-in could not be completed. Try again.",
        };
      }
    };
    let task: Promise<OperatorSession>;
    if (isCallback) {
      if (!callbackSession.current)
        callbackSession.current = completeGoogleSignIn();
      task = callbackSession.current;
    } else {
      task =
        sessionStorage.getItem(authModeStorageKey) === "nip98"
          ? verifyNip98()
          : verifyCookie();
    }
    void task.then((result) => {
      if (active) setSession(result);
    });
    return () => {
      active = false;
    };
  }, [isCallback]);

  useEffect(() => {
    if (path === "/sign-in" && session.status === "signed-in") {
      history.replaceState(null, "", "/overview");
      dispatchEvent(new PopStateEvent("popstate"));
    }
  }, [path, session.status]);

  const startGoogleSignIn = () => {
    if (!googleClientId) {
      setSession({
        status: "signed-out",
        message: "Google sign-in is not configured yet. Use NIP-98 instead.",
      });
      return;
    }
    const nonce = randomNonce();
    sessionStorage.setItem(nonceStorageKey, nonce);
    const redirectUri = new URL("/sign-in", location.origin).toString();
    const params = new URLSearchParams({
      client_id: googleClientId,
      redirect_uri: redirectUri,
      response_type: "id_token",
      scope: "openid email",
      nonce,
      prompt: "select_account",
    });
    location.assign(
      `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    );
  };

  const signInWithNip98 = async () => {
    setFallbackBusy(true);
    try {
      const probe = await requestOperatorProbe("nip98");
      if (probe.role === "operator") {
        sessionStorage.setItem(authModeStorageKey, "nip98");
        setSession({ status: "signed-in", authMode: "nip98" });
      } else {
        sessionStorage.removeItem(authModeStorageKey);
        setSession({ status: "denied" });
      }
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 403) {
        sessionStorage.removeItem(authModeStorageKey);
        setSession({ status: "denied" });
      } else if (error instanceof ApiFailure && error.status === 401) {
        sessionStorage.removeItem(authModeStorageKey);
        setSession({
          status: "signed-out",
          message: "The NIP-98 credential was rejected.",
        });
      } else {
        setSession({
          status: "signed-out",
          message:
            error instanceof Error
              ? error.message
              : "NIP-98 sign-in could not be completed.",
        });
      }
    } finally {
      setFallbackBusy(false);
    }
  };

  const startEmailSignIn = (email: string) => startEmailAdminSession(email);

  const completeEmailSignIn = async (email: string, code: string) => {
    await verifyEmailAdminSession(email, code);
    sessionStorage.removeItem(authModeStorageKey);
    const probe = await requestOperatorProbe("cookie");
    if (probe.role === "operator") {
      setSession({ status: "signed-in", authMode: "cookie" });
      return;
    }
    sessionStorage.removeItem(authModeStorageKey);
    setSession({ status: "denied" });
  };

  const authMode = session.status === "signed-in" ? session.authMode : "cookie";
  const needsRemoteBadge =
    session.status === "signed-in" &&
    route !== "/overview" &&
    route !== "/system";
  const badgeResource = useResource<OverviewMetrics>(
    () => {
      if (!needsRemoteBadge)
        return Promise.reject(new Error("Operator access required."));
      return request<OverviewMetrics>(`/metrics/overview?days=30`, authMode);
    },
    needsRemoteBadge
      ? `overview-badge-${authMode}`
      : `overview-badge-none-${session.status}-${route}`,
  );
  const remoteHealthBadge = redHealthCount(badgeResource.data?.needsAttention);
  const healthBadge = needsRemoteBadge ? remoteHealthBadge : localHealthBadge;

  if (session.status === "checking") {
    return (
      <div className="ad-auth-loading" role="status">
        Checking Colony operator access...
      </div>
    );
  }
  if (session.status === "error") {
    return (
      <SignInScreen
        message={session.message}
        googleConfigured={Boolean(googleClientId)}
        fallbackBusy={false}
        onGoogle={startGoogleSignIn}
        onNip98={signInWithNip98}
        onEmailStart={startEmailSignIn}
        onEmailVerify={completeEmailSignIn}
      />
    );
  }
  if (session.status === "denied") {
    return (
      <div className="ad-auth-page">
        <section className="ad-auth-card" aria-labelledby="ad-access-denied">
          <ColonyAdminMark />
          <p className="ad-eyebrow">Colony admin</p>
          <h1 id="ad-access-denied">Access denied</h1>
          <p>This page is available to configured Colony operators only.</p>
          <a className="ad-secondary-button" href="/sign-in">
            Return to sign in
          </a>
        </section>
      </div>
    );
  }
  if (session.status === "signed-out") {
    return (
      <SignInScreen
        message={session.message}
        googleConfigured={Boolean(googleClientId)}
        fallbackBusy={fallbackBusy}
        onGoogle={startGoogleSignIn}
        onNip98={signInWithNip98}
        onEmailStart={startEmailSignIn}
        onEmailVerify={completeEmailSignIn}
      />
    );
  }

  const additionalContent = renderPage?.(route, authMode);
  const selectedBusiness = route.match(/^\/businesses\/([^/]+)$/);
  const content =
    additionalContent ??
    (selectedBusiness ? (
      <BusinessDetailPage
        communityId={decodeURIComponent(selectedBusiness[1])}
        authMode={authMode}
        days={days}
        onDaysChange={setDays}
      />
    ) : route === "/businesses" ? (
      <BusinessesPage authMode={authMode} days={days} onDaysChange={setDays} />
    ) : route === "/ai-usage" ? (
      <AiUsagePage authMode={authMode} days={days} onDaysChange={setDays} />
    ) : route === "/system" ? (
      <HealthPage authMode={authMode} onHealthBadge={setLocalHealthBadge} />
    ) : (
      <OverviewPage
        authMode={authMode}
        days={days}
        onDaysChange={setDays}
        onHealthBadge={setLocalHealthBadge}
      />
    ));

  return (
    <AdminShell route={route} healthBadge={healthBadge}>
      {content}
    </AdminShell>
  );
}

export function AdminShell({
  route,
  healthBadge,
  children,
}: {
  route: string;
  healthBadge?: number;
  children: ReactNode;
}) {
  return (
    <div className="ad-app">
      <aside className="ad-sidebar">
        <a className="ad-brand" href="/overview">
          <ColonyAdminMark />
          <span>
            <strong>Colony admin</strong>
            <small>Operator only</small>
          </span>
        </a>
        <nav className="ad-nav" aria-label="Operator pages">
          <NavLink href="/overview" path={route} icon="overview">
            Overview
          </NavLink>
          <NavLink href="/businesses" path={route} icon="businesses">
            Businesses
          </NavLink>
          <NavLink href="/ai-usage" path={route} icon="ai">
            AI usage
          </NavLink>
          <NavLink
            href="/system"
            path={route}
            icon="health"
            badge={healthBadge}
          >
            Health
          </NavLink>
          <NavLink href="/reports" path={route} icon="reports">
            Reports
          </NavLink>
          <NavLink href="/feedback" path={route} icon="feedback">
            Feedback
          </NavLink>
        </nav>
        <p className="ad-privacy-note">
          Counts and health only. No message content is ever shown here.
        </p>
      </aside>
      <main className="ad-main">{children}</main>
    </div>
  );
}

function SignInScreen({
  message,
  googleConfigured,
  fallbackBusy,
  onGoogle,
  onNip98,
  onEmailStart,
  onEmailVerify,
}: {
  message?: string;
  googleConfigured: boolean;
  fallbackBusy: boolean;
  onGoogle: () => void;
  onNip98: () => void;
  onEmailStart: (email: string) => Promise<{ retryAfterSeconds: number }>;
  onEmailVerify: (email: string, code: string) => Promise<void>;
}) {
  const hasNip07 = Boolean((window as Window & { nostr?: unknown }).nostr);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"request" | "code">("request");
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState<string>();
  const [emailNotice, setEmailNotice] = useState<string>();
  const [resendSeconds, setResendSeconds] = useState(0);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = window.setTimeout(
      () => setResendSeconds((seconds) => Math.max(0, seconds - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [resendSeconds]);

  const requestCode = async () => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setEmailError("Enter the email address you use for Colony admin.");
      return;
    }
    setEmailBusy(true);
    setEmailError(undefined);
    try {
      const result = await onEmailStart(normalizedEmail);
      setEmail(normalizedEmail);
      setCode("");
      setStep("code");
      setEmailNotice("Check your inbox for an eight-digit code.");
      setResendSeconds(Math.max(0, result.retryAfterSeconds));
    } catch {
      setEmailNotice(undefined);
      setEmailError("We could not send a code. Please try again.");
    } finally {
      setEmailBusy(false);
    }
  };

  const verifyCode = async () => {
    if (code.length !== 8) {
      setEmailError("Enter the eight-digit code from your email.");
      return;
    }
    setEmailBusy(true);
    setEmailError(undefined);
    setEmailNotice("Signing you in...");
    try {
      await onEmailVerify(email, code);
    } catch {
      setEmailNotice(undefined);
      setEmailError(
        "That code did not work. Enter the latest code or send another one.",
      );
    } finally {
      setEmailBusy(false);
    }
  };

  return (
    <div className="ad-auth-page">
      <section className="ad-auth-card" aria-labelledby="ad-sign-in-title">
        <ColonyAdminMark />
        <p className="ad-eyebrow">Colony admin · Operator only</p>
        <h1 id="ad-sign-in-title">Sign in with your Colony account</h1>
        <p>
          Use your approved operator email, Google account, or NIP-98 key to
          continue.
        </p>
        {message ? (
          <p className="ad-auth-message" role="alert">
            {message}
          </p>
        ) : null}
        <form
          className="ad-email-code-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (step === "request") void requestCode();
            else void verifyCode();
          }}
        >
          {step === "request" ? (
            <>
              <label
                className="ad-email-code-label"
                htmlFor="ad-operator-email"
              >
                Operator email address
              </label>
              <input
                id="ad-operator-email"
                className="ad-email-code-input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={emailBusy}
              />
              <p className="ad-email-code-help">
                The code goes to the operator email on the allowlist. If nothing
                arrives, check spam or ask the coordinator.
              </p>
              <button
                className="ad-email-code-button"
                type="submit"
                disabled={emailBusy}
              >
                {emailBusy ? "Sending code..." : "Email me a code"}
              </button>
            </>
          ) : (
            <>
              <label className="ad-email-code-label" htmlFor="ad-operator-code">
                Eight-digit code
              </label>
              <input
                id="ad-operator-code"
                className="ad-email-code-input ad-email-code-input-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={8}
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, ""))
                }
                disabled={emailBusy}
              />
              <button
                className="ad-email-code-button"
                type="submit"
                disabled={emailBusy}
              >
                {emailBusy ? "Verifying code..." : "Verify code"}
              </button>
              <button
                className="ad-email-code-resend"
                type="button"
                onClick={() => void requestCode()}
                disabled={emailBusy || resendSeconds > 0}
              >
                {resendSeconds > 0
                  ? `Resend code in ${resendSeconds}s`
                  : "Resend code"}
              </button>
              <button
                className="ad-email-code-change"
                type="button"
                onClick={() => {
                  setStep("request");
                  setCode("");
                  setEmailError(undefined);
                  setEmailNotice(undefined);
                }}
                disabled={emailBusy}
              >
                Use a different email
              </button>
            </>
          )}
          {emailNotice ? (
            <p className="ad-email-code-notice" role="status">
              {emailNotice}
            </p>
          ) : null}
          {emailError ? (
            <p className="ad-email-code-error" role="alert">
              {emailError}
            </p>
          ) : null}
        </form>
        <div className="ad-auth-divider">
          <span>or</span>
        </div>
        <button
          className="ad-google-button"
          type="button"
          onClick={onGoogle}
          disabled={!googleConfigured}
        >
          <GoogleIcon />
          {googleConfigured
            ? "Continue with Google"
            : "Google sign-in is not configured"}
        </button>
        {!googleConfigured ? (
          <p className="ad-muted-note">
            NIP-98 remains available while Google sign-in is configured.
          </p>
        ) : null}
        <div className="ad-auth-divider">
          <span>or</span>
        </div>
        <button
          className="ad-secondary-button"
          type="button"
          onClick={onNip98}
          disabled={!hasNip07 || fallbackBusy}
        >
          {fallbackBusy ? "Checking NIP-98..." : "Use NIP-98 instead"}
        </button>
        {hasNip07 ? (
          <p className="ad-muted-note">
            Your browser extension signs a read-only operator check.
          </p>
        ) : (
          <p className="ad-muted-note">
            Install a NIP-07 extension such as{" "}
            <a href="https://getalby.com" target="_blank" rel="noreferrer">
              Alby
            </a>{" "}
            to use the fallback.
          </p>
        )}
      </section>
    </div>
  );
}

function NavLink({
  href,
  path,
  icon,
  badge,
  children,
}: {
  href: string;
  path: string;
  icon: string;
  badge?: number;
  children: string;
}) {
  const [pathname, hash = ""] = href.split("#");
  const currentHash = location.hash.slice(1);
  const isAnchor = Boolean(hash);
  const active =
    path === pathname && (isAnchor ? currentHash === hash : !currentHash);
  return (
    <a
      className="ad-nav-link"
      href={href}
      aria-current={active ? "page" : undefined}
      aria-label={badge ? `${children}, ${badge} health alerts` : undefined}
    >
      <NavIcon kind={icon} />
      <span>{children}</span>
      {badge ? <span className="ad-nav-badge">{badge}</span> : null}
    </a>
  );
}

function NavIcon({ kind }: { kind: string }) {
  const paths: Record<string, string> = {
    overview: "M3 10.5 12 3l9 7.5M5.5 9.5v10h13v-10M9 19.5v-6h6v6",
    businesses: "M4 20h16M6 20V5h8v15M14 9h4v11M8.5 8h3M8.5 11.5h3M8.5 15h3",
    ai: "M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
    health:
      "M12 3 4.5 6v5.2c0 4.7 3.2 8.8 7.5 9.8 4.3-1 7.5-5.1 7.5-9.8V6L12 3ZM12 7v5M12 16h.01",
    reports:
      "M12 3 4.5 6v5.2c0 4.7 3.2 8.8 7.5 9.8 4.3-1 7.5-5.1 7.5-9.8V6L12 3ZM12 7v5M12 16h.01",
    feedback: "M4 5h16v11H9l-5 4V5ZM8 9h8M8 12h5",
  };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={paths[kind] ?? paths.overview} />
    </svg>
  );
}

function DashboardPage({
  title,
  description,
  generatedAt,
  days,
  onDaysChange,
  children,
}: {
  title: string;
  description: string;
  generatedAt?: string;
  days?: 7 | 30 | 90;
  onDaysChange?: (days: 7 | 30 | 90) => void;
  children: ReactNode;
}) {
  return (
    <section className="ad-page" aria-labelledby="ad-page-title">
      <header className="ad-page-header">
        <div className="ad-page-heading">
          <h1 id="ad-page-title">{title}</h1>
          <p>{description}</p>
        </div>
        <div className="ad-toolbar">
          {generatedAt ? (
            <span className="ad-updated">
              Updated {formatUpdated(generatedAt)} SAST
            </span>
          ) : null}
          {days && onDaysChange ? (
            <label className="ad-select-label">
              <span className="sr-only">Date range</span>
              <select
                aria-label="Date range"
                value={days}
                onChange={(event) =>
                  onDaysChange(Number(event.target.value) as 7 | 30 | 90)
                }
              >
                <option value={7}>Last 7 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
            </label>
          ) : null}
          <span
            className={`ad-environment ${location.hostname === "admin.colony.global" ? "is-production" : "is-preview"}`}
          >
            {location.hostname === "admin.colony.global"
              ? "Production"
              : "Preview"}
          </span>
        </div>
      </header>
      {children}
    </section>
  );
}

function MetricState<T>({
  resource,
  children,
}: {
  resource: ReturnType<typeof useResource<T>>;
  children: (data: T) => ReactNode;
}) {
  if (resource.loading && !resource.data)
    return (
      <div className="ad-state" role="status">
        Loading metrics...
      </div>
    );
  if (resource.error && !resource.data) {
    const forbidden =
      resource.error instanceof ApiFailure && resource.error.status === 403;
    return (
      <div className="ad-state ad-state-error" role="alert">
        <h2>{forbidden ? "Access denied" : "Could not load metrics"}</h2>
        <p>
          {forbidden
            ? "This operator account cannot read these metrics."
            : "The admin service did not return this page."}
        </p>
        <button
          type="button"
          className="ad-secondary-button"
          onClick={resource.refetch}
        >
          Retry
        </button>
      </div>
    );
  }
  return resource.data ? (
    <>
      {resource.error ? (
        <p className="ad-refresh-warning" role="status">
          Refresh failed. Showing the last loaded values.
        </p>
      ) : null}
      {children(resource.data)}
    </>
  ) : null;
}

function OverviewPage({
  authMode,
  days,
  onDaysChange,
  onHealthBadge,
}: {
  authMode: AuthMode;
  days: 7 | 30 | 90;
  onDaysChange: (days: 7 | 30 | 90) => void;
  onHealthBadge: (count: number) => void;
}) {
  const resource = useResource(
    () => request<OverviewMetrics>(`/metrics/overview?days=${days}`, authMode),
    `overview-${authMode}-${days}`,
  );
  useEffect(() => {
    if (resource.data)
      onHealthBadge(redHealthCount(resource.data.needsAttention));
  }, [onHealthBadge, resource.data]);
  useEffect(() => {
    const targetId = location.hash.slice(1);
    if (resource.data && targetId) {
      document.getElementById(targetId)?.scrollIntoView({ block: "start" });
    }
  }, [resource.data]);
  return (
    <DashboardPage
      title="Overview"
      description="Colony after launch: people, businesses, agents, AI and health."
      generatedAt={resource.data?.generatedAt}
      days={days}
      onDaysChange={onDaysChange}
    >
      <MetricState resource={resource}>
        {(data) => (
          <>
            <div className="ad-stat-grid ad-stat-grid-six" id="people">
              <StatCard
                label="People"
                value={count(data.kpis.people.value)}
                delta={absoluteTrend(data.kpis.people, "this week")}
                tone="good"
              />
              <StatCard
                label="DAU"
                value={count(data.kpis.dau.value)}
                delta={relativeChange(data.kpis.dau, "vs last week")}
                tone="good"
              />
              <StatCard
                label="WAU"
                value={count(data.kpis.wau.value)}
                delta={relativeChange(data.kpis.wau, "vs last week")}
                tone="good"
              />
              <StatCard
                label="MAU"
                value={count(data.kpis.mau.value)}
                delta={relativeChange(data.kpis.mau, "vs last week")}
                tone="good"
              />
              <StatCard
                label="Stickiness"
                value={percent(data.kpis.stickinessPct.value)}
                delta={percentagePointChange(
                  data.kpis.stickinessPct,
                  "DAU / MAU",
                )}
                tone="good"
              />
              <StatCard
                label="New accounts"
                value={count(data.kpis.newAccounts.value)}
                delta="this week"
                tone="good"
              />
            </div>
            <section
              className="ad-panel ad-chart-panel"
              aria-labelledby="ad-active-chart-title"
            >
              <div className="ad-panel-header">
                <div>
                  <h2 id="ad-active-chart-title">Active people</h2>
                </div>
              </div>
              <ActivePeopleChart series={data.series} />
            </section>
            <div className="ad-two-column">
              <section
                className="ad-panel"
                aria-labelledby="ad-business-summary-title"
              >
                <PanelHeader
                  title="Businesses"
                  href="/businesses"
                  linkLabel="All businesses"
                />
                <MetricBar
                  label="Active this week"
                  value={data.businesses.activeThisWeek}
                  max={data.businesses.total}
                />
                <MetricBar
                  label="Co-founder on"
                  value={data.businesses.cofounderOn}
                  max={data.businesses.total}
                />
                <MetricBar
                  label="Created this week"
                  value={data.businesses.createdThisWeek}
                  max={data.businesses.total}
                />
                <p className="ad-panel-footnote">
                  {count(data.businesses.total)} businesses total,{" "}
                  {count(data.businesses.archived)} archived
                </p>
              </section>
              <section
                className="ad-panel"
                id="agents"
                aria-labelledby="ad-agent-summary-title"
              >
                <h2 id="ad-agent-summary-title">Agents</h2>
                <MetricBar
                  label="Active this week"
                  value={data.agents.activeThisWeek}
                  max={data.agents.total}
                />
                <MetricBar
                  label="Answer within 5 min"
                  value={data.agents.answerWithin5MinPct}
                  max={100}
                  suffix="%"
                />
                <MetricBar
                  label="Never started"
                  value={data.agents.neverStarted}
                  max={data.agents.total}
                />
                <p className="ad-panel-footnote">
                  {count(data.agents.total)} agents, {count(data.agents.scout)}{" "}
                  from Scout
                </p>
              </section>
              <section className="ad-panel">
                <PanelHeader
                  title="AI this month"
                  href="/ai-usage"
                  linkLabel="AI usage"
                />
                <div className="ad-model-list">
                  {data.ai.byModel.map((model) => (
                    <MetricBar
                      key={model.model}
                      label={model.model}
                      value={model.requests}
                      max={data.ai.requests}
                    />
                  ))}
                </div>
                <p className="ad-panel-footnote">
                  {count(data.ai.requests)} free gateway requests ·{" "}
                  {tokens(data.ai.inputTokens)} input tokens ·{" "}
                  {tokens(data.ai.outputTokens)} output tokens
                </p>
                <p className="ad-panel-footnote">
                  Charged this month: {money(data.ai.chargedUsd)}
                </p>
              </section>
              <section
                className="ad-panel ad-usage-panel"
                aria-label="Discovery and WhatsApp usage"
              >
                <div id="discovery">
                  <PanelHeader
                    title="Discovery and WhatsApp"
                    href="/businesses"
                    linkLabel="Details"
                  />
                  <MetricBar
                    label="Discovery results"
                    value={data.discovery.resultsThisMonth}
                    max={Math.max(
                      data.businesses.total * data.discovery.capPerBusiness,
                      data.discovery.resultsThisMonth,
                    )}
                    suffix={` / ${count(data.discovery.capPerBusiness)} per business cap`}
                  />
                  <MetricBar
                    label="Repeat results skipped"
                    value={data.discovery.repeatsSkipped}
                    max={null}
                  />
                </div>
                <div id="whatsapp" className="ad-usage-separator">
                  <MetricBar
                    label="WhatsApp sent"
                    value={data.whatsapp.sentThisMonth}
                    max={Math.max(data.whatsapp.sentThisMonth, 1)}
                    suffix={` · ${count(data.whatsapp.repliedThisMonth)} replied`}
                  />
                </div>
              </section>
            </div>
            <AttentionPanel items={attentionItems(data.needsAttention)} />
          </>
        )}
      </MetricState>
    </DashboardPage>
  );
}

function BusinessesPage({
  authMode,
  days,
  onDaysChange,
}: {
  authMode: AuthMode;
  days: 7 | 30 | 90;
  onDaysChange: (days: 7 | 30 | 90) => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sort, setSort] = useState<BusinessSort>("active");
  const [activeOnly, setActiveOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
      setOffset(0);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [query]);
  const params = new URLSearchParams({
    days: String(days),
    q: debouncedQuery,
    sort,
    limit: "100",
    offset: String(offset),
  });
  const resource = useResource(
    () =>
      request<BusinessesMetrics>(
        `/metrics/businesses?${params.toString()}`,
        authMode,
      ),
    `businesses-${authMode}-${params.toString()}`,
  );
  return (
    <DashboardPage
      title="Businesses"
      description={`${resource.data ? count(resource.data.total) : ""} businesses · ${resource.data ? count(resource.data.activeThisWeek) : ""} active this week`}
      generatedAt={resource.data?.generatedAt}
      days={days}
      onDaysChange={onDaysChange}
    >
      <MetricState resource={resource}>
        {(data) => {
          const rows = activeOnly
            ? data.items.filter((business) => business.activeDaysLast7 > 0)
            : data.items;
          return (
            <section
              className="ad-panel ad-table-panel"
              aria-label="Businesses table"
            >
              <div className="ad-table-toolbar">
                <label className="ad-search-field">
                  <SearchIcon />
                  <span className="sr-only">Search businesses or owners</span>
                  <input
                    type="search"
                    aria-label="Search businesses or owners"
                    placeholder="Search businesses or owners"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </label>
                <label className="ad-select-label">
                  <span className="sr-only">Business activity</span>
                  <select
                    aria-label="Business activity"
                    value={activeOnly ? "active" : "all"}
                    onChange={(event) => {
                      setActiveOnly(event.target.value === "active");
                      setOffset(0);
                    }}
                  >
                    <option value="active">Active this week</option>
                    <option value="all">All businesses</option>
                  </select>
                </label>
                <label className="ad-select-label">
                  <span className="sr-only">Sort businesses</span>
                  <select
                    aria-label="Sort businesses"
                    value={sort}
                    onChange={(event) => {
                      setSort(event.target.value as BusinessSort);
                      setOffset(0);
                    }}
                  >
                    <option value="active">Sort: most active</option>
                    <option value="people">Sort: people</option>
                    <option value="agents">Sort: agents</option>
                    <option value="ai">Sort: AI spend</option>
                    <option value="discovery">Sort: Discovery</option>
                    <option value="whatsapp">Sort: WhatsApp</option>
                    <option value="created">Sort: created</option>
                    <option value="name">Sort: name</option>
                  </select>
                </label>
              </div>
              {rows.length ? (
                <div className="ad-table-wrap">
                  <table className="ad-business-table">
                    <thead>
                      <tr>
                        <th scope="col">Business</th>
                        <th scope="col">People</th>
                        <th scope="col">Agents</th>
                        <th scope="col">Active</th>
                        <th scope="col">AI spend</th>
                        <th scope="col">Discovery</th>
                        <th scope="col">WhatsApp</th>
                        <th scope="col">Co-founder</th>
                        <th scope="col">
                          <span className="sr-only">Health</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((business) => (
                        <tr key={business.communityId}>
                          <th scope="row">
                            <a
                              className="ad-business-link"
                              href={`/businesses/${encodeURIComponent(business.communityId)}`}
                            >
                              {business.name}
                              <small>
                                {business.ownerName ?? business.host}
                              </small>
                            </a>
                          </th>
                          <td>{count(business.people)}</td>
                          <td>{count(business.agents)}</td>
                          <td>{count(business.activeDaysLast7)}/7 days</td>
                          <td>{money(business.aiChargedUsd)}</td>
                          <td>
                            {count(business.discoveryResultsThisMonth)} /{" "}
                            {count(business.discoveryCap)}
                          </td>
                          <td>{count(business.whatsappSentInRange)}</td>
                          <td>
                            <span
                              className={`ad-pill ${business.cofounderOn === null ? "is-unknown" : business.cofounderOn ? "is-on" : "is-off"}`}
                            >
                              {business.cofounderOn === null
                                ? "Unknown"
                                : business.cofounderOn
                                  ? "On"
                                  : "Off"}
                            </span>
                          </td>
                          <td>
                            <HealthDot
                              health={business.health}
                              label={`${business.name} health: ${business.health}`}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="ad-empty">No businesses found.</div>
              )}
              {data.total > 100 || offset > 0 ? (
                <div className="ad-table-footer">
                  <span>
                    Showing {rows.length ? offset + 1 : 0} to{" "}
                    {offset + rows.length} of {count(data.total)}
                  </span>
                  <div>
                    <button
                      type="button"
                      className="ad-page-button"
                      disabled={offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - 100))}
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      className="ad-page-button"
                      disabled={offset + 100 >= data.total}
                      onClick={() => setOffset(offset + 100)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          );
        }}
      </MetricState>
    </DashboardPage>
  );
}

function BusinessDetailPage({
  communityId,
  authMode,
  days,
  onDaysChange,
}: {
  communityId: string;
  authMode: AuthMode;
  days: 7 | 30 | 90;
  onDaysChange: (days: 7 | 30 | 90) => void;
}) {
  const resource = useResource(
    () =>
      request<BusinessDetailMetrics>(
        `/metrics/businesses/${encodeURIComponent(communityId)}?days=${days}`,
        authMode,
      ),
    `business-${authMode}-${communityId}-${days}`,
  );
  return (
    <DashboardPage
      title={resource.data?.business.name ?? "Business"}
      description={
        resource.data
          ? `Owner ${resource.data.business.ownerName ?? "not collected"} · created ${formatShortDate(resource.data.business.createdAt)} · host ${resource.data.business.host}`
          : "Business detail and recent activity."
      }
      generatedAt={resource.data?.generatedAt}
      days={days}
      onDaysChange={onDaysChange}
    >
      <MetricState resource={resource}>
        {(data) => (
          <>
            <div className="ad-stat-grid ad-stat-grid-five">
              <StatCard
                label="People"
                value={count(data.kpis.people)}
                delta={`+${count(data.kpis.newPeopleThisWeek)} this week`}
                tone="good"
              />
              <StatCard
                label="Agents"
                value={count(data.kpis.agents)}
                delta={data.kpis.agentNames.join(", ") || "None"}
                tone="neutral"
              />
              <StatCard
                label="Active days"
                value={`${count(data.kpis.activeDaysLast7)} of 7`}
                delta="this week"
                tone="good"
              />
              <StatCard
                label="Discovery"
                value={count(data.kpis.discoveryResultsThisMonth)}
                delta={`${count(data.kpis.discoveryCap)} cap this month`}
                tone="neutral"
              />
              <StatCard
                label="WhatsApp sent"
                value={count(data.kpis.whatsappSentInRange)}
                delta={`+${count(data.kpis.whatsappRepliedInRange)} replied`}
                tone="neutral"
              />
            </div>
            <div className="ad-two-column ad-detail-grid">
              <section className="ad-panel" aria-labelledby="ad-people-title">
                <h2 id="ad-people-title">People</h2>
                <div className="ad-role-list">
                  {data.people.byRole.map((person) => (
                    <MetricBar
                      key={person.role}
                      label={
                        person.role === "admin" || person.role === "member"
                          ? `${capitalize(person.role)}s`
                          : capitalize(person.role)
                      }
                      value={person.count}
                      max={data.kpis.people}
                      suffix={
                        person.lastActiveAt
                          ? `Last active ${relativeDate(person.lastActiveAt)}`
                          : "Never active"
                      }
                    />
                  ))}
                </div>
                <p className="ad-panel-footnote">
                  {count(data.people.staleMembers)} members with no activity in
                  the last 7 days
                </p>
              </section>
              <section className="ad-panel" aria-labelledby="ad-agents-title">
                <h2 id="ad-agents-title">Agents</h2>
                <div className="ad-agent-list">
                  {data.agents.map((agent) => (
                    <article className="ad-agent-row" key={agent.pubkeyShort}>
                      <span className="ad-agent-avatar" aria-hidden="true">
                        <svg
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                          focusable="false"
                        >
                          <path d="M11.6 15.1c-4.2 0-6-2.4-6-5.2 3.4-.1 5.7 1.8 6 5.2Z" />
                          <path d="M12.3 13.7c.2-4 2.4-6.2 6.1-6.1.1 3.5-2 5.7-6.1 6.1Z" />
                          <path d="M12 19v-5.5" />
                        </svg>
                      </span>
                      <div className="ad-agent-main">
                        <strong>{agent.name}</strong>
                        <small>
                          {runtimeName(agent.runtime)} ·{" "}
                          {agent.answerRatePct === null
                            ? "No mention data"
                            : `answers in ${percent(agent.answerRatePct)}`}
                        </small>
                      </div>
                      <span className={`ad-pill is-${agent.status}`}>
                        {agent.status === "offline" &&
                        agent.offlineHours !== null
                          ? `Offline ${count(agent.offlineHours)} h`
                          : capitalize(agent.status)}
                      </span>
                    </article>
                  ))}
                </div>
                {!data.agents.length ? (
                  <p className="ad-empty-inline">No agents are recorded.</p>
                ) : null}
              </section>
              <section
                className="ad-panel"
                aria-labelledby="ad-cofounder-title"
              >
                <h2 id="ad-cofounder-title">Co-founder</h2>
                <DataRow
                  label="Co-founder"
                  value={
                    data.cofounder.on === null
                      ? "Not collected"
                      : data.cofounder.on
                        ? "On"
                        : "Off"
                  }
                />
                <DataRow
                  label="On since"
                  value={
                    data.cofounder.onSince
                      ? formatDateTime(data.cofounder.onSince)
                      : "Not collected"
                  }
                />
                <DataRow
                  label="Onboarding"
                  value={onboardingLabel(data.cofounder.onboarding)}
                />
                <DataRow
                  label="Last wake outcome"
                  value={
                    data.cofounder.lastWake
                      ? `${data.cofounder.lastWake.status}${data.cofounder.lastWake.reason ? ` · ${data.cofounder.lastWake.reason}` : ""}`
                      : "Not collected"
                  }
                />
                {data.cofounder.skippedByOutcome.length ? (
                  <p className="ad-panel-footnote">
                    Skipped wakes:{" "}
                    {data.cofounder.skippedByOutcome
                      .map(
                        (outcome) =>
                          `${count(outcome.count)} · ${capitalize(outcome.outcome)}`,
                      )
                      .join(", ")}
                  </p>
                ) : null}
              </section>
              <section className="ad-panel" aria-labelledby="ad-problems-title">
                <h2 id="ad-problems-title">Recent problems</h2>
                <DataRow
                  label="Gateway"
                  value={`${count(data.problems.gatewayRefusals)} refusals`}
                />
                <DataRow
                  label="WhatsApp"
                  value={
                    data.whatsapp.failedByCode.length
                      ? data.whatsapp.failedByCode
                          .map(
                            (item) =>
                              `${count(item.count)} failed sends: ${item.code}`,
                          )
                          .join(", ")
                      : `${count(data.problems.whatsappFailed)} failed sends`
                  }
                />
                <DataRow
                  label="Discovery"
                  value={
                    data.discovery.repeatsSkipped === null
                      ? "Not collected"
                      : `${count(data.discovery.repeatsSkipped)} repeats skipped`
                  }
                />
              </section>
            </div>
          </>
        )}
      </MetricState>
    </DashboardPage>
  );
}

function AiUsagePage({
  authMode,
  days,
  onDaysChange,
}: {
  authMode: AuthMode;
  days: 7 | 30 | 90;
  onDaysChange: (days: 7 | 30 | 90) => void;
}) {
  const resource = useResource(
    () => request<AiUsageMetrics>(`/metrics/ai-usage?days=${days}`, authMode),
    `ai-usage-${authMode}-${days}`,
  );
  return (
    <DashboardPage
      title="AI usage"
      description="Free AI gateway: requests, tokens, cost and failures."
      generatedAt={resource.data?.generatedAt}
      days={days}
      onDaysChange={onDaysChange}
    >
      <MetricState resource={resource}>
        {(data) => (
          <>
            <div className="ad-stat-grid ad-stat-grid-five">
              <StatCard
                label="Requests"
                value={count(data.kpis.requests.value)}
                delta={relativeChange(data.kpis.requests)}
                tone="good"
              />
              <StatCard
                label="Tokens"
                value={tokenTotal(
                  data.kpis.inputTokens.value,
                  data.kpis.outputTokens.value,
                )}
                delta={`in ${tokens(data.kpis.inputTokens.value)} · out ${tokens(data.kpis.outputTokens.value)}`}
                tone="neutral"
              />
              <StatCard
                label="Charged"
                value={money(data.kpis.chargedUsd.value)}
                delta="all free models"
                tone="good"
              />
              <StatCard
                label="Refused or timed out"
                value={percent(data.kpis.refusedOrTimedOutPct.value)}
                delta={percentagePointChange(data.kpis.refusedOrTimedOutPct)}
                tone={
                  data.kpis.refusedOrTimedOutPct.value &&
                  data.kpis.refusedOrTimedOutPct.value >= 5
                    ? "bad"
                    : "good"
                }
              />
              <StatCard
                label="Sessions"
                value={count(data.kpis.sessions.value)}
                delta="free AI gateway"
                tone="good"
              />
            </div>
            <section
              className="ad-panel ad-chart-panel"
              aria-labelledby="ad-ai-chart-title"
            >
              <div className="ad-panel-header">
                <div>
                  <h2 id="ad-ai-chart-title">Requests per day by model</h2>
                </div>
              </div>
              <StackedUsageChart series={data.series} models={data.models} />
            </section>
            <div className="ad-two-column ad-ai-usage-grid">
              <section
                className="ad-panel"
                aria-labelledby="ad-gateway-outcomes-title"
              >
                <h2 id="ad-gateway-outcomes-title">Gateway outcomes</h2>
                {data.gatewayOutcomes ? (
                  <>
                    <MetricBar
                      label="Settled"
                      value={data.gatewayOutcomes.settled}
                      max={sumOutcomes(data.gatewayOutcomes)}
                    />
                    <MetricBar
                      label="Handed to next free model"
                      value={data.gatewayOutcomes.handedToNextModel}
                      max={sumOutcomes(data.gatewayOutcomes)}
                      suffix="fallback"
                    />
                    <MetricBar
                      label="Refused"
                      value={data.gatewayOutcomes.refused}
                      max={sumOutcomes(data.gatewayOutcomes)}
                    />
                    <MetricBar
                      label="Timed out"
                      value={data.gatewayOutcomes.timedOut}
                      max={sumOutcomes(data.gatewayOutcomes)}
                    />
                    {data.gatewayOutcomes.other > 0 ? (
                      <MetricBar
                        label="Other"
                        value={data.gatewayOutcomes.other}
                        max={sumOutcomes(data.gatewayOutcomes)}
                      />
                    ) : null}
                  </>
                ) : (
                  <NotCollected label="Gateway outcome history" />
                )}
              </section>
              <section
                className="ad-panel"
                aria-labelledby="ad-top-businesses-title"
              >
                <h2 id="ad-top-businesses-title">Top businesses by requests</h2>
                {data.topBusinesses.map((business) => (
                  <MetricBar
                    key={business.communityId}
                    label={business.name}
                    value={business.requests}
                    max={data.topBusinesses[0]?.requests ?? 0}
                  />
                ))}
                {!data.topBusinesses.length ? (
                  <p className="ad-empty-inline">No requests in this range.</p>
                ) : null}
              </section>
            </div>
            <section className="ad-panel ad-not-counted">
              <h2>Not counted</h2>
              <p>{data.notCounted}</p>
            </section>
          </>
        )}
      </MetricState>
    </DashboardPage>
  );
}

function HealthPage({
  authMode,
  onHealthBadge,
}: {
  authMode: AuthMode;
  onHealthBadge: (count: number) => void;
}) {
  const resource = useResource(
    () => request<HealthMetrics>("/metrics/health", authMode),
    `health-${authMode}`,
  );
  useEffect(() => {
    if (resource.data)
      onHealthBadge(redHealthCount(resource.data.needsAttention));
  }, [onHealthBadge, resource.data]);
  return (
    <DashboardPage
      title="Health"
      description="Silent failures show here the day they start."
      generatedAt={resource.data?.generatedAt}
    >
      <MetricState resource={resource}>
        {(data) => {
          const wakeTotal =
            data.cofounderWakes.allTime.delivered +
            data.cofounderWakes.allTime.skipped;
          return (
            <>
              <div className="ad-stat-grid ad-stat-grid-five">
                <StatCard
                  label="Relay"
                  value={capitalize(data.relay.status)}
                  delta={
                    data.relay.uptimePct7d === null
                      ? "Uptime not collected"
                      : `${percent(data.relay.uptimePct7d)} this week`
                  }
                  tone={data.relay.status === "up" ? "good" : "bad"}
                />
                <StatCard
                  label="Connections now"
                  value={count(data.connections.now)}
                  delta="WebSocket"
                  tone="good"
                />
                <StatCard
                  label="Wakes delivered"
                  value={`${count(data.cofounderWakes.allTime.delivered)} of ${count(wakeTotal)}`}
                  delta={`↓ ${count(data.cofounderWakes.allTime.skipped)} skipped`}
                  tone={data.cofounderWakes.allTime.skipped ? "bad" : "good"}
                />
                <StatCard
                  label="Agent answer rate"
                  value={percent(data.agents.answerWithin5MinPct)}
                  delta={
                    data.agents.previousPct === null ||
                    data.agents.answerWithin5MinPct === null
                      ? "Not collected"
                      : `${signed(data.agents.answerWithin5MinPct - data.agents.previousPct)} pts`
                  }
                  tone="good"
                />
                <StatCard
                  label="Relay errors"
                  value={count(data.relayErrors.last24h)}
                  delta="5xx in 24 h"
                  tone={data.relayErrors.last24h ? "bad" : "good"}
                />
              </div>
              <div className="ad-two-column ad-health-grid">
                <section className="ad-panel" aria-labelledby="ad-wakes-title">
                  <h2 id="ad-wakes-title">Co-founder wakes</h2>
                  {[...data.cofounderWakes.byOutcome]
                    .sort((left, right) => {
                      if (left.status === "delivered") return -1;
                      if (right.status === "delivered") return 1;
                      return right.count - left.count;
                    })
                    .map((item) => (
                      <MetricBar
                        key={`${item.status}-${item.outcome || "delivered"}`}
                        label={
                          item.status === "delivered"
                            ? "Delivered since the 1 Nov fix"
                            : `Skipped: ${item.outcome}`
                        }
                        value={item.count}
                        max={Math.max(
                          ...data.cofounderWakes.byOutcome.map(
                            (entry) => entry.count,
                          ),
                          1,
                        )}
                        tone={item.status === "skipped" ? "bad" : "good"}
                      />
                    ))}
                  <div className="ad-muted-note">
                    Last 24 hours:{" "}
                    {count(data.cofounderWakes.last24h.delivered)} delivered,{" "}
                    {count(data.cofounderWakes.last24h.skipped)} skipped,{" "}
                    {count(data.cofounderWakes.last24h.pending)} pending
                  </div>
                </section>
                <section className="ad-panel" aria-labelledby="ad-checks-title">
                  <h2 id="ad-checks-title">Checks</h2>
                  <ul className="ad-check-list">
                    {data.checks.map((check) => (
                      <li key={check.key}>
                        <HealthDot
                          health={
                            check.status === "unknown"
                              ? "unknown"
                              : check.status === "bad"
                                ? "bad"
                                : check.status === "warn"
                                  ? "warn"
                                  : "ok"
                          }
                          label={`${check.label}: ${check.status}`}
                        />
                        <strong>{check.label}</strong>
                        <span>{check.value}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="ad-muted-note">
                    Relay {data.relay.version} · started{" "}
                    {formatDateTime(data.relay.startedAt)} ·{" "}
                    {data.connections.scope.replaceAll("_", " ")}
                  </div>
                </section>
              </div>
              <AttentionPanel items={attentionItems(data.needsAttention)} />
            </>
          );
        }}
      </MetricState>
    </DashboardPage>
  );
}

function StatCard({
  label,
  value,
  delta,
  tone,
}: {
  label: string;
  value: string;
  delta: string;
  tone: "good" | "bad" | "neutral";
}) {
  return (
    <article className="ad-stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small className={`ad-tone-${tone}`}>{delta}</small>
    </article>
  );
}

function PanelHeader({
  title,
  href,
  linkLabel,
}: {
  title: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="ad-panel-header">
      <h2>{title}</h2>
      <a href={href}>{linkLabel}</a>
    </div>
  );
}

function MetricBar({
  label,
  value,
  max,
  suffix = "",
  tone = "default",
}: {
  label: string;
  value: number | null;
  max: number | null;
  suffix?: string;
  tone?: "default" | "good" | "bad";
}) {
  if (value === null)
    return (
      <div className="ad-metric-bar is-unavailable">
        <span>{label}</span>
        <span>Not collected</span>
      </div>
    );
  const amount =
    max === null
      ? 0
      : max > 0
        ? Math.max(0, Math.min(100, (value / max) * 100))
        : 0;
  return (
    <div className="ad-metric-bar">
      <div className="ad-metric-bar-copy">
        <span>{label}</span>
        <strong>
          {count(value)}
          {suffix ? <small> {suffix}</small> : null}
        </strong>
      </div>
      {max !== null ? (
        <div className={`ad-progress ad-progress-${tone}`} aria-hidden="true">
          <span style={{ width: `${amount}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="ad-data-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AttentionPanel({ items }: { items: AttentionItem[] }) {
  return (
    <section
      className="ad-panel ad-attention-panel"
      aria-labelledby="ad-attention-title"
    >
      <h2 id="ad-attention-title">Needs attention</h2>
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item.key}>
              <a href={attentionHref(item)}>
                <span
                  className={`ad-attention-dot is-${item.severity}`}
                  aria-hidden="true"
                />
                <span className="ad-attention-copy">
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                <span className="ad-attention-arrow" aria-hidden="true">
                  ›
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ad-empty-inline">No current alerts.</p>
      )}
    </section>
  );
}

function ActivePeopleChart({ series }: { series: OverviewMetrics["series"] }) {
  const plot = { left: 28, right: 690, top: 20, bottom: 180 };
  const values = series.flatMap((day) => [day.dau, day.wau]);
  const tickStep = chartAxisStep(Math.max(...values, 1));
  const tickCount = Math.ceil(Math.max(...values, 1) / tickStep);
  const axisMax = tickStep * tickCount;
  const points = chartPoints(
    series.map((day) => day.dau),
    plot,
    axisMax,
  );
  const area = chartArea(
    series.map((day) => day.wau),
    plot,
    axisMax,
  );
  const lastPoint = series.length - 1;
  return (
    <div className="ad-chart-wrap">
      <svg
        className="ad-chart"
        viewBox="0 0 700 220"
        role="img"
        aria-label="Daily active people and weekly active people over the selected range"
      >
        <title>Daily active people and weekly active people</title>
        {Array.from({ length: tickCount + 1 }, (_, index) => {
          const value = axisMax - index * tickStep;
          const y = plot.top + (index * (plot.bottom - plot.top)) / tickCount;
          return (
            <g key={value}>
              <line
                x1={plot.left}
                x2={plot.right}
                y1={y}
                y2={y}
                className="ad-chart-gridline"
              />
              <text x={plot.left - 8} y={y + 5} textAnchor="end">
                {count(value)}
              </text>
            </g>
          );
        })}
        {area ? <path d={area} className="ad-chart-area" /> : null}
        {points ? <path d={points} className="ad-chart-line" /> : null}
        {lastPoint >= 0 ? (
          <circle
            cx={chartX(lastPoint, series.length, plot)}
            cy={chartY(series[lastPoint].dau, axisMax, plot)}
            r="4"
            className="ad-chart-point"
          />
        ) : null}
        {series.flatMap((day, index) =>
          index === 0 ||
          index === series.length - 1 ||
          (index % 7 === 0 && series.length - 1 - index > 2) ? (
            <text
              key={day.day}
              x={chartX(index, series.length, plot)}
              y="205"
              textAnchor={
                index === 0
                  ? "start"
                  : index === series.length - 1
                    ? "end"
                    : "middle"
              }
            >
              {formatDay(day.day)}
            </text>
          ) : (
            []
          ),
        )}
      </svg>
      <div className="ad-chart-legend">
        <span>
          <i className="ad-legend-dau" /> Daily active (DAU)
        </span>
        <span>
          <i className="ad-legend-wau" /> Weekly active (WAU)
        </span>
      </div>
    </div>
  );
}

function StackedUsageChart({
  series,
  models,
}: {
  series: AiUsageMetrics["series"];
  models: string[];
}) {
  const height = 170;
  const width = 680;
  const maxValue = Math.max(...series.map((day) => day.requests), 1);
  const slot = width / Math.max(series.length, 1);
  return (
    <div className="ad-chart-wrap">
      {series.length ? (
        <svg
          className="ad-chart ad-stacked-chart"
          viewBox={`0 0 700 220`}
          role="img"
          aria-label={`Gateway requests per day stacked by ${models.join(", ")}`}
        >
          <title>Requests per day by model</title>
          {series.map((day, index) => {
            let y = height + 10;
            return models.map((model, modelIndex) => {
              const value = day.byModel[model] ?? 0;
              const barHeight = (value / maxValue) * height;
              y -= barHeight;
              return (
                <rect
                  key={`${day.day}-${model}`}
                  x={20 + index * slot + slot * 0.12}
                  y={y}
                  width={slot * 0.72}
                  height={barHeight}
                  className={`ad-stack-${modelIndex % 4}`}
                  rx="2"
                >
                  <title>{`${formatDay(day.day)} ${model}: ${count(value)} requests`}</title>
                </rect>
              );
            });
          })}
          <text x="10" y="215">
            {formatDay(series[0].day)}
          </text>
          <text x="690" y="215" textAnchor="end">
            {formatDay(series.at(-1)?.day ?? "")}
          </text>
        </svg>
      ) : (
        <div className="ad-empty-chart">No gateway requests in this range.</div>
      )}
      <div className="ad-chart-legend">
        {models.map((model, index) => (
          <span key={model}>
            <i className={`ad-legend-stack-${index % 4}`} /> {model}
          </span>
        ))}
      </div>
    </div>
  );
}

function HealthDot({ health, label }: { health: string; label: string }) {
  return (
    <span
      className={`ad-health-dot is-${health}`}
      role="img"
      aria-label={label}
    />
  );
}

function NotCollected({ label }: { label: string }) {
  return (
    <p className="ad-not-collected">
      <strong>{label}</strong>
      <span>Not collected</span>
    </p>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="#4285f4"
        d="M21.6 12.23c0-.71-.06-1.39-.18-2.04H12v3.86h5.38a4.6 4.6 0 0 1-2 3.02v2.52h3.24c1.9-1.75 2.98-4.32 2.98-7.36Z"
      />
      <path
        fill="#34a853"
        d="M12 22c2.7 0 4.97-.9 6.62-2.41l-3.24-2.52c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.58-4.12H3.08v2.6A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#fbbc05"
        d="M6.42 13.91a6.01 6.01 0 0 1 0-3.82v-2.6H3.08a10 10 0 0 0 0 9.02l3.34-2.6Z"
      />
      <path
        fill="#ea4335"
        d="M12 5.97c1.47 0 2.78.5 3.82 1.5l2.87-2.88C16.96 2.98 14.7 2 12 2a10 10 0 0 0-8.92 5.49l3.34 2.6C7.2 7.73 9.4 5.97 12 5.97Z"
      />
    </svg>
  );
}

function attentionHref(item: AttentionItem): string {
  if (item.link.board === "business" && item.link.params.communityId) {
    return `/businesses/${encodeURIComponent(item.link.params.communityId)}`;
  }
  if (item.link.board === "health") return "/system";
  if (item.link.board === "ai-usage") return "/ai-usage";
  if (item.link.board === "businesses") return "/businesses";
  return "/overview";
}

function consumeGoogleCallback(): {
  idToken: string | null;
  nonce: string | null;
  error: string | null;
} {
  const params = new URLSearchParams(location.hash.slice(1));
  const idToken = params.get("id_token");
  const error = params.get("error");
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  const nonce = sessionStorage.getItem(nonceStorageKey);
  sessionStorage.removeItem(nonceStorageKey);
  return { idToken, nonce, error };
}

function attentionItems(value: unknown): AttentionItem[] {
  return Array.isArray(value)
    ? value.filter((item): item is AttentionItem => {
        if (!item || typeof item !== "object") return false;
        const candidate = item as Record<string, unknown>;
        const link = candidate.link;
        return (
          typeof candidate.key === "string" &&
          typeof candidate.severity === "string" &&
          typeof candidate.title === "string" &&
          typeof candidate.detail === "string" &&
          typeof candidate.count === "number" &&
          Boolean(link) &&
          typeof link === "object" &&
          typeof (link as Record<string, unknown>).board === "string" &&
          typeof (link as Record<string, unknown>).params === "object"
        );
      })
    : [];
}

function redHealthCount(items: unknown): number {
  return attentionItems(items).filter(
    (item) => item.severity === "red" && item.link.board === "health",
  ).length;
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function relativeChange(metric: MetricDelta, period = "this month"): string {
  if (metric.value === null || metric.previous === null) return "Not collected";
  if (metric.previous === 0)
    return metric.value === 0 ? "No change this month" : "New this month";
  const change = Math.round(
    ((metric.value - metric.previous) / metric.previous) * 100,
  );
  return period === "this month"
    ? `this month, ${signed(change)}%`
    : `${signed(change)}% ${period}`;
}

function absoluteTrend(metric: MetricDelta, period: string): string {
  if (metric.value === null || metric.previous === null) return "Not collected";
  return `${signed(metric.value - metric.previous)} ${period}`;
}

function percentagePointChange(metric: MetricDelta, context = "today"): string {
  if (metric.value === null || metric.previous === null) return "Not collected";
  const value = `${signed(metric.value - metric.previous)} pts`;
  return context === "today" ? `${value} today` : `${context}, ${value}`;
}

function tokenTotal(input: MetricValue, output: MetricValue): string {
  if (input === null || output === null) return "Not collected";
  return tokens(input + output).replace(/M$/, " M");
}

function count(value: MetricValue): string {
  return value === null
    ? "Not collected"
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })
        .format(value)
        .replaceAll(",", " ");
}

function tokens(value: MetricValue): string {
  if (value === null) return "Not collected";
  if (Math.abs(value) >= 1000000) return `${trimDecimal(value / 1000000)}M`;
  if (Math.abs(value) >= 1000) return `${trimDecimal(value / 1000)}K`;
  return count(value);
}

function percent(value: MetricValue): string {
  return value === null
    ? "Not collected"
    : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)}%`;
}

function money(value: string | null): string {
  if (value === null || !Number.isFinite(Number(value))) return "Not collected";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(Number(value))
    .replace("$", "US$");
}

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)}`;
}

function trimDecimal(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(
    value,
  );
}

function formatUpdated(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Johannesburg",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Johannesburg",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Johannesburg",
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function relativeDate(value: string): string {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  return days <= 0
    ? "today"
    : days === 1
      ? "yesterday"
      : `${count(days)} days ago`;
}

function formatDay(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  }).format(date);
}

function capitalize(value: string): string {
  return value.length ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function onboardingLabel(progress: OnboardingProgress | null): string {
  if (!progress) return "Not started";
  if (progress.status === "complete") return "Complete";
  if (!progress.currentStep) return "In progress";
  const state = progress.currentStepState
    ? ` (${capitalize(progress.currentStepState)})`
    : "";
  return `In progress · ${capitalize(progress.currentStep)}${state}`;
}

function runtimeName(value: string | null): string {
  if (!value) return "Runtime not collected";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

type ChartPlot = { left: number; right: number; top: number; bottom: number };

function chartAxisStep(maxValue: number): number {
  const rawStep = maxValue / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const niceStep = [1, 2, 2.5, 5, 10].find((step) => normalized <= step) ?? 10;
  return niceStep * magnitude;
}

function chartX(index: number, length: number, plot: ChartPlot): number {
  return length < 2
    ? plot.left
    : plot.left + (index * (plot.right - plot.left)) / (length - 1);
}

function chartY(value: number, maxValue: number, plot: ChartPlot): number {
  return plot.bottom - (value / maxValue) * (plot.bottom - plot.top);
}

function chartPoints(
  values: number[],
  plot: ChartPlot,
  maxValue: number,
): string {
  if (!values.length) return "";
  return values
    .map(
      (value, index) =>
        `${index === 0 ? "M" : "L"} ${chartX(index, values.length, plot)} ${chartY(value, maxValue, plot)}`,
    )
    .join(" ");
}

function chartArea(
  values: number[],
  plot: ChartPlot,
  maxValue: number,
): string {
  if (!values.length) return "";
  const line = chartPoints(values, plot, maxValue);
  return `${line} L ${plot.right} ${plot.bottom} L ${plot.left} ${plot.bottom} Z`;
}

function sumOutcomes(
  outcomes: NonNullable<AiUsageMetrics["gatewayOutcomes"]>,
): number {
  return (
    outcomes.settled +
    outcomes.handedToNextModel +
    outcomes.refused +
    outcomes.timedOut +
    outcomes.other
  );
}
