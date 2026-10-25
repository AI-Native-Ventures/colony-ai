#!/usr/bin/env node
// Decides which CI jobs a change needs, so a pull request only pays for what
// it touches. .github/workflows/ci.yml runs this first and reads its outputs.
//
//   node scripts/ci-plan.mjs --base <sha> [--head <sha>] [--github-output]
//   node scripts/ci-plan.mjs --all          # plan as if everything changed
//
// What it decides:
//   Rust     changed crates plus every crate that depends on them (cargo
//            metadata dependency graph), PostgreSQL packages among them, and
//            whether the desktop native host is affected.
//   Unit     desktop unit tests whose import graph reaches a changed file;
//            all of them when shared config or package files change.
//   E2E      specs mapped to the changed folders in
//            desktop/tests/e2e/affected-map.json; the essential set when shared
//            code (app shell, shared/ui, composer, tokens, bridge) changes.
//   Docs- or site-only changes run no desktop or Rust job at all.
//
// A path this script does not recognise falls back to the wider choice (more
// tests), never to running nothing.

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const SAFE_NAME = /^[A-Za-z0-9_.-]+$/;

// ---------------------------------------------------------------- path rules

const startsWithAny = (file, prefixes) =>
  prefixes.some((prefix) => file.startsWith(prefix));

const CODE_DIRS = [
  "crates/",
  "desktop/",
  "web/",
  "mobile/",
  "scripts/",
  "migrations/",
  "schema/",
  "examples/",
];

/** Documentation and website files: nothing to build or test. */
export function isDocsOnly(file) {
  if (startsWithAny(file, ["docs/", "site/", ".github/ISSUE_TEMPLATE/"])) {
    return true;
  }
  if (
    file === ".github/PULL_REQUEST_TEMPLATE.md" ||
    file === ".github/CODEOWNERS"
  ) {
    return true;
  }
  // Markdown and text under a code folder can be embedded with include_str!.
  return /\.(md|mdx|txt)$/i.test(file) && !startsWithAny(file, CODE_DIRS);
}

/** Files whose change can alter any Rust crate. */
const RUST_GLOBAL = [
  /^Cargo\.(toml|lock)$/,
  /^rust-toolchain\.toml$/,
  /^\.cargo\//,
  /^\.config\/nextest\.toml$/,
  /^justfile$/i,
  /^scripts\/(run-tests|test-ensure-local-relay-key)\.sh$/,
  /^scripts\/(postgres-test-|check-postgres-test-discovery|reconcile-schema)/,
  /^bin\/(pgschema|\.pgschema)/,
];

