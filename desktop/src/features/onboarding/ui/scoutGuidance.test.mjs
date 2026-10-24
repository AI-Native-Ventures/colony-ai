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
  assert.match(html, /Connection verified/);
  assert.match(html, /Open my Colony/);
  assert.doesNotMatch(
    html,
    /Claude Code subscription|What shall we work on first/,
  );
});
test("guidance follows actual scene and supplied runtime state", () => {
  assert.equal(scoutGuidance("business").status, "Here to help");
  assert.equal(scoutGuidance("testing").status, "Working");
  assert.equal(scoutGuidance("connected").status, "Here to help");
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
  assert.equal(scoutGuidance("account").bubble, "What should I call you?");
  assert.equal(
    scoutGuidance("verify", null, undefined, undefined, false, {
      firstName: "Lerato",
    }).title,
    "Nice to meet you, Lerato.",
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
    assert.match(render(scene), /Connect your AI\./);
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
  // Onboarding offers three paths in one radio group: Claude Code or Codex,
  // Colony Agent and Start free. Other harnesses live in Settings > Agents.
  assert.equal((html.match(/role="radiogroup"/g) ?? []).length, 1);
  assert.equal((html.match(/type="radio"/g) ?? []).length, 3);
  assert.deepEqual(
    [...html.matchAll(/class="c3fr-choice-title"[^>]*>([^<]+)</g)].map(
      (match) => match[1],
    ),
    ["Claude Code or Codex", "Colony Agent", "Start free"],
  );
  assert.equal((html.match(/checked=""/g) ?? []).length, 1);
  assert.doesNotMatch(html, /Bring your own key|More tools|Subscriptions</);
  assert.doesNotMatch(html, /Skip for now/);
});

test("OpenRouter and credit scenes select the Colony Agent path", () => {
  for (const scene of ["openrouter-unlinked", "credits-price-error"]) {
    const html = renderToStaticMarkup(
      React.createElement(OnboardingScenePresentation, {
        scene,
        data: { ...data, visualOnly: true },
      }),
    );
    assert.equal((html.match(/type="radio"/g) ?? []).length, 3, scene);
    assert.match(
      html,
      /name="c3fr-ai" checked=""\/><span class="c3fr-choice-copy"[^>]*><span class="c3fr-choice-title"[^>]*>Colony Agent</,
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
    // The three bars are done; the only current step is inside the card.
    assert.equal(
      (html.match(/data-state="done"[^>]*><span[^>]*c3fr-progress-bar/g) ?? [])
        .length,
      3,
      scene,
    );
    assert.match(html, /Connect<\/span><\/li>/, scene);
  }
});
