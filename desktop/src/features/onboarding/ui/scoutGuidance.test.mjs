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

test("frozen feedback and focused field copy remain distinct", () => {
  assert.equal(scoutGuidance("verify-verifying").status, "Your turn");
  assert.equal(scoutGuidance("verify-error").title, "Check your email.");
  assert.equal(scoutGuidance("reset-error").title, "Let’s get you back in.");
  assert.equal(scoutGuidance("subscription-error").status, "Your turn");
  for (const scene of [
    "credits-failed",
    "openrouter-limit",
    "subscription-exhausted",
  ])
    assert.equal(scoutGuidance(scene).status, "Needs your attention");
  assert.equal(
    scoutGuidance("account", null, undefined, "full-name").title,
    "What should I call you?",
  );
  assert.equal(
    scoutGuidance("connect", null, undefined, undefined, true).status,
    "Working",
  );
  assert.equal(
    scoutGuidance("connect", null, undefined, undefined, true).title,
    "Checking your installed apps.",
  );
});

test("frozen reset and discovery controls render the approved state", () => {
  const render = (scene) =>
    renderToStaticMarkup(
      React.createElement(OnboardingScenePresentation, {
        scene,
        data: { ...data, visualOnly: true },
      }),
    );
  assert.match(render("forgot"), /Reset your password/);
  assert.doesNotMatch(render("forgot"), /Forgot your password/);
  for (const scene of ["connect", "subscription-scan"]) {
    assert.match(render(scene), /Finding your AI apps/);
    assert.doesNotMatch(render(scene), /7 hours/);
  }
  assert.match(render("verify-verifying"), /Verifying…/);
  assert.doesNotMatch(render("reset-error"), /aria-label="Setup progress"/);
});

test("connection controls keep one label owner and radio semantics", () => {
  const html = renderToStaticMarkup(
    React.createElement(OnboardingScenePresentation, {
      scene: "connect",
      data: {
        ...data,
        visualOnly: true,
        harnessLabel: "Claude Code",
        harnessStatus: "Installed",
      },
    }),
  );
  // Onboarding offers exactly two paths. Bring-your-own-key and the other
  // harnesses live in Settings > Agents.
  assert.equal((html.match(/role="radiogroup"/g) ?? []).length, 1);
  assert.equal((html.match(/role="radio"/g) ?? []).length, 2);
  assert.deepEqual(
    [
      ...html.matchAll(
        /role="radio"(?:(?!<\/button>)[\s\S])*<strong>([^<]+)<\/strong>/g,
      ),
    ].map((match) => match[1]),
    ["Claude Code or Codex", "Colony Agent"],
  );
  assert.equal((html.match(/aria-checked="true"/g) ?? []).length, 1);
  assert.match(
    html,
    /aria-checked="true"[^>]*role="radio"[^>]*>(?:(?!<\/button>)[\s\S])*<strong>Claude Code or Codex</,
  );
  assert.doesNotMatch(html, /Bring your own key|More tools|Subscriptions</);
  assert.match(html, /Choose AI app. Current: Claude Code/);
  assert.doesNotMatch(html, /harness-row|aria-pressed/);
});

test("OpenRouter and credit scenes select the Colony Agent path", () => {
  for (const scene of ["openrouter-unlinked", "credits-price-error"]) {
    const html = renderToStaticMarkup(
      React.createElement(OnboardingScenePresentation, {
        scene,
        data: { ...data, visualOnly: true },
      }),
    );
    assert.equal((html.match(/role="radio"/g) ?? []).length, 2, scene);
    assert.match(
      html,
      /aria-checked="true"[^>]*role="radio"[^>]*>(?:(?!<\/button>)[\s\S])*<strong>Colony Agent</,
      scene,
    );
  }
});

test("verification retains the frozen account/business/connect progress strip", () => {
  const html = renderToStaticMarkup(
    React.createElement(OnboardingScenePresentation, { scene: "verify", data }),
  );
  assert.match(html, /steps/);
  assert.match(html, />Business</);
  assert.match(html, />Connect</);
});

test("community entry and recovery retain the Connect step", () => {
  for (const scene of ["community-entry", "community-entry-error"]) {
    const html = renderToStaticMarkup(
      React.createElement(OnboardingScenePresentation, { scene, data }),
    );
    assert.match(html, /aria-current="step"[^>]*>[\s\S]*?Connect<\/li>/);
    assert.doesNotMatch(html, /aria-current="step"[^>]*>[\s\S]*?Account<\/li>/);
    assert.match(html, /wide power-content/);
  }
});
