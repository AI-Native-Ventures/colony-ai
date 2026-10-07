import assert from "node:assert/strict";
import test from "node:test";
import {
  CapabilityError,
  DEFAULT_GRANT_TTL_MS,
  MAX_GRANT_TTL_MS,
  createCapabilityStore,
} from "./capability.mjs";

function harness(options = {}) {
  const clock = { wall: 1_000_000, mono: 5_000 };
  let tokenCounter = 0;
  let idCounter = 0;
  const store = createCapabilityStore({
    now: () => clock.wall,
    monotonic: () => clock.mono,
    randomToken: () => `token-${String(++tokenCounter).padStart(20, "0")}`,
    randomId: () => `grant-${++idCounter}`,
    ...options,
  });
  const advance = (ms, { wall = true, mono = true } = {}) => {
    if (wall) clock.wall += ms;
    if (mono) clock.mono += ms;
  };
  return { store, clock, advance };
}

const request = (overrides = {}) => ({
  agentId: "agent-a",
  taskId: "task-1",
  businessId: "biz-1",
  tabId: "tab-1",
  allowedOrigins: ["https://shop.example"],
  ...overrides,
});

test("issue binds agent, task, business, tab, origins and a bounded expiry", () => {
  const { store } = harness();
  const { grant, token } = store.issue(request());
  assert.equal(grant.agentId, "agent-a");
  assert.equal(grant.taskId, "task-1");
  assert.equal(grant.businessId, "biz-1");
  assert.equal(grant.clientId, null);
  assert.deepEqual(grant.tabIds, ["tab-1"]);
  assert.equal(grant.primaryTabId, "tab-1");
  assert.deepEqual(grant.allowedOrigins, ["https://shop.example"]);
  assert.equal(grant.expiresAt - grant.issuedAt, DEFAULT_GRANT_TTL_MS);
  assert.equal(grant.state, "active");
  assert.equal(grant.epoch, 1);
  assert.ok(token.length >= 16);
});

test("the raw token and its hash never appear in any view", () => {
  const { store } = harness();
  const { grant, token } = store.issue(request());
  const serialized = JSON.stringify([
    grant,
    store.getGrant(grant.id),
    store.grantsForAgent("agent-a"),
    store.authenticate(token),
  ]);
  assert.ok(!serialized.includes(token));
  assert.ok(!/tokenHash/u.test(serialized));
  assert.ok(!/[0-9a-f]{64}/u.test(serialized));
});

test("issue validates every field and rejects widening input", () => {
  const { store } = harness();
  const bad = [
    {},
    null,
    request({ agentId: "" }),
    request({ taskId: " x" }),
    request({ businessId: undefined }),
    request({ clientId: 5 }),
    request({ tabId: "bad\nid" }),
    request({ allowedOrigins: [] }),
    request({ allowedOrigins: "https://a.example" }),
    request({ allowedOrigins: ["https://a.example", "javascript:alert(1)"] }),
    request({ allowedOrigins: ["file:///etc"] }),
    request({ allowedOrigins: ["http://localhost:3000"] }),
    request({ allowedOrigins: ["http://169.254.169.254"] }),
    request({ allowedOrigins: ["http://10.0.0.5"] }),
    request({
      allowedOrigins: Array.from(
        { length: 40 },
        (_, i) => `https://s${i}.example`,
      ),
    }),
    request({ ttlMs: 0 }),
    request({ ttlMs: -5 }),
    request({ ttlMs: Number.NaN }),
    request({ ttlMs: MAX_GRANT_TTL_MS + 1 }),
    request({ privateExceptions: ["nonsense"] }),
  ];
  for (const input of bad) {
    assert.throws(
      () => store.issue(input),
      CapabilityError,
      JSON.stringify(input),
    );
  }
  assert.equal(store.grantsForAgent("agent-a").length, 0);
});

test("origins are normalized to exact origins", () => {
  const { store } = harness();
  const { grant } = store.issue(
    request({
      allowedOrigins: [
        "https://Shop.Example/cart?x=1",
        "https://shop.example:443/",
        "http://shop.example:8080/a",
      ],
    }),
  );
  assert.deepEqual(grant.allowedOrigins, [
    "https://shop.example",
    "http://shop.example:8080",
  ]);
});

test("a private origin needs an explicit matching exception", () => {
  const { store } = harness();
  const { grant } = store.issue(
    request({
      allowedOrigins: ["http://localhost:3000"],
      privateExceptions: ["localhost:3000"],
    }),
  );
  assert.deepEqual(grant.allowedOrigins, ["http://localhost:3000"]);
  assert.deepEqual(grant.privateExceptions, ["localhost:3000"]);
  assert.throws(() =>
    store.issue(
      request({
        agentId: "agent-b",
        allowedOrigins: ["http://localhost:3001"],
        privateExceptions: ["localhost:3000"],
      }),
    ),
  );
});

