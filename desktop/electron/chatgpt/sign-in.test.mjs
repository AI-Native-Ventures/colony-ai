import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { chmod, lstat, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fixture } from "./test-support.mjs";
import { chatGptPolicy } from "./policy.mjs";
import { inspectWindowsAcl } from "./windows-acl.mjs";

test("Windows private profile does not grant broad principals credential access", {
  skip: process.platform !== "win32",
}, async (t) => {
  const f = await fixture(t);
  await f.connect();
  for (const target of [
    f.store.root,
    path.join(f.store.root, "accounts.json"),
  ]) {
    const found = inspectWindowsAcl(target);
    assert.deepEqual(
      found,
      [],
      `${target}: broad principals found: ${found.join(", ")}`,
    );
  }
});

test("production ignores origin overrides; test builds allow only explicit loopback origins", () => {
  const env = {
    COLONY_CHATGPT_AUTH_ORIGIN: "https://evil.example",
    COLONY_CHATGPT_API_ORIGIN: "http://127.0.0.1:42",
  };
  const production = chatGptPolicy(env);
  assert.equal(production.enabled, false);
  assert.equal(production.auth, "https://auth.openai.com");
  assert.equal(production.api, "https://api.openai.com");
  for (const value of [
    "http://localhost:42",
    "https://127.0.0.1:42",
    "http://127.0.0.1:42/path",
    "http://user@127.0.0.1:42",
    "http://127.0.0.1:42?x=1",
    "not-a-url",
  ])
    assert.throws(
      () =>
        chatGptPolicy(
          { COLONY_CHATGPT_AUTH_ORIGIN: value },
          { testBuild: true },
        ),
      /invalid_test_origin/,
    );
});

test("flag off performs no storage, browser or network work", async (t) => {
  const f = await fixture(t, { env: {} });
  assert.deepEqual(await f.service.start(), {
    enabled: false,
    connecting: false,
    activeAccountId: null,
    accounts: [],
  });
  await assert.rejects(f.service.connect(), /feature_disabled/);
  assert.equal(f.fake.requests.length, 0);
  await assert.rejects(lstat(path.join(f.userData, "chatgpt")), {
    code: "ENOENT",
  });
});

test("real callback, PKCE and validated tokens survive restart with no renderer secrets", async (t) => {
  const f = await fixture(t);
  const id = await f.connect();
  const publicState = await f.service.status();
  const state = await f.read();
  const a = state.accounts[0];
  assert.equal(publicState.accounts[0].state, "active");
  assert.equal(publicState.accounts[0].email, "same@example.test");
  assert.equal(a.client_id, "oaiapp_mock_1");
  assert.match(a.ext_agent_host_id, /^urn:uuid:/);
  for (const secret of [a.access_token, a.refresh_token, a.id_token])
    assert.equal(JSON.stringify(publicState).includes(secret), false);
  const second = f.create();
  assert.equal((await second.status()).activeAccountId, id);
  assert.equal(f.fake.counters.exchange, 1);
  assert.equal(f.scheduled.at(-1).ms, 3300_000);
  if (process.platform !== "win32") {
    assert.equal((await lstat(f.store.root)).mode & 0o777, 0o700);
    for (const name of ["accounts.json", "host.json"])
      assert.equal(
        (await lstat(path.join(f.store.root, name))).mode & 0o777,
        0o600,
      );
  }
});

test("returning sign-in reuses client, host and account hints, and omits name hint", async (t) => {
  const f = await fixture(t);
  const id = await f.connect();
  const before = (await f.read()).accounts[0];
  f.fake.faults.omitClient = true;
  let authorization;
  const returning = f.create({
    openExternal: async (url) => {
      authorization = new URL(url);
      await fetch(url);
    },
  });
  await returning.connect({ accountId: id });
  assert.equal(authorization.searchParams.get("client_id"), before.client_id);
  assert.equal(
    authorization.searchParams.get("ext_agent_host_id"),
    before.ext_agent_host_id,
  );
  assert.equal(
    authorization.searchParams.get("id_token_hint"),
    before.id_token,
  );
  assert.equal(authorization.searchParams.has("agent_name_hint"), false);
  assert.equal(authorization.searchParams.has("prompt"), false);
  assert.equal((await f.read()).accounts.length, 1);
});

test("missing plan scope saves identity with inference disabled", async (t) => {
  const f = await fixture(t);
  f.fake.faults.noPlan = true;
  await f.connect();
  assert.equal((await f.service.status()).accounts[0].state, "plan_use_off");
});

test("identity-only grant without offline_access remains signed in with plan use off", async (t) => {
  const f = await fixture(t);
  f.fake.faults.noPlan = true;
  f.fake.faults.noOffline = true;
  await f.connect();
  assert.equal((await f.service.status()).accounts[0].state, "plan_use_off");
  assert.equal((await f.read()).accounts[0].refresh_token, undefined);
  assert.ok((await f.read()).accounts[0].id_token);
});

for (const [name, claims, error] of [
  ["wrong nonce", { nonce: "wrong" }, "invalid_nonce"],
  ["wrong issuer", { iss: "https://evil.example" }, "invalid_issuer"],
  ["wrong audience", { aud: "oaiapp_other" }, "invalid_audience"],
  ["wrong authorized party", { azp: "oaiapp_other" }, "invalid_audience"],
  ["missing subject", { sub: "" }, "identity_mismatch"],
  ["expired", { exp: 1 }, "invalid_expiry"],
])
  test(`ID token rejects ${name} without activating an account`, async (t) => {
    const f = await fixture(t);
    f.fake.faults.claims = claims;
    await assert.rejects(f.service.connect(), new RegExp(error));
    assert.equal((await f.read()).active, null);
  });

