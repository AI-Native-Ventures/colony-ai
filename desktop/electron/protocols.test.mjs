import assert from "node:assert/strict";
import test from "node:test";
import { createBuzzMediaProtocolHandler } from "./protocols.mjs";

const HASH = "a".repeat(64);

function mediaRequest(url, { method = "GET", headers = {} } = {}) {
  return { url, method, headers: new Headers(headers) };
}

test("buzz-media fallback streams through the host loopback proxy", async () => {
  const calls = [];
  const host = {
    request: async (...args) => {
      calls.push(args);
      return 45678;
    },
  };
  const response = new Response("image-bytes", {
    status: 206,
    headers: { "content-range": "bytes 0-10/20" },
  });
  let request;
  const handle = createBuzzMediaProtocolHandler({
    host,
    fetch: async (...args) => {
      request = args;
      return response;
    },
  });

  const result = await handle(
    mediaRequest(`buzz-media://localhost/media/${HASH}.thumb.jpg?size=small`, {
      headers: { accept: "image/avif,image/webp", range: "bytes=0-10" },
    }),
  );

  assert.equal(result, response);
  assert.deepEqual(calls, [
    ["invoke", { command: "get_media_proxy_port", args: {} }],
  ]);
  assert.equal(
    request[0],
    `http://127.0.0.1:45678/media/${HASH}.thumb.jpg?size=small`,
  );
  assert.equal(request[1].headers.get("range"), "bytes=0-10");
  assert.equal(request[1].headers.get("accept"), "image/avif,image/webp");
  assert.equal(request[1].redirect, "manual");
});

test("rejects non-media paths and remote hosts before contacting the native host", async () => {
  let hostCalls = 0;
  const handle = createBuzzMediaProtocolHandler({
    host: { request: async () => hostCalls++ },
    fetch: async () => new Response("unexpected"),
  });

  const traversal = await handle(
    mediaRequest(`buzz-media://localhost/media/../${HASH}.jpg`),
  );
  const remote = await handle(
    mediaRequest(`buzz-media://remote.example/media/${HASH}.jpg`),
  );
  assert.equal(traversal.status, 404);
  assert.equal(remote.status, 404);
  assert.equal(hostCalls, 0);
});

test("fails closed if the host proxy has no usable port or the request fails", async () => {
  const notReady = createBuzzMediaProtocolHandler({
    host: { request: async () => 0 },
    fetch: async () => new Response("unexpected"),
  });
  assert.equal(
    (await notReady(mediaRequest(`buzz-media://localhost/media/${HASH}.jpg`)))
      .status,
    503,
  );

  const failed = createBuzzMediaProtocolHandler({
    host: { request: async () => 45678 },
    fetch: async () => {
      throw new Error("connection refused");
    },
  });
  assert.equal(
    (await failed(mediaRequest(`buzz-media://localhost/media/${HASH}.jpg`)))
      .status,
    502,
  );
});
