// Fake app used ONLY to prove this harness end to end (proof.test.mjs). It plays the host's part with the same
// observable contract as the product: reads HOME, runs the simulated migration before choosing the nest folder
// (kill switch, crash seam, running agents recognised by the BUZZ_MANAGED_AGENT marker, a pending reset),
// logs the migration outcome and the folder choice in the host's formats, provisions the chosen folder and
// performs the boot reset. FAKE_BREAK makes it misbehave in one named way so the tests can show the runner
// turns each defect into a FAIL. It is not the product.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { defaultContract } from "./contract.mjs";
import {
  provisionSkill,
  resolveReposAtBoot,
  simulateMigration,
} from "./simulate.mjs";

const contract = defaultContract();
const broken = process.env.FAKE_BREAK ?? "";
const home = process.env.HOME;
const userData = process.env.COLONY_ELECTRON_USER_DATA;
const logFile = process.env.COLONY_NATIVE_HOST_LOG;
const flagValue = process.env[contract.env.flag];
const enabled = broken === "ignore-flag" || flagValue === contract.env.flagOn;
const crashRaw = process.env[contract.env.crashAt];
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
const holdsNestMarker = (folder) =>
  [".nest-agents-version", "AGENTS.md"].some((name) =>
    present(path.join(folder, name)),
  );
const holdsOwned = (folder) =>
  contract.ownedTopLevel.some((name) => present(path.join(folder, name)));

const identifier = `xyz.block.buzz.app.electron.${createHash("sha256").update(userData).digest("hex").slice(0, 16)}`;
const appData = path.join(home, "Library", "Application Support", identifier);
const sentinel = path.join(
  path.dirname(appData),
  `.${identifier}.reset-pending`,
);

function hasMarker(pid) {
  const marker = `${contract.agentMarkerEnv}=${identifier}`;
  try {
    if (existsSync(`/proc/${pid}/environ`))
      return readFileSync(`/proc/${pid}/environ`, "utf8")
        .split("\0")
        .includes(marker);
    return execFileSync("ps", ["eww", "-p", String(pid)], {
      encoding: "utf8",
    }).includes(marker);
  } catch {
    return false;
  }
}

function liveAgentPids() {
  if (broken === "ignore-agent") return [];
  const dir = path.join(appData, "agents", "agent-pids");
  if (!existsSync(dir)) return [];
  const pids = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".pid"))) {
    const pid = Number(readFileSync(path.join(dir, name), "utf8").trim());
    try {
      process.kill(pid, 0);
    } catch {
      continue;
    }
    if (hasMarker(pid)) pids.push(pid);
  }
  return pids;
}

function parseCrash(raw) {
  const match = /^(\d+):(before|after)$/u.exec((raw ?? "").trim());
  return match ? { n: Number(match[1]), before: match[2] === "before" } : null;
}

async function migrate() {
  if (existsSync(sentinel)) {
    log(`${contract.migrationLogPrefix} skipped: a reset is pending`);
    return;
  }
  const journalFile = path.join(appData, contract.stateDir, "journal.json");
  if (!present(oldRoot) && !present(journalFile)) return;
  const report = await simulateMigration(home, {
    contract,
    appDataDir: appData,
    enabled,
    liveAgentPids: liveAgentPids(),
    crashAt: parseCrash(crashRaw),
    die: () => {
      log(`${contract.migrationLogPrefix} crash seam: ending the process`);
      process.exit(contract.env.crashExitCode);
    },
  });
  log(report.logLine);
  if (broken === "copy") {
    const file = path.join(newRoot, "OUTBOX", "DAY1_VIDEO_PACK.md");
    if (present(file)) {
      // A copy-then-delete migration: the bytes come back, the inode does not.
      const bytes = readFileSync(file);
      rmSync(file);
      writeFileSync(file, bytes);
    }
  }
  if (broken === "touch-foreign") {
    const file = path.join(oldRoot, "gate-note.md");
    if (present(file)) writeFileSync(file, readFileSync(file));
  }
  if (
    broken === "overwrite" &&
    present(path.join(newRoot, ".nest-agents-version"))
  )
    writeFileSync(
      path.join(newRoot, ".nest-agents-version"),
      "overwritten by the migration\n",
    );
  if (broken === "delete-owned")
    rmSync(path.join(newRoot, "RESEARCH", "TELEMETRY_TEARDOWN.md"), {
      force: true,
    });
  if (broken === "no-journal") rmSync(journalFile, { force: true });
  if (
    broken === "move-scratch" &&
    present(path.join(oldRoot, ".scratch")) &&
    present(newRoot)
  )
    renameSync(path.join(oldRoot, ".scratch"), path.join(newRoot, ".scratch"));
}

