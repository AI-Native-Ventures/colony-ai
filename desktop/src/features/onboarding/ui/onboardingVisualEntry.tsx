import "@fontsource-variable/manrope/index.css";
import "@/shared/styles/globals.css";

import * as React from "react";
import { createRoot } from "react-dom/client";

import {
  OnboardingScenePresentation,
  type OnboardingSceneData,
} from "./OnboardingScenePresentation";
import {
  ONBOARDING_SCENE_IDS,
  type OnboardingSceneId,
} from "./onboardingScenes";
import {
  GOOGLE_ACCOUNT_SCENES,
  GoogleAccountPresentation,
  type GoogleAccountScene,
} from "./GoogleAccountPresentation";
import { AccountAuthFlow } from "./AccountAuthFlow";
import type { AccountAuthClient } from "../accountAuthClient";
import { IdentityKeyHelpContent } from "./IdentityKeyHelpDialog";
import { IdentityKeyIntroduction } from "./IdentityKeyIntroduction";
import { NativeUnavailableScreen } from "./NativeUnavailableScreen";
import { OnboardingCard } from "./OnboardingCard";

const params = new URLSearchParams(window.location.search);
const requestedGoogleScene = params.get("googleScene");
const googleScene = GOOGLE_ACCOUNT_SCENES.includes(
  requestedGoogleScene as GoogleAccountScene,
)
  ? (requestedGoogleScene as GoogleAccountScene)
  : null;
const requestedScene = params.get("scene");
const requestedReskin = params.get("reskin");
const scene: OnboardingSceneId = ONBOARDING_SCENE_IDS.includes(
  requestedScene as OnboardingSceneId,
)
  ? (requestedScene as OnboardingSceneId)
  : "account";

const data: OnboardingSceneData = {
  name: scene === "additional" ? "" : "Lerato Molefe",
  email: "lerato@example.com",
  business: scene === "additional" ? "" : "Lerato Studio",
  website: "",
  description:
    scene === "additional"
      ? ""
      : "We make small-batch homeware, designed and made in Johannesburg.",
  harnessLabel: scene.startsWith("openrouter")
    ? "OpenCode"
    : scene.startsWith("credits") ||
        scene === "funding" ||
        scene.startsWith("api-")
      ? "Colony Agent"
      : "Claude Code",
  harnessStatus:
    scene.startsWith("credits") ||
    scene === "funding" ||
    scene.startsWith("api-")
      ? "Included"
      : scene === "subscription-missing"
        ? "Not installed"
        : "Installed",
  connectionLabel: "Claude Code · Sonnet",
  visualOnly: true,
};

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {requestedReskin ? (
      <ReskinVisual requested={requestedReskin} />
    ) : googleScene ? (
      <GoogleAccountPresentation
        email=""
        name=""
        onCancel={() => undefined}
        password=""
        scene={googleScene}
      />
    ) : (
      <OnboardingScenePresentation data={data} scene={scene} />
    )}
  </React.StrictMode>,
);

function ReskinVisual({ requested }: { requested: string }) {
  const [showHelp, setShowHelp] = React.useState(false);
  if (requested === "identity-intro" || requested === "identity-help") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-6 text-foreground">
        <OnboardingCard current={2} testId="reskin-identity-card">
          {requested === "identity-help" || showHelp ? (
            <IdentityKeyHelpContent />
          ) : (
            <IdentityKeyIntroduction
              direction="forward"
              disabled={false}
              onCreate={() => undefined}
              onOpenHelp={() => setShowHelp(true)}
            />
          )}
        </OnboardingCard>
      </div>
    );
  }

  if (requested === "account-legacy") {
    const account = {
      id: "visual",
      email: "visual@example.com",
      pubkey: "0".repeat(64),
      hasPassword: true,
      googleLinked: false,
    };
    const authClient: AccountAuthClient = {
      signUp: async () => ({ status: "verification_sent" }),
      verifyEmail: async () => account,
      resendCode: async () => ({ status: "verification_sent" }),
      signIn: async () => account,
      signInWithGoogle: async () => account,
      requestReset: async () => ({ status: "verification_sent" }),
      checkResetCode: async () => undefined,
      confirmReset: async () => account,
      claimAccount: async () => ({ status: "verification_sent" }),
      changePassword: async () => undefined,
      getAccount: async () => null,
    };
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-6 text-foreground">
        <OnboardingCard current={1} testId="reskin-account-card">
          <AccountAuthFlow
            authClient={authClient}
            onAuthenticated={() => undefined}
            standalone={false}
          />
        </OnboardingCard>
      </div>
    );
  }

  if (requested === "native-unavailable") {
    return (
      <NativeUnavailableScreen
        body="This part of setup is not available in this version of Colony yet."
        onBack={() => undefined}
        onRetry={() => undefined}
      />
    );
  }

  return <OnboardingScenePresentation data={data} scene="account" />;
}
