// App drivers for the proof run. A driver starts the app under test with HOME pointing at a throwaway fixture
// and gives the runner the same small surface whether the app is a packaged Buzz.app or Colony.app (Playwright
// Electron, the way the earlier real-run gates launched it) or the fake app used by this harness's own tests.
//
// Safety, all enforced here and not left to the caller:
// - HOME in the child environment is the fixture home, and the launch is refused unless the fixture marker
//   exists (assertThrowawayRoot with requireMarker).
// - Under macOS the child runs inside sandbox-exec with a policy that denies the REAL ~/.buzz and ~/.colony,
//   the keychain services and the shared app-data folders. If anything ever resolved the real home, the
//   sandbox blocks it, and the run shows a failure instead of touching private data.
// - Only an allow-list of environment variables is forwarded, so inherited credentials stay out.
import { execFile, spawn } from "node:child_process";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { NEW_NEST, OLD_NEST } from "./contract.mjs";
import { assertThrowawayRoot } from "./fixture.mjs";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const FORWARDED = [
  "PATH",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "LANG",
  "LC_ALL",
];

/** Environment for the app. HOME is always the fixture home. */
export function buildLaunchEnv({
  home,
  userDataDir,
  relayUrl,
  hostLog,
  source = process.env,
  extra = {},
}) {
  const env = {};
  for (const key of FORWARDED) if (source[key]) env[key] = source[key];
  return {
    ...env,
    HOME: home,
    BUZZ_RELAY_URL: relayUrl,
    COLONY_ELECTRON_USER_DATA: userDataDir,
    COLONY_ELECTRON_BACKGROUND: "1",
    COLONY_NATIVE_HOST_LOG: hostLog,
    ...extra,
  };
}

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** sandbox-exec policy that keeps the child away from the real home's nest folders and the keychain. */
export function sandboxPolicy(realHome = os.homedir()) {
  const q = (value) => JSON.stringify(value);
  const support = path.join(realHome, "Library", "Application Support");
  const profileFolders = `${escapeRegex(support)}/xyz\\.block\\.buzz\\.app\\.electron\\.`;
  const forbidden = [
    path.join(realHome, OLD_NEST),
    path.join(realHome, NEW_NEST),
    path.join(realHome, `${OLD_NEST}-dev`),
    path.join(realHome, "Library", "Keychains"),
    "/Library/Keychains",
    path.join(support, "xyz.block.buzz.app"),
    path.join(support, "xyz.block.buzz.app.dev"),
    path.join(support, "Colony Electron"),
    path.join(support, "Colony Electron Dev"),
  ];
  return [
    "(version 1)",
    "(allow default)",
    ...forbidden.map((p) => `(deny file-read* file-write* (subpath ${q(p)}))`),
    // Every Electron profile's native-host folder under the real home, and the real CLI links the host makes.
    `(deny file-read* file-write* (regex #"^${profileFolders}"))`,
    ...["buzz", "buzz-dev", "colony"].map(
      (name) =>
        `(deny file-write* (literal ${q(path.join(realHome, ".local", "bin", name))}))`,
    ),
    '(deny mach-lookup (global-name "com.apple.securityd") (global-name "com.apple.SecurityServer") (global-name "com.apple.security.agent") (global-name "com.apple.SecurityAgent") (global-name-regex #"^com\\.apple\\.(securityd|SecurityServer|SecurityAgent|security\\.agent)(\\.|$)"))',
    '(deny process-exec (literal "/usr/bin/security") (literal "/System/Library/CoreServices/SecurityAgent.app/Contents/MacOS/SecurityAgent"))',
  ].join("\n");
}

/** Every descendant pid of `rootPid`, from one ps snapshot. */
export async function descendants(rootPid) {
  const out = await new Promise((resolve) => {
    const child = spawn("ps", ["-axo", "pid=,ppid="]);
    let text = "";
    child.stdout.on("data", (chunk) => {
      text += chunk;
    });
    child.on("close", () => resolve(text));
    child.on("error", () => resolve(""));
  });
  const children = new Map();
  for (const line of out.split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/u).map(Number);
    if (!pid) continue;
    if (!children.has(ppid)) children.set(ppid, []);
    children.get(ppid).push(pid);
  }
  const found = [];
  const walk = (pid) => {
    for (const child of children.get(pid) ?? []) {
      found.push(child);
      walk(child);
    }
  };
  walk(rootPid);
  return found;
}

