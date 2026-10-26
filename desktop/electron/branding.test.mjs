import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createInstallerConfig } from "../scripts/electron-installer.mjs";
import { ELECTRON_BUNDLE_ID } from "../scripts/electron-package-config.mjs";
import { installAppMenu } from "./app-menu.mjs";
import {
  APP_NAME,
  WINDOWS_APP_USER_MODEL_ID,
  applyAppBranding,
  keepWindowTitle,
} from "./branding.mjs";
import { nativeProfileId, userDataPath } from "./runtime-paths.mjs";

const electronDir = path.dirname(fileURLToPath(import.meta.url));
const read = (...parts) =>
  readFileSync(path.join(electronDir, ...parts), "utf8");
const tauriConfig = JSON.parse(read("..", "src-tauri", "tauri.conf.json"));

/** An Electron app that starts out named like a dev build and records calls. */
function fakeApp() {
  const app = {
    name: "buzz",
    aboutPanel: null,
    userModelId: null,
    getName: () => app.name,
    setName: (name) => {
      app.name = name;
    },
    setAboutPanelOptions: (options) => {
      app.aboutPanel = options;
    },
    setAppUserModelId: (id) => {
      app.userModelId = id;
    },
  };
  return app;
}

test("the app menu, About panel and Hide/Quit items all use the Colony name", () => {
  const app = fakeApp();
  applyAppBranding(app, { platform: "darwin" });
  let installed;
  const Menu = {
    buildFromTemplate: (template) => template,
    setApplicationMenu: (menu) => {
      installed = menu;
    },
  };
  installAppMenu({ Menu, app, platform: "darwin" });

  assert.equal(APP_NAME, "Colony");
  assert.equal(app.getName(), "Colony");
  assert.equal(installed[0].label, "Colony");
  assert.deepEqual(app.aboutPanel, { applicationName: "Colony" });
  assert.ok(!/buzz/i.test(JSON.stringify(installed)));
});

test("Windows attributes the taskbar and toasts to the installer's app ID", () => {
  const windows = fakeApp();
  applyAppBranding(windows, { platform: "win32" });
  const mac = fakeApp();
  applyAppBranding(mac, { platform: "darwin" });

  assert.equal(windows.userModelId, WINDOWS_APP_USER_MODEL_ID);
  assert.equal(mac.userModelId, null);
  const installer = createInstallerConfig({
    desktopPath: "/desktop",
    platform: "win32",
    arch: "x64",
    version: "3.0.0",
    signed: false,
  });
  assert.equal(WINDOWS_APP_USER_MODEL_ID, installer.appId);
  assert.equal(installer.productName, APP_NAME);
});

test("a window keeps its Colony title when the empty page title arrives", () => {
  const listeners = new Map();
  keepWindowTitle({ on: (event, listener) => listeners.set(event, listener) });
  let prevented = false;
  listeners.get("page-title-updated")({
    preventDefault: () => {
      prevented = true;
    },
  });

  assert.equal(prevented, true);
});

test("main.mjs names the app and the main window from the Colony name", () => {
  const main = read("main.mjs");

  assert.match(main, /applyAppBranding\(app\);/);
  assert.match(main, /title: APP_NAME,/);
  assert.match(main, /keepWindowTitle\(entry\.window\);/);
  // The product name in the Tauri config is packaging metadata, not the label.
  assert.ok(!main.includes("productName"));
});

test("the packaged config and installer carry the same Colony name", () => {
  assert.equal(tauriConfig.productName, APP_NAME);
});

test("renaming leaves the identifiers, schemes and bundle ID untouched", () => {
  assert.equal(tauriConfig.identifier, "xyz.block.buzz.app");
  assert.deepEqual(tauriConfig.plugins["deep-link"].desktop.schemes, [
    "colony",
    "buzz",
  ]);
  assert.equal(ELECTRON_BUNDLE_ID, "xyz.block.buzz.app.electron");
  assert.equal(
    createInstallerConfig({
      desktopPath: "/desktop",
      platform: "darwin",
      arch: "arm64",
      version: "3.0.0",
      signed: false,
    }).appId,
    "xyz.block.buzz.app.electron",
  );
});

test("user data and the native profile namespace do not follow the app name", () => {
  const appData = "/Users/someone/Library/Application Support";
  const packaged = userDataPath({ appData, packaged: true, env: {} });
  const development = userDataPath({ appData, packaged: false, env: {} });

  assert.equal(packaged, `${appData}/Colony Electron`);
  assert.equal(development, `${appData}/Colony Electron Dev`);
  assert.equal(
    userDataPath({
      appData,
      packaged: true,
      env: { COLONY_ELECTRON_USER_DATA: "/tmp/profile" },
    }),
    "/tmp/profile",
  );
  // The native host stores data and keychain entries under
  // `xyz.block.buzz.app.electron.<this hash>`; these values were taken from
  // the build that shipped before the rename.
  assert.equal(nativeProfileId(packaged), "8cd9e8ccb2ddba00");
  assert.equal(nativeProfileId(development), "96eb15a48ab9d2cc");
});

test("only the native host creates a tray icon, so there is one", () => {
  const sources = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (
        /\.(mjs|cjs|js)$/.test(entry.name) &&
        !/\.test\./.test(entry.name)
      )
        sources.push([file, readFileSync(file, "utf8")]);
    }
  };
  walk(electronDir);

  assert.ok(sources.length > 10);
  for (const [file, source] of sources) {
    assert.ok(!/new\s+Tray\s*\(/.test(source), `${file} creates a Tray`);
    assert.ok(
      !/import\s*\{[^}]*\bTray\b[^}]*\}\s*from\s*"electron"/.test(source),
      `${file} imports Tray`,
    );
  }
});

test("a second launch of the same profile hands over to the first", () => {
  const main = read("main.mjs");

  // The lock is skipped only for the automated smoke launch, and a second
  // instance reveals the first window and forwards its deep link.
  assert.match(
    main,
    /const primaryInstance = smoke \|\| app\.requestSingleInstanceLock\(\);\nif \(!primaryInstance\) app\.quit\(\);/,
  );
  assert.match(
    main,
    /app\.on\("second-instance", \(_event, commandLine\) =>\n\s+deepLinks\.handleSecondInstance\(commandLine\),\n\);/,
  );
});
