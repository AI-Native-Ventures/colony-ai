import assert from "node:assert/strict";
import test from "node:test";

import {
  readTimeZonePreference,
  timeZoneLabel,
  timeZoneOptions,
  writeTimeZonePreference,
} from "./timezonePreference.ts";

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
  };
}

test("a saved time zone is read back for the same person only", () => {
  const storage = memoryStorage();
  assert.equal(
    writeTimeZonePreference("AB12", "Africa/Johannesburg", storage),
    true,
  );
  assert.equal(readTimeZonePreference("ab12", storage), "Africa/Johannesburg");
  assert.equal(readTimeZonePreference("cd34", storage), null);
});

test("an unknown zone is not saved and not read", () => {
  const storage = memoryStorage();
  assert.equal(writeTimeZonePreference("ab12", "Mars/Olympus", storage), false);
  storage.setItem("colony.time-zone.v1:ab12", "Mars/Olympus");
  assert.equal(readTimeZonePreference("ab12", storage), null);
});

test("a blocked store is a failed save, not an error", () => {
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(writeTimeZonePreference("ab12", "UTC", blocked), false);
  assert.equal(readTimeZonePreference("ab12", blocked), null);
});

test("the current zone is always among the options", () => {
  assert.ok(
    timeZoneOptions("Africa/Johannesburg").includes("Africa/Johannesburg"),
  );
});

test("the label names the zone with its short name", () => {
  const label = timeZoneLabel(
    "Africa/Johannesburg",
    new Date("2026-10-23T09:55:00+02:00"),
  );
  assert.match(label, /^Africa\/Johannesburg · \S+/);
});
