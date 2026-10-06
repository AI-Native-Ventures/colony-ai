import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { promisify } from "node:util";
import { OLD_NEST, OWNED_TOP_LEVEL } from "./contract.mjs";
import {
  FIXTURE_MARKER,
  VARIANTS,
  assertThrowawayRoot,
  buildFixture,
  syntheticBytes,
} from "./fixture.mjs";
import { readDatabase } from "./sqlite.mjs";

const run = promisify(execFile);
const scratch = [];
const fresh = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colony-nest-proof-test-"));
  scratch.push(dir);
  return path.join(dir, "fixture");
};
after(async () => {
  for (const dir of scratch) await rm(dir, { recursive: true, force: true });
});

const names = async (directory) => (await readdir(directory)).sort();
const kind = async (file) => {
  const stats = await lstat(file);
  return stats.isSymbolicLink()
    ? "symlink"
    : stats.isDirectory()
      ? "dir"
      : "file";
};

// Top-level names read from the owner's real folder with a read-only ls (names only, contents never read).
const REAL_OWNER_TOP_LEVEL = [
  ".agents",
  ".claude",
  ".codex",
  ".goose",
  ".nest-agents-version",
  ".scratch",
  ".venv-chatterbox",
  ".venv-tts",
  "AGENTS.md",
  "GUIDES",
  "OUTBOX",
  "PLANS",
  "REPOS",
  "RESEARCH",
  "WORK_LOGS",
  "archive",
  "dock-check.md",
  "gate-check.md",
  "gate-note.md",
  "models",
  "probe-note.md",
];

let owner;
before(async () => {
  owner = await buildFixture({ root: await fresh(), variant: "owner" });
});

test("owner fixture has exactly the top-level names of the owner's real folder", async () => {
  assert.deepEqual(
    await names(path.join(owner.home, OLD_NEST)),
    [...REAL_OWNER_TOP_LEVEL].sort(),
  );
  assert.equal(
    await lstat(path.join(owner.root, FIXTURE_MARKER)).then(() => true),
    true,
  );
});

test("the allow-list is eleven closed names (.scratch is foreign) and the fixture covers ten of them (.repos-dir only in some variants)", async () => {
  assert.equal(OWNED_TOP_LEVEL.length, 11);
  assert.equal(OWNED_TOP_LEVEL.includes(".scratch"), false);
  const present = await names(path.join(owner.home, OLD_NEST));
  const covered = OWNED_TOP_LEVEL.filter((name) => present.includes(name));
  assert.deepEqual(
    OWNED_TOP_LEVEL.filter((name) => !covered.includes(name)),
    [".repos-dir"],
  );
});

test("kinds and modes follow the real folder: private dirs, 0600 AGENTS.md, shared harness folders, foreign venvs", async () => {
  const nest = path.join(owner.home, OLD_NEST);
  const mode = async (relative) =>
    ((await lstat(path.join(nest, relative))).mode & 0o7777).toString(8);
  assert.equal(await mode("AGENTS.md"), "600");
  assert.equal(await mode("REPOS"), "700");
  assert.equal(await mode("models"), "755");
  assert.equal(await mode(".venv-tts"), "755");
  assert.equal(
    await kind(path.join(nest, ".claude/skills/buzz-cli")),
    "symlink",
  );
  assert.equal(
    await readlink(path.join(nest, ".claude/skills/buzz-cli")),
    "../../.agents/skills/buzz-cli",
  );
  assert.equal(await kind(path.join(nest, ".agents/skills/buzz-cli")), "dir");
  assert.equal(
    await kind(path.join(nest, ".agents/skills/colony-product-videos")),
    "dir",
  );
  // The owner's real folder has an absolute link into the nest, made by another tool.
  assert.equal(
    await readlink(path.join(nest, ".claude/skills/colony-product-videos")),
    `${owner.home}/${OLD_NEST}/.agents/skills/colony-product-videos`,
  );
});

test("archive.db is a genuine WAL case: rows only the -wal carries, -shm present, integrity ok", async () => {
  const database = owner.database;
  assert.equal(database.expectedRows, database.baseRows + database.walRows);
  assert.equal(database.rows, database.expectedRows);
  assert.equal(database.mainFileOnlyRows, database.baseRows);
  assert.ok(database.walBytes > 0);
  assert.equal(database.shmPresent, true);
  assert.equal(database.integrity, "ok");
  const archive = path.join(owner.home, OLD_NEST, "archive");
  assert.deepEqual(await names(archive), [
    "archive.db",
    "archive.db-shm",
    "archive.db-wal",
  ]);
});

