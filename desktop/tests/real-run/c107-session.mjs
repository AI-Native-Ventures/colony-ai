// Colony 1.0.7 candidate gate session. One Node process keeps the FAKE provider alive for the whole run and
// relaunches the candidate only through ai-lib's guarded launch (sandbox probe, throwaway HOME, migration 0).
// The profile HOME is a private colony-browser-gate-* folder directly under the temporary directory, so the
// packaged agent browser gate (PR 273) can be armed per launch with its nonce and 0600 marker.
// Commands are trusted local scripts dropped into AI_CMD_DIR as next.js; output lands in out-<n>.txt.
import { chmod, mkdir, mkdtemp, readFile, realpath, rename, writeFile, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  OUT,
  Rec,
  launch,
  closeApp,
  loadState,
  saveState,
  instrument,
  shot,
  progress,
  sleep,
  redact,
  signUp,
  inventory,
} from "./ai-lib.mjs";
import { startFakeProvider } from "./fake-provider.mjs";
import { createAgentBrowserFixtures } from "./agent-browser/fixtures.mjs";
import { drivePackagedRow } from "./agent-browser/row-driver.mjs";
import { judgeRow } from "./agent-browser/rows.mjs";
import {
  GATE_HOME_PREFIX,
  GATE_MARKER,
  GATE_TTL_MS,
  readPackagedGate,
} from "../../electron/browser-broker/packaged-gate.mjs";

if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI)
  throw new Error("Local opt-in required");
for (const key of ["AI_APP", "AI_OUT", "AI_STATE", "AI_PROGRESS", "AI_CMD_DIR"])
  if (!process.env[key]) throw new Error(`Explicit candidate path required: ${key}`);
const CMD = process.env.AI_CMD_DIR;
await mkdir(CMD, { recursive: true, mode: 0o700 });

const state = await loadState();
const PROFILE = process.env.GATE_PROFILE ?? "G";
if (!state[PROFILE]) {
  const privateDir = await realpath(
    await mkdtemp(path.join(os.tmpdir(), GATE_HOME_PREFIX)),
  );
  await chmod(privateDir, 0o700);
  const userDataDir = path.join(privateDir, "user-data");
  await mkdir(userDataDir, { mode: 0o700 });
  state[PROFILE] = { privateDir, userDataDir, label: `107-gate-${PROFILE}` };
  await saveState(state);
}
const G = state[PROFILE];
const rec = new Rec(process.env.RESUME_PHASE ?? "C107");
const fake = await startFakeProvider({
  logFile: path.join(OUT, `${rec.phase}-fake.jsonl`),
  port: G.fakePort ?? 0,
  scoutIntro: true,
});
G.fakePort = Number(new URL(fake.url).port);
await saveState(state);
const models = await fetch(`${fake.url}/models`);
if (!models.ok) throw new Error("FAKE unreachable");

const S = { application: null, page: null, version: null, env: null, gate: null };

/** Write the dual opt-in marker for one exact managed task and fixture origin. Returns the nonce. */
async function armGate(task, origin) {
  const nonce = randomBytes(32).toString("hex");
  const marker = {
    ...task,
    schema: 1,
    nonce,
    provider: "FAKE",
    origin,
    expiresAt: Date.now() + GATE_TTL_MS - 1000,
  };
  const file = path.join(G.privateDir, GATE_MARKER);
  await writeFile(file, JSON.stringify(marker), { mode: 0o600 });
  await chmod(file, 0o600);
  await chmod(G.privateDir, 0o700);
  const env = { HOME: G.privateDir, TMPDIR: process.env.TMPDIR, COLONY_BROWSER_PACKAGED_GATE: nonce };
  // Exercise the production reader before launch: it must accept this exact HOME and marker.
  const reader = await readPackagedGate(env);
  if (!reader) throw new Error("Packaged gate reader returned nothing");
  return nonce;
}

async function launchApp({ flag, gate } = {}) {
  if (S.application) await closeApp(S.application);
  S.application = null;
  const extraEnv = { HOME: G.privateDir };
  if (flag !== undefined) extraEnv.COLONY_BROWSER_AGENT = flag;
  if (gate) extraEnv.COLONY_BROWSER_PACKAGED_GATE = await armGate(gate.task, gate.origin);
  const { application, page, version } = await launch({ ...G, extraEnv });
  S.application = application;
  S.page = page;
  S.version = version;
  S.env = { ...extraEnv };
  S.gate = gate ?? null;
  instrument(page, rec, `launch-${flag ?? "unset"}${gate ? "-gate" : ""}`);
  await progress(
    `[${rec.phase}] launched version=${version} COLONY_BROWSER_AGENT=${flag ?? "(unset)"} gate=${gate ? "armed" : "off"}`,
  );
  return { version, env: Object.keys(extraEnv) };
}

const scope = {
  S,
  G,
  rec,
  fake,
  state,
  OUT,
  shot,
  progress,
  sleep,
  redact,
  writeFile,
  readFile,
  path,
  saveState,
  signUp,
  inventory,
  launchApp,
  closeApp,
  createAgentBrowserFixtures,
  drivePackagedRow,
  judgeRow,
};
console.log(`SESSION READY ${rec.phase} FAKE=${fake.url} HOME=${G.privateDir}`);
await writeFile(path.join(CMD, "ready.txt"), `FAKE=${fake.url}\n`);
let n = 0;
let running = true;
process.on("SIGTERM", () => {
  running = false;
});
try {
  while (running) {
    const next = path.join(CMD, "next.js");
    const exists = await stat(next).then(() => true, () => false);
    if (!exists) {
      await sleep(300);
      continue;
    }
    n += 1;
    const file = path.join(CMD, `run-${n}.js`);
    await rename(next, file);
    const source = await readFile(file, "utf8");
    const outFile = path.join(CMD, `out-${n}.txt`);
    if (source.trim() === "EXIT") {
      await writeFile(outFile, "EXITING\n");
      break;
    }
    let text;
    try {
      const result = await new Function(
        ...Object.keys(scope),
        `return (async()=>{${source}})()`,
      )(...Object.values(scope));
      text = `${result === undefined ? "" : redact(JSON.stringify(result, null, 1))}\nCOMMAND DONE\n`;
    } catch (error) {
      text = `COMMAND ERROR ${redact(error?.stack ?? String(error))}\n`;
    }
    await rec.write().catch(() => undefined);
    await writeFile(outFile, text);
  }
} finally {
  rec.notes.fake = fake.stats();
  await rec.write();
  if (S.application) await closeApp(S.application);
  await fake.close();
}
process.exit(0);
