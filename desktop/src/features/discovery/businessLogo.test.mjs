import assert from "node:assert/strict";
import test from "node:test";

import {
  businessLogoUrl,
  extractBusinessDomain,
  resolveBusinessLogoSource,
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

test("does not use shared or directory hosts as a business domain", () => {
  for (const website of [
    "https://apexcom.co.za/pathways-guesthouse",
    "https://www.facebook.com/pathwaysguesthouse",
    "https://instagram.com/pathwaysguesthouse",
    "https://sites.google.com/view/pathwaysguesthouse",
    "https://booking.com/hotel/za/pathways-guesthouse",
  ]) {
    assert.equal(extractBusinessDomain(website), null, website);
  }
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

test("uses the business domain before stored media", () => {
  const source = resolveBusinessLogoSource({
    website: "https://example.com",
    logoUrl: "https://cdn.example.org/example.png",
    placePhotoUrl: "https://images.example.org/example.jpg",
    token: "publishable-fixture",
  });
  assert.ok(source);
  assert.equal(new URL(source).hostname, "img.logo.dev");
});

test("resolves a stored logo or place photo when no eligible domain is available", () => {
  assert.equal(
    resolveBusinessLogoSource({
      website: "https://facebook.com/pathwaysguesthouse",
      logoUrl: "https://cdn.example.org/pathways.png",
      token: "publishable-fixture",
    }),
    "https://cdn.example.org/pathways.png",
  );
  assert.equal(
    resolveBusinessLogoSource({
      website: null,
      placePhotoUrl: "https://images.example.org/pathways.webp",
      token: "publishable-fixture",
    }),
    "https://images.example.org/pathways.webp",
  );
  assert.equal(
    resolveBusinessLogoSource({ website: null, token: "publishable-fixture" }),
    null,
  );
});

test("falls back to the initial when the chosen image fails", () => {
  const source = resolveBusinessLogoSource({
    website: "https://example.com",
    token: "publishable-fixture",
  });
  assert.ok(source);
  assert.equal(shouldShowBusinessLogo(source, true), false);
  assert.equal(shouldShowBusinessLogo(source, false), true);
  assert.equal(shouldShowBusinessLogo(null, false), false);
});