test("reading the database never modifies it: main, -wal and -shm are byte-identical after a read", async () => {
  const archive = path.join(owner.home, OLD_NEST, "archive");
  const snapshot = async () =>
    Promise.all(
      ["archive.db", "archive.db-wal", "archive.db-shm"].map(async (name) => {
        const stats = await lstat(path.join(archive, name));
        return [
          name,
          stats.size,
          Math.round(stats.mtimeMs),
          (await readFile(path.join(archive, name))).toString("base64"),
        ];
      }),
    );
  const before = await snapshot();
  const first = await readDatabase(path.join(archive, "archive.db"));
  const second = await readDatabase(path.join(archive, "archive.db"));
  assert.deepEqual(await snapshot(), before);
  assert.equal(first.rows, owner.database.expectedRows);
  assert.equal(second.idsSha256, owner.database.idsSha256);
});

test("REPOS holds real repositories, a relative link inside REPOS and a symlinked repository outside the nest", async () => {
  const repos = path.join(owner.home, OLD_NEST, "REPOS");
  assert.deepEqual(await names(repos), [
    "colony-social-kit",
    "colony-social-kit-day-one-film",
    "kit-latest",
    "shared-assets",
  ]);
  assert.equal(
    await readlink(path.join(repos, "kit-latest")),
    "colony-social-kit",
  );
  assert.equal(
    await readlink(path.join(repos, "shared-assets")),
    `${owner.home}/external/shared-assets`,
  );
  assert.equal(
    await readFile(path.join(repos, "kit-latest", "README.md"), "utf8"),
    "# Synthetic repository\n",
  );
});

test("repos-link-into-nest adds an absolute link into the old nest, which the migration must hold back", async () => {
  const fixture = await buildFixture({
    root: await fresh(),
    variant: "repos-link-into-nest",
  });
  assert.equal(
    await readlink(path.join(fixture.home, OLD_NEST, "REPOS", "kit-absolute")),
    `${fixture.home}/${OLD_NEST}/REPOS/colony-social-kit`,
  );
});

test(".scratch is a foreign folder with notes in it, as in the owner's real folder", async () => {
  const scratch = path.join(owner.home, OLD_NEST, ".scratch");
  assert.equal(await kind(scratch), "dir");
  assert.ok((await names(scratch)).length > 5);
  assert.equal(OWNED_TOP_LEVEL.includes(".scratch"), false);
});

test("the host's Library/Application Support folder exists so the journal can be written under a read-only HOME", async () => {
  assert.equal(
    await kind(path.join(owner.home, "Library", "Application Support")),
    "dir",
  );
});

test("foreign venv scripts name their own absolute path and run from it", async () => {
  assert.equal(owner.foreignScripts.length, 2);
  for (const relative of owner.foreignScripts) {
    const script = path.join(owner.home, relative);
    const text = await readFile(script, "utf8");
    assert.ok(
      text.includes(script),
      "the script must contain its own absolute path",
    );
    const { stdout } = await run(script);
    assert.match(stdout, /^venv-ok /u);
  }
});

test("huddle speech model folder satisfies the host's readiness rule (manifest version and expected files)", async () => {
  const stt = path.join(
    owner.home,
    OLD_NEST,
    "models/parakeet-tdt-ctc-110m-en",
  );
  assert.equal(
    await readFile(path.join(stt, ".buzz-model-manifest"), "utf8"),
    "2",
  );
  for (const file of ["model.int8.onnx", "tokens.txt", "MODEL_LICENSE.txt"])
    assert.equal(await kind(path.join(stt, file)), "file");
});

test("the version stamp stops the host refreshing Colony-written files, except in the stale variant", async () => {
  assert.equal(
    await readFile(
      path.join(owner.home, OLD_NEST, ".nest-agents-version"),
      "utf8",
    ),
    "999\n",
  );
  const stale = await buildFixture({
    root: await fresh(),
    variant: "owner-stale-version",
  });
  assert.equal(
    await readFile(
      path.join(stale.home, OLD_NEST, ".nest-agents-version"),
      "utf8",
    ),
    "1\n",
  );
  assert.match(
    await readFile(path.join(stale.home, OLD_NEST, "AGENTS.md"), "utf8"),
    /## My notes/u,
  );
});

