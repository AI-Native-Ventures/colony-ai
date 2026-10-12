// Starts and stops the packaged native host the way the apps do (NativeHost
// over the `@colony-native:` protocol). Each simulated computer is its own
// Electron profile, so it has its own app data folder and install id.
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NativeHost } from "../../../electron/native-host.mjs";

/** A fresh profile id: 16 lowercase hex characters. */
export const newProfileId = () => randomBytes(8).toString("hex");

/** The host's app data folder for `identifier` and `profile`. */
export function appDataDir(
  identifier,
  profile,
  env = process.env,
  platform = process.platform,
) {
  const folder = `${identifier}.electron.${profile}`;
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", folder);
  }
  if (platform === "win32") {
    return path.join(
      env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"),
      folder,
    );
  }
  return path.join(
    env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"),
    folder,
  );
}

/** Start one host. `nsec` is the signed-in person (no keychain is used). */
export async function startHost({ binary, profile, nsec, extraEnv = {} }) {
  const host = new NativeHost(binary, {
    env: {
      ...process.env,
      BUZZ_PRIVATE_KEY: nsec,
      COLONY_ELECTRON_PROFILE_ID: profile,
      COLONY_FIXTURE_ROLE_PACKS: "1",
      COLONY_TEAM_GATE: "1",
      ...extraEnv,
    },
    timeout: 60_000,
  });
  await host.ready;
  return {
    invoke: (command, args = {}) => host.request("invoke", { command, args }),
    /** Hard kill, like a crash or a power cut. */
    kill: async () => {
      host.child.kill("SIGKILL");
      await host.exited;
    },
    /** Normal quit: the host drains its employees. */
    close: () => host.close(),
  };
}

/** Read a JSON file the host wrote, or `null`. */
export async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}
