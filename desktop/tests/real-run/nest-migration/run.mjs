// Command line for the seeded-HOME proof run of the .buzz to .colony migration.
//
//   COLONY_REAL_RUN=1 node tests/real-run/nest-migration/run.mjs \
//     --app '/path/to/Buzz.app' \
//     --out /Users/mac/worktrees/.lanes/phase2/real-run-20261004/nest-proof-<name> \
//     [--cases owner,crash,both,...] [--profile-dir <signed-in user-data dir>] [--flag env|default]
//
// The app path is a parameter: a packaged Buzz.app (PR build) or Colony.app (release). Nothing here ever opens
// the real home folder: every case builds a throwaway HOME, and the launch is sandboxed against the real
// ~/.buzz and ~/.colony. See README.md in this folder.
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FAIL, NOT_OBSERVED, verdictOf } from "./checks.mjs";
import { CASES, DEFAULT_CASES, runProof } from "./proof.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--"))
      throw new Error(`unexpected argument ${token}`);
    const name = token.slice(2);
    if (["fake-app", "strict"].includes(name)) args[name] = true;
    else args[name] = argv[++index];
  }
  return args;
}

const usage = `usage: node run.mjs --app <Buzz.app|Colony.app> --out <report dir> [--cases ${DEFAULT_CASES.join(",")}]
  [--work <dir>] [--profile-dir <signed-in user-data dir>] [--relay <ws url>] [--flag env|default]
  [--crash-at <n>:<before|after>] [--contract <json override>] [--progress <file>] [--strict]`;

const args = parseArgs(process.argv.slice(2));
if (!args.out || (!args.app && !args["fake-app"])) {
  console.error(usage);
  process.exit(2);
}
if (!args["fake-app"]) {
  if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI)
    throw new Error("COLONY_REAL_RUN=1 required, local only, refuses CI");
  if (process.env.DEBUG || process.env.PWDEBUG)
    throw new Error(
      "Unset DEBUG and PWDEBUG: automation diagnostics can expose input values.",
    );
}
const cases = args.cases ? args.cases.split(",") : DEFAULT_CASES;
for (const id of cases)
  if (!CASES[id])
    throw new Error(`unknown case ${id}; known: ${DEFAULT_CASES.join(", ")}`);

const progress = async (line) => {
  const text = `${new Date().toTimeString().slice(0, 8)} ${line}`;
  console.log(text);
  if (args.progress) await appendFile(args.progress, `${text}\n`);
};

const here = path.dirname(fileURLToPath(import.meta.url));
const { file, data } = await runProof({
  driver: args["fake-app"]
    ? { kind: "fake", script: path.join(here, "fake-app.mjs") }
    : { kind: "packaged", app: path.resolve(args.app) },
  out: path.resolve(args.out),
  cases,
  work: args.work ? path.resolve(args.work) : undefined,
  profileDir: args["profile-dir"]
    ? path.resolve(args["profile-dir"])
    : undefined,
  relayUrl: args.relay,
  flagMode: args.flag ?? "env",
  crashAt: args["crash-at"],
  contract: args.contract
    ? JSON.parse(await readFile(args.contract, "utf8"))
    : undefined,
  onCase: async (result) => {
    // Final 1.0.5 gate: write every case as soon as it ends, so a killed run loses nothing.
    await mkdir(path.resolve(args.out), { recursive: true });
    await writeFile(
      path.join(path.resolve(args.out), `case-${result.id}.json`),
      JSON.stringify(result, null, 1),
    );
    const bad = result.rows.filter((r) => r.status !== "PASS");
    await progress(
      `[${result.id}] ${verdictOf(result.rows)} (${result.rows.length} checks); not PASS: ${bad.map((r) => `${r.id}=${r.status}`).join(", ") || "none"}`,
    );
  },
});
const rows = data.cases.flatMap((c) => c.rows);
const failed = rows.filter((r) => r.status === FAIL).length;
const unseen = rows.filter((r) => r.status === NOT_OBSERVED).length;
await progress(
  `report ${file}: ${rows.length - failed - unseen} PASS, ${failed} FAIL, ${unseen} NOT OBSERVED`,
);
process.exit(failed || (args.strict && unseen) ? 1 : 0);
