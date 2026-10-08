import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildChannelPins,
  groupPins,
  MAX_CHANNEL_PINS,
  parsePinEvent,
  pinEventsBy,
  pinPreview,
  resolvePinTarget,
} from "./pinModels.ts";

const CHANNEL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const OTHER_CHANNEL = "b5e2f8a1-3c44-5912-9e67-4a8d1f2b3c4e";
const hex = (char, n = 64) => char.repeat(n);
const ALICE = hex("a");
const BOB = hex("b");

const pinEvent = (id, target, overrides = {}) => ({
  id,
  pubkey: ALICE,
  kind: 40004,
  created_at: 100,
  content: "",
  sig: "s",
  tags: [
    ["h", CHANNEL],
    ["e", target],
  ],
  ...overrides,
});
const message = (id, overrides = {}) => ({
  id,
  pubkey: BOB,
  kind: 9,
  created_at: 50,
  content: "Ship the launch brief on Friday.",
  sig: "s",
  tags: [["h", CHANNEL]],
  ...overrides,
});

test("a pin that follows the contract parses; every deviation is ignored", () => {
  const good = pinEvent(hex("1"), hex("2"));
  assert.deepEqual(parsePinEvent(good, CHANNEL), {
    pinEventId: hex("1"),
    targetId: hex("2"),
    pinnedBy: ALICE,
    pinnedAt: 100,
  });
  const bad = {
    "wrong kind": pinEvent(hex("1"), hex("2"), { kind: 9 }),
    "no channel tag": pinEvent(hex("1"), hex("2"), {
      tags: [["e", hex("2")]],
    }),
    "another channel": pinEvent(hex("1"), hex("2"), {
      tags: [
        ["h", OTHER_CHANNEL],
        ["e", hex("2")],
      ],
    }),
    "two channel tags": pinEvent(hex("1"), hex("2"), {
      tags: [
        ["h", CHANNEL],
        ["h", OTHER_CHANNEL],
        ["e", hex("2")],
      ],
    }),
    "no target": pinEvent(hex("1"), hex("2"), { tags: [["h", CHANNEL]] }),
    "two targets": pinEvent(hex("1"), hex("2"), {
      tags: [
        ["h", CHANNEL],
        ["e", hex("2")],
        ["e", hex("3")],
      ],
    }),
    "malformed target": pinEvent(hex("1"), "nothex"),
    "thread marker would make it a reply": pinEvent(hex("1"), hex("2"), {
      tags: [
        ["h", CHANNEL],
        ["e", hex("2"), "", "reply"],
      ],
    }),
    "malformed pinner": pinEvent(hex("1"), hex("2"), { pubkey: "short" }),
    "malformed id": pinEvent("short", hex("2")),
  };
  for (const [name, event] of Object.entries(bad)) {
    assert.equal(parsePinEvent(event, CHANNEL), null, name);
  }
});

test("channel ids and hex compare without regard to case", () => {
  const record = parsePinEvent(
    pinEvent(hex("1").toUpperCase(), hex("2").toUpperCase(), {
      pubkey: ALICE.toUpperCase(),
      tags: [
        ["h", CHANNEL.toUpperCase()],
        ["e", hex("2").toUpperCase()],
      ],
    }),
    CHANNEL,
  );
  assert.equal(record?.pinEventId, hex("1"));
  assert.equal(record?.targetId, hex("2"));
  assert.equal(record?.pinnedBy, ALICE);
});

test("several pins of one message become one pin, newest first, first pinner kept", () => {
  const [group] = groupPins([
    { pinEventId: hex("1"), targetId: hex("9"), pinnedBy: ALICE, pinnedAt: 10 },
    { pinEventId: hex("2"), targetId: hex("9"), pinnedBy: BOB, pinnedAt: 30 },
    { pinEventId: hex("3"), targetId: hex("9"), pinnedBy: ALICE, pinnedAt: 20 },
  ]);
  assert.deepEqual(
    group.pins.map((pin) => pin.pinEventId),
    [hex("2"), hex("3"), hex("1")],
  );
  assert.equal(group.pinnedAt, 30);
  assert.equal(group.pinnedBy, ALICE);
});

