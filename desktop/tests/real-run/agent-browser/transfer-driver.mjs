import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, opendir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { judgeRow } from "./rows.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Only the prepared throwaway tree is inspected. Bound every directory and file read.
async function entries(directory, home) {
  assert.ok((await realpath(directory)).startsWith(`${home}${path.sep}`));
  const names = [];
  for await (const entry of await opendir(directory)) {
    assert.ok(names.length < 64, "Synthetic directory exceeded the gate bound");
    names.push(entry.name);
  }
  return names.sort();
}

async function fileDigest(file, home) {
  assert.ok((await realpath(file)).startsWith(`${home}${path.sep}`));
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    assert.ok(stat.isFile() && stat.size <= 1024, "Unexpected synthetic file");
    const buffer = Buffer.alloc(1025);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    assert.equal(
      bytesRead,
      stat.size,
      "Synthetic file changed during inspection",
    );
    return digest(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

async function cleanupEvidence(run) {
  const staging = path.join(
    run.environment.COLONY_ELECTRON_USER_DATA,
    "browser-agent-uploads",
  );
  return {
    privatePayloads: (await entries(path.join(staging, "payloads"), run.home))
      .length,
    ownershipRecords: (await entries(path.join(staging, "records"), run.home))
      .length,
  };
}

/** Visible transfer orchestration; observations come from the real managed adapter. */
export async function driveTransferRow({
  id,
  controls,
  run,
  managed,
  provenance,
  nativePicker,
}) {
  assert.equal(await realpath(run.home), run.home);
  assert.equal(run.environment.HOME, run.home);
  assert.ok(
    run.environment.COLONY_ELECTRON_USER_DATA.startsWith(
      `${run.home}${path.sep}`,
    ),
  );
  const observe = (phase) =>
    managed.observe({ row: id, phase, timeoutMs: 30_000 });
  const confirm = async (accept) => {
    const dialog = controls.getByRole("alertdialog");
    await dialog.waitFor({ timeout: 30_000 });
    await dialog
      .getByRole("button", {
        name: accept ? "Confirm action" : "Reject",
        exact: true,
      })
      .click({ timeout: 15_000 });
  };
  const finish = async () => {
    await controls
      .getByRole("button", { name: "Stop", exact: true })
      .click({ timeout: 15_000 });
    const stopped = await observe("stopped");
    assert.equal(stopped.grantTerminated, true);
    return { ...stopped, ...(await cleanupEvidence(run)) };
  };
  const start = run.fixtures.counters();
  assert.equal(start.uploads, 0);
  assert.equal(start.downloads, 0);
  assert.equal(start.downloadRequests, 0);
  assert.equal(start.forbiddenRequests, 0);

  if (id === "upload") {
    const source = path.join(run.home, "approved-upload.txt");
    const approved = Buffer.from("synthetic immutable approved upload");
    await writeFile(source, approved, { flag: "wx", mode: 0o600 });
    await controls
      .getByText("Approved sites and files", { exact: true })
      .click({ timeout: 15_000 });
    // selectFile must operate the real OS dialog, never replace showOpenDialog.
    const [picked] = await Promise.all([
      nativePicker.selectFile({ path: source, timeoutMs: 30_000 }),
      controls
        .getByRole("button", {
          name: "Choose a file for this task",
          exact: true,
        })
        .click({ timeout: 15_000 }),
    ]);
    assert.equal(picked.selected, true);
    await controls
      .getByText(
        "File ready for this task. Uploading still needs your confirmation.",
        { exact: true },
      )
      .waitFor({ timeout: 15_000 });
    // Read the actual UI-initiated IPC reply, without invoking a broker directly.
    const chosen = await observe("chosen");
    assert.match(chosen.uploadId, /^u-[a-f0-9-]{36}$/u);
    const request = `Fixture upload row: snapshot the approved tab and use browser_upload on Attach file with uploadId ${chosen.uploadId}. Do not send the form.`;
    await managed.sendTask(request);
    await confirm(false);
    const rejected = await observe("rejected");
    assert.equal(rejected.toolRefused, true);
    assert.equal(rejected.uploadRejectedWithoutEffect, true);
    assert.equal(run.fixtures.counters().uploads, 0);
    await managed.sendTask(request);
    await confirm(true);
    const attached = await observe("attached");
    assert.equal(attached.toolSucceeded, true);
    assert.equal(run.fixtures.counters().uploads, 0);
    await writeFile(source, "synthetic replacement must never be uploaded");
    assert.notEqual(await fileDigest(source, run.home), digest(approved));
    await managed.sendTask(
      "Fixture upload row: take a fresh snapshot and click Send file. Wait for person confirmation.",
    );
    await confirm(true);
    const submitted = await observe("submitted");
    assert.equal(submitted.toolSucceeded, true);
    const stopped = await finish();
    const after = run.fixtures.counters();
    return judgeRow(id, {
      ...provenance,
      ...submitted,
      ...stopped,
      nativePickerUsed: picked.selected === true,
      uploadRejectedWithoutEffect: rejected.uploadRejectedWithoutEffect,
      personConfirmed: true,
      originalReplacedBeforeSubmit: true,
      approvedDigest: digest(approved),
      receivedDigest: after.receivedDigest,
      afterUploads: after.uploads,
      unexpectedExternalRequests: [
        provenance,
        chosen,
        rejected,
        attached,
        submitted,
        stopped,
      ].some((e) => e.unexpectedExternalRequests),
      credentialExposure: [
        provenance,
        chosen,
        rejected,
        attached,
        submitted,
        stopped,
      ].some((e) => e.credentialExposure),
    });
  }

  const downloads = path.join(run.home, "Downloads");
  await mkdir(downloads, { mode: 0o700, recursive: true });
  assert.deepEqual(await entries(downloads, run.home), []);
  const collision = path.join(downloads, "report.txt");
  const sentinel = "synthetic existing file must survive";
  await writeFile(collision, sentinel, { flag: "wx", mode: 0o600 });
  const baseline = await entries(downloads, run.home);
  const request =
    "Fixture download row: snapshot the approved tab and use browser_download on Download report. Wait for person confirmation.";
  await managed.sendTask(request);
  await confirm(false);
  const rejected = await observe("rejected");
  assert.equal(rejected.toolRefused, true);
  assert.equal(run.fixtures.counters().downloads, 0);
  assert.equal(run.fixtures.counters().downloadRequests, 0);
  assert.deepEqual(await entries(downloads, run.home), baseline);
  const saved = [];
  for (let index = 0; index < 2; index += 1) {
    await managed.sendTask(request);
    await confirm(true);
    const result = await observe(`saved-${index + 1}`);
    assert.equal(result.toolSucceeded, true);
    saved.push(result);
  }
  const names = (await entries(downloads, run.home)).filter(
    (name) => !baseline.includes(name),
  );
  assert.equal(names.length, 2);
  const beforeStopDigests = await Promise.all(
    names.map((name) => fileDigest(path.join(downloads, name), run.home)),
  );
  await managed.sendTask(
    "Fixture download row: take a fresh snapshot and use browser_download on Download private redirect. Wait for person confirmation.",
  );
  await confirm(true);
  const redirected = await observe("redirect-refused");
  assert.equal(redirected.toolRefused, true);
  assert.equal(redirected.redirectRefused, true);
  const stopped = await finish();
  const afterStopDigests = await Promise.all(
    names.map((name) => fileDigest(path.join(downloads, name), run.home)),
  );
  const afterStopNames = await entries(downloads, run.home);
  return judgeRow(id, {
    ...provenance,
    ...stopped,
    downloadRejectedWithoutEffect: true,
    personConfirmed: true,
    toolSucceeded: saved.every((result) => result.toolSucceeded),
    collisionPreserved:
      (await fileDigest(collision, run.home)) === digest(sentinel),
    distinctSavedFiles: names.length === 2 && names[0] !== names[1],
    savedFilesSurviveStop:
      afterStopNames.length === baseline.length + names.length &&
      [...baseline, ...names].every((name) => afterStopNames.includes(name)) &&
      beforeStopDigests.every(
        (value, index) => value === afterStopDigests[index],
      ),
    expectedDigest: run.fixtures.expectedDownloadDigest,
    firstSavedDigest: afterStopDigests[0],
    secondSavedDigest: afterStopDigests[1],
    redirectRefused: redirected.redirectRefused,
    afterDownloads: run.fixtures.counters().downloads,
    afterDownloadRequests: run.fixtures.counters().downloadRequests,
    forbiddenRequests: run.fixtures.counters().forbiddenRequests,
    unexpectedExternalRequests: [
      provenance,
      rejected,
      ...saved,
      redirected,
      stopped,
    ].some((e) => e.unexpectedExternalRequests),
    credentialExposure: [
      provenance,
      rejected,
      ...saved,
      redirected,
      stopped,
    ].some((e) => e.credentialExposure),
  });
}
