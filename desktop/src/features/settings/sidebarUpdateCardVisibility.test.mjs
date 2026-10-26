import assert from "node:assert/strict";
import test from "node:test";

import { shouldShowSidebarUpdateCard } from "./sidebarUpdateCardVisibility.ts";

test("shows the card for states that require user action or feedback", () => {
  assert.equal(shouldShowSidebarUpdateCard({ state: "ready" }), true);
  assert.equal(shouldShowSidebarUpdateCard({ state: "installing" }), true);
  assert.equal(shouldShowSidebarUpdateCard({ state: "manual-required" }), true);
});

test("hides the card for states with nothing actionable to show", () => {
  assert.equal(shouldShowSidebarUpdateCard({ state: "idle" }), false);
  assert.equal(shouldShowSidebarUpdateCard({ state: "checking" }), false);
  assert.equal(shouldShowSidebarUpdateCard({ state: "up-to-date" }), false);
  assert.equal(shouldShowSidebarUpdateCard({ state: "unavailable" }), false);
  assert.equal(shouldShowSidebarUpdateCard({ state: "available" }), false);
  assert.equal(shouldShowSidebarUpdateCard({ state: "downloading" }), false);
});

// An error with no manual link (a failed background check, a Windows install
// failure) stays quiet: the background check retries on its own schedule.
test("hides the card on an error that has no manual download link", () => {
  assert.equal(
    shouldShowSidebarUpdateCard({ state: "error", message: "boom" }),
    false,
  );
});

// A refused or failed Mac update carries the download link, and the person
// needs to know their app was not updated.
test("shows the card on an error that carries the manual download link", () => {
  assert.equal(
    shouldShowSidebarUpdateCard({
      state: "error",
      message: "The downloaded update did not match its checksum.",
      releaseUrl: "https://colony.global/#download",
    }),
    true,
  );
});
