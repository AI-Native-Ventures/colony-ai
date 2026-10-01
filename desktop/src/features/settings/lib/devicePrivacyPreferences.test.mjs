import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_DEVICE_PRIVACY_PREFERENCES,
  devicePrivacyStorageKey,
  readDevicePrivacyPreferences,
  writeDevicePrivacyPreferences,
} from "./devicePrivacyPreferences.ts";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("privacy preferences default to the closed device settings", () => {
  assert.deepEqual(
    readDevicePrivacyPreferences("AABB", memoryStorage()),
    DEFAULT_DEVICE_PRIVACY_PREFERENCES,
  );
});

test("privacy preferences are saved atomically and scoped by identity", () => {
  const storage = memoryStorage();
  const preferences = {
    showMessageText: true,
    shareTypingActivity: false,
  };

  assert.equal(
    writeDevicePrivacyPreferences("AABB", preferences, storage),
    true,
  );
  assert.deepEqual(readDevicePrivacyPreferences("aabb", storage), preferences);
  assert.deepEqual(
    readDevicePrivacyPreferences("CCDD", storage),
    DEFAULT_DEVICE_PRIVACY_PREFERENCES,
  );
  assert.equal(
    devicePrivacyStorageKey("AABB"),
    "colony.device-privacy.v1:aabb",
  );
});

test("invalid stored data fails closed", () => {
  const storage = memoryStorage({
    "colony.device-privacy.v1:aabb": "not-json",
  });
  assert.deepEqual(
    readDevicePrivacyPreferences("aabb", storage),
    DEFAULT_DEVICE_PRIVACY_PREFERENCES,
  );
});

test("a failed preference write reports failure and keeps the current draft", () => {
  const preferences = {
    showMessageText: true,
    shareTypingActivity: true,
  };
  const storage = {
    getItem: () => null,
    setItem() {
      throw new Error("storage unavailable");
    },
  };

  assert.equal(
    writeDevicePrivacyPreferences("AABB", preferences, storage),
    false,
  );
  assert.deepEqual(preferences, {
    showMessageText: true,
    shareTypingActivity: true,
  });
});
