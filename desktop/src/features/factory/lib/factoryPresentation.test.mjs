import assert from "node:assert/strict";
import test from "node:test";

import {
  factoryStatusPresentation,
  latestRunForProject,
} from "./factoryPresentation.ts";

test("Factory maps every native status to its visible state", () => {
  assert.deepEqual(
    ["queued", "running", "waiting", "blocked", "error", "done", "cancelled"].map(
      (status) => factoryStatusPresentation(status).label,
    ),
    ["Queued", "Working", "Waiting", "Blocked", "Failed", "Done", "Cancelled"],
  );
});

test("Factory project recency derives only from actual runtime records", () => {
  const oldRun = { id: "old", projectId: "project-a", updatedAt: "2026-01-01" };
  const newRun = { id: "new", projectId: "project-a", updatedAt: "2026-01-02" };

  assert.equal(latestRunForProject([oldRun, newRun], "project-a"), newRun);
  assert.equal(latestRunForProject([oldRun], "project-b"), null);
});
