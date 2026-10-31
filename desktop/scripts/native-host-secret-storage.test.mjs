import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

// Unsigned (ad-hoc) Mac apps lose access to their own Keychain items on every
// release, which signed the owner out after every update. The native host of an
// unsigned Mac build must be built without the system keyring (secrets in
// owner-only files); a signed build keeps the Keychain. These tests pin that
// choice and the marker check that proves it on the built binary.

const packageWorkflowPath = fileURLToPath(
  new URL("../../.github/workflows/electron-package.yml", import.meta.url),
);
const cargoTomlPath = fileURLToPath(
  new URL("../src-tauri/Cargo.toml", import.meta.url),
);
const markerSourcePath = fileURLToPath(
  new URL("../src-tauri/src/app_state_keyring.rs", import.meta.url),
);

/** A GitHub Actions expression, assembled so lint sees no template placeholder. */
const expression = (inner) => `$\{{ ${inner} }}`;

const KEYCHAIN = "colony-secret-storage=keychain";
const FILE = "colony-secret-storage=file";

async function packageSteps() {
  const workflow = parse(await readFile(packageWorkflowPath, "utf8"));
  const steps = workflow.jobs.package.steps;
  const named = (name) => {
    const step = steps.find((candidate) => candidate.name === name);
    assert.ok(step, `package job has a step named "${name}"`);
    return step;
  };
  return {
    build: named("Build native host"),
    verify: named("Verify where the native host keeps its secrets"),
    steps,
  };
}

/** The part of the build script that decides the keyring flags. */
function keyringDecision(script) {
  const start = script.indexOf('keyring_flags=""');
  assert.notEqual(start, -1, "the build script sets keyring_flags");
  const end = script.indexOf("\nfi\n", start);
  assert.notEqual(end, -1, "the keyring_flags decision is a closed if block");
  return script.slice(start, end + "\nfi\n".length);
}

function flagsFor(script, platform, macSigned) {
  return execFileSync(
    "bash",
    [
      "-c",
      `set -euo pipefail\n${keyringDecision(script)}\nprintf '%s' "$keyring_flags"`,
    ],
    {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        COLONY_PACKAGE_PLATFORM: platform,
        MAC_SIGNED: macSigned,
      },
    },
  );
}

test("an unsigned Mac native host is built without the system keyring", async () => {
  const { build } = await packageSteps();
  assert.equal(flagsFor(build.run, "darwin", "false"), "--no-default-features");
  // An empty output (not even "false") means MAC_SIGNED was never set at all;
  // that is also unsigned and must keep the file storage.
  assert.equal(flagsFor(build.run, "darwin", ""), "--no-default-features");
});

test("a signed Mac native host keeps the Keychain", async () => {
  const { build } = await packageSteps();
  assert.equal(flagsFor(build.run, "darwin", "true"), "");
});

test("Windows and Linux native hosts are unchanged", async () => {
  const { build } = await packageSteps();
  for (const platform of ["win32", "linux"]) {
    for (const signed of ["true", "false"]) {
      assert.equal(
        flagsFor(build.run, platform, signed),
        "",
        `${platform} (mac_signed=${signed}) keeps the system keyring`,
      );
    }
  }
});

test("the cargo build uses the decided flags and the signing result comes from resolve-signing", async () => {
  const { build } = await packageSteps();
  assert.equal(
    build.env.MAC_SIGNED,
    expression("needs.resolve-signing.outputs.mac_signed"),
  );
  assert.equal(
    build.env.COLONY_PACKAGE_PLATFORM,
    expression("matrix.platform"),
  );
  assert.match(
    build.run,
    /cargo build --locked --release \\\n\s+\$keyring_flags \\\n\s+--features electron-host \\\n\s+--bin colony-native-host/u,
  );
});

test("the built host is checked for the secret storage it was meant to have", async () => {
  const { build, verify, steps } = await packageSteps();
  assert.ok(
    steps.indexOf(verify) > steps.indexOf(build),
    "the check runs after the host is built",
  );
  assert.equal(verify.if, undefined, "the check runs for every build");
  assert.equal(
    verify.env.MAC_SIGNED,
    expression("needs.resolve-signing.outputs.mac_signed"),
  );
  const script = verify.run;
  assert.ok(script.includes(`expected="${KEYCHAIN}"`));
  // Run the decision itself for every platform and signing result.
  const start = script.indexOf(`expected="${KEYCHAIN}"`);
  const end = script.indexOf("\nfi\n", start) + "\nfi\n".length;
  const expectedFor = (platform, macSigned) =>
    execFileSync(
      "bash",
      [
        "-c",
        `set -euo pipefail\n${script.slice(start, end)}\nprintf '%s' "$expected"`,
      ],
      {
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          COLONY_PACKAGE_PLATFORM: platform,
          MAC_SIGNED: macSigned,
        },
      },
    );
  assert.equal(expectedFor("darwin", "false"), FILE);
  assert.equal(expectedFor("darwin", ""), FILE);
  assert.equal(expectedFor("darwin", "true"), KEYCHAIN);
  assert.equal(expectedFor("win32", "false"), KEYCHAIN);
  assert.equal(expectedFor("linux", "false"), KEYCHAIN);
  // It must also refuse a host that carries both markers.
  assert.ok(script.includes(KEYCHAIN) && script.includes(FILE));
  assert.match(script, /unexpectedly carries/u);
});

test("the host source carries exactly the markers the workflow looks for", async () => {
  const [source, cargo] = await Promise.all([
    readFile(markerSourcePath, "utf8"),
    readFile(cargoTomlPath, "utf8"),
  ]);
  assert.match(
    source,
    /if cfg!\(feature = "system-keyring"\) \{\s+"colony-secret-storage=keychain"\s+\} else \{\s+"colony-secret-storage=file"\s+\}/u,
  );
  // The flag only matters because the keyring is a default feature.
  assert.match(cargo, /^default = \["system-keyring"\]$/mu);
});
