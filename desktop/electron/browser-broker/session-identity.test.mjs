import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  BROWSER_SESSION_DOMAIN,
  browserCommunityOrigin,
  browserSessionCredential,
  browserSessionKey,
  checkedBrowserSession,
} from "./session-identity.mjs";

const vectors = JSON.parse(
  readFileSync(new URL("./session-identity-vectors.json", import.meta.url)),
);
const base = vectors[0];

test("fixed Node/Rust vectors normalize relay identity and derive the exact credential", () => {
  for (const vector of vectors) {
    const context = { ...vector.context, communityOrigin: vector.relay };
    assert.deepEqual(checkedBrowserSession(context), vector.context);
    assert.equal(browserSessionKey(context), vector.key);
    assert.equal(
      browserSessionCredential(vector.master, context),
      vector.credential,
    );
    assert.equal(browserSessionKey(context).includes("fake"), false);
  }
});

test("the fixed credential agrees with independent OpenSSL HMAC", (t) => {
  // Public fixture material only. No launch credential is read from the environment.
  const result = spawnSync(
    "openssl",
    ["dgst", "-sha256", "-hmac", base.master],
    {
      input: BROWSER_SESSION_DOMAIN + base.key,
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 4096,
    },
  );
  if (result.error?.code === "ENOENT") {
    t.skip("OpenSSL is unavailable; committed vectors remain mandatory");
    return;
  }
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim().split(/\s+/u).at(-1), base.credential);
});

test("agent, thread, DM, community and master each produce separate credentials", () => {
  const scopes = [
    base.context,
    { ...base.context, agentId: "bc".repeat(32) },
    { ...base.context, taskId: base.context.taskId.replace(/cd/gu, "ef") },
    { ...base.context, taskId: vectors[1].context.taskId },
    { ...base.context, communityOrigin: "https://other.example" },
    { ...base.context, communityOrigin: "https://relay.example:8443" },
    { ...base.context, communityOrigin: "http://relay.example" },
  ];
  const credentials = scopes.map((scope) =>
    browserSessionCredential(base.master, scope),
  );
  credentials.push(
    browserSessionCredential("different-fixture-master", base.context),
  );
  assert.equal(new Set(credentials).size, credentials.length);
});

test("community origins omit tokens, canonicalize ports and retain HTTP(S) boundaries", () => {
  assert.equal(
    browserCommunityOrigin("wss://RELAY.example:443/a?key=fixture#f"),
    "https://relay.example",
  );
  assert.equal(
    browserCommunityOrigin("ws://RELAY.example:80/a"),
    "http://relay.example",
  );
  assert.equal(
    browserCommunityOrigin("https://relay.example:444/a"),
    "https://relay.example:444",
  );
  assert.equal(
    browserCommunityOrigin("http://127.0.0.1:3000/events"),
    "http://127.0.0.1:3000",
  );
  // Identity normalization does not grant page egress to private relay addresses.
  assert.equal(
    browserSessionKey({
      ...base.context,
      communityOrigin: "wss://relay.example/other",
    }),
    base.key,
  );
});

test("invalid and credentialed communities fail without reflecting secrets", () => {
  for (const relay of [
    undefined,
    null,
    42,
    "",
    "x".repeat(2049),
    "/relative",
    "file:///tmp/fixture",
    "data:text/plain,fixture",
    "ftp://relay.example",
    "https://name:secret@relay.example",
    "https://name@relay.example",
    " https://relay.example",
    "https://relay.exa\nmple",
    "https://relay.example\t",
  ]) {
    assert.throws(() => browserCommunityOrigin(relay), {
      message: "Invalid browser community",
    });
  }
});

test("only canonical public identities and exact thread or DM task IDs are accepted", () => {
  for (const agentId of [
    undefined,
    null,
    42,
    "",
    "ab".repeat(31),
    "ab".repeat(33),
    base.context.agentId.toUpperCase(),
    `${base.context.agentId}\n`,
    "npub1fixture",
  ]) {
    assert.throws(() => checkedBrowserSession({ ...base.context, agentId }), {
      message: "Invalid browser agent",
    });
  }
  for (const taskId of [
    undefined,
    null,
    42,
    "",
    "task-1",
    base.context.taskId.toUpperCase(),
    `${base.context.taskId}\n`,
    `${base.context.taskId}:other`,
    "conversation:12345678123456789abc123456789abc",
    `thread:12345678-1234-5678-9abc-123456789abc:${"cd".repeat(31)}`,
  ]) {
    assert.throws(() => checkedBrowserSession({ ...base.context, taskId }), {
      message: "Invalid browser task",
    });
  }
});

test("missing or excessive master fails without reflecting input", () => {
  for (const master of [undefined, null, 42, "", "short", "x".repeat(257)]) {
    assert.throws(() => browserSessionCredential(master, base.context), {
      message: "Invalid browser launch credential",
    });
  }
});
