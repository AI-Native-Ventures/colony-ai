import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createPackageWithOptions } from "@electron/asar";

import {
  canonicalizeAsarEntries,
  canonicalizeAsarEntry,
  assertContainedRegularFile,
  findLinuxApp,
  inspectAsarEntries,
  isApprovedAsarFileEntry,
  readElfMachine,
  scanText,
} from "./check-electron-stage0.mjs";

test("canonicalizes the observed ASAR leading separator and Windows separators", () => {
  assert.equal(
    canonicalizeAsarEntry("/src\\electron\\main.mjs"),
    "src/electron/main.mjs",
  );
  assert.equal(canonicalizeAsarEntry("\\package.json"), "package.json");
  assert.equal(canonicalizeAsarEntry("package.json"), "package.json");
});

test("rejects canonical collisions instead of silently overwriting an entry", () => {
  assert.throws(
    () => canonicalizeAsarEntries(["/package.json", "\\package.json"]),
    /canonical collision/,
  );
});

test("accepts the observed real package entry layout exactly once", () => {
  const entries = canonicalizeAsarEntries([
    "/package.json",
    "/src-electron/main.mjs",
    "/resources/colony-native-host.exe",
  ]);
  assert.deepEqual(
    [...entries.keys()],
    [
      "package.json",
      "src-electron/main.mjs",
      "resources/colony-native-host.exe",
    ],
  );
});

test("allows only the observed React renderer Tauri adapter chunk", () => {
  assert.equal(
    isApprovedAsarFileEntry(
      "src-electron/renderer/assets/tauri-BU66xV9L.js",
      "react",
    ),
    true,
  );
  assert.equal(
    isApprovedAsarFileEntry(
      "src-electron/renderer/assets/tauri-BU66xV9L.js",
      "feasibility",
    ),
    false,
  );
  assert.equal(
    isApprovedAsarFileEntry("src-electron/renderer/tauri-runtime.js", "react"),
    false,
  );
  assert.equal(
    isApprovedAsarFileEntry("src-electron/tauri-runtime.js", "react"),
    false,
  );
});

test("allows the product deep-link token only in the React renderer scan", () => {
  assert.doesNotThrow(() =>
    scanText(
      "React ASAR:src-electron/renderer/assets/autoPinMentionedAgentsPreference.js",
      "const link = 'buzz://message'; const bridge = '__TAURI_INTERNALS__';",
      [],
      ["buzz://", "__TAURI_INTERNALS__"],
    ),
  );
  assert.throws(
    () => scanText("source", "const link = 'buzz://message';"),
    /source contains forbidden token buzz:\/\//,
  );
  assert.throws(
    () =>
      scanText(
        "React ASAR:src-electron/renderer/assets/adapter.js",
        "import '@tauri-apps/api/core'; const bridge = '__TAURI_INTERNALS__';",
        [],
        ["buzz://", "__TAURI_INTERNALS__"],
      ),
    /React ASAR:src-electron\/renderer\/assets\/adapter\.js contains forbidden token @tauri-apps\//,
  );
});

for (const unsafe of [
  "/",
  "/src/",
  "/src\\/main.mjs",
  "/../outside",
  "/src/./main.mjs",
  "/src/../main.mjs",
  "//server/share",
  "\\\\server\\share",
  "/C:/Windows/System32",
  "C:\\Windows\\System32",
  "/src//main.mjs",
  "/src\0main.mjs",
]) {
  test(`rejects unsafe ASAR entry ${JSON.stringify(unsafe)}`, () => {
    assert.throws(() => canonicalizeAsarEntry(unsafe), /unsafe ASAR entry/);
  });
}

