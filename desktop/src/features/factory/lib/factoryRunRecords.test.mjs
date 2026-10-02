import assert from "node:assert/strict";
import test from "node:test";

import {
  factoryPullRequestNumber,
  isValidFactoryPreviewState,
} from "./factoryRunRecords.ts";

test("preview configuration validates its saved port and readiness", () => {
  assert.equal(
    isValidFactoryPreviewState({
      state: "not_started",
      command: "pnpm dev",
      localUrl: "http://127.0.0.1:4173",
      port: 4173,
      readiness: { mode: "http_endpoint", value: "/ready" },
    }),
    true,
  );
  assert.equal(
    isValidFactoryPreviewState({
      state: "not_started",
      command: "pnpm dev",
      localUrl: "http://127.0.0.1:4173",
      port: 4174,
      readiness: { mode: "http_endpoint", value: "/ready" },
    }),
    false,
  );
  assert.equal(
    isValidFactoryPreviewState({
      state: "not_started",
      command: "pnpm dev",
      localUrl: "http://127.0.0.1:4173",
      port: 4173,
      readiness: {
        mode: "http_endpoint",
        value: "//external.example.test/ready",
      },
    }),
    false,
  );
});

test("preview records from before readiness fields remain readable", () => {
  assert.equal(
    isValidFactoryPreviewState({
      state: "not_started",
      command: "pnpm dev",
      localUrl: "http://localhost:4173",
    }),
    true,
  );
});

test("pull request numbers come from a supported path segment", () => {
  assert.equal(
    factoryPullRequestNumber("https://code.example.test/team/project/pull/42"),
    42,
  );
  assert.equal(
    factoryPullRequestNumber(
      "https://code.example.test/team/project/issues/42",
    ),
    null,
  );
});
