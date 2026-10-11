import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { drivePackagedRow } from "./row-driver.mjs";
import { prepareGateRun } from "./gate-run.mjs";
import { judgeRow } from "./rows.mjs";

const task = {
  agentId: "a".repeat(64),
  taskId: "conversation:11111111-1111-4111-8111-111111111111",
  businessId: "synthetic-business",
  clientId: null,
  communityOrigin: "http://127.0.0.1:4403",
};
const provenance = {
  packaged: true,
  artifactSha256: "a".repeat(64),
  freshHome: true,
  isolatedProfile: true,
  keychainDenied: true,
  fakeProviderOnly: true,
  managedAcpSession: true,
  scopedMcpLaunchedByHarness: true,
  flagOn: true,
  defaultFlagUnset: true,
  realControlUi: true,
  actionLogRedacted: true,
  fixtureGranted: true,
  immutableUploadSliceInArtifact: true,
  confirmedDownloadSliceInArtifact: true,
};
const downloadEvidence = {
  ...provenance,
  downloadRejectedWithoutEffect: true,
  personConfirmed: true,
  toolSucceeded: true,
  collisionPreserved: true,
  distinctSavedFiles: true,
  savedFilesSurviveStop: true,
  redirectRefused: true,
  grantTerminated: true,
  expectedDigest: "b".repeat(64),
  firstSavedDigest: "b".repeat(64),
  secondSavedDigest: "b".repeat(64),
  afterDownloads: 2,
  afterDownloadRequests: 2,
  forbiddenRequests: 0,
  privatePayloads: 0,
  ownershipRecords: 0,
};

test("download gate rejects every missing transfer observation, bad digest and retained staging", () => {
  assert.equal(judgeRow("download", downloadEvidence).status, "PASS");
  assert.equal(judgeRow("download", provenance).status, "FAIL");
  assert.equal(
    judgeRow("download", {
      ...downloadEvidence,
      confirmedDownloadSliceInArtifact: false,
    }).status,
    "BLOCKED",
  );
  for (const key of [
    "downloadRejectedWithoutEffect",
    "personConfirmed",
    "toolSucceeded",
    "collisionPreserved",
    "distinctSavedFiles",
    "savedFilesSurviveStop",
    "redirectRefused",
    "grantTerminated",
  ])
    assert.equal(
      judgeRow("download", { ...downloadEvidence, [key]: false }).status,
      "FAIL",
      key,
    );
  for (const key of ["firstSavedDigest", "secondSavedDigest", "expectedDigest"])
    assert.equal(
      judgeRow("download", { ...downloadEvidence, [key]: "c".repeat(64) })
        .status,
      "FAIL",
      key,
    );
  for (const key of [
    "afterDownloads",
    "afterDownloadRequests",
    "forbiddenRequests",
    "privatePayloads",
    "ownershipRecords",
  ])
    assert.equal(
      judgeRow("download", { ...downloadEvidence, [key]: undefined }).status,
      "FAIL",
      key,
    );
  for (const key of [
    "forbiddenRequests",
    "privatePayloads",
    "ownershipRecords",
  ])
    assert.equal(
      judgeRow("download", { ...downloadEvidence, [key]: 1 }).status,
      "FAIL",
      key,
    );
});

