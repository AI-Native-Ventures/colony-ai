import "@fontsource-variable/manrope/index.css";

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

const params = new URLSearchParams(window.location.search);
const requestedGoogleScene = params.get("googleScene");
const googleScene = GOOGLE_ACCOUNT_SCENES.includes(
  requestedGoogleScene as GoogleAccountScene,
)
  ? (requestedGoogleScene as GoogleAccountScene)
  : null;
const requestedScene = params.get("scene");
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
  harnessLabel: "Claude Code",
  harnessStatus: "Installed",
  visualOnly: true,
};

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {googleScene ? (
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
