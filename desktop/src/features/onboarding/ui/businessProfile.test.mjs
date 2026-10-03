import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeBusinessWebsite,
  resolveBusinessLogoUrl,
  websiteFaviconUrl,
} from "./businessProfile.ts";

test("business logo priority is upload, then website icon, then initials", () => {
  assert.equal(
    resolveBusinessLogoUrl({
      uploadedLogo: "data:image/png;base64,uploaded",
      faviconUrl: "https://studio.example/favicon.ico",
      faviconFailed: false,
    }),
    "data:image/png;base64,uploaded",
  );
  assert.equal(
    resolveBusinessLogoUrl({
      uploadedLogo: null,
      faviconUrl: "https://studio.example/favicon.ico",
      faviconFailed: false,
    }),
    "https://studio.example/favicon.ico",
  );
  assert.equal(
    resolveBusinessLogoUrl({
      uploadedLogo: null,
      faviconUrl: "https://studio.example/favicon.ico",
      faviconFailed: true,
    }),
    null,
  );
});

test("website favicon uses a validated HTTP origin", () => {
  assert.equal(
    websiteFaviconUrl(" studio.example/path?ref=onboarding "),
    "https://studio.example/favicon.ico",
  );
  assert.equal(websiteFaviconUrl("javascript:alert(1)"), null);
  assert.equal(websiteFaviconUrl("https://user:secret@studio.example"), null);
  assert.equal(websiteFaviconUrl("localhost"), null);
});

test("business analysis normalizes HTTPS and rejects unsafe URL shapes", () => {
  assert.equal(
    normalizeBusinessWebsite(" colony.global "),
    "https://colony.global/",
  );
  assert.equal(
    normalizeBusinessWebsite("https://colony.ainative.ventures/"),
    "https://colony.ainative.ventures/",
  );
  for (const value of [
    "",
    "http://example.com",
    "javascript:alert(1)",
    "https://user:pass@example.com",
    "https://example.com:8080",
  ]) {
    assert.equal(normalizeBusinessWebsite(value), null);
  }
});
