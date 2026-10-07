// Launches the browser host smoke (browser-smoke-main.mjs) in real Electron and
// reports its verdict. Run it where a display exists (a desktop, or xvfb-run on
// Linux CI): `pnpm test:browser-smoke`. It needs only the installed Electron
// binary, no relay, no native host and no build.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const electronBinary = require("electron");
const entry = path.join(here, "browser-smoke-main.mjs");
const args = [
  // The CI sandbox cannot set up Chromium's setuid helper from node_modules.
  ...(process.platform === "linux" ? ["--no-sandbox"] : []),
  entry,
];

const child = spawn(electronBinary, args, {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: "0" },
});
const timer = setTimeout(() => {
  console.error("Browser smoke did not exit within 180 seconds; killing it.");
  child.kill("SIGKILL");
}, 180_000);
child.on("exit", (code, signal) => {
  clearTimeout(timer);
  if (signal) {
    console.error(`Browser smoke was stopped by ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
