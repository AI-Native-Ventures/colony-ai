import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import {
  assertFeedOmitsDiskImage,
  findSignedDiskImage,
  NOTARY_WAIT,
  notarizeCommand,
  parseNotaryResult,
  readSigningEnvironment,
  STAPLE_ATTEMPTS,
  signCommand,
  signMacDiskImage,
} from "./sign-mac-disk-image.mjs";

// The Mac disk image is the file people download from the website. The app
// inside it was already signed and notarized, but the disk image itself was
// not. These tests pin the step that signs, notarizes and staples it, and the
// workflow wiring that runs that step on every signed Mac release.

const packageWorkflowPath = fileURLToPath(
  new URL("../../.github/workflows/electron-package.yml", import.meta.url),
);
const packageJsonPath = fileURLToPath(
  new URL("../package.json", import.meta.url),
);

const DISK_IMAGE = "Colony-1.2.3-arm64-SIGNED.dmg";
const ENVIRONMENT = {
  COLONY_APPLE_DEVELOPER_IDENTITY: "Developer ID Application: Example (TEAM)",
  COLONY_APPLE_NOTARY_KEY_PATH: "/tmp/key.p8",
  COLONY_APPLE_NOTARY_KEY_ID: "KEYID",
  COLONY_APPLE_NOTARY_ISSUER_ID: "ISSUER",
  COLONY_TEMP_KEYCHAIN_PATH: "/tmp/colony.keychain-db",
};

async function releaseDir(t, files = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "colony-dmg-sign-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const contents = {
    [DISK_IMAGE]: "disk image",
    "Colony-1.2.3-arm64-SIGNED.zip": "zip",
    "latest-mac.yml":
      "version: 1.2.3\nfiles:\n  - url: Colony-1.2.3-arm64-SIGNED.zip\n",
    ...files,
  };
  for (const [name, text] of Object.entries(contents)) {
    if (text !== null) await writeFile(path.join(directory, name), text);
  }
  return directory;
}

/** A fake command runner that records calls and answers by script. */
function recorder(answers = {}) {
  const calls = [];
  const run = async (command, args) => {
    const line = [command, ...args].join(" ");
    calls.push(line);
    for (const [needle, answer] of Object.entries(answers)) {
      if (line.includes(needle)) return answer(line);
    }
    return { stdout: "", stderr: "" };
  };
  return { calls, run };
}

const accepted = () => ({
  stdout: JSON.stringify({ id: "abc-123", status: "Accepted" }),
  stderr: "",
});

test("the disk image is signed, notarized, stapled, then verified, in that order", async (t) => {
  const directory = await releaseDir(t);
  const { calls, run } = recorder({ "notarytool submit": accepted });

  const result = await signMacDiskImage({
    releaseDir: directory,
    env: ENVIRONMENT,
    run,
    wait: async () => {},
    log: () => {},
  });

  const diskImagePath = path.join(directory, DISK_IMAGE);
  assert.equal(result, diskImagePath);
  assert.deepEqual(
    calls.map((line) => line.split(" ").slice(0, 3).join(" ")),
    [
      "codesign --force --timestamp",
      "xcrun notarytool submit",
      "xcrun stapler staple",
      "codesign --verify --strict",
      "xcrun stapler validate",
      "spctl --assess --type",
    ],
  );
  assert.ok(calls.every((line) => line.includes(diskImagePath)));
});

test("signing uses the Developer ID identity from the temporary keychain", () => {
  const [command, args] = signCommand({
    diskImagePath: "/release/app.dmg",
    identity: "Developer ID Application: Example (TEAM)",
    keychainPath: "/tmp/colony.keychain-db",
  });
  assert.equal(command, "codesign");
  assert.deepEqual(args, [
    "--force",
    "--timestamp",
    "--sign",
    "Developer ID Application: Example (TEAM)",
    "--keychain",
    "/tmp/colony.keychain-db",
    "/release/app.dmg",
  ]);
});

