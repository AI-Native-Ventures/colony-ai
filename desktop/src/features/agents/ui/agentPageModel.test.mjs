import assert from "node:assert/strict";
import test from "node:test";

import {
  agentChipTone,
  authStatusLabel,
  formatLastActivity,
  harnessAvailabilityLabel,
  personInitials,
  providerName,
  instructionSource,
  requestedSourceLabel,
} from "./agentPageModel.ts";

test("status labels map to the five chip tones", () => {
  assert.equal(agentChipTone("Ready"), "ready");
  assert.equal(agentChipTone("Active"), "ready");
  assert.equal(agentChipTone("Working"), "working");
  assert.equal(agentChipTone("Offline"), "offline");
  assert.equal(agentChipTone("Archived"), "archived");
  assert.equal(agentChipTone("Needs attention"), "needs");
});

test("last activity reads as today, yesterday or a dated day", () => {
  const now = new Date(2026, 9, 23, 13, 30);
  assert.equal(formatLastActivity(null, now), "Not reported");
  assert.equal(formatLastActivity("not a date", now), "Not reported");
  assert.equal(
    formatLastActivity(new Date(2026, 9, 23, 13, 20).toISOString(), now),
    "Today, 13:20",
  );
  assert.equal(
    formatLastActivity(new Date(2026, 9, 22, 9, 5).toISOString(), now),
    "Yesterday, 09:05",
  );
  assert.match(
    formatLastActivity(new Date(2026, 9, 19, 16, 40).toISOString(), now),
    /^Mon 19 Oct, 16:40$/,
  );
});

test("providers read by their names and unknown ids as typed", () => {
  assert.equal(providerName("openai"), "OpenAI");
  assert.equal(providerName("Anthropic"), "Anthropic");
  assert.equal(providerName("relay-mesh"), "Colony shared compute");
  assert.equal(providerName("acme"), "acme");
});

test("model source, availability and sign-in states have plain labels", () => {
  assert.equal(requestedSourceLabel("definition"), "Agent definition");
  assert.equal(requestedSourceLabel("global"), "Global defaults");
  assert.equal(requestedSourceLabel(null), "Not reported");
  assert.deepEqual(harnessAvailabilityLabel("available", true), {
    label: "Installed on this Mac",
    ok: true,
  });
  assert.deepEqual(harnessAvailabilityLabel("not_installed", true), {
    label: "Not installed",
    ok: false,
  });
  assert.deepEqual(authStatusLabel("logged_in"), {
    label: "Signed in",
    tone: "ok",
  });
  assert.equal(authStatusLabel("logged_out").tone, "bad");
  assert.equal(authStatusLabel("mystery").label, "Unknown");
});

test("people chips use their first and last initials", () => {
  assert.equal(personInitials("Lerato Molefe"), "LM");
  assert.equal(personInitials("Noluthando"), "N");
  assert.equal(personInitials("  "), "?");
});

test("an instructions edit changes only the agent it is made on", () => {
  const mine = { pubkey: "AA", personaId: "mine" };
  const editable = { isBuiltIn: false, sourceTeam: null };
  const other = { pubkey: "bb", personaId: "other" };
  const sibling = { pubkey: "bb", personaId: "mine" };

  // An agent with no definition keeps its own text.
  assert.equal(
    instructionSource({ pubkey: "aa", personaId: null }, undefined, [other]),
    "agent",
  );
  // The only agent using its definition edits that definition in place.
  assert.equal(instructionSource(mine, editable, [mine, other]), "definition");
  // A definition used by another agent is copied for this agent.
  assert.equal(instructionSource(mine, editable, [mine, sibling]), "copy");
  // Case in pubkeys does not make an agent its own sibling.
  assert.equal(
    instructionSource(mine, editable, [{ pubkey: "aa", personaId: "mine" }]),
    "definition",
  );
  // Built-in and team definitions are always copied, even for one agent.
  assert.equal(
    instructionSource(
      { pubkey: "aa", personaId: "builtin:fizz" },
      { isBuiltIn: true, sourceTeam: null },
      [],
    ),
    "copy",
  );
  assert.equal(
    instructionSource(mine, { isBuiltIn: false, sourceTeam: "Creative" }, [
      mine,
    ]),
    "copy",
  );
  // A definition that cannot be found cannot be copied.
  assert.equal(instructionSource(mine, undefined, [mine]), "locked");
});
