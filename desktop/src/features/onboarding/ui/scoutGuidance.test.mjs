import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { scoutGuidance } from "./scoutGuidance.ts";
import { OnboardingScenePresentation } from "./OnboardingScenePresentation.tsx";
import { ONBOARDING_SCENE_IDS } from "./onboardingScenes.ts";
const data = {
  name: "Amina",
  email: "amina@example.com",
  business: "Studio",
  website: "",
  description: "Design",
  firstReply: "Hello Amina. Your reply arrived.",
};
test("all onboarding forms render Scout with text status and no legacy mascots", () => {
  for (const scene of ONBOARDING_SCENE_IDS.filter(
    (s) => !["workspace", "history", "history-review"].includes(s),
  )) {
    const html = renderToStaticMarkup(
      React.createElement(OnboardingScenePresentation, { scene, data }),
    );
    assert.match(html, /Chief of Staff/, scene);
    assert.match(html, /scout-status/, scene);
    assert.doesNotMatch(
      html,
      /Welcome to Buzz|Take me to Buzz|Meet your starter team|starter-team\//,
      scene,
    );
  }
});
test("first reply screen renders the supplied reply instead of a fixture", () => {
  const html = renderToStaticMarkup(
    React.createElement(OnboardingScenePresentation, {
      scene: "connected",
      data,
    }),
  );
  assert.match(html, /Hello Amina. Your reply arrived./);
  assert.match(html, /First reply received/);
  assert.match(html, /Open my Colony/);
  assert.doesNotMatch(
    html,
    /Claude Code subscription|What shall we work on first/,
  );
});
test("guidance follows actual scene and supplied runtime state", () => {
  assert.equal(scoutGuidance("business").status, "Your turn");
  assert.equal(scoutGuidance("testing").status, "Checking the connection");
  assert.equal(scoutGuidance("connected").status, "First reply received");
  assert.equal(
    scoutGuidance("business", "Website unavailable").status,
    "Needs your attention",
  );
  const state = {
    title: "Reading your website.",
    copy: "The details will appear in this form for you to review.",
    status: "Reading website",
    pose: "working",
  };
  assert.deepEqual(scoutGuidance("business", null, state), state);
});
