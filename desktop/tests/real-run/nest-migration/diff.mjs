// Manifest differ: compares the HOME tree before and after a run against the migration's rules.
// Pure function over two manifests, so it is unit tested without any app. Entries are keyed by their path
// relative to HOME, for example ".buzz/REPOS/app" and ".colony/REPOS/app".
import { classifyNestPath, defaultContract } from "./contract.mjs";
import { indexManifest } from "./manifest.mjs";

/** NEST_STRICT=1 turns every narrowing of the final 1.0.5 gate off (strict results), see README "Final gate". */
export const STRICT = process.env.NEST_STRICT === "1";

/** Entries whose content the host legitimately rewrites while it runs. Compared by existence only. */
export function isVolatile(relativeToNest) {
  // AGENTS.md: the host regenerates its managed block at every boot (owner notes below the end marker stay;
  // the stale case checks them). Final 1.0.5 gate: compared by existence only.
  return (
    relativeToNest === "archive" ||
    relativeToNest.startsWith("archive/") ||
    (!STRICT && relativeToNest === "AGENTS.md")
  );
}

/** Split ".buzz/REPOS/app" into { nest: ".buzz", rel: "REPOS/app" }. rel is "" for the nest root. */
export function splitNestPath(entryPath, contract = defaultContract()) {
  for (const nest of [contract.oldNest, contract.newNest]) {
    if (entryPath === nest) return { nest, rel: "" };
    if (entryPath.startsWith(`${nest}/`))
      return { nest, rel: entryPath.slice(nest.length + 1) };
  }
  return null;
}

/**
 * Compare two records of the same entry.
 * - `strict` also compares the inode, device, link count and modification time (nanoseconds) of files and links.
 * - `untouched` also compares the change time (nanoseconds): any write, chmod, rename or link change bumps it,
 *   so it proves a file was not touched at all. Not used for entries that were moved on purpose.
 */
function fieldDifferences(
  before,
  after,
  { strict, untouched = false, skipContent = false },
) {
  const differences = [];
  const compare = (field) => {
    if (before[field] !== after[field])
      differences.push({ field, before: before[field], after: after[field] });
  };
  compare("type");
  compare("mode");
  if (!skipContent) {
    compare("size");
    if (before.sha256 != null && after.sha256 != null) compare("sha256");
    if (before.type === "symlink") compare("target");
  }
  if (strict) {
    compare("ino");
    compare("dev");
    if (before.type !== "dir" && !skipContent) {
      compare("nlink");
      compare("mtimeNs");
      if (untouched) compare("ctimeNs");
    }
  }
  return differences;
}

/**
 * Diff two manifests.
 *
 * Rules applied (design page "PR 2 design", rules 1 to 9):
 * - foreign entries in the old nest are identical (type, mode, size, sha256, link target, inode, mtime);
 * - every owned entry from the old nest is, exactly once, either moved to the new nest byte-identical and
 *   with the same inode (a rename, never a copy), or left in place (a conflict, a skip or a failure);
 * - entries that already existed in the new nest are never overwritten;
 * - the old nest gains nothing, the new nest holds only Colony-owned and regenerated entries.
 *
 * @param {{before: object, after: object, contract?: object}} input
 */