test("authenticate maps unknown, expired and revoked tokens to distinct codes", () => {
  const { store, advance } = harness();
  assert.equal(store.authenticate("nope").code, "no_grant");
  assert.equal(store.authenticate(undefined).code, "no_grant");
  assert.equal(store.authenticate("x".repeat(500)).code, "no_grant");
  const a = store.issue(request());
  assert.equal(store.authenticate(a.token).ok, true);
  advance(DEFAULT_GRANT_TTL_MS);
  assert.equal(store.authenticate(a.token).code, "grant_expired");
  const b = store.issue(request({ agentId: "agent-b" }));
  store.revoke(b.grant.id);
  assert.equal(store.authenticate(b.token).code, "grant_revoked");
  const c = store.issue(request({ agentId: "agent-c" }));
  store.takeOver(c.grant.id);
  assert.equal(store.authenticate(c.token).code, "grant_revoked");
  assert.equal(store.getGrant(c.grant.id).state, "taken-over");
});

test("expiry honours whichever clock is earlier", () => {
  const wallFirst = harness();
  const a = wallFirst.store.issue(request({ ttlMs: 1_000 }));
  wallFirst.advance(1_000, { mono: false });
  assert.equal(wallFirst.store.authenticate(a.token).code, "grant_expired");

  const monoFirst = harness();
  const b = monoFirst.store.issue(request({ ttlMs: 1_000 }));
  monoFirst.advance(1_000, { wall: false });
  assert.equal(monoFirst.store.authenticate(b.token).code, "grant_expired");

  const neither = harness();
  const c = neither.store.issue(request({ ttlMs: 1_000 }));
  neither.advance(999);
  assert.equal(neither.store.authenticate(c.token).ok, true);
  assert.equal(neither.store.remainingMs(c.grant.id), 1);
  neither.advance(1);
  assert.equal(neither.store.remainingMs(c.grant.id), 0);
});

test("a wall clock moved backwards cannot extend a grant", () => {
  const { store, clock, advance } = harness();
  const { token } = store.issue(request({ ttlMs: 1_000 }));
  clock.wall -= 3_600_000;
  advance(1_000, { wall: false });
  assert.equal(store.authenticate(token).code, "grant_expired");
});

test("authorize enforces tab binding, business and approved origins", () => {
  const { store } = harness();
  const { token } = store.issue(request());
  assert.equal(store.authorize(token, { tabId: "tab-1" }).ok, true);
  assert.equal(
    store.authorize(token, { tabId: "tab-1", url: "https://shop.example/cart" })
      .ok,
    true,
  );
  assert.equal(store.authorize(token, { tabId: "tab-9" }).code, "tab_denied");
  assert.equal(
    store.authorize(token, { businessId: "biz-2" }).code,
    "tab_denied",
  );
  assert.equal(store.authorize(token, { businessId: "biz-1" }).ok, true);
  const other = store.authorize(token, { url: "https://evil.example/x" });
  assert.equal(other.code, "origin_approval_required");
  assert.equal(other.origin, "https://evil.example");
  assert.equal(
    store.authorize(token, { url: "https://shop.example.evil.test/" }).code,
    "origin_approval_required",
  );
  assert.equal(
    store.authorize(token, { url: "http://shop.example/" }).code,
    "origin_approval_required",
  );
  assert.equal(
    store.authorize(token, { url: "file:///etc/passwd" }).code,
    "scheme_denied",
  );
  assert.equal(store.authorize("bogus-token-bogus-token").code, "no_grant");
});

test("a redirect to a new origin needs renewed approval, then passes", () => {
  const { store } = harness();
  const { grant, token } = store.issue(request());
  assert.equal(
    store.authorize(token, { url: "https://login.partner.example/sso" }).code,
    "origin_approval_required",
  );
  const events = [];
  store.onChange((event) => events.push(event));
  const updated = store.approveOrigin(
    grant.id,
    "https://login.partner.example/sso",
  );
  assert.deepEqual(updated.allowedOrigins, [
    "https://shop.example",
    "https://login.partner.example",
  ]);
  assert.equal(
    store.authorize(token, { url: "https://login.partner.example/next" }).ok,
    true,
  );
  assert.deepEqual(
    events.map((event) => event.type),
    ["origin-approved"],
  );
  assert.equal(events[0].origin, "https://login.partner.example");
});

