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
  diffNests,
  isVolatile,
  splitNestPath,
  summarizeDiff,
} from "./diff.mjs";
import { buildFixture } from "./fixture.mjs";
import { buildManifest } from "./manifest.mjs";
import { attachFiles } from "./observe.mjs";
import { simulateMigration } from "./simulate.mjs";

const ROOTS = [".buzz", ".colony", ".colony.staging"];
const contract = defaultContract();
const scratch = [];
after(async () => {
  for (const dir of scratch) await rm(dir, { recursive: true, force: true });
});

/** Build a fixture, take the before manifest, run `act` on the HOME, take the after manifest and diff. */
async function scenario(variant, act) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colony-nest-proof-diff-"));
  scratch.push(dir);
  const fixture = await buildFixture({
    root: path.join(dir, "fixture"),
    variant,
  });
  const REPOS_DIR_FILES = [".buzz/.repos-dir", ".colony/.repos-dir"];
  const before = await attachFiles(
    await buildManifest(fixture.home, ROOTS),
    REPOS_DIR_FILES,
  );
  const result = await act(fixture.home);
  const after = await attachFiles(
    await buildManifest(fixture.home, ROOTS),
    REPOS_DIR_FILES,
  );
  return {
    fixture,
    home: fixture.home,
    before,
    after,
    result,
    diff: diffNests({ before, after, contract }),
  };
}

const migrate = (options) => (home) => simulateMigration(home, options);

test("classification: twelve owned names, the generated skill entries, everything else foreign", () => {
  const kind = (relative) => classifyNestPath(relative, contract);
  for (const name of contract.ownedTopLevel)
    assert.equal(kind(name), "owned", name);
  assert.equal(kind("REPOS/app/src/index.js"), "owned");
  assert.equal(kind("archive/archive.db-wal"), "owned");
  assert.equal(kind(".agents/skills/buzz-cli"), "generated");
  assert.equal(kind(".agents/skills/buzz-cli/SKILL.md"), "generated");
  assert.equal(kind(".claude/skills/buzz-cli"), "generated");
  for (const foreign of [
    ".venv-tts",
    ".venv-chatterbox/bin/say",
    "gate-check.md",
    "probe-note.md",
    ".agents",
    ".agents/skills/colony-product-videos",
    ".claude/skills/colony-product-videos",
    "something-else",
  ])
    assert.equal(kind(foreign), "foreign", foreign);
  assert.equal(kind(""), "root");
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
  const { diff, fixture } = await scenario("owner", migrate());
  assert.equal(diff.foreign.total > 20, true);
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
  ])
    assert.deepEqual(diff.owned[bucket], [], bucket);
  assert.deepEqual(
    diff.owned.rewrittenLinks.map((link) => link.path),
    [".colony/REPOS/kit-absolute"],
  );
  assert.deepEqual(
    diff.generated.removed.sort(),
    [...contract.generatedSkillLinks].map((l) => `.buzz/${l}`).sort(),
  );
  assert.equal(diff.generated.regenerated.length, 4);
  assert.deepEqual(diff.addedToOld, []);
  assert.deepEqual(diff.unexpectedInNew, []);
  assert.equal(
    diff.oldRoot.after,
    true,
    "the old folder stays because it holds foreign entries",
  );
  assert.match(
    summarizeDiff(diff),
    /foreign \d+\/\d+ identical, owned \d+\/\d+ moved clean, 0 left/u,
  );
  assert.equal(fixture.variant, "owner");
});

test("falsifiable: foreign bytes changed, foreign mode changed, foreign entry deleted are each reported", async () => {
  const bytes = await scenario("owner", async (home) => {
    await simulateMigration(home);
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
    await simulateMigration(home);
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
    await simulateMigration(home);
    await rm(path.join(home, ".buzz/gate-note.md"));
  });
  assert.deepEqual(gone.diff.foreign.missing, [".buzz/gate-note.md"]);
});

test("falsifiable: a foreign file rewritten with identical bytes is still reported (inode and mtime)", async () => {
  const { diff } = await scenario("owner", async (home) => {
    await simulateMigration(home);
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
    await simulateMigration(home);
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
    await simulateMigration(home);
    await rm(path.join(home, ".colony/OUTBOX/DAY1_VIDEO_PACK.md"));
  });
  assert.deepEqual(lost.diff.owned.lost, [".buzz/OUTBOX/DAY1_VIDEO_PACK.md"]);
  const altered = await scenario("owner", async (home) => {
    await simulateMigration(home);
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
    await simulateMigration(home);
    await mkdir(path.join(home, ".buzz/GUIDES"), { recursive: true });
  });
  assert.ok(
    diff.owned.altered.some(
      (item) => item.differences[0].field === "duplicated",
    ),
  );
});

test("entries left in place (skip or failure) are listed, with nothing lost", async () => {
  const { diff } = await scenario(
    "owner",
    migrate({ skip: ["REPOS", "models"] }),
  );
  assert.ok(diff.owned.leftInPlace.includes(".buzz/REPOS"));
  assert.ok(
    diff.owned.leftInPlace.includes(".buzz/models/pocket-tts/anna.wav"),
  );
  assert.deepEqual(diff.owned.lost, []);
  assert.deepEqual(diff.owned.altered, []);
  assert.deepEqual(diff.foreign.differences, []);
});

