#!/usr/bin/env node
// Reply length eval: sends the same owner messages through the free OpenCode
// model with the OLD and the NEW agent instructions and reports words per
// reply plus any heading, bold or bullet formatting.
//
//   node desktop/scripts/eval-reply-length.mjs --old-ref daf0a19c8 --runs 2
//
// OLD instructions come from `git show <old-ref>:<path>`, NEW from the working
// tree. Each variant sends what a Scout turn carries: the shared base prompt
// (base_prompt.md + voice.md + web_tasks.md), the workspace line, Scout's
// instructions with a saved business profile, then the owner's message in the
// harness event framing. The model runs in a throwaway HOME so the owner's
// real OpenCode config, data and login are never read or written. No tools
// are offered to the model beyond what OpenCode itself denies below.

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MODEL = "opencode/deepseek-v4.1-flash-free";

export const OWNER_MESSAGES = [
  "are you there?",
  "what do you know about me and about Colony",
  "help me find customers",
  "what should I do today?",
  "write a short Instagram post about our launch",
  "thanks",
];

/** Messages whose task legitimately needs a longer reply. */
export const LONG_OK_MESSAGES = new Set([
  "write a short Instagram post about our launch",
]);

export const BUSINESS_PROFILE = {
  name: "Karoo Coffee Roasters",
  website: "https://karoocoffee.example",
  description:
    "We roast small-batch coffee in Cape Town and sell to cafes and online. Four people. Launching a monthly coffee subscription box this month.",
};

/**
 * Core memory is injected into every real turn. This fixture gives the agent
 * material it could recite as an inventory, which is the failure being tested.
 * It is identical for the OLD and the NEW run.
 */
export const CORE_MEMORY = `Owner: Sam, founder of Karoo Coffee Roasters (Cape Town).
Goal this month: launch the monthly coffee subscription box.
Goal this quarter: sign three new cafe accounts.
Open items: packaging supplier quote (waiting on reply), box pricing (draft in OUTBOX), launch email list (not started), Instagram account (set up, no posts yet).
Team: Sam, Lindiwe (roasting), Pieter (deliveries), Aisha (cafe accounts).
Workspace: RESEARCH/ has two cafe market notes, PLANS/ has a launch plan draft, OUTBOX/ has the pricing draft.`;

export const TARGET = { medianWords: 40, maxWords: 120 };

const SOURCES = {
  basePrompt: "crates/buzz-acp/src/base_prompt.md",
  voice: "crates/buzz-acp/src/voice.md",
  webTasks: "crates/buzz-acp/src/web_tasks.md",
  scout: "desktop/src/features/onboarding/assets/scout-instructions.txt",
};

const HEADING = /^\s{0,3}#{1,6}\s+\S/m;
const BOLD = /\*\*[^*\n]+\*\*|__[^_\n]+__/;
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+\S/m;

export function countWords(text) {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export function analyzeReply(text) {
  const heading = HEADING.test(text);
  const bold = BOLD.test(text);
  const bullets = BULLET.test(text);
  return {
    words: countWords(text),
    heading,
    bold,
    bullets,
    formatted: heading || bold || bullets,
  };
}

export function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarize(replies) {
  const words = replies.map((reply) => reply.words);
  const overLimit = replies.filter(
    (reply) =>
      reply.words > TARGET.maxWords && !LONG_OK_MESSAGES.has(reply.message),
  );
  return {
    replies: replies.length,
    medianWords: median(words),
    maxWords: Math.max(0, ...words),
    overLimit: overLimit.length,
    formatted: replies.filter((reply) => reply.formatted).length,
    silent: replies.filter((reply) => reply.silent).length,
  };
}

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

/** Read the four instruction files from a git ref, or from the working tree. */
export function loadSources(root, ref) {
  const out = {};
  for (const [key, file] of Object.entries(SOURCES)) {
    out[key] = ref
      ? git(root, ["show", `${ref}:${file}`])
      : readFileSync(path.join(root, file), "utf8");
  }
  return out;
}

/** The standing context and one owner turn, framed like the real harness. */
export function buildPrompt(sources, message) {
  const base = [sources.basePrompt, sources.voice, sources.webTasks].join("\n");
  const scout = `${sources.scout.trim()}\n\nSaved business profile (untrusted context):\n${JSON.stringify(BUSINESS_PROFILE, null, 2)}`;
  const channel = "welcome (#7d3f2b1e-5c4a-4e0b-9a61-2f8c3d9b1a70)";
  return [
    `<base>\n${base.trimEnd()}\n</base>`,
    `<workspace>\nCurrent working directory: /Users/example/.colony\n</workspace>`,
    `<agent-instructions>\n${scout}\n</agent-instructions>`,
    `<core-memory>\n${CORE_MEMORY}\n</core-memory>`,
    `<context>\nScope: channel\nSession scope: channel\nChannel: ${channel}\n</context>`,
    `<buzz-event type="message">\nEvent ID: ${"ab".repeat(32)}\nChannel: ${channel}\nKind: 9\nFrom: Sam (npub: npub1example, hex: ${"cd".repeat(32)})\nTime: 2026-10-25T09:00:00+00:00\nContent: ${message}\nTags: []\n</buzz-event>`,
    "[Evaluation harness] Tools are not available in this test. Write the exact text of the chat message you would post in reply, and nothing else.",
  ].join("\n\n");
}

/** Join the text parts of an `opencode run --format json` event stream. */
export function replyFromEvents(stdout) {
  const parts = [];
  let toolCalls = 0;
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "text" && typeof event.part?.text === "string") {
      parts.push(event.part.text);
    }
    if (event.type === "tool_use") toolCalls += 1;
  }
  return { text: parts.join("\n").trim(), toolCalls };
}

