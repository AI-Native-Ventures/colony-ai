import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import {
  affectedCrates,
  createPlan,
  globToRegExp,
  isDocsOnly,
  planE2e,
  readAffectedMap,
  relatedUnitTests,
  smokeRunnable,
  toOutputs,
} from "./ci-plan.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// core <- db <- relay, core <- cli, host (desktop) depends on core.
const graph = {
  "buzz-core": { dir: "crates/buzz-core", deps: [] },
  "buzz-db": { dir: "crates/buzz-db", deps: ["crates/buzz-core"] },
  "buzz-relay": { dir: "crates/buzz-relay", deps: ["crates/buzz-db", "crates/buzz-core"] },
  "buzz-cli": { dir: "crates/buzz-cli", deps: ["crates/buzz-core"] },
  "buzz-voice": { dir: "crates/buzz-voice", deps: [] },
};
const tauriGraph = {
  "buzz-desktop": { dir: "desktop/src-tauri", deps: ["crates/buzz-core"] },
};
const postgresPackages = ["buzz-db", "buzz-relay"];
const map = {
  shared: ["desktop/src/app/**", "desktop/src/shared/**"],
  features: [
    { paths: ["desktop/src/features/money/**"], specs: ["money.spec.ts"] },
    { paths: ["desktop/src/features/leads/**"], specs: ["leads.spec.ts", "money.spec.ts"] },
  ],
};
const context = {
  graph,
  tauriGraph,
  postgresPackages,
  map,
  runnable: () => true,
  unitRelated: (files) => files.filter((f) => f.endsWith(".ts")).map((f) => `${f}.test.mjs`),
};
const plan = (...files) => createPlan(files, context);

test("documentation and website changes run nothing", () => {
  const result = plan("README.md", "docs/plan.md", "site/public/index.html");
  assert.equal(result.docs_only, true);
  assert.deepEqual(
    [result.rust_packages, result.desktop_js, result.unit_mode, result.e2e.mode, result.tauri, result.contracts],
    [[], false, "none", "none", false, false],
  );
  assert.equal(isDocsOnly("crates/buzz-core/prompts/system.md"), false, "embedded markdown is code");
});

test("a relay-only change tests the relay and its database, nothing in the desktop", () => {
  const result = plan("crates/buzz-relay/src/main.rs");
  assert.deepEqual(result.rust_packages, ["buzz-relay"]);
  assert.deepEqual(result.pg_packages, ["buzz-relay"]);
  assert.equal(result.tauri, false);
  assert.equal(result.desktop_js, false);
  assert.equal(result.e2e.mode, "none");
});

test("a changed crate also tests every crate that depends on it", () => {
  assert.deepEqual(
    [...affectedCrates(graph, ["crates/buzz-db/src/lib.rs"])].sort(),
    ["buzz-db", "buzz-relay"],
  );
  const result = plan("crates/buzz-core/src/kind.rs");
  assert.deepEqual(result.rust_packages, ["buzz-cli", "buzz-core", "buzz-db", "buzz-relay"]);
  assert.equal(result.tauri, true, "the desktop host depends on buzz-core");
  assert.equal(plan("crates/buzz-voice/src/lib.rs").tauri, false);
});

test("migrations run every PostgreSQL package; Cargo.lock runs every crate and cargo-deny", () => {
  const migration = plan("migrations/0001_x.sql");
  assert.deepEqual(migration.pg_packages, postgresPackages);
  assert.ok(migration.rust_packages.includes("buzz-db"));
  const lock = plan("Cargo.lock");
  assert.equal(lock.rust_all, true);
  assert.equal(lock.deny, true);
});

test("a single-feature desktop change runs lint, related unit tests and mapped specs only", () => {
  const result = plan("desktop/src/features/money/ui/MoneyPage.ts");
  assert.equal(result.desktop_js, true);
  assert.equal(result.unit_mode, "related");
  assert.deepEqual(result.unit_files, ["desktop/src/features/money/ui/MoneyPage.ts.test.mjs"]);
  assert.deepEqual(result.e2e, { mode: "specs", specs: ["money.spec.ts"], reasons: [] });
  assert.equal(result.rust_packages.length, 0);
  assert.equal(result.tauri, false);
});

test("shared code and unmapped paths run the essential set", () => {
  assert.equal(plan("desktop/src/app/AppShell.tsx").e2e.mode, "essential");
  assert.equal(plan("desktop/src/shared/ui/button.tsx").e2e.mode, "essential");
  assert.equal(plan("desktop/src/features/unknown/Thing.tsx").e2e.mode, "essential");
  assert.equal(plan("desktop/tailwind.config.js").e2e.mode, "essential");
});

test("shared config or package files rerun every unit test", () => {
  for (const file of ["desktop/package.json", "pnpm-lock.yaml", "desktop/tsconfig.json"]) {
    assert.equal(plan(file).unit_mode, "all", file);
  }
});

test("a changed spec reruns itself; the native host alone skips the front end", () => {
  assert.deepEqual(plan("desktop/tests/e2e/money.spec.ts").e2e.specs, ["money.spec.ts"]);
  const host = plan("desktop/src-tauri/src/lib.rs");
  assert.equal(host.tauri, true);
  assert.equal(host.desktop_js, false);
  assert.equal(host.e2e.mode, "none");
});

test("changing the CI definition validates it with the whole essential gate", () => {
  const result = plan(".github/workflows/ci.yml");
  assert.equal(result.rust_all, true);
  assert.equal(result.unit_mode, "all");
  assert.equal(result.e2e.mode, "essential");
  assert.equal(result.contracts, true);
});

test("an unknown base plans everything instead of nothing", () => {
  const result = createPlan([], { ...context, everything: true });
  assert.equal(result.rust_all, true);
  assert.equal(result.e2e.mode, "essential");
});

