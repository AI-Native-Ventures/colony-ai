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

const requestedScene = new URLSearchParams(window.location.search).get("scene");
const scene: OnboardingSceneId = ONBOARDING_SCENE_IDS.includes(
  requestedScene as OnboardingSceneId,
)
  ? (requestedScene as OnboardingSceneId)
  : "account";

const data: OnboardingSceneData = {
  name: "Lerato Molefe",
  email: "lerato@example.com",
  business: scene === "additional" ? "" : "Lerato Studio",
  website: "",
  description:
    "We make small-batch homeware, designed and made in Johannesburg.",
  harnessLabel: "Claude Code",
  harnessStatus: "Installed",
  visualOnly: true,
};

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <OnboardingScenePresentation data={data} scene={scene} />
  </React.StrictMode>,
);