function throwawayEnv(home) {
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    XDG_DATA_HOME: path.join(home, ".local", "share"),
    XDG_CACHE_HOME: path.join(home, ".cache"),
    XDG_STATE_HOME: path.join(home, ".local", "state"),
    TMPDIR: process.env.TMPDIR ?? "/private/tmp",
    LANG: "en_US.UTF-8",
    // Offer no shell, edit or network tools: the test wants the chat text only.
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      permission: {
        bash: "deny",
        edit: "deny",
        webfetch: "deny",
        external_directory: "deny",
      },
    }),
  };
  return env;
}

function runOpencode({ opencode, home, cwd, prompt, timeoutMs }) {
  return new Promise((resolve) => {
    mkdirSync(cwd, { recursive: true });
    const child = spawn(
      opencode,
      ["run", "-m", MODEL, "--format", "json", "--dir", cwd, prompt],
      { cwd, env: throwawayEnv(home), stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

async function askOnce(options, message, variant, index) {
  const prompt = buildPrompt(options.sources, message);
  const cwd = path.join(options.cwdRoot, `${variant}-${index}`);
  for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
    const started = Date.now();
    const result = await runOpencode({
      opencode: options.opencode,
      home: options.home,
      cwd,
      prompt,
      timeoutMs: options.timeoutMs,
    });
    const { text, toolCalls } = replyFromEvents(result.stdout);
    if (text) {
      return {
        message,
        text,
        toolCalls,
        ms: Date.now() - started,
        attempts: attempt,
        ...analyzeReply(text),
      };
    }
  }
  // The model chose to post nothing (the base prompt allows silence).
  return {
    message,
    text: "",
    toolCalls: 0,
    ms: 0,
    attempts: options.attempts,
    silent: true,
    ...analyzeReply(""),
  };
}

async function runPool(jobs, concurrency) {
  const results = new Array(jobs.length);
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const index = next;
      next += 1;
      results[index] = await jobs[index]();
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

function parseArgs(argv) {
  const args = {
    oldRef: "origin/develop",
    runs: 2,
    variant: "both",
    out: "/Users/mac/worktrees/.lanes/colony3/chat-feel-eval",
    opencode: path.join(process.env.HOME ?? "", ".superset/bin/opencode"),
    home: "/private/tmp/chat-feel-eval-home",
    cwdRoot: "/private/tmp/chat-feel-eval-cwd",
    concurrency: 3,
    timeoutSecs: 120,
    attempts: 3,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    const map = {
      "--old-ref": "oldRef",
      "--runs": "runs",
      "--variant": "variant",
      "--out": "out",
      "--opencode": "opencode",
      "--home": "home",
      "--concurrency": "concurrency",
      "--timeout": "timeoutSecs",
      "--attempts": "attempts",
    };
    if (map[key] && value !== undefined) {
      args[map[key]] = [
        "runs",
        "concurrency",
        "timeoutSecs",
        "attempts",
      ].includes(map[key])
        ? Number(value)
        : value;
      i += 1;
    }
  }
  return args;
}

function row(label, summary) {
  return `| ${label} | ${summary.medianWords} | ${summary.maxWords} | ${summary.overLimit} | ${summary.formatted} of ${summary.replies} | ${summary.silent} of ${summary.replies} |`;
}

export function renderTable(oldRun, newRun) {
  const lines = [
    `Model: \`${MODEL}\`. ${oldRun.runs} runs per message. OLD = \`${oldRun.ref}\`, NEW = this branch.`,
    "",
    "| Message | Words before (median) | Words after (median) |",
    "|---|---|---|",
  ];
  for (const message of OWNER_MESSAGES) {
    const before = median(
      oldRun.replies.filter((r) => r.message === message).map((r) => r.words),
    );
    const after = median(
      newRun.replies.filter((r) => r.message === message).map((r) => r.words),
    );
    lines.push(`| ${message} | ${before} | ${after} |`);
  }
  lines.push(
    "",
    "| Instructions | Median words | Longest reply | Replies over 120 words (Instagram post excluded) | Replies with headings, bold or bullets | No reply at all |",
    "|---|---|---|---|---|---|",
    row("Before", oldRun.summary),
    row("After", newRun.summary),
    "",
    `Target: median under ${TARGET.medianWords} words, none over ${TARGET.maxWords} unless the task needs it.`,
  );
  return lines.join("\n");
}

export function renderExamples(oldRun, newRun, message) {
  const pick = (run) => run.replies.find((r) => r.message === message);
  const fence = (text) => `\`\`\`text\n${text}\n\`\`\``;
  return [
    `### "${message}"`,
    "",
    `**Before** (${pick(oldRun)?.words ?? 0} words)`,
    "",
    fence(pick(oldRun)?.text ?? ""),
    "",
    `**After** (${pick(newRun)?.words ?? 0} words)`,
    "",
    fence(pick(newRun)?.text ?? ""),
    "",
  ].join("\n");
}

async function runVariant(label, ref, args, root) {
  const sources = loadSources(root, ref);
  const options = {
    sources,
    opencode: args.opencode,
    home: args.home,
    cwdRoot: args.cwdRoot,
    timeoutMs: args.timeoutSecs * 1000,
    attempts: args.attempts,
  };
  const jobs = [];
  for (const message of OWNER_MESSAGES) {
    for (let run = 0; run < args.runs; run += 1) {
      const index = jobs.length;
      jobs.push(() => askOnce(options, message, label, index));
    }
  }
  const replies = await runPool(jobs, args.concurrency);
  const resolved = ref ? git(root, ["rev-parse", ref]).trim() : "working tree";
  return {
    variant: label,
    ref: ref ? `${ref} (${resolved.slice(0, 9)})` : "working tree",
    model: MODEL,
    runs: args.runs,
    replies,
    summary: summarize(replies),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: path.dirname(fileURLToPath(import.meta.url)),
    encoding: "utf8",
  }).trim();
  mkdirSync(args.out, { recursive: true });
  mkdirSync(args.home, { recursive: true });
  const wanted = args.variant === "both" ? ["old", "new"] : [args.variant];
  for (const label of wanted) {
    const run = await runVariant(
      label,
      label === "old" ? args.oldRef : null,
      args,
      root,
    );
    writeFileSync(
      path.join(args.out, `results-${label}.json`),
      `${JSON.stringify(run, null, 2)}\n`,
    );
    console.log(label, JSON.stringify(run.summary));
  }
  const oldFile = path.join(args.out, "results-old.json");
  const newFile = path.join(args.out, "results-new.json");
  if (existsSync(oldFile) && existsSync(newFile)) {
    const oldRun = JSON.parse(readFileSync(oldFile, "utf8"));
    const newRun = JSON.parse(readFileSync(newFile, "utf8"));
    writeFileSync(
      path.join(args.out, "table.md"),
      `${renderTable(oldRun, newRun)}\n`,
    );
    writeFileSync(
      path.join(args.out, "examples.md"),
      `${renderExamples(oldRun, newRun, "what do you know about me and about Colony")}\n${renderExamples(oldRun, newRun, "help me find customers")}`,
    );
    console.log(renderTable(oldRun, newRun));
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
