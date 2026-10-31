// Picks the release candidate build a desktop release may reuse.
//
// The candidate pull request into main (branch release/<version>-candidate)
// already builds both installers through electron-package.yml. When the tagged
// commit has exactly the same source tree, the tag build would repeat that
// work, so the release publishes the candidate's installers instead.
//
// Anything unclear means "build". Every failure path returns reuse=false and
// never an error: the release must stay correct first and fast second.
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const PACKAGE_WORKFLOW_PATH = ".github/workflows/electron-package.yml";
export const CANDIDATE_BRANCH = /^release\/[^/]+-candidate$/;
export const RELEASE_ARTIFACTS = [
  "colony-electron-release-darwin-arm64",
  "colony-electron-release-win32-x64",
];
export const PACKAGE_JOBS = [
  "Package Electron (darwin-arm64)",
  "Package Electron (win32-x64)",
];
const MAX_RUNS_CHECKED = 30;
const API_TIMEOUT_MS = 30_000;
const TOTAL_DEADLINE_MS = 150_000;

function skip(reason) {
  return { reuse: false, reason };
}

function shaPattern(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

/** Why a run may not be reused, or null when its provenance is acceptable. */
export function provenanceProblem(run, repo) {
  if (run.path !== PACKAGE_WORKFLOW_PATH) return "not the package workflow";
  if (run.event !== "pull_request") return "not a pull_request run";
  if (run.status !== "completed" || run.conclusion !== "success") {
    return "run was not fully green";
  }
  if (run.repository?.full_name !== repo)
    return "run is from another repository";
  if (run.head_repository?.full_name !== repo) return "run is from a fork";
  if (!CANDIDATE_BRANCH.test(run.head_branch ?? "")) {
    return "not a release/*-candidate branch";
  }
  if (!shaPattern(run.head_sha)) return "run head sha is not a full sha";
  return null;
}

/** The run's commit must belong to a pull request into main from this repository. */
export function pullRequestProblem(pulls, run, repo) {
  const intoMain = (Array.isArray(pulls) ? pulls : []).some(
    (pull) =>
      pull?.base?.ref === "main" &&
      pull?.base?.repo?.full_name === repo &&
      pull?.head?.ref === run.head_branch &&
      pull?.head?.repo?.full_name === repo &&
      pull?.head?.sha === run.head_sha,
  );
  return intoMain ? null : "no pull request into main from this repository";
}

function jobsProblem(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) return "no jobs found";
  for (const name of PACKAGE_JOBS) {
    if (!jobs.some((job) => job.name === name)) return `missing job ${name}`;
  }
  const bad = jobs.find((job) => job.conclusion !== "success");
  return bad ? `job ${bad.name} did not succeed` : null;
}

function artifactsProblem(artifacts, run) {
  for (const name of RELEASE_ARTIFACTS) {
    const matches = (artifacts ?? []).filter((item) => item.name === name);
    if (matches.length !== 1)
      return `expected one ${name}, found ${matches.length}`;
    const [item] = matches;
    if (item.expired) return `${name} expired`;
    if (!(item.size_in_bytes > 0)) return `${name} is empty`;
    if (item.workflow_run?.id !== run.id)
      return `${name} belongs to another run`;
    if (item.workflow_run?.head_sha !== run.head_sha) {
      return `${name} was built from another commit`;
    }
  }
  return null;
}

/**
 * @param {object} options
 * @param {string} options.repo owner/name of this repository
 * @param {string} options.tagTree tree hash of the tagged commit
 * @param {(url: string) => Promise<any>} options.getJson GitHub API reader
 * @param {() => number} [options.now]
 */
export async function selectCandidate({
  repo,
  tagTree,
  getJson,
  now = Date.now,
}) {
  if (!/^[0-9a-f]{40}$/.test(tagTree ?? ""))
    return skip("tag tree is not a full hash");
  const deadline = now() + TOTAL_DEADLINE_MS;
  const base = `repos/${repo}`;
  const listing = await getJson(
    `${base}/actions/workflows/electron-package.yml/runs?event=pull_request&status=success&per_page=100`,
  );
  const runs = (listing?.workflow_runs ?? [])
    .filter((run) => run.head_branch && CANDIDATE_BRANCH.test(run.head_branch))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, MAX_RUNS_CHECKED);
  if (runs.length === 0) return skip("no candidate pull request runs found");

  const notes = [];
  for (const run of runs) {
    if (now() > deadline) return skip("lookup deadline reached");
    const problem = provenanceProblem(run, repo);
    if (problem) {
      notes.push(`run ${run.id}: ${problem}`);
      continue;
    }
    const commit = await getJson(`${base}/git/commits/${run.head_sha}`);
    const tree = commit?.tree?.sha;
    if (tree !== tagTree) {
      notes.push(`run ${run.id}: tree ${String(tree).slice(0, 12)} differs`);
      continue;
    }
    const pulls = await getJson(
      `${base}/commits/${run.head_sha}/pulls?per_page=100`,
    );
    const pullProblem = pullRequestProblem(pulls, run, repo);
    if (pullProblem) {
      notes.push(`run ${run.id}: ${pullProblem}`);
      continue;
    }
    const jobs = await getJson(
      `${base}/actions/runs/${run.id}/jobs?per_page=100`,
    );
    const jobProblem = jobsProblem(jobs?.jobs);
    if (jobProblem) {
      notes.push(`run ${run.id}: ${jobProblem}`);
      continue;
    }
    const artifacts = await getJson(
      `${base}/actions/runs/${run.id}/artifacts?per_page=100`,
    );
    const artifactProblem = artifactsProblem(artifacts?.artifacts, run);
    if (artifactProblem) {
      notes.push(`run ${run.id}: ${artifactProblem}`);
      continue;
    }
    return {
      reuse: true,
      reason: "candidate build with an identical source tree",
      runId: String(run.id),
      headSha: run.head_sha,
      tree,
      runUrl:
        run.html_url ?? `https://github.com/${repo}/actions/runs/${run.id}`,
      branch: run.head_branch,
    };
  }
  return skip(`no reusable candidate (${notes.slice(0, 5).join("; ")})`);
}

function writeOutputs(result) {
  const lines = {
    reuse: result.reuse ? "true" : "false",
    reason: String(result.reason).replace(/[\r\n]+/g, " "),
    run_id: result.runId ?? "",
    head_sha: result.headSha ?? "",
    tree: result.tree ?? "",
    run_url: result.runUrl ?? "",
    branch: result.branch ?? "",
  };
  const body = Object.entries(lines).map(([key, value]) => `${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${body.join("\n")}\n`);
  }
  console.log(body.join("\n"));
}

async function main() {
  let result;
  try {
    const repo = process.env.GITHUB_REPOSITORY;
    const token = process.env.GH_TOKEN;
    if (!repo || !token)
      throw new Error("GITHUB_REPOSITORY and GH_TOKEN are required.");
    const getJson = async (route) => {
      const response = await fetch(`https://api.github.com/${route}`, {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token}`,
          "x-github-api-version": "2022-11-28",
        },
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
      if (!response.ok)
        throw new Error(`GitHub API ${route} returned ${response.status}.`);
      return response.json();
    };
    result = await selectCandidate({
      repo,
      tagTree: process.env.TAG_TREE,
      getJson,
    });
  } catch (error) {
    console.log(
      `::warning::Candidate lookup failed, the release will build: ${error.message}`,
    );
    result = skip(`lookup failed: ${error.message}`);
  }
  writeOutputs(result);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
