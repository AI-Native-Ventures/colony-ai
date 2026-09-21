import {
  PRODUCTION_IDENTITY_MANIFEST_DIGEST,
  PRODUCTION_IDENTITY_PROFILES,
  validateIdentityLaunchDescriptor,
} from "./identity-protocol.mjs";
import { validateManifest } from "./host-protocol.mjs";

const PLATFORM_NAMES = Object.freeze({
  darwin: "macos",
  linux: "linux",
  win32: "windows",
});

export function identityPlatformForElectron(platform) {
  return PLATFORM_NAMES[platform] ?? null;
}

/**
 * Derive the only production identity descriptor Electron is allowed to send.
 * Non-macOS and instrumented Stage-0 launches intentionally retain the v1
 * health-only carrier until their custody gates are independently proven.
 */
export function createTrustedIdentityLaunch({
  manifest,
  flavor,
  electronPlatform,
  userDataRoot,
}) {
  if (flavor !== "normal" || electronPlatform !== "darwin") return null;
  validateManifest(manifest);
  const profile = manifest?.identityProfiles?.[flavor];
  const expectedProfile = PRODUCTION_IDENTITY_PROFILES[flavor];
  if (
    !profile ||
    profile.profileId !== expectedProfile.profileId ||
    profile.userDataRelativePath !== expectedProfile.userDataRelativePath ||
    manifest.identityManifestDigest !== PRODUCTION_IDENTITY_MANIFEST_DIGEST
  ) {
    throw new Error("identity_manifest_mismatch");
  }
  const launch = {
    profileId: profile.profileId,
    flavor,
    platform: identityPlatformForElectron(electronPlatform),
    userDataRoot,
    identityMode: "explicit",
    sharedIdentity: false,
    resetProvenance: "not_attempted_fresh",
    identityManifestDigest: manifest.identityManifestDigest,
  };
  return Object.freeze(validateIdentityLaunchDescriptor(launch));
}
