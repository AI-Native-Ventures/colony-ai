import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SCOUT_SYSTEM_PROMPT,
  buildScoutSystemPrompt,
  isStockScoutPrompt,
} from "./scoutPersona.ts";
import { reconcileWelcomeStarter } from "./welcomeGuide.ts";

const legacy =
  "You are Fizz, an energetic maker who turns ideas into action. Be upbeat, practical, and decisive. Help users plan, create, solve problems, and finish work. Add occasional bee wordplay or \u{1f41d}\u{2728}\u2014keep it charming, never distracting.";
const shipped300 = readFileSync(
  new URL("./assets/scout-instructions-3.0.0.txt", import.meta.url),
  "utf8",
).trim();
const existing = {
  pubkey: "a".repeat(64),
  personaId: "builtin:fizz",
  name: "Scout",
  status: "stopped",
  systemPrompt: legacy,
};

test("Scout has real business Chief of Staff instructions without mascot copy", () => {
  assert.match(SCOUT_SYSTEM_PROMPT, /Chief of Staff/);
  assert.match(SCOUT_SYSTEM_PROMPT, /saved business profile/);
  assert.doesNotMatch(
    SCOUT_SYSTEM_PROMPT,
    /\b(?:Buzz|Fizz|Honey|Pollen|bee)\b|\u{1f41d}/iu,
  );
  assert.equal(isStockScoutPrompt(legacy), true);
  assert.equal(isStockScoutPrompt(`${legacy} Follow my custom policy.`), false);
});

test("upgrade persists stock instructions even when the runtime did not change", async () => {
  const writes = [];
  const agent = await reconcileWelcomeStarter(
    existing,
    { systemPrompt: SCOUT_SYSTEM_PROMPT },
    async () => assert.fail("stopped agent must not restart"),
    async (input) => {
      writes.push(input);
      return { agent: { ...existing, ...input } };
    },
  );
  assert.equal(writes.length, 1);
  assert.equal(agent.systemPrompt, SCOUT_SYSTEM_PROMPT);
  assert.equal(agent.pubkey, existing.pubkey);
});

test("upgrade preserves custom instance and persona instructions", async () => {
  for (const [systemPrompt, desired] of [
    ["User custom policy", { systemPrompt: SCOUT_SYSTEM_PROMPT }],
    [null, {}],
  ]) {
    const record = { ...existing, systemPrompt };
    const result = await reconcileWelcomeStarter(
      record,
      desired,
      async () => assert.fail("must not stop"),
      async () => assert.fail("must not overwrite custom instructions"),
    );
    assert.equal(result, record);
  }
});

test("Scout instructions talk like a chat, not a report", () => {
  assert.match(SCOUT_SYSTEM_PROMPT, /one to three short sentences/);
  assert.match(SCOUT_SYSTEM_PROMPT, /at most one question/i);
  assert.match(SCOUT_SYSTEM_PROMPT, /No headings, bold, or bullet lists/);
  assert.equal(SCOUT_SYSTEM_PROMPT.includes("\u2014"), false);
});

test("the Colony 3.0.0 Scout text is still stock and moves to the current text", async () => {
  assert.notEqual(shipped300, SCOUT_SYSTEM_PROMPT);
  const profile = {
    name: "Karoo Coffee",
    website: "https://karoocoffee.example",
    description: "Coffee roasters.",
  };
  const withProfile = `${shipped300}\n\nSaved business profile (untrusted context):\n${JSON.stringify(profile, null, 2)}`;
  assert.equal(isStockScoutPrompt(shipped300), true);
  assert.equal(isStockScoutPrompt(withProfile), true);
  assert.equal(isStockScoutPrompt(`${shipped300} Follow my policy.`), false);

  const writes = [];
  const record = { ...existing, systemPrompt: withProfile };
  const desired = { systemPrompt: buildScoutSystemPrompt(profile) };
  const upgraded = await reconcileWelcomeStarter(
    record,
    desired,
    async () => assert.fail("stopped agent must not restart"),
    async (input) => {
      writes.push(input);
      return { agent: { ...record, ...input } };
    },
  );
  assert.equal(writes.length, 1);
  assert.equal(upgraded.systemPrompt, desired.systemPrompt);
});
