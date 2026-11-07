import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";

import {
  QualifyFetchError,
  fetchQualifyPage,
  isPublicAddress,
  parseQualifyUrl,
  robotsAllows,
} from "./ssrf-fetcher.mjs";

const PUBLIC_DNS = async () => [{ address: "93.184.216.34", family: 4 }];

function response({
  status = 200,
  headers = { "content-type": "text/html" },
  body = "<html></html>",
} = {}) {
  return { status, headers, body: Readable.from([body]) };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("address policy rejects private, metadata, numeric, and IPv6 loopback targets", () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "224.0.0.1",
    "::1",
    "fe80::1",
    "fc00::1",
    "::ffff:127.0.0.1",
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress("93.184.216.34"), true);
  assert.equal(isPublicAddress("2606:2800:220:1:248:1893:25c8:1946"), true);
  for (const value of [
    "http://2130706433",
    "http://0x7f000001",
    "http://0177.0.0.1",
  ]) {
    assert.throws(() => parseQualifyUrl(value), QualifyFetchError);
  }
});

test("fetcher rejects a hostname that resolves to a private IP", async () => {
  await assert.rejects(
    fetchQualifyPage("https://public.example", {
      resolve: async () => [{ address: "10.0.0.1", family: 4 }],
      request: async () => response(),
    }),
    (error) =>
      error instanceof QualifyFetchError && error.code === "blocked_address",
  );
});

test("fetcher rechecks every redirect and blocks a redirect to localhost", async () => {
  let calls = 0;
  await assert.rejects(
    fetchQualifyPage("https://public.example", {
      resolve: async (host) => [
        {
          address: host === "localhost" ? "127.0.0.1" : "93.184.216.34",
          family: 4,
        },
      ],
      request: async () => {
        calls += 1;
        return response({
          status: 302,
          headers: { location: "http://127.0.0.1/internal" },
        });
      },
    }),
    (error) =>
      error instanceof QualifyFetchError && error.code === "blocked_address",
  );
  assert.equal(calls, 1);
});

test("fetcher stops a redirect chain longer than four hops", async () => {
  await assert.rejects(
    fetchQualifyPage("https://public.example", {
      resolve: PUBLIC_DNS,
      request: async ({ url }) =>
        response({ status: 302, headers: { location: `${url.pathname}next` } }),
    }),
    (error) =>
      error instanceof QualifyFetchError && error.code === "too_many_redirects",
  );
});

test("fetcher enforces the streaming body cap without inspecting page content", async () => {
  await assert.rejects(
    fetchQualifyPage("https://public.example", {
      resolve: PUBLIC_DNS,
      maxBytes: 8,
      request: async () => response({ body: "0123456789" }),
    }),
    (error) =>
      error instanceof QualifyFetchError && error.code === "body_too_large",
  );
});

test("fetcher aborts a slow response at the request deadline", async () => {
  const slow = new Readable({ read() {} });
  await assert.rejects(
    fetchQualifyPage("https://public.example", {
      resolve: PUBLIC_DNS,
      requestTimeoutMs: 15,
      request: async () => ({
        status: 200,
        headers: { "content-type": "text/html" },
        body: slow,
      }),
    }),
    (error) => error instanceof QualifyFetchError && error.code === "timeout",
  );
});

test("fetcher uses one deadline across response headers and body", async () => {
  async function* delayedBody() {
    await delay(15);
    yield "<html></html>";
  }
  await assert.rejects(
    fetchQualifyPage("https://public.example", {
      resolve: PUBLIC_DNS,
      requestTimeoutMs: 25,
      request: async () => {
        await delay(15);
        return {
          status: 200,
          headers: { "content-type": "text/html" },
          body: Readable.from(delayedBody()),
        };
      },
    }),
    (error) => error instanceof QualifyFetchError && error.code === "timeout",
  );
});

test("fetcher treats a missing robots file as an empty policy only when requested", async () => {
  const page = await fetchQualifyPage("https://public.example/robots.txt", {
    resolve: PUBLIC_DNS,
    allowNotFound: true,
    request: async () => response({ status: 404, body: "not found" }),
  });
  assert.equal(page.text, "");
  assert.equal(page.contentType, "text/plain");
  await assert.rejects(
    fetchQualifyPage("https://public.example/robots.txt", {
      resolve: PUBLIC_DNS,
      request: async () => response({ status: 404, body: "not found" }),
    }),
    (error) =>
      error instanceof QualifyFetchError && error.code === "http_status",
  );
});

test("fetcher preserves an HTTPS to HTTP downgrade signal and robots rules", async () => {
  const page = await fetchQualifyPage("https://public.example", {
    resolve: PUBLIC_DNS,
    request: async ({ url }) =>
      url.protocol === "https:"
        ? response({
            status: 302,
            headers: { location: "http://public.example" },
          })
        : response({
            body: "<html><meta name=viewport content=width=device-width></html>",
          }),
  });
  assert.equal(page.finalProtocol, "http:");
  assert.equal(page.downgradedFromHttps, true);
  assert.equal(
    robotsAllows(
      "User-agent: Colony-Qualify\nDisallow: /private",
      "/private/lead",
    ),
    false,
  );
  assert.equal(
    robotsAllows("User-agent: *\nDisallow: /private", "/public"),
    true,
  );
  assert.equal(
    robotsAllows(
      "User-agent: *\nDisallow: /\n\nUser-agent: Colony-Qualify\nAllow: /",
      "/private",
    ),
    true,
  );
});
