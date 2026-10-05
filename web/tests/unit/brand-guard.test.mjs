import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { FORBIDDEN_BRAND_PATTERNS, srcRoot, webRoot } from "./support.mjs";

const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".css", ".html", ".svg"]);

/**
 * Internal identifiers that are protocol or storage names, never shown to a
 * visitor. Each entry must still match, so a stale entry fails the test.
 */
const ALLOWED_INTERNAL_IDENTIFIERS = [
  {
    file: "src/features/repos/use-repos.ts",
    token: '"buzz-channel"',
    why: "tag name carried by relay repository events",
  },
  {
    file: "src/features/repos/git-client.ts",
    token: "`buzz-git-${",
    why: "local IndexedDB name for cached clones",
  },
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const full = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    }),
  );
  return files.flat();
}

async function webSourceFiles() {
  const files = [
    path.join(webRoot, "index.html"),
    ...(await walk(srcRoot)).filter((file) =>
      TEXT_EXTENSIONS.has(path.extname(file)),
    ),
  ];
  return files.map((file) =>
    path.relative(webRoot, file).split(path.sep).join("/"),
  );
}

test("no web source a visitor can reach mentions the upstream product", async () => {
  const used = new Set();
  const offenders = [];

  for (const file of await webSourceFiles()) {
    const lines = (await readFile(path.join(webRoot, file), "utf8")).split(
      "\n",
    );
    lines.forEach((line, index) => {
      for (const { name, pattern } of FORBIDDEN_BRAND_PATTERNS) {
        if (!pattern.test(line)) continue;
        const allowed = ALLOWED_INTERNAL_IDENTIFIERS.find(
          (entry) => entry.file === file && line.includes(entry.token),
        );
        if (allowed) {
          used.add(allowed);
          continue;
        }
        offenders.push(`${file}:${index + 1} [${name}] ${line.trim()}`);
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    `upstream branding is back:\n${offenders.join("\n")}`,
  );
  for (const entry of ALLOWED_INTERNAL_IDENTIFIERS) {
    assert.ok(
      used.has(entry),
      `stale allowlist entry: ${entry.file} ${entry.token}`,
    );
  }
});

test("the bundle ships the Colony mark and no bee asset", async () => {
  const assets = (await walk(path.join(srcRoot, "assets"))).map((file) =>
    path.basename(file),
  );
  assert.ok(assets.includes("colony-icon.svg"), assets.join(", "));
  assert.deepEqual(
    assets.filter((name) => /app-icon|bee|buzz/i.test(name)),
    [],
  );
});
