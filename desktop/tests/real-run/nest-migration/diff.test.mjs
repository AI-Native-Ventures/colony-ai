import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { classifyNestPath, defaultContract } from "./contract.mjs";
import {
  compareStable,
  diffNests,
  isVolatile,
  splitNestPath,
  summarizeDiff,
} from "./diff.mjs";
import { buildFixture } from "./fixture.mjs";
import { buildManifest } from "./manifest.mjs";
import { simulateMigration } from "./simulate.mjs";

const ROOTS = [".buzz", ".colony", ".colony.staging"];
const contract = defaultContract();
const scratch = [];
after(async () => {
  for (const dir of scratch) await rm(dir, { recursive: true, force: true });
});

const appDataOf = (home) =>
  path.join(home, "Library", "Application Support", "xyz.block.buzz.app");

/** Run the simulated migration on `home` with the given options. */
const migrate = (options) => (home) =>
  simulateMigration(home, { appDataDir: appDataOf(home), ...options });

class Crash extends Error {}
const die = () => {
  throw new Crash("crash seam");
};

/** Build a fixture, take the before manifest, run `act` on the HOME, take the after manifest and diff. */
async function scenario(variant, act) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colony-nest-proof-diff-"));
  scratch.push(dir);
  const fixture = await buildFixture({
    root: path.join(dir, "fixture"),
    variant,
  });
  const before = await buildManifest(fixture.home, ROOTS);
  let result;
  try {
    result = await act(fixture.home);
  } catch (error) {
    if (!(error instanceof Crash)) throw error;
    result = { crashed: true };
  }
  const after = await buildManifest(fixture.home, ROOTS);
  return {
    fixture,
    home: fixture.home,
    before,
    after,
    result,
    diff: diffNests({ before, after, contract }),
  };
}

test("classification: eleven owned names, .scratch and the old generated skill entries are foreign, remove policy marks the generated ones", () => {
  const kind = (relative, c = contract) => classifyNestPath(relative, c);
  assert.equal(contract.ownedTopLevel.length, 11);
  for (const name of contract.ownedTopLevel)
    assert.equal(kind(name), "owned", name);
  assert.equal(kind("REPOS/app/src/index.js"), "owned");
  assert.equal(kind("archive/archive.db-wal"), "owned");
  for (const foreign of [
    ".scratch",
    ".scratch/notes.txt",
    ".venv-tts",
    ".venv-chatterbox/bin/say",
    "gate-check.md",
    ".agents",
    ".agents/skills/colony-product-videos",
    ".agents/skills/buzz-cli",
    ".claude/skills/buzz-cli",
    "something-else",
  ])
    assert.equal(kind(foreign), "foreign", foreign);
  const remove = { ...contract, generatedPolicy: "remove" };
  assert.equal(kind(".agents/skills/buzz-cli", remove), "generated");
  assert.equal(kind(".claude/skills/buzz-cli", remove), "generated");
  assert.equal(kind(".agents/skills/colony-product-videos", remove), "foreign");
  assert.equal(kind("", contract), "root");
});

test("splitNestPath and isVolatile", () => {
  assert.deepEqual(splitNestPath(".buzz/REPOS/app", contract), {
    nest: ".buzz",
    rel: "REPOS/app",
  });
  assert.deepEqual(splitNestPath(".colony", contract), {
    nest: ".colony",
    rel: "",
  });
  assert.equal(splitNestPath(".colony.staging/journal", contract), null);
  assert.equal(splitNestPath(".buzzard/x", contract), null);
  assert.equal(isVolatile("archive/archive.db-wal"), true);
  assert.equal(isVolatile("archives"), false);
});

