// Local candidate inspection session. Full-app launches remain behind ai-lib's sandbox probe guard.
import readline from "node:readline";
import { writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import {
  OUT,
  Rec,
  launch,
  closeApp,
  loadState,
  instrument,
  shot,
  progress,
  sleep,
  redact,
  newProfile,
  saveState,
  signUp,
} from "./ai-lib.mjs";
import { startFakeProvider } from "./fake-provider.mjs";
if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI)
  throw new Error("Local opt-in required");
for (const key of ["AI_APP", "AI_OUT", "AI_STATE", "AI_PROGRESS"])
  if (!process.env[key])
    throw new Error("Explicit candidate paths required: " + key);
const state = await loadState();
if (process.env.RESUME_NEW === "1" && state.C?.business)
  throw new Error(
    "The one explicitly authorized clean business has already been created",
  );
if (process.env.RESUME_NEW === "1") {
  state.C = {
    ...(await newProfile("106-clean")),
    name: "Candidate 106 Clean Owner",
  };
  await saveState(state);
}
const rec = new Rec(process.env.RESUME_PHASE ?? "G1-SCOUT-RESUME");
const fake = await startFakeProvider({
  logFile: path.join(OUT, rec.phase + "-fake.jsonl"),
  port: process.env.RESUME_NEW === "1" ? 0 : 62448,
  scoutIntro: true,
});
await fetch(fake.url + "/models").then((r) => {
  if (!r.ok) throw new Error("FAKE unreachable");
});
if (process.env.RESUME_NEW === "1") {
  const { createHash } = await import("node:crypto");
  const { mkdir } = await import("node:fs/promises");
  const p = state.C;
  const home = path.join(p.privateDir, "home");
  const hash = createHash("sha256")
    .update(p.userDataDir)
    .digest("hex")
    .slice(0, 16);
  const config = path.join(
    home,
    "Library",
    "Application Support",
    `xyz.block.buzz.app.electron.${hash}`,
    "agents",
    "global-agent-config.json",
  );
  await mkdir(path.dirname(config), { recursive: true, mode: 0o700 });
  await writeFile(
    config,
    JSON.stringify({
      env_vars: { OPENAI_COMPAT_BASE_URL: fake.url },
      provider: "openai",
      model: "fake-model",
      preferred_runtime: "buzz-agent",
    }),
    { mode: 0o600 },
  );
  p.home = home;
  p.fakePort = Number(new URL(fake.url).port);
  await saveState(state);
}
const { application, page, version } = await launch({
  ...state[process.env.RESUME_PROFILE ?? "A"],
  extraEnv:
    process.env.RESUME_AGENT === "1" ? { COLONY_BROWSER_AGENT: "1" } : {},
});
instrument(page, rec, "resume");
console.log(
  "SESSION READY " + rec.phase + " version=" + version + " FAKE=" + fake.url,
);
const scope = {
  application,
  page,
  rec,
  fake,
  state,
  OUT,
  shot,
  progress,
  sleep,
  writeFile,
  readFile,
  path,
  redact,
  newProfile,
  saveState,
  signUp,
};
const rl = readline.createInterface({ input: process.stdin, terminal: false });
try {
  for await (const line of rl) {
    if (line === "EXIT") break;
    try {
      const result = await new Function(
        ...Object.keys(scope),
        "return (async()=>{" +
          (line.startsWith("FILE ")
            ? await readFile(line.slice(5), "utf8")
            : JSON.parse(line)) +
          "})()",
      )(...Object.values(scope));
      if (result !== undefined) console.log(redact(JSON.stringify(result)));
      await rec.write();
      console.log("COMMAND DONE");
    } catch (e) {
      console.log("COMMAND ERROR " + redact(e.stack));
      await rec.write();
    }
  }
} finally {
  rl.close();
  rec.notes.fake = fake.stats();
  await rec.write();
  await closeApp(application);
  await fake.close();
}

process.exit(0);
