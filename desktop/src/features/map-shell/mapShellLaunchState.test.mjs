import assert from "node:assert/strict";
import test from "node:test";

import {
  mapShellCofounderEnabledStorageKey,
  readRememberedMapShellEnabled,
  resolveMapShellLaunchState,
  writeRememberedMapShellEnabled,
} from "./mapShellLaunchState.ts";

const COMMUNITY_A = {
  id: "community-a",
  relayUrl: "wss://relay-a.example",
};
const COMMUNITY_B = {
  id: "community-b",
  relayUrl: "wss://relay-a.example",
};
const COMMUNITY_A_OTHER_RELAY = {
  id: "community-a",
  relayUrl: "wss://relay-b.example",
};

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test("map-shell cache scope includes both community id and relay URL", () => {
  assert.notEqual(
    mapShellCofounderEnabledStorageKey(COMMUNITY_A),
    mapShellCofounderEnabledStorageKey(COMMUNITY_B),
  );
  assert.notEqual(
    mapShellCofounderEnabledStorageKey(COMMUNITY_A),
    mapShellCofounderEnabledStorageKey(COMMUNITY_A_OTHER_RELAY),
  );
});

test("map-shell cache remembers both direct co-founder settings values", () => {
  const storage = createStorage();

  assert.equal(
    writeRememberedMapShellEnabled(COMMUNITY_A, true, storage),
    true,
  );
  assert.equal(readRememberedMapShellEnabled(COMMUNITY_A, storage), true);
  assert.equal(
    writeRememberedMapShellEnabled(COMMUNITY_A, false, storage),
    true,
  );
  assert.equal(readRememberedMapShellEnabled(COMMUNITY_A, storage), false);
});

test("map-shell cache treats unavailable or malformed values as unknown", () => {
  const storage = createStorage();
  storage.setItem(mapShellCofounderEnabledStorageKey(COMMUNITY_A), "unknown");

  assert.equal(readRememberedMapShellEnabled(COMMUNITY_A, storage), null);
  assert.equal(readRememberedMapShellEnabled(COMMUNITY_A, null), null);
  assert.equal(writeRememberedMapShellEnabled(COMMUNITY_A, true, null), false);
});

test("map-shell launch state lets direct relay data replace cached data", () => {
  assert.equal(
    resolveMapShellLaunchState({
      cofounderEnabled: false,
      cofounderSettingsError: false,
      cofounderSettingsTimedOut: false,
      mapHomeEnabled: true,
      rememberedCofounderEnabled: true,
    }),
    "legacy",
  );
  assert.equal(
    resolveMapShellLaunchState({
      cofounderEnabled: true,
      cofounderSettingsError: true,
      cofounderSettingsTimedOut: false,
      mapHomeEnabled: true,
      rememberedCofounderEnabled: false,
    }),
    "map",
  );
});

test("map-shell launch state uses cache only while the relay result is unknown", () => {
  assert.equal(
    resolveMapShellLaunchState({
      cofounderEnabled: undefined,
      cofounderSettingsError: false,
      cofounderSettingsTimedOut: false,
      mapHomeEnabled: true,
      rememberedCofounderEnabled: true,
    }),
    "map",
  );
  assert.equal(
    resolveMapShellLaunchState({
      cofounderEnabled: undefined,
      cofounderSettingsError: false,
      cofounderSettingsTimedOut: false,
      mapHomeEnabled: true,
      rememberedCofounderEnabled: false,
    }),
    "legacy",
  );
  assert.equal(
    resolveMapShellLaunchState({
      cofounderEnabled: undefined,
      cofounderSettingsError: false,
      cofounderSettingsTimedOut: false,
      mapHomeEnabled: true,
      rememberedCofounderEnabled: null,
    }),
    "loading",
  );
  assert.equal(
    resolveMapShellLaunchState({
      cofounderEnabled: undefined,
      cofounderSettingsError: false,
      cofounderSettingsTimedOut: false,
      mapHomeEnabled: false,
      rememberedCofounderEnabled: true,
    }),
    "legacy",
  );
});

test("map-shell launch state falls back after the first settings read errors", () => {
  assert.equal(
    resolveMapShellLaunchState({
      cofounderEnabled: undefined,
      cofounderSettingsError: true,
      cofounderSettingsTimedOut: false,
      mapHomeEnabled: true,
      rememberedCofounderEnabled: null,
    }),
    "legacy",
  );
});

test("map-shell launch state falls back after the first settings read times out", () => {
  assert.equal(
    resolveMapShellLaunchState({
      cofounderEnabled: undefined,
      cofounderSettingsError: false,
      cofounderSettingsTimedOut: true,
      mapHomeEnabled: true,
      rememberedCofounderEnabled: null,
    }),
    "legacy",
  );
});