test("pins RS256 and rejects forged signatures", async (t) => {
  const f = await fixture(t);
  f.fake.faults.header = { alg: "HS256" };
  await assert.rejects(f.service.connect(), /unsupported_algorithm/);
  delete f.fake.faults.header;
  f.fake.faults.badSignature = true;
  await assert.rejects(f.service.connect(), /invalid_signature/);
});

test("clock skew is bounded to five seconds", async (t) => {
  const f = await fixture(t);
  f.fake.faults.claims = { exp: Math.floor(f.now() / 1000) - 4 };
  await f.connect();
  f.fake.faults.claims = { iat: Math.floor(f.now() / 1000) + 6 };
  await assert.rejects(f.service.connect(), /invalid_expiry/);
});

test("discovery cannot redirect JWKS or revocation to another origin", async (t) => {
  const f = await fixture(t);
  f.fake.faults.jwksUri = "https://evil.example/jwks";
  await assert.rejects(f.service.connect(), /invalid_discovery/);
  assert.equal(f.fake.counters.jwks, 0);
});

test("wrong state, wrong callback path and denial without matching state cannot exchange", async (t) => {
  const f = await fixture(t, {
    openExternal: async (auth) => {
      const p = new URL(auth).searchParams;
      const callback = new URL(p.get("redirect_uri"));
      callback.searchParams.set("code", "fake-code");
      callback.searchParams.set("client_id", "oaiapp_fake");
      callback.searchParams.set("state", "wrong");
      assert.equal((await fetch(callback)).status, 400);
      callback.searchParams.set("error", "access_denied");
      callback.searchParams.delete("code");
      assert.equal((await fetch(callback)).status, 400);
      callback.searchParams.set("state", p.get("state"));
      callback.pathname = "/callback";
      assert.equal((await fetch(callback)).status, 400);
      callback.pathname = "/auth/callback";
      assert.equal((await fetch(callback)).status, 200);
    },
  });
  const outcome = await f.service.connect();
  assert.equal(outcome.outcome, "cancelled");
  assert.equal(f.fake.counters.exchange, 0);
});

test("wrong client on return rejects callback and preserves selected account", async (t) => {
  const f = await fixture(t);
  const id = await f.connect();
  const before = await f.read();
  f.fake.faults.wrongClient = true;
  const returning = f.create({
    openExternal: async (url) => {
      await fetch(url);
    },
  });
  await assert.rejects(
    returning.connect({ accountId: id }),
    /invalid_callback/,
  );
  assert.deepEqual(await f.read(), before);
  assert.equal(f.fake.counters.exchange, 1);
});

test("listener binds before browser and closes after one callback", async (t) => {
  let callback;
  const f = await fixture(t, {
    openExternal: async (auth) => {
      const response = await fetch(auth, { redirect: "manual" });
      callback = response.headers.get("location");
      assert.equal((await fetch(callback)).status, 200);
      try {
        assert.equal((await fetch(callback)).status, 400);
      } catch (error) {
        assert.equal(error.name, "TypeError");
      }
    },
  });
  await f.connect();
  assert.equal(f.fake.counters.exchange, 1);
  await assert.rejects(fetch(callback));
});

test("timeout and explicit cancellation close listeners with no exchange", async (t) => {
  let uri;
  const f = await fixture(t, {
    listenerTimeoutMs: 20,
    openExternal: async (url) => {
      uri = new URL(url).searchParams.get("redirect_uri");
    },
  });
  await assert.rejects(f.service.connect(), /listener_timeout/);
  await assert.rejects(fetch(uri));
  const service = f.create({
    openExternal: async () => {
      service.cancel();
    },
  });
  assert.equal((await service.connect()).outcome, "cancelled");
  assert.equal(f.fake.counters.exchange, 0);
});

test("port in use fails before opening browser", async (t) => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  let opened = false;
  const f = await fixture(t, {
    callbackPort: server.address().port,
    openExternal: async () => {
      opened = true;
    },
  });
  await assert.rejects(f.service.connect(), /listener_failed/);
  assert.equal(opened, false);
});

test("a hung browser opener does not suppress listener timeout", async (t) => {
  const f = await fixture(t, {
    listenerTimeoutMs: 20,
    openExternal: () => new Promise(() => {}),
  });
  await assert.rejects(f.service.connect(), /listener_timeout/);
  assert.equal(f.fake.counters.exchange, 0);
});

test("accounts with the same email stay distinct; mismatch cannot overwrite", async (t) => {
  const f = await fixture(t);
  const first = await f.connect();
  const second = await f.connect();
  assert.notEqual(first, second);
  assert.equal((await f.read()).accounts.length, 2);
  await f.service.select(first);
  f.fake.faults.claims = { sub: "other-subject" };
  await assert.rejects(
    f.service.connect({ accountId: first }),
    /identity_mismatch/,
  );
  assert.equal((await f.read()).active, first);
  assert.equal((await f.read()).accounts[0].subject, "fake-subject-1");
});

test("rejects permissive credential modes and symlinks", {
  skip: process.platform === "win32",
}, async (t) => {
  const f = await fixture(t);
  await f.connect();
  const file = path.join(f.store.root, "accounts.json");
  await chmod(file, 0o644);
  await assert.rejects(f.service.status(), /unsafe_storage/);
  await chmod(file, 0o600);
  const original = await readFile(file);
  const target = path.join(f.userData, "foreign.json");
  await writeFile(target, original, { mode: 0o600 });
  const { unlink } = await import("node:fs/promises");
  await unlink(file);
  await symlink(target, file);
  await assert.rejects(f.service.status(), /storage_read_failed/);
});