test("the wait for Apple is bounded so a slow queue fails the step", () => {
  const [, args] = notarizeCommand({
    diskImagePath: "/release/app.dmg",
    notaryKeyPath: "/tmp/key.p8",
    notaryKeyId: "KEYID",
    notaryIssuerId: "ISSUER",
  });
  assert.equal(args[args.indexOf("--timeout") + 1], NOTARY_WAIT);
  assert.ok(args.includes("--wait"));
  assert.equal(args[args.indexOf("--output-format") + 1], "json");
});

test("a submission Apple refuses stops the release before stapling", async (t) => {
  const directory = await releaseDir(t);
  const logged = [];
  const { calls, run } = recorder({
    "notarytool submit": () => ({
      stdout: JSON.stringify({ id: "abc-123", status: "Invalid" }),
      stderr: "",
    }),
    "notarytool log": () => ({ stdout: "the reasons", stderr: "" }),
  });

  await assert.rejects(
    signMacDiskImage({
      releaseDir: directory,
      env: ENVIRONMENT,
      run,
      wait: async () => {},
      log: (line) => logged.push(line),
    }),
    /did not notarize the Mac disk image \(status: Invalid\)/,
  );
  assert.ok(logged.includes("the reasons"));
  assert.ok(!calls.some((line) => line.includes("stapler")));
});

test("a refusal printed by a failing notarytool is still read", async (t) => {
  const directory = await releaseDir(t);
  const { run } = recorder({
    "notarytool submit": () => {
      const error = new Error("exit 1");
      error.stdout = JSON.stringify({ id: "abc-123", status: "Rejected" });
      throw error;
    },
  });

  await assert.rejects(
    signMacDiskImage({
      releaseDir: directory,
      env: ENVIRONMENT,
      run,
      wait: async () => {},
      log: () => {},
    }),
    /status: Rejected/,
  );
});

test("stapling retries a bounded number of times, then fails", async (t) => {
  const directory = await releaseDir(t);
  let stapleCalls = 0;
  const waits = [];
  const { run } = recorder({
    "notarytool submit": accepted,
    "stapler staple": () => {
      stapleCalls += 1;
      throw new Error("ticket not found");
    },
  });

  await assert.rejects(
    signMacDiskImage({
      releaseDir: directory,
      env: ENVIRONMENT,
      run,
      wait: async (ms) => waits.push(ms),
      log: () => {},
    }),
    /Could not staple Apple's ticket .* after 5 attempts: ticket not found/,
  );
  assert.equal(stapleCalls, STAPLE_ATTEMPTS);
  assert.equal(waits.length, STAPLE_ATTEMPTS - 1);
});

test("stapling succeeds once Apple serves the ticket", async (t) => {
  const directory = await releaseDir(t);
  let stapleCalls = 0;
  const { calls, run } = recorder({
    "notarytool submit": accepted,
    "stapler staple": () => {
      stapleCalls += 1;
      if (stapleCalls < 3) throw new Error("ticket not found");
      return { stdout: "", stderr: "" };
    },
  });

  await signMacDiskImage({
    releaseDir: directory,
    env: ENVIRONMENT,
    run,
    wait: async () => {},
    log: () => {},
  });
  assert.equal(stapleCalls, 3);
  assert.ok(calls.at(-1).startsWith("spctl --assess"));
});

test("a failed check on the finished disk image fails the release", async (t) => {
  const directory = await releaseDir(t);
  const { run } = recorder({
    "notarytool submit": accepted,
    "spctl --assess": () => {
      throw new Error("rejected");
    },
  });

  await assert.rejects(
    signMacDiskImage({
      releaseDir: directory,
      env: ENVIRONMENT,
      run,
      wait: async () => {},
      log: () => {},
    }),
    /rejected/,
  );
});

