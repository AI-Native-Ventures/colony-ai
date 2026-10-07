// Delta gate 2, R4: markers and naming on disk, on the new binary.
//   node r4-scan.mjs --app <Buzz.app> --migrated <d1-narrowed/case-owner.json> --fresh <d1-narrowed/case-empty.json> [--told <first-request.json>]
// Reads the throwaway HOMEs the proof harness left behind (paths come from the host log line "nest-folder: chosen=.colony ... path=").
//   migrated nest: AGENTS.md has exactly one COLONY managed section and no BUZZ marker, the owner notes above and below the section
//                  are byte identical to a freshly built owner fixture, and no file, name or link in ~/.colony says buzz
//   fresh nest:    the same naming scan on a nest the host created from nothing
//   colony CLI:    help and error text of the bundled command line (seven invocations) has no old name
//   what the agent is told (optional): the first model request of the R1a run, with the known internal tool ids listed
// Allowed machine tokens: BUZZ_ variable names and the <buzz-event> tag. Everything else with the old name is a failing hit.
import { execFile, execFileSync } from "node:child_process";
import { lstat, mkdtemp, readFile, readdir, readlink, symlink } from "node:fs/promises";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Rec, progress } from "./ai-lib.mjs";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const APP = path.resolve(arg("app"));
const rec = new Rec("R4");
const here = path.dirname(fileURLToPath(import.meta.url));
const reBuzz = /buzz/iu;
const allowed = (h) => /BUZZ_[A-Z_]+|<buzz-events?[ >]|<\/buzz-events?>/u.test(h) && !/BUZZ MANAGED/u.test(h);

const homeOf = async (caseFile) => {
  const c = JSON.parse(await readFile(caseFile, "utf8"));
  const line = (c.evidence?.hostLogLines ?? []).find((l) => /nest-folder: chosen=\.colony/u.test(l)) ?? "";
  const m = line.match(/ path=(\S+?)\/\.colony/u);
  if (!m) throw new Error(`no .colony path in the host log of ${caseFile}`);
  return m[1];
};

const walkNest = async (home) => {
  const hits = [];
  let files = 0;
  let entries = 0;
  const walk = async (dir, rel, depth) => {
    if (depth > 6) return;
    for (const name of await readdir(dir).catch(() => [])) {
      const full = path.join(dir, name);
      const r = path.join(rel, name);
      entries += 1;
      if (reBuzz.test(name)) hits.push({ kind: "name", where: r, text: name });
      const st = await lstat(full).catch(() => null);
      if (!st) continue;
      if (st.isSymbolicLink()) {
        const target = await readlink(full).catch(() => "");
        if (reBuzz.test(target)) hits.push({ kind: "link", where: r, text: target });
      } else if (st.isDirectory()) {
        if (!/^(models|\.venv|REPOS|archive)/u.test(name)) await walk(full, r, depth + 1);
      } else if (st.size < 400000) {
        files += 1;
        const text = await readFile(full, "utf8").catch(() => "");
        text.split("\n").forEach((line, i) => {
          if (reBuzz.test(line)) hits.push({ kind: "text", where: `${r}:${i + 1}`, text: line.slice(0, 180) });
        });
      }
    }
  };
  await walk(path.join(home, ".colony"), ".colony", 0);
  return { hits, files, entries };
};

const markers = (text) => ({
  colonyBegin: (text.match(/<!--\s*BEGIN\s+COLONY\s+MANAGED/gu) ?? []).length,
  colonyEnd: (text.match(/<!--\s*END\s+COLONY\s+MANAGED/gu) ?? []).length,
  buzzMarkers: (text.match(/<!--\s*(BEGIN|END)\s+BUZZ\s+MANAGED/gu) ?? []).length,
});
const split = (text) => {
  const begin = text.search(/<!--\s*BEGIN\s+\w+\s+MANAGED/u);
  const endMatch = text.match(/<!--\s*END\s+\w+\s+MANAGED\s*-->/u);
  const end = endMatch ? endMatch.index + endMatch[0].length : -1;
  return { above: begin >= 0 ? text.slice(0, begin) : null, below: end >= 0 ? text.slice(end) : null };
};

// ---- migrated nest ----
const migratedHome = await homeOf(arg("migrated"));
const tmp = mkdtempSync(path.join(os.tmpdir(), "colony-r4-fixture-"));
execFileSync("node", [path.join(here, "nest-migration", "fixture.mjs"), "--out", tmp, "--variant", "owner"], { stdio: "ignore" });
const orig = readFileSync(path.join(tmp, "home", ".buzz", "AGENTS.md"), "utf8");
const now = await readFile(path.join(migratedHome, ".colony", "AGENTS.md"), "utf8");
const mk = markers(now);
const a = split(orig);
const b = split(now);
const notesAbove = a.above !== null && a.above === b.above;
const notesBelow = a.below !== null && a.below === b.below;
rec.row(
  "R4-agents-md",
  "Migrated nest: AGENTS.md has exactly one COLONY managed section, zero BUZZ markers, notes above and below byte identical to the owner fixture",
  mk.colonyBegin === 1 && mk.colonyEnd === 1 && mk.buzzMarkers === 0 && !/buzz/iu.test(now) && notesAbove && notesBelow ? "PASS" : "FAIL",
  `COLONY begin ${mk.colonyBegin}, end ${mk.colonyEnd}; BUZZ markers ${mk.buzzMarkers}; the word buzz anywhere in the file: ${/buzz/iu.test(now)}. Notes above the section byte identical: ${notesAbove} (${a.above?.length ?? "?"} bytes). Notes below byte identical: ${notesBelow} (${a.below?.length ?? "?"} bytes). Notes above, quoted: ${JSON.stringify((a.above ?? "").slice(0, 160))}`,
);
const migrated = await walkNest(migratedHome);
const migratedBad = migrated.hits.filter((h) => !allowed(h.text));
rec.row(
  "R4-migrated-tree",
  "Migrated nest: zero hits of the old name (any case) in every file, name and link of ~/.colony",
  migratedBad.length ? "FAIL" : "PASS",
  `${migrated.files} text files and ${migrated.entries} entries scanned (models, REPOS, archive and venv trees skipped, they are the owner's own data). Hits: ${migrated.hits.map((h) => `${h.kind} ${h.where}: ${h.text}`).join(" || ") || "none"}`,
);

