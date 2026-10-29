import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_ANT_PRESETS,
  agentAntAvatarDataUrl,
  agentFunctionFromRole,
} from "./agentAntAvatar.ts";

function svg(dataUrl) {
  return Buffer.from(
    dataUrl.slice(dataUrl.indexOf(",") + 1),
    "base64",
  ).toString("utf8");
}

test("role names deterministically select the approved ant colour and prop", () => {
  const expected = [
    ["Sales lead", "#E0826B", "translate(19 5) scale(3.4)", "M20.5 11.5"],
    [
      "Operations helper",
      "#6E97DE",
      "translate(19 5) scale(3.4)",
      "M18.76 10.19",
    ],
    ["Customer Success", "#D6739B", "translate(19 5) scale(3.4)", "M12 20.2"],
    ["Finance", "#D9A83F", "translate(19 5) scale(3.4)", "<rect"],
    ["Brand designer", "#9179DA", "translate(19 5) scale(3.4)", "M12 3.4"],
  ];
  for (const [role, color, prop, shape] of expected) {
    const first = agentAntAvatarDataUrl(role);
    const second = agentAntAvatarDataUrl(role);
    const artwork = svg(first);
    assert.equal(first, second, `${role} output is stable`);
    assert.equal(
      agentFunctionFromRole(role),
      role === "Sales lead"
        ? "Sales"
        : role === "Operations helper"
          ? "Operations"
          : role === "Customer Success"
            ? "Customer Success"
            : role === "Finance"
              ? "Finance"
              : "Brand",
    );
    assert.match(
      artwork,
      new RegExp(color, "i"),
      `${role} uses its role colour`,
    );
    assert.ok(artwork.includes(prop), `${role} adds a function prop`);
    assert.ok(
      artwork.includes(shape),
      `${role} uses the expected prop geometry`,
    );
    assert.match(artwork, /viewBox="-120 -145 240 235"/);
  }
});

test("neutral and custom colours use the same shipped ant body without a prop", () => {
  const neutral = svg(agentAntAvatarDataUrl("Research", "slate"));
  const custom = svg(agentAntAvatarDataUrl("Research", "#12ABEF"));
  assert.equal(agentFunctionFromRole("Research"), "Other");
  assert.doesNotMatch(neutral, /translate\(19 5\) scale\(3\.4\)/);
  assert.doesNotMatch(custom, /translate\(19 5\) scale\(3\.4\)/);
  assert.match(custom, /#12ABEF/i);
  assert.match(custom, /#84D3F7/i);
  assert.match(custom, /#0B6A94/i);
});

test("the ten colour presets stay named and unique", () => {
  assert.equal(AGENT_ANT_PRESETS.length, 10);
  assert.equal(new Set(AGENT_ANT_PRESETS.map(({ id }) => id)).size, 10);
  assert.equal(AGENT_ANT_PRESETS[0].label, "Leaf");
});