/** Non-crate files that one crate embeds (include_str!, sqlx migrate!). */
const RUST_OWNED = [
  [/^(migrations|schema)\//, "buzz-db"],
  [/^scripts\/(model-capabilities|normative-corpus)\.json$/, "buzz-agent"],
];

/** Changes that must also run every PostgreSQL package. */
const PG_ALL = [/^(migrations|schema)\//, /^scripts\/postgres-test-/];

/** The CI definition itself: validate it with the whole essential gate. */
const CI_DEFINITION = [
  /^\.github\/workflows\/ci\.yml$/,
  /^scripts\/ci-plan(\.test)?\.mjs$/,
  /^desktop\/tests\/e2e\/affected-map\.json$/,
  /^desktop\/playwright\.config\.ts$/,
];

/** Files that make workflow and release contract scripts worth running. */
const CONTRACT_INPUTS = [
  /^\.github\/(workflows|scripts)\//,
  /^scripts\/(test-|ci-|verify-release-ref|desktop_release|publish-)/,
  /^desktop\/scripts\/(release-|electron-)/,
  /^site\/scripts\//,
  /^justfile$/i,
];

/** Shared desktop inputs: any change reruns every desktop unit test. */
const UNIT_ALL = [
  /^desktop\/(package\.json|biome\.json|vite\.config\.ts|tsconfig[\w.-]*\.json)$/,
  /^desktop\/test-loader[\w-]*\.mjs$/,
  /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|preview-features\.json)$/,
  /^patches\//,
  /^scripts\/(model-capabilities|normative-corpus)\.json$/,
];

const matchesAny = (file, patterns) =>
  patterns.some((pattern) => pattern.test(file));

// -------------------------------------------------------------- cargo graph

/**
 * Reads `cargo metadata --no-deps` for a manifest into
 * `{ name: { dir, deps: [dir...] } }` (dirs relative to the repo root).
 * Returns null when cargo cannot run, which makes the plan use every crate.
 */
export function readCargoGraph(manifest = "Cargo.toml") {
  let metadata;
  try {
    metadata = JSON.parse(
      execFileSync(
        "cargo",
        [
          "metadata",
          "--no-deps",
          "--format-version",
          "1",
          "--manifest-path",
          path.join(repoRoot, manifest),
        ],
        {
          cwd: repoRoot,
          encoding: "utf8",
          env: { ...process.env, RUSTUP_TOOLCHAIN: "stable" },
          maxBuffer: 64 * 1024 * 1024,
        },
      ),
    );
  } catch {
    return null;
  }
  return graphFromMetadata(metadata);
}

export function graphFromMetadata(metadata) {
  const rel = (absolute) =>
    path.relative(repoRoot, absolute).split(path.sep).join("/");
  const graph = {};
  for (const pkg of metadata.packages) {
    graph[pkg.name] = {
      dir: rel(path.dirname(pkg.manifest_path)),
      deps: pkg.dependencies.filter((dep) => dep.path).map((dep) => rel(dep.path)),
    };
  }
  return graph;
}

/** Crate that owns a file: the one whose directory is the longest prefix. */
function ownerOf(graph, file) {
  let best = null;
  for (const [name, { dir }] of Object.entries(graph)) {
    if (file === dir || file.startsWith(`${dir}/`)) {
      if (!best || dir.length > graph[best].dir.length) best = name;
    }
  }
  return best;
}

/** The changed crates plus every crate that (transitively) depends on them. */
export function affectedCrates(graph, files) {
  const changed = new Set();
  for (const file of files) {
    const owner =
      ownerOf(graph, file) ??
      RUST_OWNED.find(([pattern]) => pattern.test(file))?.[1];
    if (owner && graph[owner]) changed.add(owner);
  }
  const byDir = new Map(Object.entries(graph).map(([n, { dir }]) => [dir, n]));
  const dependents = new Map();
  for (const [name, { deps }] of Object.entries(graph)) {
    for (const dir of deps) {
      const dependency = byDir.get(dir);
      if (!dependency) continue;
      if (!dependents.has(dependency)) dependents.set(dependency, new Set());
      dependents.get(dependency).add(name);
    }
  }
  const affected = new Set(changed);
  const queue = [...changed];
  while (queue.length) {
    for (const parent of dependents.get(queue.pop()) ?? []) {
      if (!affected.has(parent)) {
        affected.add(parent);
        queue.push(parent);
      }
    }
  }
  return affected;
}

/** Crates `name` depends on, directly or not, inside the same graph. */
function forwardClosure(graph, start) {
  const byDir = new Map(Object.entries(graph).map(([n, { dir }]) => [dir, n]));
  const seen = new Set();
  const queue = [...start];
  while (queue.length) {
    const name = queue.pop();
    if (seen.has(name) || !graph[name]) continue;
    seen.add(name);
    for (const dir of graph[name].deps) {
      if (byDir.has(dir)) queue.push(byDir.get(dir));
    }
  }
  return seen;
}

// ------------------------------------------------------- desktop unit tests

/** JSONC to JSON: drop comments but leave string contents (like "@/*") alone. */
function stripJsonComments(text) {
  return text.replace(
    /("(?:\\.|[^"\\])*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (match, string) => string ?? "",
  );
}

/** `@/x` style aliases from desktop/tsconfig.json, as absolute path prefixes. */
function readAliases(root) {
  const config = JSON.parse(
    stripJsonComments(readFileSync(path.join(root, "desktop/tsconfig.json"), "utf8")),
  );
  return Object.entries(config.compilerOptions?.paths ?? {}).map(
    ([alias, [target]]) => [
      alias.replace(/\*$/, ""),
      path.resolve(root, "desktop", target.replace(/\*$/, "")),
      alias.endsWith("*"),
    ],
  );
}

const EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"];

