import assert from "node:assert/strict";
import test from "node:test";

import { loadManifest } from "./host-protocol.mjs";
import {
  createTrustedIdentityLaunch,
  identityPlatformForElectron,
} from "./identity-launch.mjs";
import {
  digestJson,
  PRODUCTION_IDENTITY_MANIFEST_DIGEST,
} from "./identity-protocol.mjs";

const manifest = loadManifest();

test("trusted identity launch derives the frozen macOS normal descriptor", () => {
  const launch = createTrustedIdentityLaunch({
    manifest,
    flavor: "normal",
    electronPlatform: "darwin",
    userDataRoot: "/tmp/Colony/dev/0000000000000001/normal",
  });
  assert.deepEqual(launch, {
    profileId: "0000000000000001",
    flavor: "normal",
    platform: "macos",
    userDataRoot: "/tmp/Colony/dev/0000000000000001/normal",
    identityMode: "explicit",
    sharedIdentity: false,
    resetProvenance: "not_attempted_fresh",
    identityManifestDigest: PRODUCTION_IDENTITY_MANIFEST_DIGEST,
  });
  assert.equal(Object.isFrozen(launch), true);
});

test("unproven platforms and instrumented flavor remain health-only", () => {
  assert.equal(
    createTrustedIdentityLaunch({
      manifest,
      flavor: "instrumented",
      electronPlatform: "darwin",
      userDataRoot: "/tmp/Colony/dev/0000000000000001/instrumented",
    }),
    null,
  );
  assert.equal(
    createTrustedIdentityLaunch({
      manifest,
      flavor: "normal",
      electronPlatform: "linux",
      userDataRoot: "/tmp/Colony/dev/0000000000000001/normal",
    }),
    null,
  );
  assert.equal(
    createTrustedIdentityLaunch({
      manifest,
      flavor: "normal",
      electronPlatform: "win32",
      userDataRoot: "C:\\Users\\runner\\Colony\\dev\\0000000000000001\\normal",
    }),
    null,
  );
});

test("platform mapping is finite and unknown hosts do not activate identity", () => {
  assert.equal(identityPlatformForElectron("darwin"), "macos");
  assert.equal(identityPlatformForElectron("linux"), "linux");
  assert.equal(identityPlatformForElectron("win32"), "windows");
  assert.equal(identityPlatformForElectron("freebsd"), null);
});

test("trusted launch rejects a profile path that is not the frozen manifest authority", () => {
  const tampered = structuredClone(manifest);
  tampered.identityProfiles.normal.userDataRelativePath =
    "Colony/dev/0000000000000001/other";
  assert.throws(
    () =>
      createTrustedIdentityLaunch({
        manifest: tampered,
        flavor: "normal",
        electronPlatform: "darwin",
        userDataRoot: "/tmp/Colony/dev/0000000000000001/normal",
      }),
    /invalid_manifest_identity_digest/,
  );
});

test("trusted launch rejects a complete identity record drift even with a recomputed digest", () => {
  const tampered = structuredClone(manifest);
  tampered.identityProfiles.normal.collisionEvidence.macos =
    "observed-unoccupied";
  tampered.identityManifestDigest = digestJson({
    manifestVersion: tampered.identityProfiles.manifestVersion,
    identityProfiles: tampered.identityProfiles,
  });
  assert.throws(
    () =>
      createTrustedIdentityLaunch({
        manifest: tampered,
        flavor: "normal",
        electronPlatform: "darwin",
        userDataRoot: "/tmp/Colony/dev/0000000000000001/normal",
      }),
    /invalid_manifest_identity_digest/,
  );
});