test("cargo being unavailable falls back to every crate", () => {
  const result = createPlan(["crates/buzz-relay/src/main.rs"], { ...context, graph: null });
  assert.equal(result.rust_all, true);
});

test("outputs are single-line and reject unsafe names", () => {
  const outputs = toOutputs({
    ...plan("desktop/src/features/money/ui/MoneyPage.ts"),
    rust_packages: ["ok-crate", "bad crate; rm -rf /"],
  });
  assert.equal(outputs.rust_package_args, "-p ok-crate");
  assert.equal(outputs.e2e_args, "--project=smoke tests/e2e/money\\.spec\\.ts$");
  for (const value of Object.values(outputs)) assert.ok(!value.includes("\n"));
  assert.equal(toOutputs(plan("desktop/src/app/AppShell.tsx")).e2e_args, "--project=essential --project=essential-focus");
});

test("glob patterns keep ** and * apart", () => {
  const pattern = globToRegExp("desktop/src/features/messages/ui/*Composer*");
  assert.ok(pattern.test("desktop/src/features/messages/ui/MessageComposer.tsx"));
  assert.ok(!pattern.test("desktop/src/features/messages/ui/sub/MessageComposer.tsx"));
  assert.ok(globToRegExp("desktop/src/app/**").test("desktop/src/app/navigation/a.ts"));
  assert.ok(globToRegExp("**/x.spec.ts").test("tests/e2e/x.spec.ts"));
  assert.ok(globToRegExp("desktop/src/*").test("desktop/src/main.tsx"));
  assert.ok(!globToRegExp("desktop/src/*").test("desktop/src/app/a.ts"));
});

test("planE2e: none for non-desktop files", () => {
  assert.equal(planE2e(["crates/buzz-core/src/lib.rs"], map).mode, "none");
});

// ------------------------------------------------------------ real map file

test("affected-map.json names real smoke specs and real focus titles", () => {
  const realMap = readAffectedMap(repoRoot);
  const runnable = smokeRunnable(repoRoot);
  const mapped = [
    ...realMap.essential.specs,
    ...realMap.essential.focus.specs,
    ...realMap.features.flatMap((entry) => entry.specs),
  ];
  for (const spec of mapped) assert.ok(runnable(spec), `${spec} must exist and be in the smoke project`);
  for (const entry of realMap.features) {
    assert.ok(entry.paths.length > 0 && entry.specs.length > 0, JSON.stringify(entry.paths));
  }
  const focusSource = realMap.essential.focus.specs
    .map((spec) => readFileSync(path.join(repoRoot, "desktop/tests/e2e", spec), "utf8"))
    .join("\n");
  for (const title of realMap.essential.focus.titles) {
    assert.ok(focusSource.includes(title), `focus title not found in any focus spec: ${title}`);
  }
});

test("the essential and focus projects in playwright.config.ts read the map", () => {
  const config = readFileSync(path.join(repoRoot, "desktop/playwright.config.ts"), "utf8");
  assert.match(config, /affected-map\.json/);
  assert.match(config, /name: "essential"/);
  assert.match(config, /name: "essential-focus"/);
});

// ------------------------------------------------------ unit import graph

const scratch = mkdtempSync(path.join(tmpdir(), "ci-plan-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

function fixture(files) {
  const root = mkdtempSync(path.join(scratch, "repo-"));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), content);
  }
  return root;
}

test("related unit tests follow imports, aliases, file reads and folders", () => {
  const root = fixture({
    "desktop/tsconfig.json": `{
      /* comment */
      "compilerOptions": { "paths": { "@/*": ["./src/*"] } }
    }`,
    "desktop/src/lib/leaf.ts": "export const leaf = 1;",
    "desktop/src/lib/mid.ts": 'import { leaf } from "./leaf";\nexport const mid = leaf;',
    "desktop/src/lib/mid.test.mjs": 'import { mid } from "./mid.ts";',
    "desktop/src/other/aliased.ts": 'import { leaf } from "@/lib/leaf";',
    "desktop/src/other/aliased.test.mjs": 'import "./aliased.ts";',
    "desktop/src/other/reads.test.mjs": 'readFileSync(new URL("../lib/mid.ts", import.meta.url));',
    "desktop/src/other/scans.test.mjs": 'const dir = "../styles";',
    "desktop/src/styles/a.css": "a{}",
    "desktop/src/unrelated/solo.ts": "export {};",
    "desktop/src/unrelated/solo.test.mjs": 'import "./solo.ts";',
    "desktop/scripts/tool.mjs": "export {};",
    "desktop/scripts/tool.test.mjs": "spawn('node', ['x']);",
    "desktop/scripts/other.test.mjs": "",
  });
  const related = (...files) => relatedUnitTests(files, root);
  assert.deepEqual(related("desktop/src/lib/leaf.ts"), [
    "src/lib/mid.test.mjs",
    "src/other/aliased.test.mjs",
    "src/other/reads.test.mjs",
  ]);
  assert.deepEqual(related("desktop/src/styles/a.css"), ["src/other/scans.test.mjs"]);
  assert.deepEqual(related("desktop/src/unrelated/solo.test.mjs"), ["src/unrelated/solo.test.mjs"]);
  assert.deepEqual(related("desktop/src/brand-new/file.tsx"), []);
  assert.deepEqual(related("desktop/scripts/tool.mjs"), ["scripts/other.test.mjs", "scripts/tool.test.mjs"]);
});

test("the real desktop tree resolves its import graph", () => {
  const related = relatedUnitTests(["desktop/src/app/communityViewTransition.ts"], repoRoot);
  assert.ok(related.includes("src/app/communityViewTransition.test.mjs"), related.join(", "));
});
