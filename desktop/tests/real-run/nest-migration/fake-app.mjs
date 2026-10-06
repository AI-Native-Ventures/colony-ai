// Fake app used ONLY to prove this harness end to end (proof.test.mjs). It plays the host's part: reads HOME,
// logs the folder choice in the host's format, runs the simulated migration (honouring the kill switch, the
// crash hook, running agents and a read-only HOME), and performs the boot reset. FAKE_BREAK makes it misbehave
// in one named way so the tests can show the runner turns each defect into a FAIL. It is not the product.
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { defaultContract } from "./contract.mjs";
import { simulateMigration } from "./simulate.mjs";

const contract = defaultContract();
const home = process.env.HOME;
const userData = process.env.COLONY_ELECTRON_USER_DATA;
const logFile = process.env.COLONY_NATIVE_HOST_LOG;
const broken = process.env.FAKE_BREAK ?? "";
const flagOn =
  broken === "ignore-flag" ||
  process.env[contract.env.flag] === contract.env.flagOn;
const crashAfter = process.env[contract.env.crashAfter];
const oldRoot = path.join(home, contract.oldNest);
const newRoot = path.join(home, contract.newNest);

const log = (line) => appendFileSync(logFile, `${line}\n`);
const present = (file) => {
  try {
    lstatSync(file);
    return true;
  } catch {
    return false;
  }
};
const holdsNest = (folder) =>
  [".nest-agents-version", "AGENTS.md"].some((marker) =>
    present(path.join(folder, marker)),
  );

const profile = createHash("sha256")
  .update(userData)
  .digest("hex")
  .slice(0, 16);
const appData = path.join(
  home,
  "Library",
  "Application Support",
  `xyz.block.buzz.app.electron.${profile}`,
);
const sentinel = path.join(
  path.dirname(appData),
  `.${path.basename(appData)}.reset-pending`,
);

function liveAgent() {
  const dir = path.join(appData, "agents", "agent-pids");
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".pid"))) {
    const pid = Number(readFileSync(path.join(dir, name), "utf8").trim());
    try {
      process.kill(pid, 0);
      return pid;
    } catch {
      /* dead */
    }
  }
  return null;
}

function choose() {
  const oldThere = present(oldRoot);
  const newThere = present(newRoot);
  if (!oldThere && !newThere)
    return { chosen: contract.newNest, reason: "fresh-install" };
  if (newThere && !oldThere)
    return { chosen: contract.newNest, reason: "colony-folder-only" };
  if (!newThere)
    return { chosen: contract.oldNest, reason: "legacy-folder-kept" };
  return holdsNest(newRoot)
    ? { chosen: contract.newNest, reason: "both-colony-has-nest" }
    : { chosen: contract.oldNest, reason: "both-legacy-kept" };
}

async function migrate() {
  if (!flagOn) return;
  if (!present(oldRoot)) return;
  if (present(path.join(home, contract.sentinelPaths[0]))) return;
  // Resume after a crash: the journal exists without a sentinel, even if the nest markers already moved.
  const resuming = present(path.join(home, contract.journalPaths[0]));
  if (!holdsNest(oldRoot) && !resuming) return;
  const agent = broken === "ignore-agent" ? null : liveAgent();
  if (agent) {
    log(
      `${contract.migrationLogPrefix} deferred, agent running (pid ${agent}), the move will finish next launch`,
    );
    return;
  }
  try {
    const probe = path.join(home, ".colony-write-probe");
    writeFileSync(probe, "");
    rmSync(probe);
  } catch (error) {
    log(
      `${contract.migrationLogPrefix} could not start (${error.code}), Colony stays on ${contract.oldNest}`,
    );
    return;
  }
  const stopAfter = crashAfter === undefined ? undefined : Number(crashAfter);
  const result = await simulateMigration(home, {
    contract,
    stopAfter,
    journal: broken !== "no-journal",
    sentinel: broken !== "no-journal",
  });
  if (stopAfter !== undefined) {
    log(
      `${contract.migrationLogPrefix} crash hook after ${result.moved.length} entries`,
    );
    process.kill(process.pid, "SIGKILL");
  }
  log(
    `${contract.migrationLogPrefix} moved ${result.moved.join(", ")}; left ${result.left.join(", ") || "none"}`,
  );
  for (const name of result.left)
    log(
      `${contract.migrationLogPrefix} skipped ${name}: already in ${contract.newNest}, kept both`,
    );
  if (broken === "copy") {
    const file = path.join(newRoot, "OUTBOX", "DAY1_VIDEO_PACK.md");
    const bytes = readFileSync(file);
    rmSync(file);
    writeFileSync(file, bytes);
  }
  if (broken === "touch-foreign") {
    const file = path.join(oldRoot, "gate-note.md");
    writeFileSync(file, readFileSync(file));
  }
  if (broken === "overwrite" && present(path.join(newRoot, "AGENTS.md")))
    writeFileSync(
      path.join(newRoot, "AGENTS.md"),
      "overwritten by the migration\n",
    );
  if (broken === "delete-owned")
    rmSync(path.join(newRoot, "RESEARCH", "TELEMETRY_TEARDOWN.md"), {
      force: true,
    });
}

function reset(chosen) {
  if (!existsSync(sentinel)) return;
  const folder = path.join(home, chosen);
  for (const name of contract.ownedTopLevel)
    rmSync(path.join(folder, name), { recursive: true, force: true });
  for (const link of contract.generatedSkillLinks)
    rmSync(path.join(folder, link), { recursive: true, force: true });
  if (broken === "reset-wipes-all")
    rmSync(path.join(folder, ".venv-tts"), { recursive: true, force: true });
  rmSync(sentinel, { force: true });
  // The product's verification reports the nest as not gone while foreign entries remain: mimic it when asked.
  if (broken === "reset-never-completes")
    log(
      "buzz-desktop reset: verification failed (keychain_wiped=true, app_data_gone=true, legacy_gone=true, nest_gone=false)",
    );
  else log("buzz-desktop reset: completed");
}

await migrate();
const choice = choose();
log(
  `${contract.nestFolderLogPrefix} chosen=${choice.chosen} reason=${choice.reason} path=${path.join(home, choice.chosen)}`,
);
if (!present(path.join(home, choice.chosen))) {
  // A fresh install: the host creates the nest with its markers.
  mkdirSync(path.join(home, choice.chosen), { recursive: true });
  writeFileSync(
    path.join(home, choice.chosen, ".nest-agents-version"),
    "999\n",
  );
}
reset(choice.chosen);
process.on("SIGTERM", () => process.exit(0));
setInterval(() => {}, 1000);
