import assert from "node:assert/strict";
import test from "node:test";
import {
  harnessDetectionStatus,
  harnessInstallLabel,
} from "./harnessDetectionState.ts";

test("missing Codex adapter is a connection setup, not a missing CLI", () => {
  const runtime = {
    id: "codex",
    availability: "adapter_missing",
    authStatus: { status: "unknown" },
  };
  assert.equal(harnessDetectionStatus(runtime, false), "Connection needed");
  assert.equal(harnessInstallLabel(runtime), "Set up connection");
  assert.equal(
    harnessDetectionStatus(
      { ...runtime, availability: "adapter_outdated" },
      false,
    ),
    "Connection update needed",
  );
  assert.equal(
    harnessInstallLabel({ ...runtime, availability: "adapter_outdated" }),
    "Update connection",
  );
});

test("installation never implies authentication", () => {
  for (const id of ["codex", "goose", "omp", "grok"]) {
    const runtime = {
      id,
      availability: "available",
      authStatus: { status: "unknown" },
    };
    assert.equal(
      harnessDetectionStatus(runtime, false),
      "Authentication not checked",
    );
    assert.equal(
      harnessDetectionStatus(
        { ...runtime, authStatus: { status: "config_invalid" } },
        false,
      ),
      "Configuration needs attention",
    );
    assert.equal(
      harnessDetectionStatus(
        { ...runtime, authStatus: { status: "logged_out" } },
        false,
      ),
      "Sign-in needed",
    );
    assert.equal(
      harnessDetectionStatus(runtime, true),
      "Ready on this computer",
    );
  }
});