test("does not traverse symlinked app directories or executables", () => {
  const directory = mkdtempSync(`${os.tmpdir()}/stage0-links-`);
  const outside = mkdtempSync(`${os.tmpdir()}/stage0-outside-`);
  try {
    const outsideApp = path.join(outside, "Buzz Stage0 Normal.app");
    mkdirSync(outsideApp, { recursive: true });
    writeFileSync(path.join(outsideApp, "Buzz Stage0 Normal"), "outside");
    symlinkSync(outsideApp, path.join(directory, "escaped-app"), "dir");
    assert.throws(
      () => findLinuxApp(directory, "Buzz Stage0 Normal"),
      /package entry escaped-app escapes package root/,
    );
    rmSync(path.join(directory, "escaped-app"), { force: true });

    const app = path.join(directory, "real-app");
    mkdirSync(app, { recursive: true });
    symlinkSync(
      path.join(outsideApp, "Buzz Stage0 Normal"),
      path.join(app, "Buzz Stage0 Normal"),
    );
    assert.throws(
      () => findLinuxApp(directory, "Buzz Stage0 Normal"),
      /package entry Buzz Stage0 Normal escapes package root/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("confines required resources before reading escaping links", () => {
  const directory = mkdtempSync(`${os.tmpdir()}/stage0-resource-links-`);
  const outside = mkdtempSync(`${os.tmpdir()}/stage0-resource-outside-`);
  try {
    const outsideFile = path.join(outside, "helper");
    const insideFile = path.join(directory, "helper-real");
    const escapingLink = path.join(directory, "helper-escaping");
    const containedLink = path.join(directory, "helper-contained");
    writeFileSync(outsideFile, "outside");
    writeFileSync(insideFile, "inside");
    symlinkSync(outsideFile, escapingLink);
    symlinkSync(insideFile, containedLink);

    assert.throws(
      () => assertContainedRegularFile(directory, escapingLink, "helper"),
      /helper escapes package root/,
    );
    assert.equal(
      assertContainedRegularFile(directory, containedLink, "helper").path,
      realpathSync(insideFile),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("rejects ASAR link metadata before a required link can resolve", async () => {
  const directory = mkdtempSync(`${os.tmpdir()}/stage0-asar-links-`);
  try {
    const source = path.join(directory, "source");
    const sourceDirectory = path.join(source, "src-electron");
    const archive = path.join(directory, "linked.asar");
    mkdirSync(sourceDirectory, { recursive: true });
    writeFileSync(path.join(sourceDirectory, "real-main.mjs"), "export {};\n");
    symlinkSync("real-main.mjs", path.join(sourceDirectory, "main.mjs"));
    await createPackageWithOptions(source, archive, {});

    assert.throws(
      () => inspectAsarEntries(archive),
      /ASAR link metadata is not permitted: src-electron\/main\.mjs/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("retains every regular ASAR file for the normal scan", async () => {
  const directory = mkdtempSync(`${os.tmpdir()}/stage0-asar-files-`);
  try {
    const source = path.join(directory, "source");
    const sourceDirectory = path.join(source, "src-electron");
    const archive = path.join(directory, "regular.asar");
    mkdirSync(sourceDirectory, { recursive: true });
    writeFileSync(path.join(source, "package.json"), "{}\n");
    writeFileSync(path.join(sourceDirectory, "main.mjs"), "export {};\n");
    await createPackageWithOptions(source, archive, {});

    const entries = inspectAsarEntries(archive);
    assert.deepEqual([...entries.fileEntries].sort(), [
      "package.json",
      "src-electron/main.mjs",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("recognizes a little-endian x86_64 ELF fixture and rejects non-ELF input", () => {
  const directory = mkdtempSync(`${os.tmpdir()}/stage0-elf-`);
  try {
    const elf = Buffer.alloc(20);
    elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
    elf.writeUInt16LE(0x3e, 18);
    const elfPath = `${directory}/helper`;
    const invalidPath = `${directory}/invalid`;
    writeFileSync(elfPath, elf);
    writeFileSync(invalidPath, Buffer.from("not an elf"));
    assert.equal(readElfMachine(elfPath), 0x3e);
    assert.equal(readElfMachine(invalidPath), null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
