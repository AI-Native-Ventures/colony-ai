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

async function loadWorkflows() {
  const [releaseSource, packageSource] = await Promise.all([
    readFile(releaseWorkflowPath, "utf8"),
    readFile(packageWorkflowPath, "utf8"),
  ]);
  return {
    release: parse(releaseSource),
    releaseSource,
    packageWorkflow: parse(packageSource),
    packageSource,
  };
}

const stepNamed = (job, name) => job.steps.find((step) => step.name === name);

test("a release candidate pull request builds in release mode, from its own head commit", async () => {
  const { packageWorkflow, packageSource } = await loadWorkflows();
  const flag = packageWorkflow.env.COLONY_RELEASE_BUILD;
  assert.match(flag, /inputs\.release == true/);
  assert.match(flag, /github\.event_name == 'pull_request'/);
  assert.match(flag, /head\.repo\.full_name == github\.repository/);
  assert.match(flag, /startsWith\(github\.head_ref, 'release\/'\)/);
  assert.match(flag, /endsWith\(github\.head_ref, '-candidate'\)/);
  // Nothing may read the raw input any more: one flag decides every release step.
  assert.equal(packageSource.includes("inputs.release"), true);
  assert.equal(packageSource.match(/inputs\.release/g).length, 1);
  const checkout = packageWorkflow.jobs.package.steps[0];
  assert.match(checkout.with.ref, /github\.event\.pull_request\.head\.sha/);
  // Release uploads exist for candidate runs; the plain package upload does not.
  const upload = stepNamed(
    packageWorkflow.jobs.package,
    "Upload release installer artifacts",
  );
  assert.equal(
    upload.with.name,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions expression text
    "colony-electron-release-${{ matrix.platform }}-${{ matrix.arch }}",
  );
  assert.equal(upload.with["retention-days"], 7);
  assert.equal(upload.if, "env.COLONY_RELEASE_BUILD == 'true'");
});

test("the tag release reuses a candidate build only after a lookup, never when signing is configured", async () => {
  const { release } = await loadWorkflows();
  const select = release.jobs["select-build"];
  assert.deepEqual(select.needs, "release-info");
  assert.deepEqual(select.permissions, { contents: "read", actions: "read" });
  assert.ok(select["timeout-minutes"] <= 30);

  const signing = stepNamed(
    select,
    "Check whether release signing is configured",
  );
  for (const secret of [
    "APPLE_DEVELOPER_ID_CERT_P12_B64",
    "APPLE_DEVELOPER_ID_CERT_PASSWORD",
    "APPLE_NOTARY_API_KEY_P8_B64",
    "APPLE_NOTARY_KEY_ID",
    "APPLE_NOTARY_ISSUER_ID",
    "WINDOWS_SIGNING_CERT_PFX_B64",
    "WINDOWS_SIGNING_CERT_PASSWORD",
  ]) {
    assert.ok(
      signing.env[secret],
      `${secret} must be part of the signing check`,
    );
  }

  const lookup = stepNamed(
    select,
    "Look for a release candidate build with the same source tree",
  );
  assert.match(lookup.if, /steps\.signing\.outputs\.configured != 'true'/);
  assert.match(lookup.if, /inputs\.reuse_candidate/);
  assert.equal(lookup["continue-on-error"], true);
  assert.ok(lookup["timeout-minutes"] <= 5);
  assert.match(lookup.run, /git rev-parse "\$GITHUB_SHA\^\{tree\}"/);

  const download = stepNamed(select, "Download the candidate installers");
  assert.equal(download["continue-on-error"], true);
  assert.ok(download["timeout-minutes"] <= 20);
  // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions expression text
  assert.equal(download.with["run-id"], "${{ steps.lookup.outputs.run_id }}");
  // biome-ignore lint/suspicious/noTemplateCurlyInString: GitHub Actions expression text
  assert.equal(download.with.repository, "${{ github.repository }}");

  // The candidate passes the same gate the publish job applies, as unsigned.
  const verify = stepNamed(
    select,
    "Check the candidate installers against the tag version",
  );
  assert.match(verify.run, /release-metadata\.mjs/);
  assert.match(verify.run, /--version="\$RELEASE_VERSION"/);
  assert.match(verify.run, /--mac-signed=false/);
  assert.match(verify.run, /--windows-signed=false/);

  // Reuse is decided only by a finished hand-off, so any failure builds.
  const decide = stepNamed(
    select,
    "Decide whether the release reuses the candidate build",
  );
  assert.match(decide.run, /HANDOFF_OUTCOME" = "success"/);
  assert.equal(
    stepNamed(select, "Hand the checked installers to the publish job").with
      .name,
    "colony-electron-release-reused",
  );
});

test("the package job builds unless the candidate was reused, and publish accepts either source", async () => {
  const { release } = await loadWorkflows();
  const pkg = release.jobs.package;
  assert.ok(pkg.needs.includes("select-build"));
  assert.match(pkg.if, /needs\.select-build\.outputs\.reuse != 'true'/);
  assert.match(pkg.if, /!cancelled\(\)/);
  assert.equal(pkg.with.release, true);

  const publish = release.jobs.publish;
  assert.ok(publish.needs.includes("select-build"));
  assert.match(publish.if, /needs\.package\.result == 'success'/);
  assert.match(
    publish.if,
    /needs\.package\.result == 'skipped' && needs\.select-build\.outputs\.reuse == 'true'/,
  );
  // Fallback artifacts never mix with the reused ones.
  const built = stepNamed(publish, "Download installers and updater feeds");
  assert.equal(built.if, "needs.select-build.outputs.reuse != 'true'");
  assert.equal(built.with.pattern, "colony-electron-release-*-*");
  const reused = stepNamed(
    publish,
    "Download the reused candidate installers and updater feeds",
  );
  assert.equal(reused.if, "needs.select-build.outputs.reuse == 'true'");
  assert.equal(reused.with.name, "colony-electron-release-reused");
  assert.equal(
    "colony-electron-release-reused".match(/colony-electron-release-.+-.+/),
    null,
  );

  // Same metadata and checksum step for both sources.
  assert.equal(
    stepNamed(publish, "Generate update metadata and checksums").run.includes(
      "release-metadata.mjs",
    ),
    true,
  );
});

test("only a tag release can publish, and a dry run never does", async () => {
  const { release } = await loadWorkflows();
  const { inputs } = release.on.workflow_dispatch;
  assert.equal(inputs.dry_run.default, false);
  assert.equal(inputs.reuse_candidate.default, true);
  const publishStep = stepNamed(
    release.jobs.publish,
    "Create or refresh GitHub Release",
  );
  assert.match(publishStep.if, /!inputs\.dry_run/);
  assert.match(
    publishStep.if,
    /startsWith\(github\.ref, 'refs\/tags\/desktop-v'\)/,
  );
  // A branch is accepted only for a dry run.
  const validate = stepNamed(
    release.jobs["release-info"],
    "Validate tag and app versions",
  );
  assert.match(
    validate.run,
    /\[ "\$EVENT_NAME" = "workflow_dispatch" \] && \[ "\$DRY_RUN" = "true" \]/,
  );
  assert.match(validate.run, /refs\/tags\/desktop-v\$version/);
  // The release notes say which source the installers came from.
  const notes = stepNamed(release.jobs.publish, "Create release notes");
  assert.match(
    notes.run,
    /Build source: installers reused from the release candidate build/,
  );
  assert.match(notes.run, /Build source: installers built from this tag/);
});
