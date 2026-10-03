import * as React from "react";
import { onboardingSceneStage } from "./onboardingScenes";
import type { PresentationProps } from "./OnboardingSceneTypes";
import {
  accessScene,
  BusinessForm,
  BusinessChooser,
  AccountForm,
  InviteScene,
  SignInForm,
  StatusScene,
  StoryPanel,
} from "./OnboardingSceneForms";
import {
  ConnectionShell,
  StaticConnectContent,
} from "./OnboardingConnectionContent";
import { ConnectedScene, WorkspacePreview } from "./OnboardingSceneOverlays";
import {
  EmailCodePresentation,
  isEmailCodeScene,
} from "./EmailCodePresentation";
import { Glyph, InlineAlert, PrimaryButton } from "./OnboardingScenePrimitives";
import "./onboardingCalibration.css";
import "./onboardingTypography.css";

export type {
  OnboardingSceneData,
  OnboardingBusinessChoice,
  OnboardingSceneActions,
} from "./OnboardingSceneTypes";

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
  if (isEmailCodeScene(scene)) return <EmailCodePresentation {...props} />;
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
        <p className="lede" role="status" aria-live="polite">
          {data.connectionPhase === "saving"
            ? "Saving your verified connection."
            : data.connectionPhase === "waiting"
              ? "Your agent started. Waiting for its first reply."
              : "We’re starting your agent and checking that it can reply."}
        </p>
        <ol className="progress-list">
          <li className="complete">
            <Glyph name="check" />
            Connection selected
          </li>
          <li
            className={
              data.connectionPhase === "waiting" ||
              data.connectionPhase === "saving" ||
              data.visualOnly
                ? "complete"
                : ""
            }
          >
            {data.connectionPhase === "waiting" ||
            data.connectionPhase === "saving" ||
            data.visualOnly ? (
              <Glyph name="check" />
            ) : (
              <span className="spinner" />
            )}
            Starting your agent
          </li>
          <li className={data.connectionPhase === "saving" ? "complete" : ""}>
            {data.connectionPhase === "saving" ? (
              <Glyph name="check" />
            ) : data.connectionPhase === "waiting" || data.visualOnly ? (
              <span className="spinner" />
            ) : (
              <span className="waiting-dot" />
            )}
            {data.connectionPhase === "saving"
              ? "Reply received"
              : "Waiting for a reply"}
          </li>
        </ol>
        <button
          className="secondary full"
          type="button"
          onClick={() => onNavigate?.("connect")}
          disabled={data.connectionPhase === "saving"}
        >
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
          {data.error ??
            "Your connection isn’t working yet. Check that you’re signed in and that your account has usage available."}
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
  const rootRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (
      !["connect", "testing", "connected", "connection-error"].includes(
        props.scene,
      )
    )
      return;
    const heading = rootRef.current?.querySelector<HTMLElement>("h2");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [props.scene]);
  const workspaceScene =
    props.scene === "workspace" ||
    props.scene === "history" ||
    props.scene === "history-review";
  if (workspaceScene) {
    return (
      <div className="colony-onboarding-root" ref={rootRef}>
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
  ) : props.scene.startsWith("verify") ? (
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
    <div className="colony-onboarding-root" ref={rootRef}>
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
