import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  ChatGptError,
  BACKOFF_MS,
  TERMINAL_REFRESH_ERRORS,
} from "./policy.mjs";
import { createChatGptStore } from "./store.mjs";
import { fixture, deferred, waitUntil } from "./test-support.mjs";

test("concurrent refreshes share one rotation and persist the complete token tuple", async (t) => {
  const f = await fixture(t);
  const id = await f.connect();
  const old = (await f.read()).accounts[0];
  const hold = deferred();
  f.fake.faults.holdToken = hold.promise;
  const first = f.service.refresh(id, old.access_token);
  const second = f.service.refresh(id, old.access_token);
  assert.equal(first, second);
  await waitUntil(() => f.fake.counters.refresh === 1);
  hold.resolve();
  await Promise.all([first, second]);
  const updated = (await f.read()).accounts[0];
  assert.notEqual(updated.refresh_token, old.refresh_token);
  assert.notEqual(updated.access_token, old.access_token);
  assert.equal(updated.state, "active");
  assert.equal(updated.generation, old.generation + 1);
  assert.equal(updated.refresh_inflight, undefined);
  assert.equal(f.fake.counters.refresh, 1);
});

test("two OS processes cannot rotate the same rejected token twice", async (t) => {
  const f = await fixture(t);
  const id = await f.connect();
  const a = (await f.read()).accounts[0];
  const child = fork(
    fileURLToPath(new URL("./rotation-child.mjs", import.meta.url)),
    [f.userData, f.fake.origin],
    {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { PATH: process.env.PATH },
      timeout: 5000,
    },
  );
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });
  await new Promise((resolve, reject) => {
    child.once("message", (message) =>
      message.ready ? resolve() : reject(new Error("child_failed")),
    );
    child.once("error", reject);
  });
  const hold = deferred();
  f.fake.faults.holdToken = hold.promise;
  const refresh = f.service.refresh(id, a.access_token);
  await waitUntil(() => f.fake.counters.refresh === 1);
  const done = new Promise((resolve, reject) => {
    child.once("message", (message) =>
      message.done ? resolve() : reject(new Error("child_refresh_failed")),
    );
    child.once("exit", (code) => {
      if (code) reject(new Error("child_exit_failed"));
    });
  });
  child.send({ go: true });
  hold.resolve();
  await Promise.all([refresh, done]);
  assert.equal(f.fake.counters.refresh, 1);
});

test("crash between rotation receipt and atomic persist leaves a durable recovery fence", async (t) => {
  const f = await fixture(t);
  const id = await f.connect();
  const originalSave = f.store.save;
  let failed = false;
  f.store.save = (state) => {
    if (!failed && f.fake.counters.refresh > 0) {
      failed = true;
      throw new ChatGptError("storage_write_failed");
    }
    return originalSave(state);
  };
  await assert.rejects(f.service.refresh(id), /storage_write_failed/);
  f.store.save = originalSave;
  assert.equal((await f.read()).accounts[0].refresh_inflight, true);
  const restarted = f.create({ store: createChatGptStore(f.userData) });
  const publicState = await restarted.status();
  assert.equal(publicState.accounts[0].state, "needs_sign_in");
  const saved = (await f.read()).accounts[0];
  assert.equal(saved.last_error, "refresh_interrupted");
  assert.equal(saved.access_token, undefined);
  assert.equal(saved.refresh_token, undefined);
  assert.ok(saved.id_token);
  await restarted.resume();
  assert.equal(f.fake.counters.refresh, 1);
});

test("disconnect during refresh never reactivates a stale result and revokes the rotated token", async (t) => {
  const f = await fixture(t);
  const id = await f.connect();
  const hold = deferred();
  f.fake.faults.holdToken = hold.promise;
  const refresh = f.service.refresh(id);
  await waitUntil(() => f.fake.counters.refresh === 1);
  const writesAfterDisconnect = [];
  const save = f.store.save;
  f.store.save = (state) => {
    const account = state.accounts.find((a) => a.id === id);
    writesAfterDisconnect.push({
      state: account.state,
      inflight: Boolean(account.refresh_inflight),
    });
    save(state);
  };
  const disconnect = f.service.disconnect(id);
  hold.resolve();
  await Promise.all([refresh, disconnect]);
  const state = await f.read();
  assert.equal(state.accounts[0].state, "disconnected");
  assert.equal(state.accounts[0].access_token, undefined);
  assert.equal(state.accounts[0].refresh_token, undefined);
  assert.equal(state.accounts[0].id_token, undefined);
  assert.equal(state.accounts[0].pending_revoke, undefined);
  assert.equal(state.active, null);
  assert.equal(f.fake.counters.revoke, 1);
  assert.equal(
    writesAfterDisconnect.some((a) => a.state === "active" && !a.inflight),
    false,
  );
});