test("approving an origin never admits private or unsupported targets", () => {
  const { store } = harness();
  const { grant } = store.issue(request());
  for (const url of [
    "http://127.0.0.1:8080",
    "http://localhost:3000",
    "file:///etc/passwd",
    "data:text/html,hi",
    "http://169.254.169.254",
  ]) {
    assert.throws(
      () => store.approveOrigin(grant.id, url),
      CapabilityError,
      url,
    );
  }
  assert.deepEqual(store.getGrant(grant.id).allowedOrigins, [
    "https://shop.example",
  ]);
});

test("a person may approve a local dev origin explicitly, never metadata", () => {
  const { store } = harness();
  const { grant, token } = store.issue(request());
  const updated = store.approveOrigin(grant.id, "http://localhost:3000/app", {
    allowPrivate: true,
  });
  assert.ok(updated.allowedOrigins.includes("http://localhost:3000"));
  assert.deepEqual(updated.privateExceptions, ["localhost:3000"]);
  assert.equal(
    store.authorize(token, { url: "http://localhost:3000/x" }).ok,
    true,
  );
  assert.equal(
    store.authorize(token, { url: "http://localhost:3001/x" }).code,
    "origin_approval_required",
  );
  assert.throws(() =>
    store.approveOrigin(grant.id, "http://169.254.169.254/latest", {
      allowPrivate: true,
    }),
  );
  assert.throws(() =>
    store.approveOrigin(grant.id, "not a url", { allowPrivate: true }),
  );
});

test("revoke mid task fails every fence taken before it", () => {
  const { store } = harness();
  const { grant, token } = store.issue(request());
  const fence = store.fence(token);
  assert.deepEqual(fence.check(), { ok: true });
  store.revoke(grant.id, "person stopped it");
  assert.deepEqual(fence.check(), { ok: false, code: "grant_revoked" });
  assert.throws(
    () => fence.assertCurrent(),
    (error) =>
      error instanceof CapabilityError && error.code === "grant_revoked",
  );
  assert.equal(store.getGrant(grant.id).endedReason, "person stopped it");
  assert.equal(
    store.authorize(token, { tabId: "tab-1" }).code,
    "grant_revoked",
  );
  assert.equal(store.revoke(grant.id), false);
});

test("take over ends the grant and fences pending work", () => {
  const { store } = harness();
  const { grant, token } = store.issue(request());
  const fence = store.fence(token);
  const events = [];
  store.onChange((event) => events.push(event.type));
  assert.equal(store.takeOver(grant.id), true);
  assert.equal(fence.check().code, "grant_revoked");
  assert.deepEqual(events, ["taken-over"]);
});

test("expiry during a task fails the fence", () => {
  const { store, advance } = harness();
  const { token } = store.issue(request({ ttlMs: 60_000 }));
  const fence = store.fence(token);
  advance(59_999);
  assert.equal(fence.check().ok, true);
  advance(1);
  assert.equal(fence.check().code, "grant_expired");
});

test("narrowing the grant fences pending actions, widening does not", () => {
  const { store } = harness();
  const { grant, token } = store.issue(
    request({
      allowedOrigins: ["https://shop.example", "https://pay.example"],
    }),
  );
  const fence = store.fence(token);
  store.approveOrigin(grant.id, "https://cdn.example");
  assert.equal(fence.check().ok, true);
  store.removeOrigin(grant.id, "https://pay.example");
  assert.deepEqual(fence.check(), { ok: false, code: "fenced" });
  assert.equal(store.fence(token).check().ok, true);
  assert.equal(
    store.authorize(token, { url: "https://pay.example/" }).code,
    "origin_approval_required",
  );
  assert.equal(store.removeOrigin(grant.id, "https://never.example").epoch, 2);
});

test("the last origin cannot be removed", () => {
  const { store } = harness();
  const { grant } = store.issue(request());
  assert.throws(() => store.removeOrigin(grant.id, "https://shop.example"));
});

test("a new grant for the same agent replaces and fences the old one", () => {
  const { store } = harness();
  const first = store.issue(request());
  const fence = store.fence(first.token);
  const second = store.issue(request({ taskId: "task-2" }));
  assert.equal(store.authenticate(first.token).code, "grant_revoked");
  assert.equal(fence.check().code, "grant_revoked");
  assert.equal(store.authenticate(second.token).ok, true);
  assert.equal(store.getGrant(first.grant.id).endedReason, "replaced");
  assert.equal(store.grantsForAgent("agent-a").length, 1);
});

test("an invalid replacement does not revoke the existing grant", () => {
  const { store } = harness();
  const first = store.issue(request());
  assert.throws(() => store.issue(request({ allowedOrigins: ["file:///x"] })));
  assert.equal(store.authenticate(first.token).ok, true);
});

