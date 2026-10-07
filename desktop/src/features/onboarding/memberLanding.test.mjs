import assert from "node:assert/strict";
import test from "node:test";

import { pickMemberLandingChannel } from "./memberLanding.ts";

const channel = (id, name, extra = {}) => ({
  id,
  name,
  channelType: "stream",
  visibility: "open",
  archivedAt: null,
  ...extra,
});

test("members land in general, ignoring case and order", () => {
  assert.equal(
    pickMemberLandingChannel([channel("a", "random"), channel("b", "General")]),
    "b",
  );
});

test("an archived or non-stream general is skipped", () => {
  assert.equal(
    pickMemberLandingChannel([
      channel("a", "general", { archivedAt: "2026-01-01" }),
      channel("f", "general", { channelType: "forum" }),
      channel("c", "design"),
    ]),
    "c",
  );
});

test("falls back to an open channel, then any stream, then nothing", () => {
  assert.equal(
    pickMemberLandingChannel([
      channel("p", "private", { visibility: "private" }),
      channel("o", "open"),
    ]),
    "o",
  );
  assert.equal(
    pickMemberLandingChannel([
      channel("p", "private", { visibility: "private" }),
    ]),
    "p",
  );
  assert.equal(pickMemberLandingChannel([]), null);
});
