import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import test from "node:test";

import {
  canonicalizeAsarEntries,
  canonicalizeAsarEntry,
  readElfMachine,
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
