import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  capMessage,
  cloudModelLabel,
  cloudSetupLabel,
  FREE_AI_BUSY_MESSAGE,
  macOffMessage,
  notCloudReadyMessage,
  settingsTitle,
  startFailureMessage,
  statusLabel,
  workingOnLabel,
} from "./placementCopy.ts";

describe("cloud agent copy", () => {
  it("switch_shows_current_home_and_status: the exact strings of the plan", () => {
    assert.equal(workingOnLabel("mac"), "Working on: This Mac");
    assert.equal(workingOnLabel("cloud"), "Working on: Cloud");
    assert.equal(statusLabel("asleep"), "Asleep");
    assert.equal(statusLabel("waking"), "Waking");
    assert.equal(statusLabel("working"), "Working");
    assert.equal(statusLabel("failed"), "Could not start");
    assert.equal(statusLabel("outOfCredit"), "Out of AI credit");
    assert.equal(statusLabel("notCloudReady"), null);
    assert.equal(statusLabel(null), null);
    assert.equal(settingsTitle("Scout"), "Where Scout works");
  });

  it("not_cloud_ready_message and the cards", () => {
    assert.equal(
      notCloudReadyMessage("Scout"),
      "Open Colony on your Mac once to make Scout cloud-ready.",
    );
    assert.equal(
      macOffMessage("Scout"),
      "Scout's Mac is off. Move Scout to the cloud?",
    );
    assert.equal(
      startFailureMessage("Scout"),
      "Scout could not start in the cloud.",
    );
    assert.equal(
      capMessage(2),
      "You can have 2 agents in the cloud during the beta.",
    );
  });

  it("no copy carries an em-dash", () => {
    const all = [
      workingOnLabel("cloud"),
      settingsTitle("A"),
      notCloudReadyMessage("A"),
      macOffMessage("A"),
      startFailureMessage("A"),
      capMessage(2),
      cloudSetupLabel("deepseek/deepseek-v4.1-flash"),
    ].join(" ");
    assert.equal(all.includes("—"), false);
  });

  it("names the cloud model the way the plan does", () => {
    assert.equal(
      cloudModelLabel("deepseek/deepseek-v4.1-flash"),
      "DeepSeek V4.1 Flash",
    );
    assert.equal(
      cloudSetupLabel("deepseek/deepseek-v4.1-flash"),
      "Colony credits · DeepSeek V4.1 Flash",
    );
    assert.equal(cloudSetupLabel(null), "Colony credits");
  });

  it("the free model reads as Free (default), never as its raw id", () => {
    assert.equal(cloudModelLabel("colony-free"), "Free (default)");
    assert.equal(cloudSetupLabel("colony-free"), "Free AI");
    assert.equal(cloudSetupLabel("colony-free").includes("colony-free"), false);
    // Paid models keep the existing label.
    assert.equal(
      cloudModelLabel("deepseek/deepseek-v4.1-flash"),
      "DeepSeek V4.1 Flash",
    );
  });

  it("the busy notice copy is exact and carries no em-dash", () => {
    assert.equal(FREE_AI_BUSY_MESSAGE, "Free AI is busy right now.");
    assert.equal(FREE_AI_BUSY_MESSAGE.includes("\u2014"), false);
  });
});
