import assert from "node:assert/strict";
import test from "node:test";

import {
  appearanceLastBusinessKey,
  appearanceSnapshotKey,
  blendColor,
  customGradientStops,
  isValidHexColor,
  writeAppearanceSnapshot,
  mergeLiveAppearanceSnapshot,
} from "./appearanceSnapshot.ts";

test("appearance snapshot keys bind the person and stable business id", () => {
  assert.equal(
    appearanceSnapshotKey("AABB", "business-17"),
    "colony.appearance.v1:aabb:business-17",
  );
  assert.equal(
    appearanceLastBusinessKey("AABB"),
    "colony.appearance.v1:aabb:last-business",
  );
});

test("custom color fields accept only six digit hex values", () => {
  assert.equal(isValidHexColor("#aBcD09"), true);
  assert.equal(isValidHexColor("#abc"), false);
  assert.equal(isValidHexColor("red"), false);
  assert.equal(isValidHexColor("#12gg00"), false);
});

test("color blending clamps and rounds each channel", () => {
  assert.equal(blendColor("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(blendColor("#000000", "#ffffff", 2), "#ffffff");
  assert.equal(blendColor("#ffffff", "#000000", -1), "#ffffff");
});

test("custom gradient stops use the light and dark reference tint ratios", () => {
  assert.deepEqual(customGradientStops(["#ffffff", "#000000"], "light"), [
    "#ffffff",
    "#bdbdbd",
  ]);
  assert.deepEqual(customGradientStops(["#ffffff", "#000000"], "dark"), [
    "#404040",
    "#000000",
  ]);
});

test("an appearance commit replaces one complete scoped snapshot atomically", () => {
  const writes = [];
  const storage = { setItem: (...entry) => writes.push(entry) };
  const snapshot = {
    version: 1,
    theme: "buzz",
    accent: "#895AF6",
    followSystem: true,
    custom: false,
    customLight: ["#895AF6", "#5A9CF6"],
    customDark: ["#895AF6", "#5A9CF6"],
    glassBackground: false,
    glassOpacity: 65,
    prominentActiveTab: false,
    messageSize: "default",
    density: "comfortable",
    linkPreview: "compact",
    threadLayout: "split",
  };

  assert.equal(
    writeAppearanceSnapshot(storage, "person:business", snapshot),
    true,
  );
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], "person:business");
  const { updatedAt, ...stored } = JSON.parse(writes[0][1]);
  const { customDark: _legacyDark, ...expected } = snapshot;
  assert.deepEqual(stored, expected);
  assert.ok(Number.isSafeInteger(updatedAt) && updatedAt > 0);
  assert.equal(
    writeAppearanceSnapshot(
      {
        setItem: () => {
          throw new Error("quota");
        },
      },
      "person:business",
      snapshot,
    ),
    false,
  );
});

test("opening Settings retains live theme and channel choices over an older full snapshot", () => {
  const live = {
    theme: "buzz",
    accent: "#3b82f6",
    followSystem: false,
    density: "spacious",
    linkPreview: "rich",
    threadLayout: "focus",
    customLight: ["#895AF6", "#5A9CF6"],
    glassOpacity: 65,
    messageSize: "default",
  };
  const result = mergeLiveAppearanceSnapshot(live, {
    theme: "dracula",
    accent: "#895AF6",
    followSystem: true,
    density: "compact",
    linkPreview: "compact",
    threadLayout: "split",
    custom: true,
    messageSize: "larger",
  });
  for (const key of [
    "theme",
    "accent",
    "followSystem",
    "density",
    "linkPreview",
    "threadLayout",
  ])
    assert.equal(result[key], live[key]);
  assert.equal(result.custom, true);
  assert.equal(result.messageSize, "larger");
});