// ---- fresh nest ----
const freshHome = await homeOf(arg("fresh"));
const freshAgents = await readFile(path.join(freshHome, ".colony", "AGENTS.md"), "utf8").catch(() => null);
const fm = freshAgents ? markers(freshAgents) : null;
const fresh = await walkNest(freshHome);
const freshBad = fresh.hits.filter((h) => !allowed(h.text));
rec.row(
  "R4-fresh-tree",
  "Fresh nest: AGENTS.md has one COLONY managed section and zero BUZZ markers, and zero hits in every file, name and link of ~/.colony",
  freshBad.length || !fm || fm.colonyBegin !== 1 || fm.colonyEnd !== 1 || fm.buzzMarkers !== 0 ? "FAIL" : "PASS",
  `AGENTS.md: ${fm ? `COLONY begin ${fm.colonyBegin}, end ${fm.colonyEnd}, BUZZ markers ${fm.buzzMarkers}` : "not present"}. ${fresh.files} text files and ${fresh.entries} entries scanned. Hits: ${fresh.hits.map((h) => `${h.kind} ${h.where}: ${h.text}`).join(" || ") || "none"}`,
);

// ---- colony command line ----
const cliDir = await mkdtemp(path.join(os.tmpdir(), "colony-r4-cli-"));
const sidecar = path.join(APP, "Contents", "Resources", "buzz");
const colonyLink = path.join(cliDir, "colony");
await symlink(sidecar, colonyLink).catch(() => undefined);
const cliOut = [];
for (const argv of [["--help"], ["channels", "--help"], ["messages", "--help"], ["messages", "send", "--help"], ["users", "--help"], ["bogus-subcommand"], ["messages", "send"]]) {
  const result = await new Promise((resolve) => {
    execFile(colonyLink, argv, { env: { HOME: freshHome, PATH: process.env.PATH, BUZZ_RELAY_URL: "ws://127.0.0.1:9" }, timeout: 15000, maxBuffer: 1 << 20 }, (error, stdout, stderr) =>
      resolve({ argv, code: error?.code ?? 0, text: `${stdout}\n${stderr}` }),
    );
  });
  const lines = result.text.split("\n");
  const hits = lines.map((l, i) => ({ l, i })).filter(({ l }) => reBuzz.test(l)).map(({ l, i }) => `line ${i + 1}: ${l.trim().slice(0, 160)}`);
  cliOut.push({ argv: argv.join(" "), code: result.code, lines: lines.length, hits, head: lines.slice(0, 2).join(" / ").slice(0, 160) });
}
const cliHits = cliOut.flatMap((c) => c.hits.map((h) => `colony ${c.argv}: ${h}`));
rec.row(
  "R4-colony-cli",
  "colony command line: help and error text has zero hits of the old name",
  cliHits.filter((h) => !allowed(h)).length ? "FAIL" : "PASS",
  `${cliOut.length} invocations: ${cliOut.map((c) => `colony ${c.argv} exit ${c.code}, ${c.lines} lines, ${c.hits.length} hits`).join(" || ")}. Hits: ${cliHits.join(" || ") || "none"}`,
);

// ---- what the agent is told ----
const toldFile = arg("told");
if (toldFile) {
  const text = await readFile(toldFile, "utf8").catch(() => "");
  // Token level: every distinct word that contains the old name, so a long JSON line cannot hide a bad token behind an allowed one.
  const tokens = {};
  for (const m of text.replace(/\\[ntr"]/gu, " ").matchAll(/[\w<\/.-]*buzz[\w>.-]*/giu)) tokens[m[0]] = (tokens[m[0]] ?? 0) + 1;
  const isAllowedToken = (t) => /^BUZZ_[A-Z0-9_]+$/u.test(t) || /^<\/?buzz-events?>?$/u.test(t);
  const isKnownId = (t) => /^buzz-dev-mcp__\w+$/u.test(t);
  const ids = Object.keys(tokens).filter(isKnownId);
  const machine = Object.keys(tokens).filter(isAllowedToken);
  const other = Object.keys(tokens).filter((t) => !isAllowedToken(t) && !isKnownId(t));
  rec.row(
    "R4-agent-told",
    "What the agent is told (first request: system text, tool names and descriptions): old name only in allowed machine tokens and the known internal tool ids",
    text ? (other.length ? "FAIL" : "PASS") : "NOT OBSERVED",
    text ? `${text.length} bytes scanned. Every distinct token with the old name: ${Object.entries(tokens).map(([t, n]) => `${t} x${n}`).join(", ") || "none"}. KNOWN INTERNAL IDENTIFIERS (intentionally unchanged for model compatibility, never shown in the default view): ${ids.join(", ") || "none"}. Allowed machine tokens (BUZZ_ variable names, the event tag): ${machine.join(", ") || "none"}. Any other token: ${other.join(", ") || "none"}` : "First request not captured",
  );
}
rec.notes.endedAt = new Date().toISOString();
rec.notes.homes = { migrated: migratedHome.replace(os.tmpdir(), "<tmp>"), fresh: freshHome.replace(os.tmpdir(), "<tmp>") };
await rec.write();
await progress(`[R4] done, ${rec.rows.length} rows`);
