import assert from "node:assert/strict";
import test from "node:test";

import { personaJobTitlesFromTeam } from "./personaJobTitles.ts";

const member = (personaId, title) => ({
  managedAgent: personaId ? { personaId } : null,
  position: title ? { head: { title } } : null,
});

test("an agent's position title becomes its definition's job title", () => {
  const titles = personaJobTitlesFromTeam([
    member("persona-scout", "Chief of Staff"),
    member("persona-aya", " Business Development "),
  ]);
  assert.equal(titles.get("persona-scout"), "Chief of Staff");
  assert.equal(titles.get("persona-aya"), "Business Development");
});

test("members without an agent or a title add nothing", () => {
  const titles = personaJobTitlesFromTeam([
    member(null, "Founder"),
    member("persona-writer", null),
    member("persona-theo", "   "),
  ]);
  assert.equal(titles.size, 0);
});

test("the first title wins when two agents share a definition", () => {
  const titles = personaJobTitlesFromTeam([
    member("persona-mina", "Social Media Manager"),
    member("persona-mina", "Designer"),
  ]);
  assert.equal(titles.get("persona-mina"), "Social Media Manager");
});
