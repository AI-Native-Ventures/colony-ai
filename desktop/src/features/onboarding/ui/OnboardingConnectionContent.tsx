import type * as React from "react";
import claudeLogoUrl from "../assets/harness-logos/claude.png?inline";
import codexLogoUrl from "../assets/harness-logos/codex.webp?url";
import openRouterDarkLogoUrl from "../assets/harness-logos/openrouter-dark.svg?url";
import openRouterLogoUrl from "../assets/harness-logos/openrouter.svg?url";
import type { OnboardingSceneId } from "./onboardingScenes";
import type { OnboardingSceneData } from "./OnboardingSceneTypes";
import {
  AntMark,
  BackButton,
  Glyph,
  type GlyphName,
} from "./OnboardingScenePrimitives";
import { CreditReviewDialog } from "./OnboardingSceneOverlays";

export function ConnectionShell({
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
              <Glyph name={icon as GlyphName} />
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

export function StaticConnectContent({
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
