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
