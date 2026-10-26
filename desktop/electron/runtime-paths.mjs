import { createHash } from "node:crypto";
import path from "node:path";

/** Resolve the renderer, preload, and native host for Electron's current mode. */
export function runtimePaths({
  packaged,
  appPath,
  resourcesPath,
  env = process.env,
  platform = process.platform,
}) {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  const executableSuffix = platform === "win32" ? ".exe" : "";
  const nativeHost = env.COLONY_NATIVE_HOST
    ? env.COLONY_NATIVE_HOST
    : packaged
      ? pathApi.join(resourcesPath, `colony-native-host${executableSuffix}`)
      : pathApi.join(
          appPath,
          "src-tauri",
          "target",
          "debug",
          `colony-native-host${executableSuffix}`,
        );

  return {
    nativeHost,
    rendererRoot: pathApi.join(appPath, "dist"),
    preload: pathApi.join(appPath, "electron", "preload.cjs"),
    devUrl: packaged ? undefined : env.COLONY_ELECTRON_DEV_URL,
  };
}

/**
 * Electron profile folder. The names are fixed on purpose: the native host
 * namespaces its storage and keychain entries by a hash of this path (see
 * `nativeProfileId`), so it must never follow the display name.
 */
export function userDataPath({ appData, packaged, env = process.env }) {
  return (
    env.COLONY_ELECTRON_USER_DATA ||
    path.join(appData, packaged ? "Colony Electron" : "Colony Electron Dev")
  );
}

/** Sixteen hex characters that scope the native host's data to one profile. */
export function nativeProfileId(userData) {
  return createHash("sha256").update(userData).digest("hex").slice(0, 16);
}