test("switching accounts during renewal keeps both registrations and selected identity", async (t) => {
  const f = await fixture(t);
  const first = await f.connect();
  const second = await f.connect();
  const hold = deferred();
  f.fake.faults.holdToken = hold.promise;
  const refresh = f.service.refresh(first);
  await waitUntil(() => f.fake.counters.refresh === 1);
  const switchAccount = f.service.select(second);
  hold.resolve();
  await Promise.all([refresh, switchAccount]);
  const state = await f.read();
  assert.equal(state.active, second);
  assert.equal(state.accounts[0].state, "active");
  assert.equal(state.accounts[1].state, "active");
  assert.equal(f.fake.counters.revoke, 0);
});

for (const code of [...TERMINAL_REFRESH_ERRORS, "invalid_client"])
  test(`refresh ${code} is terminal and durable`, async (t) => {
    const f = await fixture(t);
    const id = await f.connect();
    f.fake.faults.tokenError = code;
    await f.service.refresh(id);
    const saved = (await f.read()).accounts[0];
    assert.equal(saved.state, "needs_sign_in");
    assert.equal(saved.access_token, undefined);
    assert.equal(saved.refresh_token, undefined);
    assert.equal(saved.last_error, code);
    await f.service.resume();
    await f.create().start();
    assert.equal(f.fake.counters.refresh, 1);
  });

test("revocation in ChatGPT is detected on next refresh without an OAuth loop", async (t) => {
  const f = await fixture(t);
  const id = await f.connect();
  f.fake.invalidateSessions();
  await f.service.refresh(id);
  assert.equal((await f.service.status()).accounts[0].state, "needs_sign_in");
  assert.equal(f.fake.counters.authorize, 1);
});

test("temporary errors back off, preserve credentials, and stop after bounded retries", async (t) => {
  const f = await fixture(t);
  const id = await f.connect();
  const before = (await f.read()).accounts[0];
  f.fake.faults.tokenError = "temporarily_unavailable";
  f.fake.faults.tokenStatus = 500;
  for (const backoff of BACKOFF_MS) {
    await f.service.refresh(id);
    const saved = (await f.read()).accounts[0];
    assert.equal(saved.access_token, before.access_token);
    assert.equal(saved.refresh_token, before.refresh_token);
    assert.equal(saved.next_attempt_at - f.now(), backoff);
    const count = f.fake.counters.refresh;
    await f.service.refresh(id);
    assert.equal(f.fake.counters.refresh, count);
    f.advance(backoff);
  }
  await f.service.refresh(id);
  assert.equal((await f.read()).accounts[0].state, "unavailable");
  assert.equal(
    (await f.read()).accounts[0].refresh_token,
    before.refresh_token,
  );
  const count = f.fake.counters.refresh;
  for (let i = 0; i < 5; i++) {
    f.advance(600_000);
    await f.service.resume();
  }
  assert.equal(f.fake.counters.refresh, count);
  assert.equal(count, 6);
  assert.ok(f.scheduled.every((s) => s.ms >= 1000));
  delete f.fake.faults.tokenError;
  await f.service.retry();
  assert.equal((await f.read()).accounts[0].state, "active");
});

test("earliest refresh time gates both scheduled and on-demand renewal", async (t) => {
  const f = await fixture(t);
  f.fake.faults.expiresIn = 20;
  f.fake.faults.earliestRefreshAt = Math.floor(f.now() / 1000) + 120;
  const id = await f.connect();
  await f.service.refresh(id);
  await f.service.resume();
  assert.equal(f.fake.counters.refresh, 0);
  f.advance(120_000);
  await f.service.resume();
  assert.equal(f.fake.counters.refresh, 1);
  assert.ok(f.scheduled.every((s) => s.ms >= 1000));
});

