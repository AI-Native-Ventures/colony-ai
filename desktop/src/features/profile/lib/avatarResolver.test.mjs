import assert from "node:assert/strict";
import test from "node:test";

import { resolveAvatarUrl } from "./avatarResolver.ts";

test("profile pictures take priority over managed agent art", () => {
  assert.equal(
    resolveAvatarUrl(" profile.png ", "managed-ant.svg", "fallback.svg"),
    "profile.png",
  );
});

test("managed agent art is used before a surface fallback", () => {
  assert.equal(
    resolveAvatarUrl(null, " managed-ant.svg ", "fallback.svg"),
    "managed-ant.svg",
  );
});

test("surface art and initials are the final avatar fallbacks", () => {
  assert.equal(resolveAvatarUrl(null, null, "fallback.svg"), "fallback.svg");
  assert.equal(resolveAvatarUrl(" ", " ", " "), null);
});
