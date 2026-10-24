import * as React from "react";

import { ConnectChoice } from "./ConnectChoice";
import {
  EmailCodePresentation,
  isEmailCodeScene,
  resetStepIndex,
} from "./EmailCodePresentation";
import {
  FirstRunFrame,
  FirstRunHead,
  type FirstRunLayout,
  type FirstRunStep,
  type FirstRunStory,
} from "./FirstRunFrame";
import {
  AccountHelpChip,
  BusinessMark,
  FirstRunButton,
  FirstRunLink,
  InviteCard,
} from "./firstRunControls";
import { ChevronLeftIcon } from "./firstRunIcons";
import {
  AccountForm,
  BusinessChooser,
  BusinessForm,
  SignInForm,
} from "./OnboardingSceneForms";
import {
  ConnectedScene,
  ConnectionErrorScene,
  ReadyScene,
  SLOW_REPLY_COPY,
  TestingScene,
} from "./OnboardingResultScenes";
import type { OnboardingSceneId } from "./onboardingScenes";
import type { PresentationProps } from "./OnboardingSceneTypes";
import { scoutGuidance, scoutTone, type ScoutContext } from "./scoutGuidance";

export type {
  OnboardingSceneData,
  OnboardingBusinessChoice,
  OnboardingSceneActions,
} from "./OnboardingSceneTypes";
export { SLOW_REPLY_COPY };

// "connected" and "connection-error" are the results of the test, not the choice.
const CONNECT_SCENE = /^(connect$|funding|subscription|credits|openrouter)/;

function isConnectScene(scene: OnboardingSceneId) {
  return CONNECT_SCENE.test(scene);
}

function isVerifyScene(scene: OnboardingSceneId) {
  return scene.startsWith("verify");
}

function step(label: string, state: FirstRunStep["state"]): FirstRunStep {
  return { label, state };
}

/** The bars under Scout. Sign-in, reset and the returning list show none or their own. */
function progressFor(
  scene: OnboardingSceneId,
  props: PresentationProps,
): { steps: FirstRunStep[] | null; label?: string } {
  const invited = props.inviteBrand !== undefined;
  if (props.data.hideProgress || scene === "signin" || scene === "businesses")
    return { steps: null };
  const reset = resetStepIndex(scene);
  if (reset !== null) {
    const labels = ["Email", "Code", "New password", "Done"];
    return {
      label: "Reset steps",
      steps: labels.map((label, index) =>
        step(
          label,
          reset === 3 || index < reset
            ? "done"
            : index === reset
              ? "current"
              : "todo",
        ),
      ),
    };
  }
  if (scene === "invite")
    return {
      label: "Joining progress",
      steps: [
        step("Invite", "current"),
        step("Account", "todo"),
        step("Connect", "todo"),
      ],
    };
  if (scene === "account" || scene === "account-error" || isVerifyScene(scene))
    return {
      steps: invited
        ? [
            step("Invite", "done"),
            step("Account", "current"),
            step("Connect", "todo"),
          ]
        : [
            step("Account", "current"),
            step("Business", "todo"),
            step("Connect", "todo"),
          ],
      label: invited ? "Joining progress" : undefined,
    };
  if (scene === "additional")
    return { steps: [step("Business", "current"), step("Connect", "todo")] };
  if (scene.includes("business"))
    return {
      steps: [
        step("Account", "done"),
        step("Business", "current"),
        step("Connect", "todo"),
      ],
    };
  if (scene === "connected" || scene.startsWith("community-entry"))
    return {
      steps: [
        step("Account", "done"),
        step("Business", "done"),
        step("Connect", "done"),
      ],
    };
  if (
    isConnectScene(scene) ||
    scene === "testing" ||
    scene === "connection-error"
  )
    return {
      steps: [
        step("Account", "done"),
        step("Business", "done"),
        step("Connect", "current"),
      ],
    };
  return { steps: null };
}

