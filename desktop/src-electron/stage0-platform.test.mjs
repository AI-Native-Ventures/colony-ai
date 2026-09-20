import assert from "node:assert/strict";
import test from "node:test";

import {
  getStage0Target,
  getStage0TargetFromArguments,
} from "./stage0-platform.mjs";

test("Stage 0 target map keeps macOS and Windows helper resources explicit", () => {
  assert.deepEqual(getStage0Target({ platform: "darwin", arch: "arm64" }), {
    platform: "darwin",
    arch: "arm64",
    targetTriple: "aarch64-apple-darwin",
    helperName: "colony-native-host",
    packageSuffix: "darwin-arm64",
    bundleKind: "app",
    executableName: null,
  });
  assert.deepEqual(getStage0Target({ platform: "win32", arch: "x64" }), {
    platform: "win32",
    arch: "x64",
    targetTriple: "x86_64-pc-windows-msvc",
    helperName: "colony-native-host.exe",
    packageSuffix: "win32-x64",
    bundleKind: "directory",
    executableName: "Buzz",
  });
});

test("Stage 0 target arguments reject unsupported or mismatched host choices", () => {
  assert.throws(
    () => getStage0Target({ platform: "linux", arch: "x64" }),
    /unsupported Stage 0 target/,
  );
  assert.throws(
    () =>
      getStage0Target({
        platform: "win32",
        arch: "x64",
        targetTriple: "aarch64-apple-darwin",
      }),
    /does not match/,
  );
  assert.equal(
    getStage0TargetFromArguments([
      "node",
      "stage",
      "--platform=win32",
      "--arch=x64",
      "--target=x86_64-pc-windows-msvc",
    ]).helperName,
    "colony-native-host.exe",
  );
});