test("pins are listed most recently pinned first", () => {
  const groups = groupPins([
    { pinEventId: hex("1"), targetId: hex("7"), pinnedBy: ALICE, pinnedAt: 10 },
    { pinEventId: hex("2"), targetId: hex("8"), pinnedBy: ALICE, pinnedAt: 99 },
  ]);
  assert.deepEqual(
    groups.map((group) => group.targetId),
    [hex("8"), hex("7")],
  );
});

test("a target is a message, unavailable, or rejected", () => {
  const target = hex("2");
  assert.deepEqual(resolvePinTarget(target, CHANNEL, [message(target)]), {
    state: "message",
    id: target,
    author: BOB,
    content: "Ship the launch brief on Friday.",
    createdAt: 50,
  });
  assert.deepEqual(resolvePinTarget(target, CHANNEL, []), {
    state: "unavailable",
  });
  assert.equal(
    resolvePinTarget(target, CHANNEL, [
      message(target, { tags: [["h", OTHER_CHANNEL]] }),
    ]),
    "rejected",
    "a message from another channel",
  );
  assert.equal(
    resolvePinTarget(target, CHANNEL, [message(target, { kind: 40099 })]),
    "rejected",
    "not a stream message",
  );
  assert.equal(
    resolvePinTarget(target, CHANNEL, [message(target, { tags: [] })]),
    "rejected",
    "no channel at all",
  );
  assert.equal(
    resolvePinTarget(target, CHANNEL, [message(target, { kind: 40002 })]) ===
      "rejected",
    false,
    "v2 stream messages are pinnable",
  );
});

test("the finished list drops rejected pins, keeps unavailable ones, and counts what it dropped", () => {
  const ok = hex("2");
  const gone = hex("3");
  const elsewhere = hex("4");
  const { result, rejected } = buildChannelPins(
    CHANNEL,
    [
      pinEvent(hex("d"), ok, { created_at: 300 }),
      pinEvent(hex("e"), gone, { created_at: 200 }),
      pinEvent(hex("f"), elsewhere, { created_at: 100 }),
      pinEvent(hex("1"), hex("5"), { kind: 9 }),
    ],
    [message(ok), message(elsewhere, { tags: [["h", OTHER_CHANNEL]] })],
  );
  assert.equal(rejected, 1);
  assert.deepEqual(
    result.pins.map((pin) => [pin.targetId, pin.target.state]),
    [
      [ok, "message"],
      [gone, "unavailable"],
    ],
  );
  assert.equal(result.truncated, false);
});

test("the list is bounded and says when it was cut", () => {
  const events = Array.from({ length: MAX_CHANNEL_PINS + 5 }, (_, i) =>
    pinEvent(
      i.toString(16).padStart(64, "0"),
      (i + 1000).toString(16).padStart(64, "0"),
      { created_at: i },
    ),
  );
  const { result } = buildChannelPins(CHANNEL, events, []);
  assert.equal(result.pins.length, MAX_CHANNEL_PINS);
  assert.equal(result.truncated, true);
});

test("unpinning targets only the viewer's own pin events", () => {
  const [group] = groupPins([
    { pinEventId: hex("1"), targetId: hex("9"), pinnedBy: ALICE, pinnedAt: 10 },
    { pinEventId: hex("2"), targetId: hex("9"), pinnedBy: BOB, pinnedAt: 20 },
  ]);
  assert.deepEqual(
    pinEventsBy(group, ALICE.toUpperCase()).map((pin) => pin.pinEventId),
    [hex("1")],
  );
  assert.deepEqual(pinEventsBy(group, hex("c")), []);
  assert.deepEqual(pinEventsBy(undefined, ALICE), []);
  assert.deepEqual(pinEventsBy(group, undefined), []);
});

test("previews join lines and are bounded", () => {
  assert.equal(pinPreview("\n  First  \n\nSecond\n"), "First Second");
  const long = pinPreview("w".repeat(500));
  assert.equal(long.length, 220);
  assert.ok(long.endsWith("…"));
});