export function diffNests({ before, after, contract = defaultContract() }) {
  const beforeIndex = indexManifest(before);
  const afterIndex = indexManifest(after);
  const movedPaths = new Set();
  const hasChildren = (entryPath) =>
    before.entries.some((candidate) =>
      candidate.path.startsWith(`${entryPath}/`),
    );
  // An empty directory the host provisioned in the new nest (a placeholder). A source directory of the same
  // name may be renamed over it, which is how the migration places REPOS or PLANS next to an existing nest.
  const placeholderFor = (destinationPath, entry) => {
    const existing = beforeIndex.get(destinationPath);
    return existing &&
      existing.type === "dir" &&
      entry.type === "dir" &&
      !hasChildren(destinationPath)
      ? existing
      : null;
  };
  const result = {
    foreign: { total: 0, identical: 0, differences: [], missing: [] },
    owned: {
      total: 0,
      movedClean: [],
      leftInPlace: [],
      conflicts: [],
      lost: [],
      altered: [],
      copied: [],
      unresolvedLinks: [],
      staged: [],
    },
    newSideExisting: { total: 0, differences: [], missing: [] },
    generated: { removed: [], kept: [], regenerated: [] },
    addedToOld: [],
    unexpectedInNew: [],
    createdInNew: [],
    stagingLeft: afterIndex.has(contract.stagingName),
    oldRoot: {
      before: beforeIndex.has(contract.oldNest),
      after: afterIndex.has(contract.oldNest),
    },
    newRoot: {
      before: beforeIndex.has(contract.newNest),
      after: afterIndex.has(contract.newNest),
    },
  };

  for (const entry of before.entries) {
    const split = splitNestPath(entry.path, contract);
    if (!split || split.rel === "") continue;
    const { nest, rel } = split;
    const kind = classifyNestPath(rel, contract);

    if (nest === contract.newNest) {
      // An empty placeholder directory that the old nest's directory of the same name may replace.
      const pairedOld = beforeIndex.get(`${contract.oldNest}/${rel}`);
      if (
        pairedOld &&
        classifyNestPath(rel, contract) === "owned" &&
        placeholderFor(entry.path, pairedOld)
      )
        continue;
      // Entries the new nest already had: must survive untouched.
      const now = afterIndex.get(entry.path);
      result.newSideExisting.total += 1;
      if (!now) {
        result.newSideExisting.missing.push(entry.path);
        continue;
      }
      // The destination's AGENTS.md is NOT existence-only here: the host may refresh its managed section, and the check that
      // allows it (checks.mjs agentsMdVerdict) needs the difference to be visible, with the bytes outside the section compared.
      const archiveOnly = rel === "archive" || rel.startsWith("archive/");
      const differences = fieldDifferences(entry, now, {
        strict: !archiveOnly,
        untouched: !archiveOnly,
        skipContent: archiveOnly,
      });
      if (differences.length)
        result.newSideExisting.differences.push({
          path: entry.path,
          differences,
        });
      continue;
    }

    if (kind === "foreign") {
      result.foreign.total += 1;
      const now = afterIndex.get(entry.path);
      if (!now) {
        // Final 1.0.5 gate: when the app stays in the old folder (flag off, deferred) the host provisions its own
        // colony-cli skill there and retires the old generated buzz-cli entries (nest.rs "Version 7 renamed the
        // skill", nest/tests.rs retiring_the_legacy_skill_*). Generated by Colony, not user data: reported as
        // retired, not as a missing foreign entry. The current skill must exist beside it.
        // Narrow: only the link or directory itself and its two generated files. Any other file below it is user data.
        const retiredSkill = STRICT ? undefined : contract.generatedSkillLinks.find(
          (link) =>
            rel === link ||
            rel === `${link}/SKILL.md` ||
            rel === `${link}/.skill-version`,
        );
        if (
          retiredSkill &&
          afterIndex.has(
            `${nest}/${retiredSkill.replace(/buzz-cli$/u, "colony-cli")}`,
          )
        ) {
          (result.generated.retired ??= []).push(entry.path);
          result.foreign.total -= 1;
          continue;
        }
        result.foreign.missing.push(entry.path);
        continue;
      }
      const differences = fieldDifferences(entry, now, {
        strict: true,
        untouched: true,
      });
      if (differences.length)
        result.foreign.differences.push({ path: entry.path, differences });
      else result.foreign.identical += 1;
      continue;
    }

    if (kind === "generated-parent") {
      // Present: must be unchanged. Missing: only fine when nothing foreign lived below it.
      const now = afterIndex.get(entry.path);
      const heldForeign = before.entries.some(
        (other) =>
          other.path.startsWith(`${entry.path}/`) &&
          classifyNestPath(
            other.path.slice(contract.oldNest.length + 1),
            contract,
          ) === "foreign",
      );
      if (!now && heldForeign) result.foreign.missing.push(entry.path);
      continue;
    }

    if (kind === "generated") {
      const stillThere = afterIndex.has(entry.path);
      const bucket = stillThere ? "kept" : "removed";
      // Only the generated link or directory itself is reported, not each file below it.
      if (contract.generatedSkillLinks.includes(rel))
        result.generated[bucket].push(entry.path);
      continue;
    }

    // Owned entry in the old nest.
    result.owned.total += 1;
    const destinationPath = `${contract.newNest}/${rel}`;
    const stagingPath = `${contract.stagingName}/${rel}`;
    const placeholder = placeholderFor(destinationPath, entry);
    let destination = afterIndex.get(destinationPath);
    // A placeholder that is still the same directory was not replaced: the source did not move.
    if (placeholder && destination && destination.ino === placeholder.ino)
      destination = undefined;
    let landedAt = destinationPath;
    let inFlight = false;
    if (
      !destination &&
      afterIndex.has(stagingPath) &&
      !afterIndex.has(entry.path)
    ) {
      destination = afterIndex.get(stagingPath);
      landedAt = stagingPath;
      inFlight = true;
    }
    const source = afterIndex.get(entry.path);
    const conflicted = beforeIndex.has(destinationPath) && !placeholder;

    if (conflicted) {
      result.owned.conflicts.push({
        path: entry.path,
        sourceIntact: Boolean(source),
        destinationKept: afterIndex.has(destinationPath),
      });
      continue;
    }
    // The host's own link to a folder that stayed behind (REPOS, pointed at by the new nest's `.repos-dir`) is
    // not a copy of it: the source stayed where it was and the new nest reaches it through the link.
    const link = destination;
    if (
      link &&
      source &&
      link.type === "symlink" &&
      link.resolves &&
      link.target?.endsWith(`/${contract.oldNest}/${rel}`)
    ) {
      result.owned.leftInPlace.push(entry.path);
      continue;
    }
    // Final 1.0.5 gate: after a held-back entry (journal step skipped, notice recorded) the host provisions its own
    // EMPTY default folder of that name in the new nest (for REPOS: the default repos dir). An empty directory that
    // did not exist before the run is a placeholder, not a copy; the old entry stays whole.
    if (
      !STRICT &&
      destination &&
      source &&
      destination.type === "dir" &&
      destination.ino !== entry.ino &&
      !beforeIndex.has(destinationPath) &&
      !after.entries.some((other) =>
        other.path.startsWith(`${destinationPath}/`),
      )
    ) {
      result.owned.leftInPlace.push(entry.path);
      continue;
    }
    if (destination && source) {
      // Present at both places although it existed only at the old one: a copy that was not cleaned up.
      result.owned.altered.push({
        path: entry.path,
        differences: [
          { field: "duplicated", before: "one place", after: "two places" },
        ],
      });
      continue;
    }
    if (!destination && source) {
      result.owned.leftInPlace.push(entry.path);
      continue;
    }
    if (!destination && !source) {
      // A moved WAL or SHM that SQLite consumed when the database was opened and closed cleanly at the new place
      // is a checkpoint, not a loss; ARCHIVE-INTACT still proves the rows and the integrity.
      if (
        !STRICT &&
        /^archive\/archive\.db-(wal|shm)$/u.test(rel) &&
        (afterIndex.has(`${contract.newNest}/archive/archive.db`) ||
          afterIndex.has(`${contract.oldNest}/archive/archive.db`))
      ) {
        (result.owned.checkpointed ??= []).push(entry.path);
        continue;
      }
      result.owned.lost.push(entry.path);
      continue;
    }

    // Moved (or staged, while a run is in flight). Judge it.
    const volatile = isVolatile(rel);
    const differences = fieldDifferences(entry, destination, {
      strict: !volatile,
      skipContent: volatile,
    });
    if (
      entry.type === "symlink" &&
      destination.resolves === false &&
      entry.resolves
    )
      result.owned.unresolvedLinks.push({
        path: landedAt,
        target: destination.target,
      });
    const copiedFields = differences.filter((difference) =>
      ["ino", "dev", "nlink"].includes(difference.field),
    );
    if (copiedFields.length && !volatile) result.owned.copied.push(landedAt);
    const content = differences.filter(
      (difference) => !["ino", "dev", "nlink"].includes(difference.field),
    );
    movedPaths.add(landedAt);
    if (content.length)
      result.owned.altered.push({
        path: landedAt,
        differences: content,
      });
    else if (inFlight) result.owned.staged.push(landedAt);
    else result.owned.movedClean.push(landedAt);
  }

  // Regenerated skill entries in the new nest.
  for (const link of contract.regeneratedSkillLinks)
    if (afterIndex.has(`${contract.newNest}/${link}`))
      result.generated.regenerated.push(`${contract.newNest}/${link}`);

  // Anything new.
  const allowedNew = (entryPath) =>
    contract.allowedNewArtifacts.some(
      (allowed) => entryPath === allowed || entryPath.startsWith(`${allowed}/`),
    );
  for (const entry of after.entries) {
    if (beforeIndex.has(entry.path)) continue;
    const split = splitNestPath(entry.path, contract);
    if (!split) {
      if (!allowedNew(entry.path)) result.unexpectedInNew.push(entry.path);
      continue;
    }
    if (split.rel === "") continue;
    if (split.nest === contract.oldNest) {
      result.addedToOld.push(entry.path);
      continue;
    }
    if (allowedNew(entry.path)) continue;
    const kind = classifyNestPath(split.rel, contract);
    const isMoved = movedPaths.has(entry.path);
    const regenerated = contract.regeneratedSkillLinks.some(
      (link) => split.rel === link || split.rel.startsWith(`${link}/`),
    );
    // Parent folders the regenerated skills live in (.agents/skills and so on) are not user data either.
    const skillParent = contract.regeneratedSkillLinks.some((link) =>
      link.startsWith(`${split.rel}/`),
    );
    if (isMoved) continue;
    if (kind === "owned" || regenerated || skillParent)
      result.createdInNew.push(entry.path);
    else result.unexpectedInNew.push(entry.path);
  }

  return result;
}