test("grants are isolated per agent and per business", () => {
  const { store } = harness();
  const a = store.issue(
    request({ agentId: "agent-a", businessId: "biz-1", tabId: "tab-a" }),
  );
  const b = store.issue(
    request({ agentId: "agent-b", businessId: "biz-2", tabId: "tab-b" }),
  );
  assert.equal(store.authorize(a.token, { tabId: "tab-b" }).code, "tab_denied");
  assert.equal(store.authorize(b.token, { tabId: "tab-a" }).code, "tab_denied");
  assert.equal(
    store.authorize(a.token, { businessId: "biz-2" }).code,
    "tab_denied",
  );
  assert.equal(store.revokeBusiness("biz-1"), 1);
  assert.equal(store.authenticate(a.token).code, "grant_revoked");
  assert.equal(store.authenticate(b.token).ok, true);
  assert.equal(store.revokeAgent("agent-b"), 1);
  assert.equal(store.revokeAll(), 0);
});

test("tab binding is capped and unbinding fences", () => {
  const { store } = harness({ maxExtraTabs: 2 });
  const { grant, token } = store.issue(request());
  store.bindTab(grant.id, "tab-2");
  store.bindTab(grant.id, "tab-3");
  assert.equal(store.bindTab(grant.id, "tab-3").tabIds.length, 3);
  assert.throws(
    () => store.bindTab(grant.id, "tab-4"),
    (error) => error.code === "tab_limit",
  );
  assert.equal(store.authorize(token, { tabId: "tab-3" }).ok, true);
  const fence = store.fence(token);
  assert.equal(store.unbindTab(grant.id, "tab-3"), true);
  assert.equal(fence.check().code, "fenced");
  assert.equal(store.authorize(token, { tabId: "tab-3" }).code, "tab_denied");
  assert.equal(store.unbindTab(grant.id, "tab-3"), false);
  store.unbindTab(grant.id, "tab-1");
  assert.equal(store.getGrant(grant.id).primaryTabId, null);
});

test("an ended grant cannot gain tabs or origins", () => {
  const { store } = harness();
  const { grant } = store.issue(request());
  store.revoke(grant.id);
  assert.throws(
    () => store.bindTab(grant.id, "tab-2"),
    (e) => e.code === "grant_revoked",
  );
  assert.throws(
    () => store.approveOrigin(grant.id, "https://x.example"),
    (e) => e.code === "grant_revoked",
  );
  assert.throws(
    () => store.approveOrigin("missing", "https://x.example"),
    (e) => e.code === "no_grant",
  );
});

test("the active grant count is capped and expiry frees capacity", () => {
  const { store, advance } = harness({ maxActiveGrants: 2 });
  store.issue(request({ agentId: "a1" }));
  store.issue(request({ agentId: "a2" }));
  assert.throws(
    () => store.issue(request({ agentId: "a3" })),
    (error) => error.code === "grant_limit",
  );
  advance(DEFAULT_GRANT_TTL_MS);
  assert.equal(store.sweep(), 2);
  assert.equal(store.sweep(), 0);
  assert.doesNotThrow(() => store.issue(request({ agentId: "a3" })));
});

test("listeners see lifecycle events and a throwing listener is isolated", () => {
  const { store } = harness();
  const seen = [];
  store.onChange(() => {
    throw new Error("boom");
  });
  const off = store.onChange((event) => seen.push(event.type));
  const { grant } = store.issue(request());
  store.bindTab(grant.id, "tab-2");
  store.revoke(grant.id);
  off();
  store.issue(request({ agentId: "agent-z" }));
  assert.deepEqual(seen, ["issued", "tab-bound", "revoked"]);
});

test("old ended grants are purged beyond the retention window", () => {
  const { store } = harness();
  const tokens = [];
  for (let i = 0; i < 80; i += 1) {
    const { token, grant } = store.issue(request({ agentId: `agent-${i}` }));
    tokens.push(token);
    store.revoke(grant.id);
  }
  store.issue(request({ agentId: "last" }));
  assert.equal(store.authenticate(tokens[0]).code, "no_grant");
  assert.equal(store.authenticate(tokens[79]).code, "grant_revoked");
});

test("tokens are unique and compared by hash, not by prefix", () => {
  const real = createCapabilityStore();
  const a = real.issue(request({ agentId: "a" }));
  const b = real.issue(request({ agentId: "b" }));
  assert.notEqual(a.token, b.token);
  assert.ok(a.token.length >= 40);
  assert.equal(real.authenticate(a.token.slice(0, -1)).code, "no_grant");
  assert.equal(real.authenticate(`${a.token}x`).code, "no_grant");
});
