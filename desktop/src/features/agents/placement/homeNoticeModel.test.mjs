import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { freeAiBusyShowing, homeNoticeKind } from "./homeNoticeModel.ts";
import { homeNoticeContent } from "./homeNoticeContent.ts";

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

const AGENT = "aa".repeat(32);
const msg = (id, createdAt, pubkey, tags = []) => ({
  id,
  createdAt,
  pubkey,
  tags,
});
const busyTags = [["colony_notice", "freeAiBusy"]];

describe("free AI busy card", () => {
  it("a cloud agent whose latest message is the freeAiBusy notice shows the card", () => {
    assert.equal(
      kind({
        placement: placement("cloud", "asleep"),
        freeAiBusy: true,
      }),
      "freeAiBusy",
    );
  });

  it("start failure and out of credit still win over free AI busy", () => {
    assert.equal(
      kind({ placement: placement("cloud", "failed"), freeAiBusy: true }),
      "startFailure",
    );
    assert.equal(
      kind({ placement: placement("cloud", "outOfCredit"), freeAiBusy: true }),
      "outOfCredit",
    );
  });

  it("never on the Mac, and not unless the notice is showing", () => {
    assert.equal(
      kind({
        placement: placement("mac"),
        freeAiBusy: true,
        oldestUnansweredAt: null,
      }),
      null,
    );
    assert.equal(kind({ placement: placement("cloud", "asleep") }), null);
  });

  it("shows only while the agent's newest message is the tagged notice", () => {
    const messages = [
      msg("1", 10, "bb".repeat(32)),
      msg("2", 20, AGENT, busyTags),
    ];
    assert.equal(freeAiBusyShowing(messages, AGENT), true);
    // The agent answered afterwards: the card goes away.
    assert.equal(
      freeAiBusyShowing([...messages, msg("3", 30, AGENT)], AGENT),
      false,
    );
    // Another sender's tagged message is not this agent's notice.
    assert.equal(
      freeAiBusyShowing([msg("4", 40, "bb".repeat(32), busyTags)], AGENT),
      false,
    );
    // Other notice kinds and untagged messages do not count.
    assert.equal(
      freeAiBusyShowing(
        [msg("5", 50, AGENT, [["colony_notice", "outOfCredit"]])],
        AGENT,
      ),
      false,
    );
    assert.equal(freeAiBusyShowing([], AGENT), false);
  });

  it("the card says Free AI is busy right now. with Top up and Move to This Mac", () => {
    const calls = [];
    const content = homeNoticeContent("freeAiBusy", "Scout", {
      moveToCloud: () => calls.push("cloud"),
      moveToMac: () => calls.push("mac"),
      retry: () => calls.push("retry"),
      topUp: () => calls.push("topUp"),
    });
    assert.equal(content.message, "Free AI is busy right now.");
    assert.deepEqual(
      content.actions.map((action) => action.label),
      ["Top up", "Move to This Mac"],
    );
    for (const action of content.actions) action.onClick();
    assert.deepEqual(calls, ["topUp", "mac"]);
  });

  it("the other cards keep their words", () => {
    const handlers = {
      moveToCloud: () => {},
      moveToMac: () => {},
      retry: () => {},
      topUp: () => {},
    };
    assert.equal(
      homeNoticeContent("outOfCredit", "Scout", handlers).message,
      "Out of AI credit.",
    );
    assert.equal(
      homeNoticeContent("startFailure", "Scout", handlers).message,
      "Scout could not start in the cloud.",
    );
  });
});
