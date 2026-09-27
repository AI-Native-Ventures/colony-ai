import assert from "node:assert/strict";
import test from "node:test";

import remarkEntityLinks from "./remarkEntityLinks.ts";

function run(value) {
  const tree = {
    type: "root",
    children: [{ type: "paragraph", children: [{ type: "text", value }] }],
  };
  remarkEntityLinks()(tree);
  return tree.children[0].children;
}

test("turns every bare Buzz entity permalink family into a chip node", () => {
  const owner = "ab".repeat(32);
  const id = "cd".repeat(32);
  const links = [
    `buzz://repo?owner=${owner}&d=buzz`,
    `buzz://project?owner=${owner}&d=onboarding`,
    `buzz://pr?id=${id}&owner=${owner}&d=buzz`,
    `buzz://issue?id=${id}&owner=${owner}&d=buzz`,
    "buzz://goal/123e4567-e89b-12d3-a456-426614174000",
  ];
  for (const link of links) {
    const children = run(link);
    assert.equal(children[0].type, "entity-link");
    assert.equal(children[0].value, link);
  }
});

test("keeps sentence punctuation outside entity chip nodes", () => {
  const link = "buzz://goal/123e4567-e89b-12d3-a456-426614174000";
  const children = run(`${link}.`);
  assert.equal(children[0].value, link);
  assert.equal(children[1].value, ".");
});
