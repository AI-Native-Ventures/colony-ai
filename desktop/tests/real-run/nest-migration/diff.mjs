// Manifest differ: compares the HOME tree before and after a run against the migration's rules.
// Pure function over two manifests, so it is unit tested without any app. Entries are keyed by their path
// relative to HOME, for example ".buzz/REPOS/app" and ".colony/REPOS/app".
import { classifyNestPath, defaultContract } from "./contract.mjs";
import { indexManifest } from "./manifest.mjs";

/** Entries whose content the host legitimately rewrites while it runs. Compared by existence only. */
export function isVolatile(relativeToNest) {
  return relativeToNest === "archive" || relativeToNest.startsWith("archive/");
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

function fieldDifferences(before, after, { strict, skipContent = false }) {
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
    if (before.type !== "dir" && !skipContent) compare("mtimeMs");
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
  const home = before.home;
  const oldPrefix = `${home}/${contract.oldNest}`;
  const newPrefix = `${home}/${contract.newNest}`;
  const expectedRewrite = (target) =>
    target === oldPrefix || target.startsWith(`${oldPrefix}/`)
      ? `${newPrefix}${target.slice(oldPrefix.length)}`
      : null;

  const movedPaths = new Set();
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
      rewrittenLinks: [],
      unresolvedLinks: [],
    },
    newSideExisting: { total: 0, differences: [], missing: [] },
    generated: { removed: [], kept: [], regenerated: [] },
    addedToOld: [],
    unexpectedInNew: [],
    createdInNew: [],
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
      // Entries the new nest already had: must survive untouched.
      const now = afterIndex.get(entry.path);
      result.newSideExisting.total += 1;
      if (!now) {
        result.newSideExisting.missing.push(entry.path);
        continue;
      }
      const differences = fieldDifferences(entry, now, {
        strict: !isVolatile(rel),
        skipContent: isVolatile(rel),
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
        result.foreign.missing.push(entry.path);
        continue;
      }
      const differences = fieldDifferences(entry, now, { strict: true });
      if (differences.length)
        result.foreign.differences.push({ path: entry.path, differences });
      else result.foreign.identical += 1;
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
    const destination = afterIndex.get(destinationPath);
    const source = afterIndex.get(entry.path);
    const conflicted = beforeIndex.has(destinationPath);

    if (conflicted) {
      result.owned.conflicts.push({
        path: entry.path,
        sourceIntact: Boolean(source),
        destinationKept: Boolean(destination),
      });
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
      result.owned.lost.push(entry.path);
      continue;
    }

    // Moved. Judge it.
    const volatile = isVolatile(rel);
    let rewritten = false;
    let differences = fieldDifferences(entry, destination, {
      strict: !volatile,
      skipContent: volatile,
    });
    if (entry.type === "symlink" && entry.target !== destination.target) {
      const wanted = expectedRewrite(entry.target);
      if (wanted !== null && wanted === destination.target) {
        rewritten = true;
        result.owned.rewrittenLinks.push({
          path: destinationPath,
          before: entry.target,
          after: destination.target,
        });
        // A rewritten link is a new link: its target text and inode differ by design.
        differences = differences.filter(
          (difference) =>
            !["target", "ino", "dev", "mtimeMs"].includes(difference.field),
        );
      }
    }
    if (
      entry.type === "symlink" &&
      destination.resolves === false &&
      entry.resolves
    )
      result.owned.unresolvedLinks.push({
        path: destinationPath,
        target: destination.target,
      });
    const copiedFields = differences.filter((difference) =>
      ["ino", "dev"].includes(difference.field),
    );
    if (copiedFields.length && !rewritten && !volatile)
      result.owned.copied.push(destinationPath);
    const content = differences.filter(
      (difference) => !["ino", "dev"].includes(difference.field),
    );
    movedPaths.add(destinationPath);
    if (content.length)
      result.owned.altered.push({
        path: destinationPath,
        differences: content,
      });
    else result.owned.movedClean.push(destinationPath);
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