/** One-line summary of a diff for logs and the report. */
export function summarizeDiff(diff) {
  return [
    `foreign ${diff.foreign.identical}/${diff.foreign.total} identical`,
    `owned ${diff.owned.movedClean.length}/${diff.owned.total} moved clean`,
    `${diff.owned.leftInPlace.length} left`,
    `${diff.owned.conflicts.length} conflicts`,
    `${diff.owned.lost.length} lost`,
    `${diff.owned.altered.length} altered`,
    `${diff.owned.copied.length} copied`,
  ].join(", ");
}

/**
 * Compare two manifests of the same HOME taken at different times, to prove a later launch changed nothing.
 * Volatile entries (the archive) are compared by existence only. Directory mtimes are ignored.
 * Returns what was added, removed and changed, each as a list of paths.
 */
export function compareStable(first, second, contract = defaultContract()) {
  const a = indexManifest(first);
  const b = indexManifest(second);
  const added = [];
  const removed = [];
  const changed = [];
  for (const [entryPath, entry] of a) {
    const other = b.get(entryPath);
    if (!other) {
      removed.push(entryPath);
      continue;
    }
    const split = splitNestPath(entryPath, contract);
    const volatile = split ? isVolatile(split.rel) : false;
    const differences = fieldDifferences(entry, other, {
      strict: !volatile,
      untouched: !volatile,
      skipContent: volatile,
    });
    if (differences.length) changed.push({ path: entryPath, differences });
  }
  for (const entryPath of b.keys())
    if (!a.has(entryPath)) added.push(entryPath);
  return { added, removed, changed };
}
