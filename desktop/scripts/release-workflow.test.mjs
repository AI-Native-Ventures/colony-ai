import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const releaseWorkflowPath = fileURLToPath(
  new URL("../../.github/workflows/release-desktop.yml", import.meta.url),
);
const packageWorkflowPath = fileURLToPath(
  new URL("../../.github/workflows/electron-package.yml", import.meta.url),
);

test("desktop release workflow is tag-bound and passes only declared optional secrets", async () => {
  const [releaseSource, packageSource] = await Promise.all([
    readFile(releaseWorkflowPath, "utf8"),
    readFile(packageWorkflowPath, "utf8"),
  ]);
  const release = parse(releaseSource);
  const packageWorkflow = parse(packageSource);

  assert.deepEqual(release.on.push.tags, ["desktop-v*"]);
  assert.equal(release.on.workflow_dispatch.inputs.version.required, true);
  assert.equal(
    release.jobs.package.uses,
    "./.github/workflows/electron-package.yml",
  );
  assert.equal(release.jobs.package.with.release, true);
  assert.equal(release.jobs.publish.permissions.contents, "write");

  for (const secretName of Object.keys(release.jobs.package.secrets)) {
    assert.equal(
      packageWorkflow.on.workflow_call.secrets[secretName]?.required,
      false,
      `${secretName} must be declared optional by the reusable package workflow`,
    );
  }
});