test("a disk image listed in the update feed is refused before it is changed", async (t) => {
  const directory = await releaseDir(t, {
    "latest-mac.yml": `version: 1.2.3\nfiles:\n  - url: ${DISK_IMAGE}\n`,
  });
  const { calls, run } = recorder({ "notarytool submit": accepted });

  await assert.rejects(
    signMacDiskImage({
      releaseDir: directory,
      env: ENVIRONMENT,
      run,
      wait: async () => {},
      log: () => {},
    }),
    /latest-mac\.yml lists Colony-1\.2\.3-arm64-SIGNED\.dmg/,
  );
  assert.deepEqual(calls, []);
  assert.doesNotThrow(() =>
    assertFeedOmitsDiskImage("files:\n  - url: other.zip\n", DISK_IMAGE),
  );
});

test("a stale disk image blockmap is refused before the image is changed", async (t) => {
  const directory = await releaseDir(t, {
    [`${DISK_IMAGE}.blockmap`]: "blockmap",
  });
  const { calls, run } = recorder({ "notarytool submit": accepted });

  await assert.rejects(
    signMacDiskImage({
      releaseDir: directory,
      env: ENVIRONMENT,
      run,
      wait: async () => {},
      log: () => {},
    }),
    /blockmap describes the disk image before it is stapled/,
  );
  assert.deepEqual(calls, []);
});

test("missing signing settings are named", () => {
  assert.throws(
    () => readSigningEnvironment({ COLONY_APPLE_NOTARY_KEY_ID: "KEYID" }),
    /needs COLONY_APPLE_DEVELOPER_IDENTITY, COLONY_APPLE_NOTARY_KEY_PATH, COLONY_APPLE_NOTARY_ISSUER_ID/,
  );
  assert.equal(
    readSigningEnvironment({
      ...ENVIRONMENT,
      COLONY_TEMP_KEYCHAIN_PATH: "",
    }).keychainPath,
    undefined,
  );
});

test("exactly one signed disk image is expected", () => {
  assert.equal(findSignedDiskImage([DISK_IMAGE, "latest-mac.yml"]), DISK_IMAGE);
  assert.throws(
    () => findSignedDiskImage(["Colony-1.2.3-arm64-UNSIGNED.dmg"]),
    /found 0/,
  );
  assert.throws(
    () => findSignedDiskImage([DISK_IMAGE, "Colony-1.2.4-arm64-SIGNED.dmg"]),
    /found 2/,
  );
});

test("an unreadable answer from Apple is an error, never a pass", () => {
  assert.throws(() => parseNotaryResult("not json"), /unreadable answer/);
  assert.throws(() => parseNotaryResult("{}"), /no status/);
  assert.deepEqual(parseNotaryResult('{"id":"x","status":"Accepted"}'), {
    id: "x",
    status: "Accepted",
  });
});

test("every signed Mac release runs the disk image step while credentials exist", async () => {
  const workflow = parse(await readFile(packageWorkflowPath, "utf8"));
  const steps = workflow.jobs.package.steps;
  const indexOf = (name) => {
    const index = steps.findIndex((step) => step.name === name);
    assert.notEqual(index, -1, `package job has a step named "${name}"`);
    return index;
  };
  const sign = indexOf("Sign, notarize and staple the Mac disk image");
  const step = steps[sign];

  assert.equal(
    step.if,
    "env.COLONY_RELEASE_BUILD == 'true' && matrix.platform == 'darwin' && needs.resolve-signing.outputs.mac_signed == 'true'",
  );
  assert.match(step.run, /pnpm --dir desktop run electron:sign-disk-image/);
  assert.ok(
    sign > indexOf("Build release installer and updater metadata"),
    "the disk image exists before it is signed",
  );
  assert.ok(
    sign < indexOf("Remove temporary signing credentials"),
    "the signing keychain and notary key still exist",
  );
  assert.ok(
    sign < indexOf("Upload release installer artifacts"),
    "only the stapled disk image is uploaded",
  );

  const scripts = JSON.parse(await readFile(packageJsonPath, "utf8")).scripts;
  assert.equal(
    scripts["electron:sign-disk-image"],
    "node ./scripts/sign-mac-disk-image.mjs",
  );
});