function choose() {
  if (holdsNestMarker(newRoot))
    return {
      chosen: contract.newNest,
      reason: present(oldRoot) ? "both-colony-has-nest" : "colony-folder-only",
    };
  if (holdsOwned(oldRoot))
    return {
      chosen: contract.oldNest,
      reason: present(newRoot) ? "both-legacy-kept" : "legacy-folder-kept",
    };
  return {
    chosen: contract.newNest,
    reason: present(newRoot) ? "colony-folder-only" : "fresh-install",
  };
}

/** NEST_AGENTS_VERSION of the host (nest.rs): a stamp below it makes the host refresh AGENTS.md. */
const HOST_AGENTS_VERSION = 7;

/**
 * What the host's version refresh does to a moved AGENTS.md: the legacy markers of the managed section become the
 * Colony markers in place, the owner's text and the section body are kept, and the stamp is written. (The real
 * refresh also replaces the static text above the section; this stand-in leaves it, which no check reads.)
 */
function refreshAgentsMd(folder) {
  const stampFile = path.join(folder, ".nest-agents-version");
  const agentsFile = path.join(folder, "AGENTS.md");
  if (!present(stampFile) || !present(agentsFile)) return;
  const stamp = Number.parseInt(readFileSync(stampFile, "utf8"), 10);
  if (!(stamp < HOST_AGENTS_VERSION)) return;
  const text = readFileSync(agentsFile, "utf8")
    .replace(
      /^<!-- BEGIN BUZZ MANAGED[^\n]*$/m,
      "<!-- BEGIN COLONY MANAGED - regenerated automatically, do not edit below -->",
    )
    .replace(/^<!-- END BUZZ MANAGED -->/m, "<!-- END COLONY MANAGED -->");
  writeFileSync(agentsFile, text);
  writeFileSync(stampFile, `${HOST_AGENTS_VERSION}\n`);
}

/** What ensure_nest does for the chosen folder: markers on a new folder, the refresh of an old one, the skill the new folder owns. */
async function provision(chosen) {
  const folder = path.join(home, chosen);
  if (chosen === contract.oldNest) return;
  if (!present(folder)) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, ".nest-agents-version"), "999\n");
  }
  refreshAgentsMd(folder);
  await provisionSkill(folder);
  await resolveReposAtBoot(folder);
}

/** Reset: remove exactly the owned entries and generated skills of the chosen folder, then the folder if empty. */
function reset(chosen) {
  if (!existsSync(sentinel)) return;
  const folder = path.join(home, chosen);
  for (const name of contract.ownedTopLevel)
    rmSync(path.join(folder, name), { recursive: true, force: true });
  for (const dir of contract.sharedHarnessDirs) {
    for (const skill of ["buzz-cli", "colony-cli"]) {
      const target = path.join(folder, dir, "skills", skill);
      if (!present(target)) continue;
      rmSync(target, { recursive: true, force: true });
      for (const parent of [
        path.join(folder, dir, "skills"),
        path.join(folder, dir),
      ]) {
        try {
          rmdirSync(parent);
        } catch {
          break;
        }
      }
    }
  }
  if (broken === "reset-wipes-all")
    rmSync(path.join(folder, ".venv-tts"), { recursive: true, force: true });
  try {
    rmdirSync(folder);
  } catch {
    /* foreign entries remain */
  }
  rmSync(sentinel, { force: true });
  if (broken === "reset-never-completes")
    log(
      "buzz-desktop reset: verification failed (keychain_wiped=true, app_data_gone=true, legacy_gone=true, nest_gone=false)",
    );
  else log("buzz-desktop reset: completed");
}

await migrate();
const choice = choose();
await provision(choice.chosen);
log(
  `${contract.nestFolderLogPrefix} chosen=${choice.chosen} reason=${choice.reason} path=${path.join(home, choice.chosen)}`,
);
reset(choice.chosen);
process.on("SIGTERM", () => process.exit(0));
setInterval(() => {}, 1000);
