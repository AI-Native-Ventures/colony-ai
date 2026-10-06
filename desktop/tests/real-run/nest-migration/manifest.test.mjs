import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
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
  pinFiles,
  recordEntry,
  sha256File,
  treeHash,
  unpinFiles,
} from "./manifest.mjs";

const scratch = [];
/** A pin folder of its own, outside the tree, so tests never share pins. */
const pinFolder = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "colony-nest-proof-pins-"));
  scratch.push(dir);
  return path.join(dir, "pins");
};
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

test("times are recorded in nanoseconds as strings, with the inode and link count, for files only", async () => {
  const home = await tree();
  const entries = indexManifest(await buildManifest(home, [".buzz"]));
  const file = entries.get(".buzz/dir/file.txt");
  const real = await stat(path.join(home, ".buzz/dir/file.txt"), {
    bigint: true,
  });
  assert.equal(file.mtimeNs, real.mtimeNs.toString());
  assert.equal(file.ctimeNs, real.ctimeNs.toString());
  assert.equal(file.ino, real.ino.toString());
  assert.equal(file.nlink, 1);
  const dir = entries.get(".buzz/dir");
  assert.equal(dir.mtimeNs, null);
  assert.equal(dir.ctimeNs, null);
  assert.equal(dir.nlink, null);
});

test("a rewrite with identical bytes is visible through mtime, and through ctime even when mtime is put back", async () => {
  const home = await tree();
  const file = path.join(home, ".buzz/dir/file.txt");
  const old = new Date("2020-01-01T00:00:00Z");
  await utimes(file, old, old);
  const at = async () =>
    indexManifest(await buildManifest(home, [".buzz"])).get(
      ".buzz/dir/file.txt",
    );
  const first = await at();
  await writeFile(file, await readFile(file));
  const second = await at();
  assert.equal(first.sha256, second.sha256);
  assert.notEqual(first.mtimeNs, second.mtimeNs);
  await utimes(file, old, old);
  const third = await at();
  assert.equal(third.mtimeNs, first.mtimeNs, "mtime was restored");
  assert.notEqual(third.ctimeNs, first.ctimeNs, "ctime cannot be restored");
});

test("pinning: every regular file gets a hard link outside the tree, volatile paths are skipped, the pins can be removed", async () => {
  const home = await tree();
  await mkdir(path.join(home, ".buzz/archive"), { recursive: true });
  await writeFile(path.join(home, ".buzz/archive/archive.db"), "db");
  const pinDir = await pinFolder();
  const count = await pinFiles(home, [".buzz"], pinDir, (relative) =>
    relative.startsWith(".buzz/archive"),
  );
  assert.equal(
    count,
    2,
    "file.txt and script.sh; not the archive, not the links, not the directories",
  );
  const entries = indexManifest(await buildManifest(home, [".buzz"]));
  assert.equal(entries.get(".buzz/dir/file.txt").nlink, 2);
  assert.equal(entries.get(".buzz/script.sh").nlink, 2);
  assert.equal(entries.get(".buzz/archive/archive.db").nlink, 1);
  await unpinFiles(pinDir);
  const after = indexManifest(await buildManifest(home, [".buzz"]));
  assert.equal(after.get(".buzz/dir/file.txt").nlink, 1);
});

test("pinning makes delete-then-write and copy-then-delete change the inode on every filesystem", async () => {
  const home = await tree();
  const pinDir = await pinFolder();
  await pinFiles(home, [".buzz"], pinDir);
  const file = path.join(home, ".buzz/dir/file.txt");
  const at = async () =>
    indexManifest(await buildManifest(home, [".buzz"])).get(
      ".buzz/dir/file.txt",
    );
  const before = await at();
  const bytes = await readFile(file);
  await rm(file);
  await writeFile(file, bytes);
  await chmod(file, 0o640);
  const after = await at();
  assert.notEqual(
    after.ino,
    before.ino,
    "the original inode is held by its pin and cannot be reused",
  );
  assert.equal(after.nlink, 1);
  assert.equal(before.nlink, 2);
});

test("attachDatabases records an absent database as absent rather than failing", async () => {
  const home = await tree();
  const manifest = await attachDatabases(await buildManifest(home, [".buzz"]), [
    ".buzz/archive/archive.db",
  ]);
  assert.equal(manifest.databases[".buzz/archive/archive.db"].absent, true);
});
