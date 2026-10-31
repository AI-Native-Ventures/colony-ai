import assert from "node:assert/strict";
import test from "node:test";
import {
  PACKAGE_WORKFLOW_PATH,
  RELEASE_ARTIFACTS,
  provenanceProblem,
  selectCandidate,
} from "./select-release-candidate.mjs";

const REPO = "owner/colony";
const HEAD = "a".repeat(40);
const TREE = "b".repeat(40);

function run(overrides = {}) {
  return {
    id: 100,
    path: PACKAGE_WORKFLOW_PATH,
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    head_branch: "release/3.0.20-candidate",
    head_sha: HEAD,
    created_at: "2026-10-31T06:00:00Z",
    html_url: "https://github.com/owner/colony/actions/runs/100",
    repository: { full_name: REPO, id: 1 },
    head_repository: { full_name: REPO, id: 1 },
    ...overrides,
  };
}

function world(overrides = {}) {
  const state = {
    runs: [run()],
    trees: { [HEAD]: TREE },
    pulls: [
      {
        base: { ref: "main", repo: { full_name: REPO } },
        head: {
          ref: "release/3.0.20-candidate",
          sha: HEAD,
          repo: { full_name: REPO },
        },
      },
    ],
    jobs: [
      { name: "Resolve optional release signing", conclusion: "success" },
      { name: "Package Electron (darwin-arm64)", conclusion: "success" },
      { name: "Package Electron (win32-x64)", conclusion: "success" },
    ],
    artifacts: RELEASE_ARTIFACTS.map((name) => ({
      name,
      expired: false,
      size_in_bytes: 1000,
      workflow_run: { id: 100, head_sha: HEAD },
    })),
    ...overrides,
  };
  const calls = [];
  const getJson = async (route) => {
    calls.push(route);
    if (route.includes("/workflows/electron-package.yml/runs")) {
      return { workflow_runs: state.runs };
    }
    const commit = /\/git\/commits\/([0-9a-f]+)$/.exec(route);
    if (commit) return { tree: { sha: state.trees[commit[1]] } };
    if (route.includes("/pulls")) return state.pulls;
    if (route.endsWith("/jobs?per_page=100")) return { jobs: state.jobs };
    if (route.endsWith("/artifacts?per_page=100"))
      return { artifacts: state.artifacts };
    throw new Error(`unexpected route ${route}`);
  };
  return { getJson, calls };
}

const select = (state, tagTree = TREE) =>
  selectCandidate({ repo: REPO, tagTree, getJson: world(state).getJson });

test("reuses a green candidate run whose head tree equals the tag tree", async () => {
  const result = await select();
  assert.equal(result.reuse, true);
  assert.equal(result.runId, "100");
  assert.equal(result.headSha, HEAD);
  assert.equal(result.tree, TREE);
});

test("builds when the trees differ", async () => {
  const result = await select({}, "c".repeat(40));
  assert.equal(result.reuse, false);
  assert.match(result.reason, /differs/);
});

test("builds when the tag tree is not a full hash", async () => {
  assert.equal((await select({}, "")).reuse, false);
  assert.equal((await select({}, "abc")).reuse, false);
});

test("builds when no candidate run exists", async () => {
  const result = await select({ runs: [] });
  assert.equal(result.reuse, false);
});

test("ignores runs that are not release candidate pull requests", async () => {
  for (const overrides of [
    { head_branch: "feature/x" },
    { head_branch: "release/3.0.20-candidate/extra" },
    { event: "workflow_dispatch" },
    { event: "push" },
    { conclusion: "failure" },
    { conclusion: "cancelled" },
    { status: "in_progress" },
    { path: ".github/workflows/other.yml" },
    { head_repository: { full_name: "fork/colony", id: 2 } },
    { repository: { full_name: "other/colony", id: 3 } },
    { head_sha: "abc" },
  ]) {
    const { getJson } = world({ runs: [run(overrides)] });
    const result = await selectCandidate({
      repo: REPO,
      tagTree: TREE,
      getJson,
    });
    assert.equal(result.reuse, false, JSON.stringify(overrides));
  }
});

test("provenanceProblem accepts the expected run", () => {
  assert.equal(provenanceProblem(run(), REPO), null);
});

test("builds when the commit has no pull request into main from this repo", async () => {
  for (const pulls of [
    [],
    [
      {
        base: { ref: "develop", repo: { full_name: REPO } },
        head: {
          ref: "release/3.0.20-candidate",
          sha: HEAD,
          repo: { full_name: REPO },
        },
      },
    ],
    [
      {
        base: { ref: "main", repo: { full_name: REPO } },
        head: {
          ref: "release/3.0.20-candidate",
          sha: HEAD,
          repo: { full_name: "fork/colony" },
        },
      },
    ],
    [
      {
        base: { ref: "main", repo: { full_name: REPO } },
        head: { ref: "other", sha: HEAD, repo: { full_name: REPO } },
      },
    ],
  ]) {
    assert.equal((await select({ pulls })).reuse, false);
  }
});

test("builds when any job did not succeed or a package job is missing", async () => {
  const jobs = [
    { name: "Package Electron (darwin-arm64)", conclusion: "success" },
    { name: "Package Electron (win32-x64)", conclusion: "skipped" },
  ];
  assert.equal((await select({ jobs })).reuse, false);
  assert.equal((await select({ jobs: [jobs[0]] })).reuse, false);
  assert.equal((await select({ jobs: [] })).reuse, false);
});

test("builds when an installer artifact is missing, expired, empty or foreign", async () => {
  const good = (name) => ({
    name,
    expired: false,
    size_in_bytes: 1000,
    workflow_run: { id: 100, head_sha: HEAD },
  });
  const [mac, win] = RELEASE_ARTIFACTS.map(good);
  for (const artifacts of [
    [],
    [mac],
    [mac, { ...win, expired: true }],
    [mac, { ...win, size_in_bytes: 0 }],
    [mac, { ...win, workflow_run: { id: 999, head_sha: HEAD } }],
    [mac, { ...win, workflow_run: { id: 100, head_sha: "d".repeat(40) } }],
    [mac, win, { ...win }],
    [{ ...mac, name: "colony-electron-darwin-arm64" }, win],
  ]) {
    assert.equal(
      (await select({ artifacts })).reuse,
      false,
      JSON.stringify(artifacts),
    );
  }
});

test("prefers the newest valid run and skips newer runs that cannot be reused", async () => {
  const older = run({ id: 100, created_at: "2026-10-30T00:00:00Z" });
  const newerBad = run({
    id: 200,
    created_at: "2026-10-31T00:00:00Z",
    head_sha: "e".repeat(40),
  });
  const { getJson } = world({
    runs: [older, newerBad],
    trees: { [HEAD]: TREE, ["e".repeat(40)]: "f".repeat(40) },
  });
  const result = await selectCandidate({ repo: REPO, tagTree: TREE, getJson });
  assert.equal(result.reuse, true);
  assert.equal(result.runId, "100");
});

test("an API failure propagates so the caller can fall back to building", async () => {
  await assert.rejects(
    selectCandidate({
      repo: REPO,
      tagTree: TREE,
      getJson: async () => {
        throw new Error("boom");
      },
    }),
    /boom/,
  );
});

test("stops looking once the deadline passes", async () => {
  let clock = 0;
  const { getJson } = world({ runs: [run({ id: 1 }), run({ id: 2 })] });
  const result = await selectCandidate({
    repo: REPO,
    tagTree: "c".repeat(40),
    getJson,
    now: () => (clock += 100_000),
  });
  assert.equal(result.reuse, false);
  assert.match(result.reason, /deadline/);
});
