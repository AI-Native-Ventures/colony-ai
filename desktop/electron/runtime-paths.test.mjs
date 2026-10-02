import assert from "node:assert/strict";
import test from "node:test";
import { runtimePaths } from "./runtime-paths.mjs";

test("packaged runtime paths resolve from app.asar and resources", () => {
  const paths = runtimePaths({
    packaged: true,
    appPath: "/Applications/Buzz.app/Contents/Resources/app.asar",
    resourcesPath: "/Applications/Buzz.app/Contents/Resources",
    env: { COLONY_ELECTRON_DEV_URL: "http://127.0.0.1:5173" },
    platform: "darwin",
  });

  assert.deepEqual(paths, {
    nativeHost: "/Applications/Buzz.app/Contents/Resources/colony-native-host",
    rendererRoot: "/Applications/Buzz.app/Contents/Resources/app.asar/dist",
    preload:
      "/Applications/Buzz.app/Contents/Resources/app.asar/electron/preload.cjs",
    devUrl: undefined,
  });
});

test("development paths honor the host and Vite URL overrides", () => {
  const paths = runtimePaths({
    packaged: false,
    appPath: "/checkout/desktop",
    env: {
      COLONY_NATIVE_HOST: "/tmp/colony-native-host-dev",
      COLONY_ELECTRON_DEV_URL: "http://127.0.0.1:5173",
    },
    platform: "darwin",
  });

  assert.deepEqual(paths, {
    nativeHost: "/tmp/colony-native-host-dev",
    rendererRoot: "/checkout/desktop/dist",
    preload: "/checkout/desktop/electron/preload.cjs",
    devUrl: "http://127.0.0.1:5173",
  });
});

test("development defaults to the debug host under desktop/src-tauri", () => {
  const paths = runtimePaths({
    packaged: false,
    appPath: "/checkout/desktop",
    env: {},
    platform: "linux",
  });

  assert.equal(
    paths.nativeHost,
    "/checkout/desktop/src-tauri/target/debug/colony-native-host",
  );
  assert.equal(paths.devUrl, undefined);
});

test("Windows host paths include the executable suffix", () => {
  const paths = runtimePaths({
    packaged: true,
    appPath: "C:\\Program Files\\Buzz\\resources\\app.asar",
    resourcesPath: "C:\\Program Files\\Buzz\\resources",
    env: {},
    platform: "win32",
  });

  assert.equal(
    paths.nativeHost,
    "C:\\Program Files\\Buzz\\resources\\colony-native-host.exe",
  );
  assert.equal(
    paths.rendererRoot,
    "C:\\Program Files\\Buzz\\resources\\app.asar\\dist",
  );
});

test("an explicit host path wins in packaged builds while dev URL stays disabled", () => {
  const paths = runtimePaths({
    packaged: true,
    appPath: "/opt/buzz/resources/app.asar",
    resourcesPath: "/opt/buzz/resources",
    env: {
      COLONY_NATIVE_HOST: "/opt/alternate/host",
      COLONY_ELECTRON_DEV_URL: "http://127.0.0.1:5173",
    },
    platform: "linux",
  });

  assert.equal(paths.nativeHost, "/opt/alternate/host");
  assert.equal(paths.devUrl, undefined);
});