test("a correct migration diffs clean: foreign identical, every owned entry moved by rename, links meaningful", async () => {
  const { diff, result } = await scenario("owner", migrate());
  assert.equal(result.outcome, "migrated");
  assert.equal(diff.foreign.total > 40, true);
  assert.equal(diff.foreign.identical, diff.foreign.total);
  assert.deepEqual(diff.foreign.differences, []);
  assert.deepEqual(diff.foreign.missing, []);
  assert.equal(diff.owned.total > 40, true);
  assert.equal(diff.owned.movedClean.length, diff.owned.total);
  for (const bucket of [
    "leftInPlace",
    "conflicts",
    "lost",
    "altered",
    "copied",
    "unresolvedLinks",
    "staged",
  ])
    assert.deepEqual(diff.owned[bucket], [], bucket);
  assert.deepEqual(diff.addedToOld, []);
  assert.deepEqual(diff.unexpectedInNew, []);
  assert.equal(diff.stagingLeft, false);
  assert.equal(
    diff.oldRoot.after,
    true,
    "the old folder stays because it holds foreign entries",
  );
  assert.match(
    summarizeDiff(diff),
    /foreign \d+\/\d+ identical, owned \d+\/\d+ moved clean, 0 left/u,
  );
});

test("falsifiable: foreign bytes changed, foreign mode changed, foreign entry deleted, .scratch moved are each reported", async () => {
  const bytes = await scenario("owner", async (home) => {
    await migrate()(home);
    await writeFile(
      path.join(home, ".buzz/.venv-tts/bin/say"),
      "#!/bin/sh\necho tampered\n",
    );
  });
  assert.ok(
    bytes.diff.foreign.differences.some(
      (item) =>
        item.path === ".buzz/.venv-tts/bin/say" &&
        item.differences.some((d) => d.field === "sha256"),
    ),
  );
  const mode = await scenario("owner", async (home) => {
    await migrate()(home);
    await chmod(path.join(home, ".buzz/.venv-chatterbox/pyvenv.cfg"), 0o600);
  });
  assert.ok(
    mode.diff.foreign.differences.some(
      (item) =>
        item.path.endsWith("pyvenv.cfg") &&
        item.differences.some((d) => d.field === "mode"),
    ),
  );
  const gone = await scenario("owner", async (home) => {
    await migrate()(home);
    await rm(path.join(home, ".buzz/gate-note.md"));
  });
  assert.deepEqual(gone.diff.foreign.missing, [".buzz/gate-note.md"]);
  const scratch = await scenario("owner", async (home) => {
    await migrate()(home);
    await rename(
      path.join(home, ".buzz/.scratch"),
      path.join(home, ".colony/.scratch"),
    );
  });
  assert.ok(
    scratch.diff.foreign.missing.includes(".buzz/.scratch"),
    "moving a foreign folder must be reported",
  );
});

test("falsifiable: deleting an old generated skill entry is reported as a foreign change", async () => {
  const { diff } = await scenario("owner", async (home) => {
    await migrate()(home);
    await rm(path.join(home, ".buzz/.claude/skills/buzz-cli"));
  });
  assert.deepEqual(diff.foreign.missing, [".buzz/.claude/skills/buzz-cli"]);
});

test("falsifiable: a foreign file rewritten with identical bytes is still reported (inode and mtime)", async () => {
  const { diff } = await scenario("owner", async (home) => {
    await migrate()(home);
    const file = path.join(home, ".buzz/gate-check.md");
    const bytes = await readFile(file);
    await rm(file);
    await writeFile(file, bytes);
    await chmod(file, 0o644);
  });
  const item = diff.foreign.differences.find(
    (entry) => entry.path === ".buzz/gate-check.md",
  );
  assert.ok(item, "an untouched file would not have a new inode");
  assert.ok(item.differences.some((d) => d.field === "ino"));
});

test("falsifiable: copy-then-delete instead of rename is reported as copied", async () => {
  const { diff } = await scenario("owner", async (home) => {
    await migrate()(home);
    const file = path.join(home, ".colony/REPOS/colony-social-kit/README.md");
    const bytes = await readFile(file);
    await rm(file);
    await writeFile(file, bytes);
    await chmod(file, 0o644);
  });
  assert.deepEqual(diff.owned.copied, [
    ".colony/REPOS/colony-social-kit/README.md",
  ]);
});

