import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ColonyCreditsOption } from "./ColonyCreditsOption.tsx";

test("Colony credits stay a visible Colony Agent option with no purchase controls", () => {
  const html = renderToStaticMarkup(React.createElement(ColonyCreditsOption));
  assert.match(html, /<h3 id="[^"]+">Colony credits<\/h3>/);
  assert.match(html, /aria-labelledby="([^"]+)"[\s\S]*<h3 id="\1">/);
  assert.match(html, />Coming soon</);
  assert.doesNotMatch(html, /<button|<input|<a /);
  assert.doesNotMatch(html, /balance|Unavailable|Reload|\$\d/i);
});
