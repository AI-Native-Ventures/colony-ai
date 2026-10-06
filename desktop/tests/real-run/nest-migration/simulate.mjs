// Test-only stand-in for the migration. It performs the design page's migration on a fixture HOME with plain
// renames so the differ, the checks and the runner can be proven against both a correct migration and
// deliberately broken ones, with no packaged app. It is NOT the product migration and the proof run never
// uses it.
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { defaultContract } from "./contract.mjs";

const present = async (file) => {
  try {
    await lstat(file);
    return true;
  } catch {
    return false;
  }
};

/**
 * Apply the migration.
 * @param {string} home fixture HOME
 * @param {object} [options]
 * @param {object} [options.contract]
 * @param {string[]} [options.skip] owned names to leave in place (a conflict or a failure)
 * @param {number} [options.stopAfter] stop after this many entries, as a crash would
 * @param {boolean} [options.journal] write a journal line before each move (default true)
 * @param {boolean} [options.sentinel] write the sentinel when finished (default true)
 * @returns {{moved: string[], left: string[]}}
 */
export async function simulateMigration(home, options = {}) {
  const contract = options.contract ?? defaultContract();
  const oldRoot = path.join(home, contract.oldNest);
  const newRoot = path.join(home, contract.newNest);
  const skip = new Set(options.skip ?? []);
  const journalPath = path.join(home, contract.journalPaths[0]);
  await mkdir(newRoot, { recursive: true });
  await mkdir(path.dirname(journalPath), { recursive: true });
  const moved = [];
  const left = [];
  for (const name of contract.ownedTopLevel) {
    const from = path.join(oldRoot, name);
    const to = path.join(newRoot, name);
    if (!(await present(from))) continue;
    if (skip.has(name) || (await present(to))) {
      left.push(name);
      continue;
    }
    if (options.stopAfter !== undefined && moved.length >= options.stopAfter) {
      left.push(name);
      continue;
    }
    if (options.journal !== false)
      await writeFile(
        journalPath,
        `${JSON.stringify({ name, from, to, at: Date.now() })}\n`,
        { flag: "a" },
      );
    await rename(from, to);
    moved.push(name);
  }
  if (options.stopAfter !== undefined) return { moved, left };

  // Absolute links into the old nest are rewritten to the new one.
  const rewrite = async (directory) => {
    for (const child of await readdir(directory)) {
      const full = path.join(directory, child);
      const stats = await lstat(full);
      if (stats.isSymbolicLink()) {
        const target = await readlink(full);
        if (target === oldRoot || target.startsWith(`${oldRoot}/`)) {
          await rm(full);
          await symlink(`${newRoot}${target.slice(oldRoot.length)}`, full);
        }
      } else if (stats.isDirectory()) await rewrite(full);
    }
  };
  if (
    moved.includes("REPOS") &&
    !(await lstat(path.join(newRoot, "REPOS"))).isSymbolicLink()
  )
    await rewrite(path.join(newRoot, "REPOS"));
  const reposDirFile = path.join(newRoot, ".repos-dir");
  if (moved.includes(".repos-dir")) {
    const value = (await readFile(reposDirFile, "utf8")).trim();
    if (value === oldRoot || value.startsWith(`${oldRoot}/`))
      await writeFile(
        reposDirFile,
        `${newRoot}${value.slice(oldRoot.length)}\n`,
      );
  }

  // Generated skill entries: remove exactly the old ones, regenerate under the new name in the new nest.
  for (const link of contract.generatedSkillLinks)
    await rm(path.join(oldRoot, link), { recursive: true, force: true });
  await mkdir(path.join(newRoot, ".agents/skills/colony-cli"), {
    recursive: true,
  });
  await writeFile(
    path.join(newRoot, ".agents/skills/colony-cli/SKILL.md"),
    "# Colony CLI skill (synthetic)\n",
  );
  for (const harness of [".claude", ".codex", ".goose"]) {
    await mkdir(path.join(newRoot, harness, "skills"), { recursive: true });
    const link = path.join(newRoot, harness, "skills/colony-cli");
    await rm(link, { force: true });
    await symlink("../../.agents/skills/colony-cli", link);
  }

  if (options.sentinel !== false)
    await writeFile(
      path.join(home, contract.sentinelPaths[0]),
      `${JSON.stringify({ moved, left, pending: [], completedAt: new Date().toISOString() }, null, 2)}\n`,
    );
  return { moved, left };
}