test("falsifiable: an owned entry deleted, or its bytes altered, is reported", async () => {
  const lost = await scenario("owner", async (home) => {
    await migrate()(home);
    await rm(path.join(home, ".colony/OUTBOX/DAY1_VIDEO_PACK.md"));
  });
  assert.deepEqual(lost.diff.owned.lost, [".buzz/OUTBOX/DAY1_VIDEO_PACK.md"]);
  const altered = await scenario("owner", async (home) => {
    await migrate()(home);
    await writeFile(path.join(home, ".colony/AGENTS.md"), "# replaced\n");
  });
  assert.ok(
    altered.diff.owned.altered.some(
      (item) =>
        item.path === ".colony/AGENTS.md" &&
        item.differences.some((d) => d.field === "sha256"),
    ),
  );
});

test("falsifiable: an entry present at both places is reported as a copy that was not cleaned up", async () => {
  const { diff } = await scenario("owner", async (home) => {
    await migrate()(home);
    await mkdir(path.join(home, ".buzz/GUIDES"), { recursive: true });
  });
  assert.ok(
    diff.owned.altered.some(
      (item) => item.differences[0].field === "duplicated",
    ),
  );
});

test("falsifiable: a link or pointer file rewritten by the migration is reported (Colony holds entries back, it never rewrites)", async () => {
  const link = await scenario("owner", async (home) => {
    await migrate()(home);
    const target = path.join(home, ".colony/REPOS/kit-latest");
    await rm(target);
    await symlink("colony-social-kit-day-one-film", target);
  });
  assert.ok(
    link.diff.owned.altered.some(
      (item) =>
        item.path === ".colony/REPOS/kit-latest" &&
        item.differences.some((d) => d.field === "target"),
    ),
  );
  const pointer = await scenario("repos-symlinked", async (home) => {
    await migrate()(home);
    await writeFile(path.join(home, ".colony/.repos-dir"), "/somewhere/else\n");
  });
  assert.ok(
    pointer.diff.owned.altered.some(
      (item) => item.path === ".colony/.repos-dir",
    ),
  );
});

test("entries held back stay whole in the old folder while everything else moves (REPOS with an absolute link into the nest)", async () => {
  const { diff, result } = await scenario("repos-link-into-nest", migrate());
  assert.equal(result.outcome, "migrated");
  assert.deepEqual(
    result.skipped.map(([name]) => name),
    ["REPOS"],
  );
  assert.ok(diff.owned.leftInPlace.includes(".buzz/REPOS"));
  assert.ok(diff.owned.leftInPlace.includes(".buzz/REPOS/kit-absolute"));
  assert.deepEqual(
    diff.owned.leftInPlace.filter((p) => !p.startsWith(".buzz/REPOS")),
    [],
  );
  assert.ok(
    diff.owned.movedClean.includes(".colony/models/pocket-tts/anna.wav"),
  );
  assert.deepEqual(diff.owned.lost, []);
  assert.deepEqual(diff.owned.altered, []);
  assert.deepEqual(diff.foreign.differences, []);
});

test("a hold on a small entry (.repos-dir inside the old nest) aborts the whole migration: nothing moves", async () => {
  const { diff, result } = await scenario("repos-dir-inside", migrate());
  assert.equal(result.outcome, "aborted");
  assert.match(result.logLine, /detail=repos-dir-inside-old-folder/u);
  assert.equal(diff.owned.movedClean.length, 0);
  assert.equal(diff.owned.staged.length, 0);
  assert.equal(diff.owned.leftInPlace.length, diff.owned.total);
  assert.equal(diff.stagingLeft, false);
});

