import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { homeNoticeKind } from "./homeNoticeModel.ts";

const NOW = 1_800_000_000;
const placement = (home, status = null) => ({
  home,
  generation: 2,
  status,
  cloudReady: true,
  cloudModel: null,
  configVersion: 1,
});
const base = {
  placement: placement("mac"),
  cloudAvailable: true,
  owned: true,
  online: false,
  hasLocalRecord: false,
  localStartFailed: false,
  oldestUnansweredAt: NOW - 61,
  nowSeconds: NOW,
};
const kind = (overrides = {}) => homeNoticeKind({ ...base, ...overrides });

describe("home notice card", () => {
  it("mac_off_card: offline Mac, a message unanswered past the stalled window, no local copy", () => {
    assert.equal(kind(), "macOff");
  });

  it("mac_off_card: not before the stalled window", () => {
    assert.equal(kind({ oldestUnansweredAt: NOW - 59 }), null);
    assert.equal(kind({ oldestUnansweredAt: NOW - 60 }), "macOff");
  });

  it("mac_off_card: nothing unanswered, no card", () => {
    assert.equal(kind({ oldestUnansweredAt: null }), null);
  });

  it("mac_off_card: an agent that is online needs no rescue", () => {
    assert.equal(kind({ online: true }), null);
  });

  it("mac_off_card: only when cloud agents are available and the person owns the agent", () => {
    assert.equal(kind({ cloudAvailable: false }), null);
    assert.equal(kind({ owned: false }), null);
  });

  it("mac_off_card: this device owns a copy that is starting, so wait for it", () => {
    assert.equal(kind({ hasLocalRecord: true }), null);
  });

  it("mac_off_card: this device owns a copy whose start failed, so offer the cloud", () => {
    assert.equal(
      kind({ hasLocalRecord: true, localStartFailed: true }),
      "macOff",
    );
  });

  it("out of credit and start failure follow the relay's status, in the cloud only", () => {
    assert.equal(
      kind({ placement: placement("cloud", "outOfCredit") }),
      "outOfCredit",
    );
    assert.equal(
      kind({ placement: placement("cloud", "failed") }),
      "startFailure",
    );
    assert.equal(kind({ placement: placement("cloud", "asleep") }), null);
    assert.equal(kind({ placement: placement("cloud", "working") }), null);
    // A Mac placed agent never shows a cloud failure.
    assert.equal(
      kind({ placement: placement("mac", "failed"), oldestUnansweredAt: null }),
      null,
    );
  });

  it("a cloud agent never shows the Mac off card", () => {
    assert.equal(kind({ placement: placement("cloud", "asleep") }), null);
  });
});