test("repos-symlinked: REPOS is a link outside HOME and .repos-dir records it", async () => {
  const fixture = await buildFixture({
    root: await fresh(),
    variant: "repos-symlinked",
  });
  const repos = path.join(fixture.home, OLD_NEST, "REPOS");
  assert.equal(await kind(repos), "symlink");
  assert.equal(await readlink(repos), `${fixture.home}/external/repos-target`);
  assert.equal(
    await readFile(path.join(fixture.home, OLD_NEST, ".repos-dir"), "utf8"),
    `${fixture.home}/external/repos-target\n`,
  );
});

test("repos-dir-inside: .repos-dir holds an absolute path inside the old nest", async () => {
  const fixture = await buildFixture({
    root: await fresh(),
    variant: "repos-dir-inside",
  });
  assert.equal(
    await readFile(path.join(fixture.home, OLD_NEST, ".repos-dir"), "utf8"),
    `${fixture.home}/${OLD_NEST}/REPOS\n`,
  );
});

test("both-colony-has-nest, both-unrelated-colony, colony-only and empty have the folders the case needs", async () => {
  const both = await buildFixture({
    root: await fresh(),
    variant: "both-colony-has-nest",
  });
  assert.deepEqual(
    (await names(both.home)).filter((name) => name.startsWith(".")),
    [".buzz", ".colony"],
  );
  assert.equal(await kind(path.join(both.home, ".colony/AGENTS.md")), "file");
  assert.equal(
    await kind(path.join(both.home, ".colony/GUIDES/welcome.md")),
    "file",
  );
  // Empty placeholders the host provisioned: a source directory may replace them.
  assert.deepEqual(await names(path.join(both.home, ".colony/REPOS")), []);
  assert.deepEqual(await names(path.join(both.home, ".colony/PLANS")), []);
  const unrelated = await buildFixture({
    root: await fresh(),
    variant: "both-unrelated-colony",
  });
  assert.deepEqual(await names(path.join(unrelated.home, ".colony")), [
    "unrelated-tool.cfg",
  ]);
  const only = await buildFixture({
    root: await fresh(),
    variant: "colony-only",
  });
  assert.deepEqual(await names(only.home), [".colony", "Library"]);
  const empty = await buildFixture({ root: await fresh(), variant: "empty" });
  assert.deepEqual(await names(empty.home), ["Library"]);
  assert.equal(empty.database, null);
});

test("every variant is described and buildable", () => {
  for (const [name, description] of Object.entries(VARIANTS)) {
    assert.ok(description.length > 20, name);
  }
});

test("synthetic bytes are deterministic per seed and label, and differ between them", () => {
  assert.deepEqual(
    syntheticBytes("a", "x", 100),
    syntheticBytes("a", "x", 100),
  );
  assert.notDeepEqual(
    syntheticBytes("a", "x", 100),
    syntheticBytes("b", "x", 100),
  );
  assert.notDeepEqual(
    syntheticBytes("a", "x", 100),
    syntheticBytes("a", "y", 100),
  );
  assert.equal(syntheticBytes("a", "x", 70).length, 70);
});

test("the root guard refuses the real home, an ancestor of it, the real nest folders and unmarked folders", async () => {
  const realHome = os.homedir();
  await assert.rejects(assertThrowawayRoot(realHome), /real home/u);
  await assert.rejects(
    assertThrowawayRoot(path.dirname(realHome)),
    /real home/u,
  );
  await assert.rejects(
    assertThrowawayRoot(path.join(realHome, ".buzz")),
    /inside the real/u,
  );
  await assert.rejects(
    assertThrowawayRoot(path.join(realHome, ".colony", "x")),
    /inside the real/u,
  );
  await assert.rejects(assertThrowawayRoot("relative/path"), /absolute/u);
  const unmarked = path.dirname(await fresh());
  await writeFile(path.join(unmarked, "stray.txt"), "x");
  await assert.rejects(
    assertThrowawayRoot(unmarked),
    /not empty and is not a fixture/u,
  );
  await assert.rejects(
    buildFixture({ root: unmarked }),
    /not empty and is not a fixture/u,
  );
  await assert.rejects(
    assertThrowawayRoot(unmarked, { requireMarker: true }),
    /no \.nest-proof-fixture marker/u,
  );
  await assert.doesNotReject(
    assertThrowawayRoot(owner.root, { requireMarker: true }),
  );
  const missing = path.join(unmarked, "does-not-exist");
  await mkdir(unmarked, { recursive: true });
  await assert.doesNotReject(assertThrowawayRoot(missing));
});