test("a crash during staging leaves each entry in exactly one place (old or staging) with nothing lost, and a resume completes", async () => {
  const crashed = await scenario(
    "owner",
    migrate({ crashAt: { n: 5, before: false }, die }),
  );
  assert.equal(crashed.result.crashed, true);
  const d = crashed.diff;
  assert.equal(d.stagingLeft, true);
  assert.equal(d.owned.staged.length > 0, true);
  assert.equal(d.owned.leftInPlace.length > 0, true);
  assert.equal(
    d.owned.movedClean.length,
    0,
    "nothing is published before the run completes",
  );
  for (const bucket of ["lost", "altered", "copied", "conflicts"])
    assert.deepEqual(d.owned[bucket], [], bucket);
  assert.equal(
    d.owned.staged.length + d.owned.leftInPlace.length,
    d.owned.total,
  );
  assert.deepEqual(d.foreign.differences, []);
  // Resume as the next launch would.
  const resumed = await simulateMigration(crashed.home, {
    appDataDir: appDataOf(crashed.home),
  });
  assert.equal(resumed.outcome, "migrated");
  const after = await buildManifest(crashed.home, ROOTS);
  const done = diffNests({ before: crashed.before, after, contract });
  assert.equal(done.owned.movedClean.length, done.owned.total);
  assert.equal(done.stagingLeft, false);
  assert.deepEqual(done.owned.copied, []);
});

test("conflicts: entries the new folder already has are kept, an empty placeholder is replaced, overwriting is reported", async () => {
  const kept = await scenario("both-colony-has-nest", migrate());
  assert.equal(kept.result.outcome, "migrated");
  const names = kept.diff.owned.conflicts.map((item) => item.path).sort();
  assert.deepEqual(names, [
    ".buzz/.nest-agents-version",
    ".buzz/AGENTS.md",
    ".buzz/GUIDES",
  ]);
  for (const item of kept.diff.owned.conflicts) {
    assert.equal(item.sourceIntact, true, item.path);
    assert.equal(item.destinationKept, true, item.path);
  }
  assert.deepEqual(kept.diff.newSideExisting.differences, []);
  assert.deepEqual(kept.diff.newSideExisting.missing, []);
  // The empty REPOS and PLANS placeholders in ~/.colony were replaced by the real folders.
  assert.ok(
    kept.diff.owned.movedClean.includes(
      ".colony/REPOS/colony-social-kit/README.md",
    ),
  );
  assert.ok(
    kept.diff.owned.movedClean.includes(".colony/models/pocket-tts/anna.wav"),
  );
  assert.deepEqual(kept.diff.owned.lost, []);
  assert.deepEqual(kept.diff.owned.leftInPlace, []);

  const overwritten = await scenario("both-colony-has-nest", async (home) => {
    await migrate()(home);
    await rm(path.join(home, ".colony/AGENTS.md"));
    await rename(
      path.join(home, ".buzz/AGENTS.md"),
      path.join(home, ".colony/AGENTS.md"),
    );
  });
  assert.ok(
    overwritten.diff.newSideExisting.differences.some(
      (item) => item.path === ".colony/AGENTS.md",
    ),
  );
  assert.ok(
    overwritten.diff.owned.conflicts.some(
      (item) => item.path === ".buzz/AGENTS.md" && !item.sourceIntact,
    ),
  );
});

test("an unrelated ~/.colony is merged into without touching its own file", async () => {
  const { diff, result } = await scenario("both-unrelated-colony", migrate());
  assert.equal(result.outcome, "migrated");
  assert.deepEqual(diff.newSideExisting.differences, []);
  assert.equal(diff.owned.movedClean.length, diff.owned.total);
});

test("the old folder gaining an entry, and the new folder holding a foreign-looking entry, are reported", async () => {
  const { diff } = await scenario("owner", async (home) => {
    await migrate()(home);
    await writeFile(path.join(home, ".buzz/late-note.md"), "x");
    await writeFile(path.join(home, ".colony/stray-tool-output.txt"), "x");
  });
  assert.deepEqual(diff.addedToOld, [".buzz/late-note.md"]);
  assert.deepEqual(diff.unexpectedInNew, [".colony/stray-tool-output.txt"]);
});

test("links: a moved link that resolved before and dangles after is reported", async () => {
  const { diff } = await scenario("owner", async (home) => {
    await migrate()(home);
    const link = path.join(home, ".colony/REPOS/kit-latest");
    await rm(link);
    await symlink("../../.buzz/nowhere", link);
  });
  assert.ok(
    diff.owned.unresolvedLinks.some(
      (item) => item.path === ".colony/REPOS/kit-latest",
    ),
  );
});