/** Resolves a path to a real file, or to a directory dependency, or null. */
function resolveOnDisk(candidate) {
  const bare = candidate.split(/[?#]/, 1)[0];
  for (const extension of EXTENSIONS) {
    const file = bare + extension;
    if (existsSync(file) && statSync(file).isFile()) return { file };
  }
  if (existsSync(bare) && statSync(bare).isDirectory()) {
    for (const extension of EXTENSIONS.slice(1)) {
      const index = path.join(bare, `index${extension}`);
      if (existsSync(index)) return { file: index };
    }
    return { directory: bare };
  }
  return null;
}

// Each pattern requires its own start, so a stray apostrophe in a comment
// cannot swallow a real specifier.
const LITERALS = [
  /["'`](\.{1,2}\/[^"'`\n$]*)["'`]/g,
  /["'`]((?:desktop\/)?(?:src|scripts|electron|tests)\/[^"'`\n$]*)["'`]/g,
  /["'`](@[\w-]*(?:\/[^"'`\n$]*)?)["'`]/g,
];

/**
 * Every repo path a source file can depend on: import specifiers, relative
 * string literals (fs reads, `new URL(...)`), and repo-rooted literals such as
 * "src/features/x.ts". Over-matching only makes more tests run.
 */
function dependenciesOf(file, aliases, root) {
  const text = readFileSync(file, "utf8");
  const results = [];
  for (const literal of LITERALS.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => match[1]),
  )) {
    let candidate = null;
    if (/^\.{1,2}\//.test(literal)) {
      candidate = path.resolve(path.dirname(file), literal);
    } else if (/^(desktop\/)?(src|scripts|electron|tests)\//.test(literal)) {
      candidate = path.resolve(
        root,
        literal.startsWith("desktop/") ? literal : `desktop/${literal}`,
      );
    } else {
      for (const [prefix, target, wildcard] of aliases) {
        if (wildcard ? literal.startsWith(prefix) : literal === prefix) {
          candidate = wildcard
            ? path.join(target, literal.slice(prefix.length))
            : target;
          break;
        }
      }
    }
    const resolved = candidate && resolveOnDisk(candidate);
    if (resolved) results.push(resolved);
  }
  return results;
}

function listFiles(dir, predicate, found = []) {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, predicate, found);
    else if (predicate(full)) found.push(full);
  }
  return found;
}

/** The unit-test files `pnpm test` runs, as paths relative to desktop/. */
export function unitTestFiles(root = repoRoot) {
  const desktop = path.join(root, "desktop");
  const isTest = (file) => file.endsWith(".test.mjs");
  return [
    ...listFiles(path.join(desktop, "src"), isTest),
    ...listFiles(path.join(desktop, "electron"), isTest),
    ...listFiles(path.join(desktop, "tests/real-run/nest-migration"), isTest),
    ...listFiles(path.join(desktop, "scripts"), isTest).filter(
      (file) => path.dirname(file) === path.join(desktop, "scripts"),
    ),
  ]
    .map((file) => path.relative(desktop, file).split(path.sep).join("/"))
    .sort();
}

/**
 * Unit tests that can see a changed file: a test is related when it is changed
 * itself, or when its import graph (plus files and folders it reads) reaches a
 * changed file. Changes under desktop/electron or desktop/scripts rerun every
 * test of that folder, since those tests also launch the scripts they cover.
 */
export function relatedUnitTests(files, root = repoRoot) {
  const changed = files.map((file) => path.resolve(root, file));
  const aliases = readAliases(root);
  const all = unitTestFiles(root);
  const related = new Set();

  for (const folder of ["electron/", "scripts/"]) {
    const touched = files.some(
      (file) => file.startsWith(`desktop/${folder}`) && !file.endsWith(".test.mjs"),
    );
    if (touched) all.filter((test) => test.startsWith(folder)).forEach((t) => related.add(t));
  }

  const memo = new Map();
  const depsOf = (file) => {
    if (!memo.has(file)) {
      memo.set(file, []);
      memo.set(file, /\.(mjs|js|jsx|ts|tsx)$/.test(file) ? dependenciesOf(file, aliases, root) : []);
    }
    return memo.get(file);
  };
  const reaches = (start) => {
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const file = queue.pop();
      if (changed.includes(file)) return true;
      for (const dep of depsOf(file)) {
        if (dep.directory) {
          if (changed.some((c) => c.startsWith(`${dep.directory}${path.sep}`))) return true;
        } else if (!seen.has(dep.file)) {
          seen.add(dep.file);
          queue.push(dep.file);
        }
      }
    }
    return false;
  };
  for (const test of all) {
    if (!related.has(test) && reaches(path.resolve(root, "desktop", test))) {
      related.add(test);
    }
  }
  return [...related].sort();
}

// ----------------------------------------------------------------- e2e map

export const globToRegExp = (glob) =>
  new RegExp(
    `^${glob
      .split(/(\*\*\/|\*\*|\*)/)
      .map((part) =>
        part === "**/"
          ? "(?:.*/)?"
          : part === "**"
            ? ".*"
            : part === "*"
              ? "[^/]*"
              : part.replace(/[.+^${}()|[\]\\?]/g, "\\$&"),
      )
      .join("")}$`,
  );

export function readAffectedMap(root = repoRoot) {
  return JSON.parse(
    readFileSync(path.join(root, "desktop/tests/e2e/affected-map.json"), "utf8"),
  );
}

/** True for a spec file that exists and is part of the `smoke` project. */
export function smokeRunnable(root = repoRoot) {
  const config = readFileSync(path.join(root, "desktop/playwright.config.ts"), "utf8");
  const block = /name: "smoke",\s*testMatch: \[([\s\S]*?)\],/.exec(config)?.[1] ?? "";
  const matchers = [...block.matchAll(/"([^"]+)"/g)].map((m) => globToRegExp(m[1]));
  return (spec) =>
    existsSync(path.join(root, "desktop/tests/e2e", spec)) &&
    matchers.some((matcher) => matcher.test(`tests/e2e/${spec}`));
}

const E2E_INPUTS = [
  /^desktop\/(src|tests\/e2e|tests\/helpers|public)\//,
  /^desktop\/(index\.html|vite\.config\.ts|tailwind\.config\.js|postcss\.config\.js|playwright\.config\.ts|package\.json|tsconfig[\w.-]*\.json)$/,
  /^(pnpm-lock\.yaml|preview-features\.json)$/,
  /^scripts\/(model-capabilities|normative-corpus)\.json$/,
];

/**
 * Which Playwright specs to run: none, the specs mapped to the changed
 * folders, or the essential set (shared code or an unmapped path).
 */
export function planE2e(files, map, runnable = () => true) {
  const relevant = files.filter((file) => matchesAny(file, E2E_INPUTS));
  if (relevant.length === 0) return { mode: "none", specs: [], reasons: [] };

  const shared = map.shared.map(globToRegExp);
  const features = map.features.map((entry) => ({
    ...entry,
    patterns: entry.paths.map(globToRegExp),
  }));
  const specs = new Set();
  const reasons = [];
  let essential = false;

  for (const file of relevant) {
    const specFile = /^desktop\/tests\/e2e\/([\w.-]+\.spec\.ts)$/.exec(file)?.[1];
    if (specFile) {
      // A changed spec reruns itself (the manual suites own the rest).
      if (runnable(specFile)) specs.add(specFile);
      continue;
    }
    if (shared.some((pattern) => pattern.test(file))) {
      essential = true;
      reasons.push(`${file}: shared code`);
      continue;
    }
    const hits = features.filter((entry) => entry.patterns.some((p) => p.test(file)));
    if (hits.length === 0) {
      essential = true;
      reasons.push(`${file}: not mapped`);
      continue;
    }
    for (const hit of hits) hit.specs.forEach((spec) => specs.add(spec));
  }
  if (essential) return { mode: "essential", specs: [], reasons };
  const selected = [...specs].filter((spec) => runnable(spec)).sort();
  if (selected.length === 0) return { mode: "essential", specs: [], reasons: ["no mapped spec"] };
  return { mode: "specs", specs: selected, reasons: [] };
}

// -------------------------------------------------------------------- plan

/**
 * @param {string[]} files changed paths relative to the repo root
 * @param {object} context graph/postgres/map/specExists/unit overrides (tests)
 */
export function createPlan(files, context = {}) {
  const everything = context.everything === true;
  const graph = context.graph === undefined ? readCargoGraph() : context.graph;
  const tauriGraph =
    context.tauriGraph === undefined
      ? readCargoGraph("desktop/src-tauri/Cargo.toml")
      : context.tauriGraph;
  const map = context.map ?? readAffectedMap();
  const runnable = context.runnable ?? smokeRunnable();
  const unitRelated = context.unitRelated ?? ((list) => relatedUnitTests(list));
  const postgresPackages = context.postgresPackages ?? readPostgresPackages();

  const code = everything ? ["Cargo.lock"] : files.filter((file) => !isDocsOnly(file));
  const docsOnly = !everything && code.length === 0;
  const plan = {
    docs_only: docsOnly,
    full: false,
    rust_packages: [],
    rust_all: false,
    tauri: false,
    pg_packages: [],
    desktop_js: false,
    unit_mode: "none",
    unit_files: [],
    e2e: { mode: "none", specs: [], reasons: [] },
    web: false,
    mobile: false,
    deny: false,
    contracts: false,
  };
  if (docsOnly) return plan;

  const ciDefinition = everything || code.some((file) => matchesAny(file, CI_DEFINITION));
  plan.full = ciDefinition;

  // Rust: changed crates and their dependents.
  const rustGlobal = code.some((file) => matchesAny(file, RUST_GLOBAL)) || ciDefinition;
  const rustTouched = code.some(
    (file) => startsWithAny(file, ["crates/", "examples/"]) || RUST_OWNED.some(([p]) => p.test(file)),
  );
  if (graph === null && (rustGlobal || rustTouched)) {
    plan.rust_all = true;
  } else if (graph) {
    const everyCrate = Object.keys(graph).sort();
    const affected = rustGlobal ? new Set(everyCrate) : affectedCrates(graph, code);
    plan.rust_all = affected.size === everyCrate.length;
    plan.rust_packages = [...affected].sort();
    const pgAll = code.some((file) => matchesAny(file, PG_ALL)) || rustGlobal;
    plan.pg_packages = postgresPackages.filter((name) => pgAll || affected.has(name));
    if (tauriGraph) {
      const tauriNames = Object.keys(tauriGraph);
      const tauriRootDeps = tauriNames.flatMap((name) =>
        Object.entries(graph)
          .filter(([, { dir }]) => tauriGraph[name].deps.includes(dir))
          .map(([crate]) => crate),
      );
      const reachable = forwardClosure(graph, tauriRootDeps);
      plan.tauri = [...affected].some((crate) => reachable.has(crate));
    }
  }
  if (code.some((file) => startsWithAny(file, ["desktop/src-tauri/", "desktop/identity-kernel/", "desktop/identity-store/"])) || rustGlobal || graph === null) {
    plan.tauri = true;
  }

  // Desktop front end: lint and type-check, then only the related unit tests.
  const desktopChanged = code.some(
    (file) =>
      (file.startsWith("desktop/") &&
        !startsWithAny(file, ["desktop/src-tauri/", "desktop/identity-kernel/", "desktop/identity-store/"])) ||
      matchesAny(file, UNIT_ALL),
  );
  plan.desktop_js = desktopChanged || ciDefinition;
  if (plan.desktop_js) {
    if (ciDefinition || code.some((file) => matchesAny(file, UNIT_ALL))) {
      plan.unit_mode = "all";
    } else {
      plan.unit_files = unitRelated(code);
      plan.unit_mode = plan.unit_files.length > 0 ? "related" : "none";
    }
  }

  plan.e2e = ciDefinition
    ? { mode: "essential", specs: [], reasons: ["CI definition changed"] }
    : planE2e(code, map, runnable);

  plan.web = code.some((file) => file.startsWith("web/") || /^(pnpm-lock\.yaml|pnpm-workspace\.yaml)$/.test(file));
  plan.mobile = code.some((file) => file.startsWith("mobile/") || /^scripts\/(test-mobile-gateway-recipes|mobile-google-auth-xcconfig)\.sh$/.test(file));
  plan.deny = code.some((file) => file === "Cargo.lock" || file === "deny.toml");
  plan.contracts = ciDefinition || code.some((file) => matchesAny(file, CONTRACT_INPUTS));
  return plan;
}

function readPostgresPackages() {
  try {
    return execFileSync(path.join(repoRoot, "scripts/postgres-test-packages.sh"), {
      cwd: repoRoot,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ----------------------------------------------------------------- outputs

function shardCount(specs) {
  return Math.min(4, Math.max(1, Math.ceil(specs / 8)));
}

/** Flat key/value pairs for $GITHUB_OUTPUT. Every value is a single line. */
export function toOutputs(plan) {
  const safe = (names) => names.filter((name) => SAFE_NAME.test(name));
  const packages = safe(plan.rust_packages);
  const pg = safe(plan.pg_packages);
  const specs = safe(plan.e2e.specs);
  const e2eArgs =
    plan.e2e.mode === "essential"
      ? "--project=essential --project=essential-focus"
      : plan.e2e.mode === "specs"
        ? `--project=smoke ${specs.map((spec) => `tests/e2e/${spec.replaceAll(".", "\\.")}$`).join(" ")}`
        : "";
  // An empty matrix is an error in GitHub Actions, so "none" still lists one shard.
  const shards =
    plan.e2e.mode === "essential"
      ? 2
      : plan.e2e.mode === "specs"
        ? shardCount(specs.length)
        : 1;
  return {
    docs_only: String(plan.docs_only),
    rust: String(packages.length > 0 || plan.rust_all),
    rust_all: String(plan.rust_all),
    rust_package_args: plan.rust_all ? "--workspace" : packages.map((n) => `-p ${n}`).join(" "),
    unit_test_crates: plan.rust_all ? "all" : packages.join(" "),
    tauri: String(plan.tauri),
    postgres: String(pg.length > 0),
    postgres_package_args: pg.map((n) => `-p ${n}`).join(" "),
    desktop_js: String(plan.desktop_js),
    unit_mode: plan.unit_mode,
    unit_files: plan.unit_files.filter((f) => /^[\w./@-]+$/.test(f)).join(" "),
    e2e_mode: plan.e2e.mode,
    e2e_args: e2eArgs,
    e2e_shards: JSON.stringify(Array.from({ length: shards }, (_, i) => i + 1)),
    e2e_total_shards: String(shards),
    web: String(plan.web),
    mobile: String(plan.mobile),
    deny: String(plan.deny),
    contracts: String(plan.contracts),
  };
}

export function summarize(plan, outputs) {
  const row = (job, runs, why) => `| ${job} | ${runs ? "runs" : "skipped"} | ${why} |`;
  const crates = plan.rust_all ? "every crate" : plan.rust_packages.join(", ") || "none";
  return [
    "### CI plan",
    "",
    "| Job | | Why |",
    "| --- | --- | --- |",
    row("Desktop lint and types", plan.desktop_js, plan.desktop_js ? "desktop files changed" : "no desktop change"),
    row("Desktop unit tests", plan.unit_mode !== "none", `${plan.unit_mode}${plan.unit_files.length ? ` (${plan.unit_files.length} files)` : ""}`),
    row("Rust clippy and tests", outputs.rust === "true", crates),
    row("Desktop native host (Tauri crate)", plan.tauri, plan.tauri ? "host or a crate it uses changed" : "untouched"),
    row("PostgreSQL tests", outputs.postgres === "true", plan.pg_packages.join(", ") || "no database crate affected"),
    row("Desktop E2E", plan.e2e.mode !== "none", plan.e2e.mode === "specs" ? plan.e2e.specs.join(", ") : plan.e2e.mode),
    row("Web", plan.web, "web/ changed"),
    row("Mobile", plan.mobile, "mobile/ changed"),
    row("cargo-deny", plan.deny, "Cargo.lock or deny.toml changed"),
    row("Workflow contracts", plan.contracts, "CI or release definitions changed"),
    plan.docs_only ? "\nDocs or site only: no desktop or Rust job runs." : "",
    ...plan.e2e.reasons.slice(0, 8).map((reason) => `\n- E2E essential set because ${reason}`),
  ].join("\n");
}

// -------------------------------------------------------------------- main

function git(...args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
}

function changedFiles(base, head) {
  return git("diff", "--name-only", "--no-renames", base, head)
    .split("\n")
    .filter(Boolean);
}

function main(argv) {
  const option = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  const everything = argv.includes("--all");
  let files = [];
  if (!everything) {
    const base = option("--base");
    // A missing or unreachable base (new branch, force push) plans everything.
    let usable = Boolean(base) && !/^0+$/.test(base);
    if (usable) {
      try {
        files = changedFiles(base, option("--head") ?? "HEAD");
      } catch {
        usable = false;
      }
    }
    if (!usable) return emit(createPlan([], { everything: true }), argv);
  }
  return emit(createPlan(files, { everything }), argv, files);
}

function emit(plan, argv, files = []) {
  const outputs = toOutputs(plan);
  const summary = summarize(plan, outputs);
  console.log(JSON.stringify({ files: files.length, plan, outputs }, null, 2));
  if (argv.includes("--github-output") && process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(outputs).map(([k, v]) => `${k}=${v}\n`).join(""),
    );
  }
  if (argv.includes("--github-output") && process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