function BusinessPreview({
  data,
  onLogoError,
}: Pick<PresentationProps, "data" | "onLogoError">) {
  return (
    <section aria-label="Workspace preview" className="c3fr-preview">
      <span className="c3fr-eyebrow">Your workspace</span>
      <div className="c3fr-preview-head">
        <BusinessMark
          logoUrl={data.logoUrl}
          name={data.business}
          onLogoError={onLogoError}
        />
        <span className="c3fr-preview-text">
          <span className="c3fr-preview-name">
            {data.business || "Your business"}
          </span>
          <span className="c3fr-preview-kind">Company workspace</span>
        </span>
      </div>
      <p className="c3fr-preview-copy">
        {data.description || "Your idea takes shape here."}
      </p>
    </section>
  );
}

function firstNameOf(name: string) {
  return name.trim().split(/\s+/)[0] ?? "";
}

function SceneBody(props: PresentationProps) {
  const {
    data,
    scene,
    onNavigate,
    contentOverride,
    connectionContentOverride,
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
        headingRef={props.headingRef}
        onCreateBusiness={props.onCreateBusiness}
        onNavigate={onNavigate}
        onSelectBusiness={props.onSelectBusiness}
        pending={props.pending}
      />
    );
  if (isConnectScene(scene))
    return (
      connectionContentOverride ?? (
        <ConnectChoice
          data={data}
          initial={scene === "connect" ? "own" : "colony"}
        />
      )
    );
  if (scene === "community-entry" || scene === "community-entry-error")
    return (
      <ReadyScene
        data={data}
        entry={props.entry}
        headingRef={props.headingRef}
        onNavigate={onNavigate}
      />
    );
  if (scene === "testing")
    return (
      <TestingScene
        data={data}
        headingRef={props.headingRef}
        onCancelTest={props.onCancelTest}
        onNavigate={onNavigate}
      />
    );
  if (scene === "connected")
    return (
      <ConnectedScene
        data={data}
        headingRef={props.headingRef}
        onNavigate={onNavigate}
      />
    );
  if (scene === "invite" && data.visualOnly)
    return (
      <div className="c3fr-form">
        <FirstRunHead
          lede="Join your team, their agents and the work already in motion."
          title="You’re invited."
        />
        <InviteCard
          invite={{ businessName: "Rosebank Studio", inviter: "Ayesha" }}
        />
        <FirstRunButton kind="primary">Join Rosebank Studio</FirstRunButton>
      </div>
    );
  if (scene === "connection-error")
    return (
      <ConnectionErrorScene
        data={data}
        headingRef={props.headingRef}
        onNavigate={onNavigate}
      />
    );
  return null;
}

function layoutFor(scene: OnboardingSceneId): {
  layout: FirstRunLayout;
  width: number;
} {
  if (resetStepIndex(scene) !== null) return { layout: "reset", width: 480 };
  if (scene.includes("business") || scene === "additional")
    return { layout: "business", width: 460 };
  if (isConnectScene(scene)) return { layout: "tight", width: 500 };
  if (scene === "businesses") return { layout: "default", width: 500 };
  if (
    scene === "connected" ||
    scene === "connection-error" ||
    scene.startsWith("community-entry")
  )
    return { layout: "default", width: 480 };
  return { layout: scene === "invite" ? "tight" : "default", width: 460 };
}

