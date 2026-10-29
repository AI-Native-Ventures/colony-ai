import assert from "node:assert/strict";
import test from "node:test";

import {
  businessLogoUrl,
  extractBusinessDomain,
  shouldShowBusinessLogo,
} from "./businessLogo.ts";

test("extracts the website host without scheme, www, path, query, or port", () => {
  assert.equal(
    extractBusinessDomain(" HTTPS://WWW.Example.co.za:8443/about/team?ref=1 "),
    "example.co.za",
  );
  assert.equal(
    extractBusinessDomain("www.example.com/catalog/item"),
    "example.com",
  );
  assert.equal(extractBusinessDomain("example.org"), "example.org");
});

test("rejects missing and malformed website domains", () => {
  assert.equal(extractBusinessDomain(null), null);
  assert.equal(extractBusinessDomain("  "), null);
  assert.equal(extractBusinessDomain("not a domain"), null);
  assert.equal(extractBusinessDomain("file://example.com/logo.png"), null);
});

test("builds the 2x logo.dev request from the publishable build token", () => {
  const result = businessLogoUrl(
    "https://www.example.com/about",
    "publishable-fixture",
  );
  assert.ok(result);
  const url = new URL(result);
  assert.equal(url.origin, "https://img.logo.dev");
  assert.equal(url.pathname, "/example.com");
  assert.equal(url.searchParams.get("token"), "publishable-fixture");
  assert.equal(url.searchParams.get("size"), "64");
  assert.equal(url.searchParams.get("format"), "png");
  assert.equal(url.searchParams.get("retina"), "true");
  assert.equal(url.searchParams.get("fallback"), "404");
});

test("uses the letter tile when website, token, or image is unavailable", () => {
  assert.equal(businessLogoUrl(null, "publishable-fixture"), null);
  assert.equal(businessLogoUrl("https://example.com", ""), null);
  assert.equal(
    shouldShowBusinessLogo(null, "publishable-fixture", false),
    false,
  );
  assert.equal(shouldShowBusinessLogo("https://example.com", "", false), false);
  assert.equal(
    shouldShowBusinessLogo("https://example.com", "publishable-fixture", true),
    false,
  );
  assert.equal(
    shouldShowBusinessLogo("https://example.com", "publishable-fixture", false),
    true,
  );
});