test("links: relative and outside links keep their exact text and resolve after the move", async () => {
  const { diff, after } = await scenario("owner", migrate());
  const link = (name) =>
    after.entries.find((entry) => entry.path === `.colony/REPOS/${name}`);
  assert.equal(link("kit-latest").target, "colony-social-kit");
  assert.equal(link("kit-latest").resolves, true);
  assert.match(link("shared-assets").target, /\/external\/shared-assets$/u);
  assert.equal(link("shared-assets").resolves, true);
  assert.deepEqual(diff.owned.altered, []);
});

test("a symlinked REPOS moves as a link with the same target", async () => {
  const { diff, after, fixture } = await scenario("repos-symlinked", migrate());
  const repos = after.entries.find((entry) => entry.path === ".colony/REPOS");
  assert.equal(repos.type, "symlink");
  assert.equal(repos.target, `${fixture.home}/external/repos-target`);
  assert.equal(diff.owned.movedClean.includes(".colony/REPOS"), true);
  assert.deepEqual(diff.owned.altered, []);
  assert.deepEqual(diff.owned.copied, []);
});

test("colony-only: nothing created in the old folder, the new folder is unchanged", async () => {
  const { diff } = await scenario("colony-only", async () => undefined);
  assert.equal(diff.oldRoot.before, false);
  assert.equal(diff.oldRoot.after, false);
  assert.equal(diff.newSideExisting.total > 3, true);
  assert.deepEqual(diff.newSideExisting.differences, []);
  assert.deepEqual(diff.addedToOld, []);
});

test("archive entries are volatile: the host rewrites them, so only existence is compared", async () => {
  const { diff } = await scenario("owner", async (home) => {
    await migrate()(home);
    await writeFile(
      path.join(home, ".colony/archive/archive.db-wal"),
      "rewritten by the host",
    );
  });
  assert.deepEqual(diff.owned.altered, []);
});

test("compareStable: identical trees pass, an added, removed or changed entry is reported, archive compared by existence", async () => {
  const { before } = await scenario("colony-only", async () => undefined);
  assert.deepEqual(compareStable(before, before, contract), {
    added: [],
    removed: [],
    changed: [],
  });
  const trimmed = { ...before, entries: before.entries.slice(1) };
  assert.equal(compareStable(before, trimmed, contract).removed.length, 1);
  assert.equal(compareStable(trimmed, before, contract).added.length, 1);
  const fileIndex = before.entries.findIndex((entry) => entry.type === "file");
  const changed = {
    ...before,
    entries: before.entries.map((entry, index) =>
      index === fileIndex ? { ...entry, sha256: "0".repeat(64) } : entry,
    ),
  };
  const result = compareStable(before, changed, contract);
  assert.equal(result.removed.length + result.added.length, 0);
  assert.equal(result.changed.length, 1);
  assert.equal(result.changed[0].differences[0].field, "sha256");
});

test("reset pruning: harness folders that only held generated entries may vanish, one that held a foreign skill may not", async () => {
  const remove = { ...contract, generatedPolicy: "remove" };
  assert.equal(classifyNestPath(".codex", remove), "generated-parent");
  assert.equal(classifyNestPath(".codex/skills", remove), "generated-parent");
  assert.equal(classifyNestPath(".codex", contract), "foreign");
  const { before, after: untouched } = await scenario(
    "owner",
    async () => undefined,
  );
  const prune = async (...paths) => {
    const entries = untouched.entries.filter(
      (entry) =>
        !paths.some(
          (p) =>
            entry.path === `.buzz/${p}` || entry.path.startsWith(`.buzz/${p}/`),
        ),
    );
    return diffNests({
      before,
      after: { ...untouched, entries },
      contract: remove,
    });
  };
  const ok = await prune(
    ".codex",
    ".goose",
    ".agents/skills/buzz-cli",
    ".claude/skills/buzz-cli",
  );
  assert.deepEqual(ok.foreign.missing, []);
  const bad = await prune(".claude/skills");
  assert.ok(
    bad.foreign.missing.includes(".buzz/.claude/skills/colony-product-videos"),
    "the foreign skill link under a pruned parent must be reported",
  );
});