export function OnboardingScenePresentation(props: PresentationProps) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Focus follows rendered scene and new error feedback.
  React.useEffect(() => {
    // Connection choices keep roving keyboard focus within the same form.
    if (
      rootRef.current?.contains(document.activeElement) &&
      document.activeElement?.getAttribute("role") === "radio"
    )
      return;
    const heading = rootRef.current?.querySelector<HTMLElement>(
      ".c3fr-title, .c3fr-callout-title",
    );
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [props.scene, props.error, props.data.error]);
  const workspaceScene =
    props.scene === "workspace" ||
    props.scene === "history" ||
    props.scene === "history-review";
  // The host router owns the full app. Never render the retired miniature shell.
  if (workspaceScene) return <>{props.contentOverride}</>;

  const { scene, data } = props;
  const context: ScoutContext = {
    firstName: firstNameOf(data.name),
    appLabel: data.harnessLabel,
    businessName: data.inviteScene?.businessName,
    inviter: data.inviteScene?.inviter,
  };
  const guidance = scoutGuidance(
    scene,
    props.error ?? data.error,
    data.scoutGuidance,
    undefined,
    scene === "connect" &&
      (data.visualOnly || data.harnessStatus === "Checking"),
    context,
  );
  const progress = progressFor(scene, props);
  const reset = resetStepIndex(scene) !== null;
  const signedIn = data.signedInEmail;
  const story: FirstRunStory = {
    heading: guidance.title,
    body: guidance.copy,
    status: guidance.status,
    tone: guidance.tone ?? scoutTone(guidance.status),
    pose: guidance.pose,
    bubble: guidance.bubble,
    extra:
      scene.includes("business") || scene === "additional" ? (
        <BusinessPreview data={data} onLogoError={props.onLogoError} />
      ) : undefined,
    footer:
      scene === "signin" ? (
        <AccountHelpChip label="How your account stays yours" />
      ) : scene === "businesses" && signedIn ? (
        <span className="c3fr-story-plain">
          Signed in as <strong>{signedIn}</strong>
        </span>
      ) : undefined,
    progress: progress.steps,
    progressLabel: progress.label,
  };
  const inviteLink = props.onHaveInviteLink ? (
    <FirstRunLink
      data-testid="have-invite-link"
      onClick={props.onHaveInviteLink}
    >
      Have an invite link?
    </FirstRunLink>
  ) : null;
  const top =
    props.topOverride !== undefined ? (
      props.topOverride
    ) : scene === "account" || scene === "account-error" ? (
      <>
        <span>
          Already have an account?{" "}
          <FirstRunLink onClick={() => props.onNavigate?.("signin")}>
            Sign in
          </FirstRunLink>
        </span>
        {inviteLink}
      </>
    ) : scene === "signin" ? (
      <>
        <span>
          New to Colony?{" "}
          <FirstRunLink onClick={() => props.onNavigate?.("account")}>
            Create an account
          </FirstRunLink>
        </span>
        {inviteLink}
      </>
    ) : isVerifyScene(scene) && scene !== "verify-change-email" ? (
      <FirstRunLink
        onClick={
          props.authCode?.onChangeEmail ??
          (() => props.onNavigate?.("verify-change-email"))
        }
      >
        Use a different email
      </FirstRunLink>
    ) : reset ? (
      <FirstRunLink
        className="c3fr-back-link"
        onClick={() => props.onNavigate?.("signin")}
      >
        <ChevronLeftIcon size={16} strokeWidth={2.4} />
        Back to sign in
      </FirstRunLink>
    ) : scene === "business" || scene === "business-error" ? (
      inviteLink
    ) : scene === "invite" ? (
      <span>
        Already have an account?{" "}
        <FirstRunLink onClick={() => props.onNavigate?.("signin")}>
          Sign in
        </FirstRunLink>
      </span>
    ) : scene === "businesses" ? (
      <>
        {inviteLink}
        {props.onSignOut ? (
          <FirstRunLink
            data-testid="onboarding-sign-out"
            onClick={props.onSignOut}
          >
            Sign out
          </FirstRunLink>
        ) : null}
      </>
    ) : null;
  const { layout, width } = layoutFor(scene);
  return (
    <div ref={rootRef}>
      <FirstRunFrame
        layout={layout}
        story={story}
        testId={`onboarding-scene-${scene}`}
        top={top}
        width={width}
      >
        <SceneBody {...props} />
      </FirstRunFrame>
    </div>
  );
}
