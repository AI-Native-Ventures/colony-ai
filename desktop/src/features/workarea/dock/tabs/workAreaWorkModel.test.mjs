import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveWorkTabView, sortChannelWork } from "./workAreaWorkModel.ts";

const CHANNEL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const OTHER = "b5e2f8a1-3c44-5912-9e67-4a8d1f2b3c4e";

const channel = (overrides = {}) => ({
  id: CHANNEL,
  channelType: "stream",
  isMember: true,
  archivedAt: null,
  ...overrides,
});
const record = (id, title, status = "active", channelId = CHANNEL) => ({
  dTag: `company:work:${id}`,
  channelId,
  event: {},
  head: { workItemId: id, title, status },
});
const ok = (data) => ({ status: "success", error: null, data });
const pending = { status: "pending", error: null, data: undefined };
const failed = (error) => ({ status: "error", error, data: undefined });

const view = (input) => resolveWorkTabView({ channelId: CHANNEL, ...input });

test("every state of the Work tab is decided by one table", () => {
  const cases = [
    [
      "channels still loading",
      { channels: pending, heads: pending },
      "loading",
    ],
    [
      "channels loaded, work still loading",
      { channels: ok([channel()]), heads: pending },
      "loading",
    ],
    [
      "channels failed",
      { channels: failed(new Error("x")), heads: pending },
      "failed",
    ],
    [
      "work failed",
      { channels: ok([channel()]), heads: failed(new Error("x")) },
      "failed",
    ],
    [
      "not a member of the channel",
      { channels: ok([channel({ isMember: false })]), heads: ok([]) },
      "denied",
    ],
    [
      "channel missing from the person's list",
      { channels: ok([]), heads: ok([]) },
      "denied",
    ],
    [
      "direct message",
      { channels: ok([channel({ channelType: "dm" })]), heads: ok([]) },
      "unlisted",
    ],
    [
      "forum",
      { channels: ok([channel({ channelType: "forum" })]), heads: ok([]) },
      "unlisted",
    ],
    [
      "archived",
      {
        channels: ok([channel({ archivedAt: "2026-10-01T00:00:00Z" })]),
        heads: ok([]),
      },
      "unlisted",
    ],
    ["no work anywhere", { channels: ok([channel()]), heads: ok([]) }, "empty"],
    [
      "work only in another channel",
      {
        channels: ok([channel()]),
        heads: ok([record("w1", "Elsewhere", "active", OTHER)]),
      },
      "empty",
    ],
    [
      "work in this channel",
      {
        channels: ok([channel()]),
        heads: ok([record("w1", "Here")]),
      },
      "ready",
    ],
  ];
  for (const [name, input, expected] of cases) {
    assert.equal(view(input).state, expected, name);
  }
});

test("a failure carries its error so the tab can log it, not show it", () => {
  const error = new Error("relay returned 500: boom");
  const result = view({ channels: ok([channel()]), heads: failed(error) });
  assert.equal(result.state, "failed");
  assert.equal(result.error, error);
});

test("channel membership outranks a work failure", () => {
  const result = view({
    channels: ok([channel({ isMember: false })]),
    heads: failed(new Error("x")),
  });
  assert.equal(result.state, "denied");
});

test("only this channel's work is listed, open work first", () => {
  const result = view({
    channels: ok([channel()]),
    heads: ok([
      record("w4", "Archived one", "archived"),
      record("w1", "Zeta", "active"),
      record("w5", "Not here", "active", OTHER),
      record("w3", "Finished", "done_verified"),
      record("w2", "Alpha", "active"),
      record("w6", "Stuck", "blocked"),
    ]),
  });
  assert.equal(result.state, "ready");
  assert.deepEqual(
    result.records.map((item) => item.head.title),
    ["Alpha", "Zeta", "Stuck", "Finished", "Archived one"],
  );
});

test("channel ids compare without regard to case", () => {
  const result = resolveWorkTabView({
    channelId: CHANNEL.toUpperCase(),
    channels: ok([channel()]),
    heads: ok([record("w1", "Here")]),
  });
  assert.equal(result.state, "ready");
});

test("sorting is stable and does not change its input", () => {
  const input = [record("b", "Same"), record("a", "Same")];
  const sorted = sortChannelWork(input);
  assert.deepEqual(
    sorted.map((item) => item.head.workItemId),
    ["a", "b"],
  );
  assert.deepEqual(
    input.map((item) => item.head.workItemId),
    ["b", "a"],
  );
});
