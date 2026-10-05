import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  FORBIDDEN_BRAND_PATTERNS,
  installBrowserGlobals,
  startSourceLoader,
  visibleText,
  webRoot,
} from "./support.mjs";

const ORIGIN = "https://acme.colony.global";
const CODE = "demo-code-123";
let loader;

before(async () => {
  installBrowserGlobals(ORIGIN);
  loader = await startSourceLoader();
});

after(async () => {
  await loader?.close();
  Reflect.deleteProperty(globalThis, "window");
});

/** Render `/invite/<code>` through the real route tree, as the relay serves it. */
async function renderInviteRoute(code) {
  const { createMemoryHistory, createRouter, RouterProvider } = await import(
    "@tanstack/react-router"
  );
  const { routeTree } = await loader.load("/src/app/routeTree.gen.ts");
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [`/invite/${code}`] }),
  });
  await router.load();
  return renderToString(createElement(RouterProvider, { router }));
}

test("invite page renders Colony copy, mark, download target and invite link", async () => {
  const html = await renderInviteRoute(CODE);
  const text = visibleText(html);

  assert.match(text, /You're invited to join/);
  assert.match(text, /acme\.colony\.global/);
  assert.match(text, /Open in Colony/);
  assert.match(
    text,
    /Install Colony, create your account, then choose Join a community and paste this link\./,
  );
  assert.match(text, /Copy link/);
  assert.match(text, /Download Colony/);
  assert.match(html, /alt="Colony"/);

  // The link to paste into the app is this page's own address.
  assert.ok(html.includes(`value="${ORIGIN}/invite/${CODE}"`), html);
  // Before the visitor's OS is known the download points at the Colony site.
  assert.ok(html.includes('href="https://colony.global#download"'), html);
});

test("invite page never shows the upstream product, mark or download links", async () => {
  const html = await renderInviteRoute(CODE);
  for (const { name, pattern } of FORBIDDEN_BRAND_PATTERNS) {
    assert.doesNotMatch(html, pattern, `rendered invite page mentions ${name}`);
  }
  assert.doesNotMatch(html, /Accept invite in/);
});

test("the document title and favicon are Colony", async () => {
  const html = await readFile(path.join(webRoot, "index.html"), "utf8");
  assert.match(html, /<title>Colony<\/title>/);
  assert.match(html, /rel="icon"[^>]*colony-icon\.svg/);
});

test("deep links use the colony scheme and carry relay, code and receipt", async () => {
  const { colonyConnectLink, colonyJoinLink } = await loader.load(
    "/src/shared/lib/colony-links.ts",
  );

  const join = new URL(colonyJoinLink("wss://acme.colony.global", CODE));
  assert.equal(join.protocol, "colony:");
  assert.equal(join.hostname, "join");
  assert.equal(join.searchParams.get("relay"), "wss://acme.colony.global");
  assert.equal(join.searchParams.get("code"), CODE);
  assert.equal(join.searchParams.get("policy_receipt"), null);

  const withReceipt = new URL(
    colonyJoinLink("wss://acme.colony.global", CODE, "receipt.1"),
  );
  assert.equal(withReceipt.searchParams.get("policy_receipt"), "receipt.1");

  const connect = new URL(colonyConnectLink("wss://acme.colony.global"));
  assert.equal(connect.protocol, "colony:");
  assert.equal(connect.hostname, "connect");
  assert.equal(connect.searchParams.get("relay"), "wss://acme.colony.global");
});
