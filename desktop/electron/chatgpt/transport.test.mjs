import assert from "node:assert/strict";
import { test } from "node:test";
import { createChatGptHttp } from "./http.mjs";
import { fixture } from "./test-support.mjs";

test("HTTP bounds bodies, refuses redirects and redacts server-controlled errors", async () => {
  const large = createChatGptHttp({
    fetchImpl: async () => new Response("a".repeat(1024 * 1024 + 1)),
  });
  await assert.rejects(large("http://fake"), /response_too_large/);
  const redacted = createChatGptHttp({
    fetchImpl: async (_url, options) => {
      assert.equal(options.redirect, "error");
      return new Response(
        JSON.stringify({
          error: { code: "a_sensitive_token", message: "private" },
        }),
        { status: 500 },
      );
    },
  });
  await assert.rejects(
    redacted("http://fake"),
    (error) =>
      error.code === "http_error" && !error.message.includes("sensitive"),
  );
});

test("real token HTTP timeout is bounded and preserves a durable renewal record", async (t) => {
  const f = await fixture(t);
  const id = await f.connect();
  f.fake.faults.holdToken = new Promise(() => {});
  await f.create({ timeoutMs: 80 }).refresh(id);
  const a = (await f.read()).accounts[0];
  assert.equal(a.last_error, "request_timeout");
  assert.ok(a.refresh_token);
  assert.ok(a.next_attempt_at > f.now());
});

test("temporary JWKS failure after rotation retries validation without another rotation", async (t) => {
  const f = await fixture(t);
  const id = await f.connect();
  const originalId = (await f.read()).accounts[0].id_token;
  f.fake.rotateKey();
  f.advance(31_000);
  f.fake.faults.jwksError = true;
  await f.service.refresh(id);
  const pending = (await f.read()).accounts[0];
  assert.equal(pending.refresh_inflight, true);
  assert.equal(pending.id_token, originalId);
  assert.ok(pending.rotation_id_token);
  delete f.fake.faults.jwksError;
  f.advance(30_000);
  await f.service.refresh(id);
  const saved = (await f.read()).accounts[0];
  assert.equal(saved.refresh_inflight, undefined);
  assert.equal(saved.rotation_id_token, undefined);
  assert.notEqual(saved.id_token, originalId);
  assert.equal(f.fake.counters.refresh, 1);
});

test("failed new exchange retains issued registration for a fresh OAuth attempt", async (t) => {
  const f = await fixture(t);
  f.fake.faults.tokenError = "invalid_grant";
  await assert.rejects(f.service.connect(), /invalid_grant/);
  const pending = (await f.read()).pending[0];
  assert.equal(pending.client_id, "oaiapp_mock_1");
  delete f.fake.faults.tokenError;
  await f.service.connect({ registrationId: pending.id });
  assert.equal((await f.read()).accounts[0].client_id, pending.client_id);
  assert.equal((await f.read()).pending.length, 0);
});
