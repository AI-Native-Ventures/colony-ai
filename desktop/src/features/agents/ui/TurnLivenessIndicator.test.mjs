import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TurnLivenessIndicator } from "./TurnLivenessIndicator.tsx";

test("live turns render one decorative Scout and one status label", () => {
  const html = renderToStaticMarkup(React.createElement(TurnLivenessIndicator));
  assert.match(html, /data-testid="turn-liveness-indicator"/);
  assert.match(html, /role="status"/);
  assert.match(html, /aria-label="Agent turn in progress"/);
  assert.equal((html.match(/data-pose="working"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /bee-sprite|buzz-logo/);
});