test("a crash after three entries leaves each entry in exactly one place and nothing lost", async () => {
  const { diff, result } = await scenario("owner", migrate({ stopAfter: 3 }));
  assert.equal(result.moved.length, 3);
  assert.equal(diff.owned.movedClean.length > 0, true);
  assert.equal(diff.owned.leftInPlace.length > 0, true);
  assert.deepEqual(diff.owned.lost, []);
  assert.deepEqual(diff.owned.altered, []);
  assert.deepEqual(diff.owned.copied, []);
  assert.equal(
    diff.owned.movedClean.length + diff.owned.leftInPlace.length,
    diff.owned.total,
  );
});

test("conflicts: entries the new folder already has are kept, the old source stays, and overwriting is reported", async () => {
  const kept = await scenario("both-colony-has-nest", migrate());
  const names = kept.diff.owned.conflicts.map((item) => item.path).sort();
  assert.ok(names.includes(".buzz/AGENTS.md"));
  assert.ok(names.includes(".buzz/GUIDES"));
  assert.ok(names.includes(".buzz/REPOS"));
  for (const item of kept.diff.owned.conflicts) {
    assert.equal(item.sourceIntact, true, item.path);
    assert.equal(item.destinationKept, true, item.path);
  }
  assert.deepEqual(kept.diff.newSideExisting.differences, []);
  assert.deepEqual(kept.diff.newSideExisting.missing, []);
  // Non-conflicting entries still moved.
  assert.ok(
    kept.diff.owned.movedClean.includes(".colony/models/pocket-tts/anna.wav"),
  );

  const overwritten = await scenario("both-colony-has-nest", async (home) => {
    await simulateMigration(home);
    await rename(
      path.join(home, ".buzz/AGENTS.md"),
      path.join(home, ".colony/AGENTS.md"),
    );
  });
  assert.ok(
    overwritten.diff.newSideExisting.differences.some(
      (item) => item.path === ".colony/AGENTS.md",
    ),
    "replacing the new folder's own AGENTS.md must be reported",
  );
  assert.ok(
    overwritten.diff.owned.conflicts.some(
      (item) => item.path === ".buzz/AGENTS.md" && !item.sourceIntact,
    ),
  );
});

test("the old folder gaining an entry, and the new folder holding a foreign-looking entry, are reported", async () => {
  const { diff } = await scenario("owner", async (home) => {
    await simulateMigration(home);
    await writeFile(path.join(home, ".buzz/late-note.md"), "x");
    await writeFile(path.join(home, ".colony/stray-tool-output.txt"), "x");
  });
  assert.deepEqual(diff.addedToOld, [".buzz/late-note.md"]);
  assert.deepEqual(diff.unexpectedInNew, [".colony/stray-tool-output.txt"]);
});

test("links: an absolute link into the old nest that was not rewritten is reported as unresolved", async () => {
  const { diff } = await scenario("owner", async (home) => {
    await simulateMigration(home);
    const link = path.join(home, ".colony/REPOS/kit-absolute");
    await rm(link);
    await symlink(`${home}/.buzz/REPOS/colony-social-kit`, link);
  });
  assert.ok(
    diff.owned.unresolvedLinks.some(
      (item) => item.path === ".colony/REPOS/kit-absolute",
    ),
  );
});

test("links: relative, outside and dangling links keep their exact text and are not reported as rewritten", async () => {
  const { diff, after } = await scenario("owner", migrate());
  const link = (name) =>
    after.entries.find((entry) => entry.path === `.colony/REPOS/${name}`);
  assert.equal(link("kit-latest").target, "colony-social-kit");
  assert.equal(link("kit-latest").resolves, true);
  assert.equal(link("old-checkout").target, "../nowhere/old-checkout");
  assert.equal(link("old-checkout").resolves, false);
  assert.match(link("shared-assets").target, /\/external\/shared-assets$/u);
  assert.equal(link("shared-assets").resolves, true);
  assert.equal(diff.owned.rewrittenLinks.length, 1);
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
    await simulateMigration(home);
    await writeFile(
      path.join(home, ".colony/archive/archive.db-wal"),
      "rewritten by the host",
    );
  });
  assert.deepEqual(diff.owned.altered, []);
});

test(".repos-dir rewritten from the old nest to the new one is expected; any other change to it is reported", async () => {
  const ok = await scenario("repos-dir-inside", migrate());
  assert.deepEqual(ok.diff.owned.altered, []);
  assert.deepEqual(
    ok.diff.owned.rewrittenFiles.map((item) => item.path),
    [".colony/.repos-dir"],
  );
  assert.equal(
    ok.diff.owned.rewrittenFiles[0].after,
    `${ok.home}/.colony/REPOS`,
  );
  const wrong = await scenario("repos-dir-inside", async (home) => {
    await simulateMigration(home);
    await writeFile(path.join(home, ".colony/.repos-dir"), "/somewhere/else\n");
  });
  assert.ok(
    wrong.diff.owned.altered.some((item) => item.path === ".colony/.repos-dir"),
  );
  const untouchedOutside = await scenario("repos-symlinked", migrate());
  assert.deepEqual(untouchedOutside.diff.owned.rewrittenFiles, []);
  assert.deepEqual(untouchedOutside.diff.owned.altered, []);
});