/** SIGKILL a process and everything below it, children first. */
export async function killTree(pid) {
  const all = [...(await descendants(pid)).reverse(), pid];
  for (const target of all) {
    try {
      process.kill(target, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Read a log file's lines, tolerating a file that does not exist yet. */
export async function readLines(file) {
  try {
    return (await readFile(file, "utf8")).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Shared shape of a started app.
 * @typedef {object} RunningApp
 * @property {number} pid
 * @property {() => Promise<string[]>} hostLogLines host log plus the process's own stdout and stderr
 * @property {() => Promise<void>} quit graceful quit with a deadline, then SIGTERM
 * @property {() => Promise<void>} kill SIGKILL the whole tree
 * @property {() => boolean} isRunning
 * @property {Promise<{code: number|null, signal: string|null}>} exited
 * @property {object} [page] Playwright page when the driver has a window
 */

/** Launch a packaged .app through Playwright Electron inside the sandbox. */
export async function launchPackaged({
  app,
  fixtureRoot,
  home,
  userDataDir,
  privateDir,
  relayUrl,
  extraEnv = {},
}) {
  await assertThrowawayRoot(fixtureRoot, { requireMarker: true });
  if (path.dirname(home) !== (await realpath(fixtureRoot)))
    throw new Error("home is not the fixture's home folder");
  const { _electron: electron } = await import("@playwright/test");
  const macos = path.join(app, "Contents", "MacOS");
  const executable = path.join(macos, (await readdir(macos))[0]);
  const hostLog = path.join(privateDir, "native-host.log");
  await writeFile(hostLog, "", { flag: "a" });
  const sandbox = path.join(privateDir, "sandbox.sb");
  await writeFile(sandbox, sandboxPolicy(), { mode: 0o600 });
  const launcher = path.join(privateDir, "launch.sh");
  const q = (value) => `'${value.replace(/'/gu, `'\\''`)}'`;
  await writeFile(
    launcher,
    `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${q(sandbox)} ${q(executable)} "$@"\n`,
    { mode: 0o700 },
  );
  const lines = [];
  const application = await electron.launch({
    executablePath: launcher,
    args: ["--no-sandbox", `--user-data-dir=${userDataDir}`],
    env: buildLaunchEnv({
      home,
      userDataDir,
      relayUrl,
      hostLog,
      extra: extraEnv,
    }),
    timeout: 60000,
  });
  const child = application.process();
  for (const stream of [child.stdout, child.stderr])
    if (stream)
      createInterface({ input: stream }).on("line", (line) => lines.push(line));
  const exited = new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  let page = null;
  return {
    pid: child.pid,
    version: () =>
      application.evaluate(({ app: electronApp }) => electronApp.getVersion()),
    async window(timeoutMs = 45000) {
      page = await application.firstWindow({ timeout: timeoutMs });
      await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs });
      return page;
    },
    application,
    hostLogLines: async () => [...(await readLines(hostLog)), ...lines],
    async quit() {
      try {
        await Promise.race([
          application.close(),
          sleep(10000).then(() => Promise.reject(new Error("close deadline"))),
        ]);
      } catch {
        await killTree(child.pid);
      }
    },
    kill: () => killTree(child.pid),
    isRunning: () => alive(child.pid),
    exited,
    get page() {
      return page;
    },
  };
}

/**
 * Fake app for this harness's own tests: a node script that plays the host's part (logs the folder choice,
 * runs the simulated migration). Same surface as launchPackaged. Never used in a proof run.
 */
export async function launchFake({
  script,
  fixtureRoot,
  home,
  userDataDir,
  privateDir,
  extraEnv = {},
}) {
  await assertThrowawayRoot(fixtureRoot, { requireMarker: true });
  const hostLog = path.join(privateDir, "native-host.log");
  await writeFile(hostLog, "", { flag: "a" });
  const lines = [];
  const child = spawn(process.execPath, [script], {
    env: buildLaunchEnv({
      home,
      userDataDir,
      relayUrl: "ws://127.0.0.1:9",
      hostLog,
      extra: extraEnv,
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr])
    createInterface({ input: stream }).on("line", (line) => lines.push(line));
  const exited = new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
  return {
    pid: child.pid,
    version: async () => "fake",
    window: async () => ({ fake: true }),
    hostLogLines: async () => [...(await readLines(hostLog)), ...lines],
    async quit() {
      child.kill("SIGTERM");
      await Promise.race([exited, sleep(5000)]);
      if (alive(child.pid)) await killTree(child.pid);
    },
    kill: () => killTree(child.pid),
    isRunning: () => alive(child.pid),
    exited,
    page: null,
  };
}

/**
 * Prepare the private working folders for one launch: a user-data directory (a private copy of a signed-in
 * profile when `profileDir` is given, an empty one otherwise) and a folder for the sandbox and host log.
 */
export async function preparePrivateDirs(base, label, profileDir) {
  const privateDir = path.join(base, `private-${label}`);
  await mkdir(privateDir, { recursive: true, mode: 0o700 });
  await chmod(privateDir, 0o700);
  const userDataDir = path.join(privateDir, "user-data");
  if (profileDir) {
    const { cp } = await import("node:fs/promises");
    await cp(profileDir, userDataDir, { recursive: true });
  } else {
    await mkdir(userDataDir, { recursive: true, mode: 0o700 });
  }
  await chmod(userDataDir, 0o700);
  return { privateDir, userDataDir };
}

const execFileAsync = promisify(execFile);

/** Paths from `lsof -Fn` output: every line that starts with `n`. */
export function parseLsofCwd(output) {
  return String(output)
    .split("\n")
    .filter((line) => line.startsWith("n"))
    .map((line) => line.slice(1));
}

async function processEnvironment(pid) {
  try {
    return (await readFile(`/proc/${pid}/environ`, "utf8")).split("\0");
  } catch {
    /* not Linux */
  }
  try {
    // macOS: `ps eww` prints the environment after the command line.
    const { stdout } = await execFileAsync("ps", ["eww", "-p", String(pid)]);
    return stdout.split(/\s+/u);
  } catch {
    return [];
  }
}

async function processCwd(pid) {
  try {
    return await realpath(`/proc/${pid}/cwd`);
  } catch {
    /* not Linux */
  }
  try {
    const { stdout } = await execFileAsync("lsof", [
      "-a",
      "-d",
      "cwd",
      "-Fn",
      "-p",
      String(pid),
    ]);
    return parseLsofCwd(stdout)[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Managed agent processes below `rootPid`: descendants whose environment carries `<markerEnv>=<identifier>`,
 * with their working directory. This is how a restored agent is observed from outside the app.
 */
export async function findManagedAgents(rootPid, markerEnv, identifier) {
  const marker = `${markerEnv}=${identifier}`;
  const found = [];
  for (const pid of await descendants(rootPid)) {
    if (!(await processEnvironment(pid)).includes(marker)) continue;
    found.push({ pid, cwd: await processCwd(pid) });
  }
  return found;
}
