import assert from "node:assert/strict";
import test from "node:test";

import {
  addressProtocol,
  normalizeBrowserAddress,
  pageLabel,
} from "./browserAddress.ts";

const ok = (input) => {
  const result = normalizeBrowserAddress(input);
  assert.equal(result.ok, true, `${input}: ${result.message}`);
  return result.url;
};
const refused = (input) => {
  const result = normalizeBrowserAddress(input);
  assert.equal(
    result.ok,
    false,
    `${input} should be refused, got ${result.url}`,
  );
  return result.message;
};

test("adds https to a bare site and keeps explicit http and https", () => {
  assert.equal(ok("example.com"), "https://example.com/");
  assert.equal(ok("  example.com/a?b=1#c  "), "https://example.com/a?b=1#c");
  assert.equal(ok("https://example.com/x"), "https://example.com/x");
  assert.equal(ok("HTTP://Example.com"), "http://example.com/");
  assert.equal(
    ok("sub.example.co.za:8443/path"),
    "https://sub.example.co.za:8443/path",
  );
});

test("local apps open over http without typing the scheme", () => {
  assert.equal(ok("localhost:3000"), "http://localhost:3000/");
  assert.equal(ok("localhost"), "http://localhost/");
  assert.equal(ok("localhost:5173/app?x=1"), "http://localhost:5173/app?x=1");
  assert.equal(ok("127.0.0.1:8080"), "http://127.0.0.1:8080/");
  assert.equal(ok("http://localhost:3000/a"), "http://localhost:3000/a");
  assert.equal(ok("app.localhost:3000"), "http://app.localhost:3000/");
});

test("only http and https schemes open: every other scheme is refused", () => {
  for (const input of [
    "file:///etc/passwd",
    "FILE:///Users/x/secret.txt",
    "file:/etc/passwd",
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "blob:https://example.com/uuid",
    "about:blank",
    "about:config",
    "chrome://settings",
    "chrome-extension://abc/page.html",
    "devtools://devtools/bundled/inspector.html",
    "view-source:https://example.com",
    "mailto:someone@example.com",
    "tel:+27111111111",
    "ftp://example.com/file",
    "ws://example.com",
    "colony://app/index.html",
    "buzz-media://abc",
    "vscode://file/x",
  ]) {
    const message = refused(input);
    assert.match(message, /only opens web pages/u, input);
  }
});

test("refusals name a plain scheme and never echo hostile text", () => {
  assert.match(refused("javascript:alert(1)"), /\(javascript:\)/u);
  const message = refused("<img src=x onerror=alert(1)>:1");
  assert.doesNotMatch(message, /onerror/u);
});

test("credentials in the address are refused", () => {
  assert.match(
    refused("https://user:pass@example.com"),
    /username or password/u,
  );
  assert.match(
    refused("user@example.com"),
    /username or password|web address/u,
  );
});

test("things that are not addresses explain what to type", () => {
  assert.match(refused(""), /Type a web address/u);
  assert.match(refused("   "), /Type a web address/u);
  assert.match(
    refused("how do i bake bread"),
    /does not look like a web address/u,
  );
  assert.match(refused("intranet"), /does not look like a web address/u);
  assert.match(refused("http://"), /web address/u);
  assert.match(refused(`https://${"a".repeat(9000)}.com`), /too long/u);
});

test("the browser host's own policy would accept every address this returns", async () => {
  // The host re-checks every URL; anything accepted here must pass there.
  const { checkedUrl } = await import(
    "../../../../electron/browser-host-policy.mjs"
  );
  for (const input of [
    "example.com",
    "localhost:3000",
    "127.0.0.1:8080",
    "xn--bcher-kva.example/ü",
  ]) {
    assert.equal(checkedUrl(ok(input)), ok(input));
  }
});

test("protocol and page label for the address bar and tab strip", () => {
  assert.equal(addressProtocol("https://a.test/"), "https");
  assert.equal(addressProtocol("http://a.test/"), "http");
  assert.equal(addressProtocol(""), null);
  assert.equal(
    pageLabel({ title: " Hello ", url: "https://a.test/" }),
    "Hello",
  );
  assert.equal(pageLabel({ title: "", url: "https://a.test/x" }), "a.test");
  assert.equal(pageLabel({ title: "", url: "" }), "New tab");
  assert.equal(pageLabel({ title: "", url: "not a url" }), "New tab");
});
