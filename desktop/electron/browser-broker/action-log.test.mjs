import assert from "node:assert/strict";
import test from "node:test";
import {
  ACTION_LOG_LIMITS,
  createActionLog,
  summarizeToolArgs,
} from "./action-log.mjs";
import { REDACTED } from "./redaction.mjs";

const base = {
  grantId: "g1",
  agentId: "agent-a",
  taskId: "t1",
  businessId: "b1",
  tabId: "tab-1",
  tool: "browser_click",
  status: "ok",
  summary: "Clicked Add to cart",
  durationMs: 12.6,
};

test("append stamps a sequence and timestamp and keeps whitelisted fields", () => {
  const log = createActionLog({ now: () => 1234 });
  const entry = log.append({
    ...base,
    injected: "ignored",
    password: "hunter2",
  });
  assert.equal(entry.seq, 1);
  assert.equal(entry.ts, 1234);
  assert.equal(entry.tool, "browser_click");
  assert.equal(entry.durationMs, 13);
  assert.equal(entry.status, "ok");
  assert.ok(!("injected" in entry));
  assert.ok(!("password" in entry));
  assert.equal(log.append(base).seq, 2);
});

test("credentials never reach the stored record", () => {
  const log = createActionLog();
  log.append({
    ...base,
    summary: `Typed password=hunter22 and sk-ant-api03-abcdefghijklmnopqrstuvwxyz`,
    url: "https://user:pw@example.com/cb?token=abc&x=1#access_token=zzz",
    origin: "https://example.com",
    args: {
      password: "hunter2",
      note: "card 4111 1111 1111 1111",
      nested: { cookie: "a=b" },
    },
  });
  const stored = JSON.stringify(log.entries());
  for (const secret of [
    "hunter2",
    "hunter22",
    "sk-ant",
    "user:pw",
    "token=abc",
    "zzz",
    "4111",
    "a=b",
  ]) {
    assert.ok(!stored.includes(secret), `${secret} leaked: ${stored}`);
  }
  assert.ok(stored.includes(REDACTED));
  assert.ok(stored.includes("x=1"));
});

test("unknown statuses fall back to error so the UI never trusts free text", () => {
  const log = createActionLog();
  assert.equal(log.append({ ...base, status: "<script>" }).status, "error");
  assert.equal(
    log.append({ ...base, status: "confirmation_requested" }).status,
    "confirmation_requested",
  );
  assert.equal(log.append(undefined).status, "error");
});

test("the log is bounded by entry count and counts what it drops", () => {
  const log = createActionLog({ maxEntries: 5 });
  for (let i = 0; i < 12; i += 1) log.append({ ...base, summary: `step ${i}` });
  const stats = log.stats();
  assert.equal(stats.count, 5);
  assert.equal(stats.dropped, 7);
  assert.equal(stats.lastSeq, 12);
  const seqs = log.entries().map((entry) => entry.seq);
  assert.deepEqual(seqs, [8, 9, 10, 11, 12]);
});

test("the log is bounded by bytes", () => {
  const log = createActionLog({ maxBytes: 4_000 });
  for (let i = 0; i < 100; i += 1)
    log.append({ ...base, summary: "x".repeat(250), args: { n: i } });
  assert.ok(log.stats().bytes <= 4_000);
  assert.ok(log.stats().dropped > 0);
  assert.ok(log.stats().count >= 1);
});

test("a single oversized record cannot evict the whole log", () => {
  const log = createActionLog({ maxBytes: 8_000 });
  for (let i = 0; i < 5; i += 1) log.append(base);
  const huge = log.append({
    ...base,
    summary: "y".repeat(10_000),
    args: Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [`k${i}`, "z".repeat(1_900)]),
    ),
  });
  assert.deepEqual(huge.args, { truncated: true });
  assert.ok(huge.summary.length <= 83);
  assert.ok(log.stats().count >= 5);
  assert.ok(log.stats().bytes <= 8_000);
});

test("summaries are capped", () => {
  const log = createActionLog();
  const entry = log.append({ ...base, summary: "s ".repeat(5_000) });
  assert.ok(entry.summary.length <= ACTION_LOG_LIMITS.maxSummary + 3);
});

test("entries filter by sequence, grant and tab, and return copies", () => {
  const log = createActionLog();
  log.append({ ...base, grantId: "g1", tabId: "tab-1" });
  log.append({ ...base, grantId: "g2", tabId: "tab-2" });
  log.append({ ...base, grantId: "g1", tabId: "tab-3" });
  assert.equal(log.entries({ grantId: "g1" }).length, 2);
  assert.equal(log.entries({ tabId: "tab-2" }).length, 1);
  assert.equal(log.entries({ sinceSeq: 2 }).length, 1);
  assert.equal(log.entries({ limit: 1 }).at(0).seq, 3);
  const copy = log.entries();
  copy[0].summary = "mutated";
  assert.notEqual(log.entries()[0].summary, "mutated");
});

test("summarizeToolArgs keeps ids and lengths, never typed text or secrets", () => {
  assert.deepEqual(
    summarizeToolArgs("browser_type", {
      tab: "t1",
      ref: "e4",
      text: "my secret text",
      submit: true,
    }),
    { tab: "t1", ref: "e4", chars: 14, submit: true },
  );
  assert.deepEqual(
    summarizeToolArgs("browser_click", { tab: "t1", ref: "e9" }),
    { tab: "t1", ref: "e9" },
  );
  const nav = summarizeToolArgs("browser_navigate", {
    tab: "t1",
    url: "https://a.example/x?token=abc&q=1",
  });
  assert.ok(!nav.url.includes("abc"));
  assert.ok(nav.url.includes("q=1"));
  assert.deepEqual(
    summarizeToolArgs("browser_select", { ref: "e2", values: ["a", "b"] }),
    { ref: "e2", values: 2 },
  );
  assert.deepEqual(
    summarizeToolArgs("browser_scroll", {
      tab: "t1",
      direction: "down",
      amount: 400,
    }),
    { tab: "t1", direction: "down", amount: 400 },
  );
  const wait = summarizeToolArgs("browser_wait", {
    text: "Order sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
    timeoutMs: 5000,
  });
  assert.ok(!wait.text.includes("sk-ant"));
  assert.equal(wait.timeoutMs, 5000);
  assert.deepEqual(
    summarizeToolArgs("browser_upload", { ref: "e3", uploadId: "u-1" }),
    { ref: "e3", uploadId: "u-1" },
  );
  assert.deepEqual(summarizeToolArgs("browser_click", null), {});
  assert.deepEqual(summarizeToolArgs("browser_type", { text: 5 }), {
    chars: 0,
  });
});