test("expired renewable session transitions locally without a remote request", async (t) => {
  const f = await fixture(t);
  const id = await f.connect();
  f.advance(31 * 86400_000);
  await f.service.resume();
  assert.equal((await f.service.status()).accounts[0].state, "needs_sign_in");
  assert.equal(f.fake.counters.refresh, 0);
  assert.ok(id);
});

test("failed sign-out persists pending revocation and restarts retry it", async (t) => {
  const f = await fixture(t);
  const id = await f.connect();
  const host = (await f.read()).accounts[0].ext_agent_host_id;
  f.fake.faults.revokeError = true;
  const publicState = await f.service.disconnect(id);
  assert.equal(publicState.accounts[0].remoteRevocationPending, true);
  assert.equal(publicState.accounts[0].state, "pending_revoke");
  const saved = (await f.read()).accounts[0];
  assert.equal(saved.access_token, undefined);
  assert.equal(saved.refresh_token, undefined);
  assert.equal(saved.id_token, undefined);
  assert.ok(saved.pending_revoke.token);
  delete f.fake.faults.revokeError;
  f.advance(30_000);
  await f.create().start();
  assert.equal((await f.read()).accounts[0].pending_revoke, undefined);
  assert.equal((await f.read()).accounts[0].ext_agent_host_id, host);
  assert.equal(f.fake.counters.revoke, 2);
});

test("repeated revoke failures retain journal and stop the automatic loop", async (t) => {
  const f = await fixture(t);
  const id = await f.connect();
  f.fake.faults.revokeError = true;
  await f.service.disconnect(id);
  for (let i = 0; i < 10; i++) {
    f.advance(600_000);
    await f.service.resume();
  }
  assert.equal(f.fake.counters.revoke, 5);
  assert.ok((await f.read()).accounts[0].pending_revoke.token);
  assert.equal(f.scheduled.at(-1).cancelled, true);
});

test("failed validation revokes newly received credentials and retains issued ID for retry", async (t) => {
  const f = await fixture(t);
  f.fake.faults.claims = { nonce: "wrong" };
  await assert.rejects(f.service.connect(), /invalid_nonce/);
  const pending = (await f.read()).pending[0];
  assert.equal(pending.client_id, "oaiapp_mock_1");
  assert.equal(pending.pending_revoke, undefined);
  assert.equal(f.fake.counters.revoke, 1);
  delete f.fake.faults.claims;
  await f.service.connect({ registrationId: pending.id });
  const state = await f.read();
  assert.equal(state.pending.length, 0);
  assert.equal(state.accounts[0].client_id, "oaiapp_mock_1");
});

test("unknown JWKS kid is refetched at most once per throttle window", async (t) => {
  const f = await fixture(t);
  const id = await f.connect();
  f.fake.rotateKey();
  f.advance(31_000);
  await f.service.connect({ accountId: id });
  assert.equal(f.fake.counters.jwks, 2);
  f.fake.faults.header = { kid: "never-published" };
  await assert.rejects(
    f.service.connect({ accountId: id }),
    /invalid_signature/,
  );
  await assert.rejects(
    f.service.connect({ accountId: id }),
    /invalid_signature/,
  );
  assert.equal(f.fake.counters.jwks, 2);
});

test("dead writer lock is reclaimed, live lock has a bounded wait", async (t) => {
  const f = await fixture(t);
  await f.service.status();
  const lock = path.join(f.store.root, "writer.lock");
  await mkdir(lock, { mode: 0o700 });
  const dead = "2147483647-dead-beef.json";
  await writeFile(path.join(lock, dead), "{}", { mode: 0o600 });
  await f.service.status();
  await mkdir(lock, { mode: 0o700 });
  await writeFile(path.join(lock, `${process.pid}-dead-beef.json`), "{}", {
    mode: 0o600,
  });
  const competing = createChatGptStore(f.userData, { lockTimeoutMs: 50 });
  await assert.rejects(
    competing.locked(() => {}),
    /storage_busy/,
  );
});