// These doubles verify the shipped coordinator driver and filesystem checks.
// They are harness preparation tests, never packaged managed-runtime evidence.
async function harness(
  t,
  id,
  {
    corrupt = false,
    retain = false,
    earlyRequest = false,
    lateEffect = false,
  } = {},
) {
  const run = await prepareGateRun({
    realHome: "/Users/synthetic-owner",
    relayOrigin: "ws://127.0.0.1:4403",
    task,
    modelPlan: [{}],
  });
  t.after(run.close);
  const staging = path.join(
    run.environment.COLONY_ELECTRON_USER_DATA,
    "browser-agent-uploads",
  );
  for (const dir of ["payloads", "records"])
    await mkdir(path.join(staging, dir), { recursive: true });
  const cookie = (await fetch(run.fixtureOrigin)).headers
    .get("set-cookie")
    .split(";")[0];
  const commands = [];
  let current;
  let approved;
  let selectedPath;
  let pickedBytes;
  let saves = 0;
  const phases = [];
  const managed = {
    task,
    agentId: task.agentId,
    providerModel: "colony-browser-fake",
    providerOrigin: run.providerOrigin,
    async sendTask(message) {
      commands.push(message);
      current = message;
      approved = undefined;
    },
    async observe({ phase, timeoutMs }) {
      assert.equal(timeoutMs, 30000);
      phases.push(phase);
      if (phase === "chosen") {
        pickedBytes = await readFile(selectedPath);
        await writeFile(path.join(staging, "records", "synthetic.json"), "{}");
        await copyFile(
          selectedPath,
          path.join(staging, "payloads", "synthetic.txt"),
        );
        return { uploadId: "u-11111111-1111-4111-8111-111111111111" };
      }
      if (phase === "rejected") {
        assert.equal(approved, false);
        if (earlyRequest) await fetch(`${run.fixtureOrigin}/report.txt`);
        return { toolRefused: true, uploadRejectedWithoutEffect: true };
      }
      if (phase === "attached") {
        assert.equal(approved, true);
        return { toolSucceeded: true };
      }
      if (phase === "submitted") {
        assert.equal(approved, true);
        assert.match(current, /Send file/u);
        await fetch(`${run.fixtureOrigin}/upload`, {
          method: "POST",
          body: corrupt ? "wrong" : pickedBytes,
        });
        return { toolSucceeded: true };
      }
      if (phase.startsWith("saved-")) {
        assert.equal(approved, true);
        assert.match(current, /browser_download/u);
        const response = await fetch(`${run.fixtureOrigin}/report.txt`, {
          headers: { cookie },
        });
        assert.equal(response.status, 200);
        const body = Buffer.from(await response.arrayBuffer());
        await writeFile(path.join(staging, "records", "synthetic.json"), "{}");
        await writeFile(
          path.join(run.home, "Downloads", `report (${++saves}).txt`),
          corrupt ? "wrong" : body,
          { flag: "wx" },
        );
        return { toolSucceeded: true };
      }
      if (phase === "redirect-refused") {
        assert.equal(approved, true);
        const response = await fetch(`${run.fixtureOrigin}/redirect-private`, {
          redirect: "manual",
        });
        assert.equal(response.status, 302);
        return { toolRefused: true, redirectRefused: true };
      }
      assert.equal(phase, "stopped");
      if (lateEffect) {
        if (id === "upload")
          await fetch(`${run.fixtureOrigin}/upload`, {
            method: "POST",
            body: pickedBytes,
          });
        else
          await writeFile(
            path.join(run.home, "Downloads", "unexpected.txt"),
            "synthetic late effect",
          );
      }
      if (!retain) {
        for (const dir of ["payloads", "records"]) {
          await rm(path.join(staging, dir), { recursive: true });
          await mkdir(path.join(staging, dir));
        }
      }
      return { grantTerminated: true };
    },
  };
  const locator = (name = "") => ({
    getByRole: (_role, options = {}) => locator(options.name),
    getByText: (text) => locator(text),
    getByLabel: () => locator(),
    getByTestId: () => locator(),
    async click() {
      if (name === "Confirm action") approved = true;
      if (name === "Reject") approved = false;
    },
    async waitFor() {},
    async selectOption() {},
  });
  const page = locator();
  const nativePicker = {
    async selectFile({ path: file, timeoutMs }) {
      assert.equal(timeoutMs, 30000);
      selectedPath = file;
      return { selected: true };
    },
  };
  return { run, managed, page, nativePicker, commands, phases, id, provenance };
}

for (const id of ["upload", "download"]) {
  test(`${id} packaged driver collects ordered visible phases and independent fixture/disk evidence`, async (t) => {
    const h = await harness(t, id);
    assert.equal((await drivePackagedRow(h)).status, "PASS");
    assert.deepEqual(
      h.phases,
      id === "upload"
        ? ["chosen", "rejected", "attached", "submitted", "stopped"]
        : ["rejected", "saved-1", "saved-2", "redirect-refused", "stopped"],
    );
    assert.equal(h.commands.length, id === "upload" ? 3 : 4);
  });
  for (const fault of ["corrupt", "retain", "lateEffect"]) {
    test(`${id} packaged driver fails ${fault} evidence despite successful tool observations`, async (t) => {
      const h = await harness(t, id, { [fault]: true });
      assert.equal((await drivePackagedRow(h)).status, "FAIL");
    });
  }
}

test("driver derives default-on proof from actual launch env and blocks missing picker before controls", async () => {
  for (const id of ["upload", "download"]) {
    const blocked = await drivePackagedRow({
      id,
      page: null,
      managed: null,
      run: { environment: { COLONY_BROWSER_AGENT: "1" } },
      provenance,
    });
    assert.equal(blocked.status, "BLOCKED");
  }
  const blocked = await drivePackagedRow({
    id: "upload",
    page: null,
    managed: null,
    run: { environment: {} },
    provenance,
  });
  assert.match(blocked.reason, /native picker/u);
});

test("download fixture refuses missing cookie and records only actual session-bearing transfers", async (t) => {
  const h = await harness(t, "download");
  const denied = await fetch(`${h.run.fixtureOrigin}/report.txt`);
  assert.equal(denied.status, 401);
  assert.equal(h.run.fixtures.counters().downloads, 0);
  assert.equal(h.run.fixtures.counters().downloadRequests, 1);
});

test("download driver rejects unauthorized requests before confirmation even without saved bytes", async (t) => {
  const h = await harness(t, "download", { earlyRequest: true });
  await assert.rejects(drivePackagedRow(h), /1 !== 0/u);
});
