import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import {
  attachDatabases,
  buildManifest,
  indexManifest,
  recordEntry,
  sha256File,
  treeHash,
} from "./manifest.mjs";

const scratch = [];
const tree = async () => {
  const home = await mkdtemp(
    path.join(os.tmpdir(), "colony-nest-proof-manifest-"),
  );
  scratch.push(home);
  await mkdir(path.join(home, ".buzz/dir"), { recursive: true });
  await writeFile(path.join(home, ".buzz/dir/file.txt"), "hello\n");
  await chmod(path.join(home, ".buzz/dir/file.txt"), 0o640);
  await writeFile(path.join(home, ".buzz/script.sh"), "#!/bin/sh\n");
  await chmod(path.join(home, ".buzz/script.sh"), 0o755);
  await symlink("dir", path.join(home, ".buzz/link-to-dir"));
  await symlink("../nowhere", path.join(home, ".buzz/dangling"));
  await symlink("/etc/hosts", path.join(home, ".buzz/absolute"));
  return home;
};
after(async () => {
  for (const dir of scratch) await rm(dir, { recursive: true, force: true });
});

test("every kind of entry is recorded with its type, mode and size, and files with a sha256", async () => {
  const home = await tree();
  const manifest = await buildManifest(home, [".buzz"]);
  const entries = indexManifest(manifest);
  assert.equal(entries.get(".buzz").type, "dir");
  assert.equal(entries.get(".buzz/dir/file.txt").type, "file");
  assert.equal(entries.get(".buzz/dir/file.txt").mode, "0640");
  assert.equal(entries.get(".buzz/dir/file.txt").size, 6);
  assert.equal(entries.get(".buzz/script.sh").mode, "0755");
  assert.equal(
    entries.get(".buzz/dir/file.txt").sha256,
    "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
  );
  assert.equal(
    entries.get(".buzz/dir").size,
    null,
    "directory sizes are not recorded",
  );
});

test("a symlink is recorded as a symlink and never followed, even to a directory", async () => {
  const home = await tree();
  const manifest = await buildManifest(home, [".buzz"]);
  const entries = indexManifest(manifest);
  assert.equal(entries.get(".buzz/link-to-dir").type, "symlink");
  assert.equal(entries.get(".buzz/link-to-dir").target, "dir");
  assert.equal(
    manifest.entries.some((entry) =>
      entry.path.startsWith(".buzz/link-to-dir/"),
    ),
    false,
    "the link target's children must not be listed under the link",
  );
  assert.equal(entries.get(".buzz/absolute").target, "/etc/hosts");
});

test("link resolution is recorded: a live link resolves, a dangling one does not", async () => {
  const home = await tree();
  const entries = indexManifest(await buildManifest(home, [".buzz"]));
  assert.equal(entries.get(".buzz/link-to-dir").resolves, true);
  assert.equal(entries.get(".buzz/dangling").resolves, false);
  assert.equal(entries.get(".buzz/dangling").resolved, null);
});

test("a root that does not exist is skipped, which is how absent is recorded", async () => {
  const home = await tree();
  const manifest = await buildManifest(home, [
    ".buzz",
    ".colony",
    ".colony.staging",
  ]);
  assert.equal(
    manifest.entries.some((entry) => entry.path.startsWith(".colony")),
    false,
  );
  assert.equal(await recordEntry(home, ".colony"), null);
});

test("entries are sorted by path so two manifests compare line by line", async () => {
  const home = await tree();
  const manifest = await buildManifest(home, [".buzz"]);
  const paths = manifest.entries.map((entry) => entry.path);
  assert.deepEqual(paths, [...paths].sort());
});

test("treeHash changes when content, mode or a link target changes, and not otherwise", async () => {
  const home = await tree();
  const first = await buildManifest(home, [".buzz"]);
  const same = await buildManifest(home, [".buzz"]);
  assert.equal(treeHash(first.entries), treeHash(same.entries));
  await writeFile(path.join(home, ".buzz/dir/file.txt"), "HELLO\n");
  const changed = await buildManifest(home, [".buzz"]);
  assert.notEqual(treeHash(first.entries), treeHash(changed.entries));
  await writeFile(path.join(home, ".buzz/dir/file.txt"), "hello\n");
  await chmod(path.join(home, ".buzz/dir/file.txt"), 0o600);
  const mode = await buildManifest(home, [".buzz"]);
  assert.notEqual(treeHash(first.entries), treeHash(mode.entries));
});

test("sha256File streams the same digest as the manifest", async () => {
  const home = await tree();
  const file = path.join(home, ".buzz/dir/file.txt");
  assert.equal(
    await sha256File(file),
    "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
  );
});

test("mtime is recorded for files, so a rewrite with identical bytes is still visible", async () => {
  const home = await tree();
  const file = path.join(home, ".buzz/dir/file.txt");
  await utimes(
    file,
    new Date("2026-01-01T00:00:00Z"),
    new Date("2026-01-01T00:00:00Z"),
  );
  const first = indexManifest(await buildManifest(home, [".buzz"])).get(
    ".buzz/dir/file.txt",
  );
  await writeFile(file, "hello\n");
  const second = indexManifest(await buildManifest(home, [".buzz"])).get(
    ".buzz/dir/file.txt",
  );
  assert.equal(first.sha256, second.sha256);
  assert.notEqual(first.mtimeMs, second.mtimeMs);
});

test("attachDatabases records an absent database as absent rather than failing", async () => {
  const home = await tree();
  const manifest = await attachDatabases(await buildManifest(home, [".buzz"]), [
    ".buzz/archive/archive.db",
  ]);
  assert.equal(manifest.databases[".buzz/archive/archive.db"].absent, true);
});
