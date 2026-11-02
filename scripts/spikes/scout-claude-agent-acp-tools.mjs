#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { accessSync, constants } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const isolated = process.argv.includes("--isolated");

function quoteSandboxPath(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function findExecutable(name) {
  if (name.includes("/")) return name;
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  throw new Error(`Could not resolve ${name} on PATH`);
}

async function runMcpServer(logPath) {
  let buffer = "";
  for await (const chunk of process.stdin) {
    buffer += chunk.toString();
    while (buffer.includes("\n")) {
      const newline = buffer.indexOf("\n");
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      const request = JSON.parse(line);
      if (request.method) {
        await writeFile(logPath, `${request.method}\n`, { flag: "a", mode: 0o600 });
      }
      if (request.id === undefined) continue;
      let result;
      if (request.method === "initialize") {
        result = {
          protocolVersion: request.params?.protocolVersion ?? "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "colony-spike", version: "0.0.1" },
        };
      } else if (request.method === "tools/list") {
        result = {
          tools: [
            {
              name: "colony_probe",
              description: "A harmless spike-only tool used to verify ACP MCP forwarding.",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        };
      } else {
        result = {};
      }
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result })}\n`);
    }
  }
}

if (process.argv.includes("--mcp-server")) {
  const logPath = process.env.COLONY_SPIKE_MCP_LOG;
  if (!logPath) throw new Error("MCP fixture is missing its temporary log path");
  await runMcpServer(logPath);
  process.exit(0);
}

if (!isolated) {
  const hostHome = process.env.HOME;
  if (!hostHome || !hostHome.startsWith("/Users/")) {
    throw new Error("Run this macOS spike from a normal user session");
  }

  const root = await mkdtemp("/private/tmp/scout-claude-acp-spike-");
  const adapter = findExecutable("claude-agent-acp");
  const claude = findExecutable("claude");
  const blockedPaths = [
    join(hostHome, ".claude"),
    join(hostHome, "Library", "Keychains"),
    join(hostHome, "Library", "Application Support"),
  ];
  const profile = [
    "(version 1)",
    "(allow default)",
    "(deny network-outbound)",
    ...blockedPaths.flatMap((path) => [
      `(deny file-read* (subpath ${quoteSandboxPath(path)}))`,
      `(deny file-write* (subpath ${quoteSandboxPath(path)}))`,
    ]),
    `(deny file-read* (literal ${quoteSandboxPath(join(hostHome, ".claude.json"))}))`,
    `(deny file-write* (literal ${quoteSandboxPath(join(hostHome, ".claude.json"))}))`,
    '(deny mach-lookup (global-name "com.apple.securityd"))',
    "",
  ].join("\n");
  const profilePath = join(root, "deny-owner-state.sb");
  await writeFile(profilePath, profile, { mode: 0o600 });

  const childEnv = {
    C3_SPIKE_ADAPTER_BIN: adapter,
    C3_SPIKE_CLAUDE_BIN: claude,
    C3_SPIKE_TMP_ROOT: root,
    HOME: join(root, "home"),
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    TMPDIR: root,
  };
  const result = spawnSync(
    "/usr/bin/sandbox-exec",
    ["-f", profilePath, process.execPath, scriptPath, "--isolated"],
    { cwd: repoRoot, env: childEnv, encoding: "utf8", timeout: 45_000 },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const root = process.env.C3_SPIKE_TMP_ROOT;
const home = process.env.HOME;
const adapterBin = process.env.C3_SPIKE_ADAPTER_BIN;
const claudeBin = process.env.C3_SPIKE_CLAUDE_BIN;
if (!root || !home?.startsWith("/private/tmp/") || !adapterBin || !claudeBin) {
  throw new Error("The isolated harness is missing its disposable paths");
}

const workDir = join(root, "work");
const configDir = join(home, ".claude");
const logDir = join(home, "logs");
const mcpLog = join(home, "mcp.log");
await Promise.all([mkdir(workDir, { recursive: true }), mkdir(configDir, { recursive: true }), mkdir(logDir, { recursive: true })]);
await writeFile(join(configDir, "settings.json"), "{}\n", { mode: 0o600 });
await writeFile(join(home, ".claude.json"), "{}\n", { mode: 0o600 });

const version = spawnSync(adapterBin, ["--version"], {
  cwd: workDir,
  env: { HOME: home, PATH: process.env.PATH, TMPDIR: root },
  encoding: "utf8",
  timeout: 5_000,
});
if (version.status !== 0) throw new Error("The installed adapter did not answer --version");

const env = {
  HOME: home,
  CLAUDE_CONFIG_DIR: configDir,
  CLAUDE_CODE_EXECUTABLE: claudeBin,
  CLAUDE_AGENT_LOGS: logDir,
  ANTHROPIC_API_KEY: "sk-ant-no-account-spike-key",
  ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
  DISABLE_TELEMETRY: "1",
  PATH: process.env.PATH,
  TMPDIR: root,
};

const adapter = spawn(adapterBin, [], { cwd: workDir, detached: true, env, stdio: ["pipe", "pipe", "ignore"] });
const pending = new Map();
let inputBuffer = "";
let nextId = 1;
adapter.stdout.setEncoding("utf8");
adapter.stdout.on("data", (chunk) => {
  inputBuffer += chunk;
  while (inputBuffer.includes("\n")) {
    const newline = inputBuffer.indexOf("\n");
    const line = inputBuffer.slice(0, newline);
    inputBuffer = inputBuffer.slice(newline + 1);
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  }
});

function request(method, params, timeoutMs = 10_000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out`));
    }, timeoutMs);
    pending.set(id, (message) => {
      clearTimeout(timeout);
      resolve(message);
    });
    adapter.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return true;
  return Promise.race([
    once(child, "exit").then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

let sessionId;
let promptStatus = "not attempted";
try {
  const initialized = await request("initialize", {
    protocolVersion: 2,
    clientCapabilities: {
      auth: { terminal: true },
      _meta: { "terminal-auth": true },
    },
    clientInfo: { name: "buzz-acp-spike", version: "local" },
  });
  if (initialized.error) throw new Error("ACP initialize failed");
  adapter.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`);

  const created = await request("session/new", {
    cwd: workDir,
    mcpServers: [
      {
        name: "colony-spike",
        command: process.execPath,
        args: [scriptPath, "--mcp-server"],
        env: [{ name: "COLONY_SPIKE_MCP_LOG", value: mcpLog }],
      },
    ],
    _meta: {
      systemPrompt: { append: "This is a local integration spike. Do not edit, publish, or send anything." },
      claudeCode: { options: { disallowedTools: ["Read(~/Library/Mail/**)", "Bash(find ~:*)"] } },
    },
  });
  if (created.error || !created.result?.sessionId) throw new Error("ACP session/new failed");
  sessionId = created.result.sessionId;

  try {
    const prompted = await request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: "List the names of all tools available to you. Return only names. Do not call any tool." }],
    }, 20_000);
    promptStatus = prompted.error ? "adapter returned an error; network is intentionally denied" : "completed";
  } catch {
    promptStatus = "no model response; network is intentionally denied";
  }
} finally {
  if (sessionId && adapter.exitCode === null) {
    adapter.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "session/cancel", params: { sessionId } })}\n`);
  }
  adapter.stdin.end();
  if (!(await waitForExit(adapter, 3_000)) && adapter.pid) {
    try {
      process.kill(-adapter.pid, "SIGTERM");
    } catch {
      // It may have exited between the check and the signal.
    }
    if (!(await waitForExit(adapter, 1_000)) && adapter.pid) {
      try {
        process.kill(-adapter.pid, "SIGKILL");
      } catch {
        // The exact child process group is already gone.
      }
    }
  }
}

let mcpCalls = [];
try {
  mcpCalls = (await readFile(mcpLog, "utf8")).trim().split("\n").filter(Boolean);
} catch {
  // No MCP connection is a useful negative result for the spike.
}
const adapterVersion = version.stdout.trim();
const listedTools = mcpCalls.includes("tools/list") ? "colony_probe" : "not observed";
console.log(`Adapter: ${adapterVersion}`);
console.log(`ACP initialize/session/new: ${sessionId ? "completed" : "failed"}`);
console.log(`Session MCP tools/list: ${listedTools}`);
console.log(`Tool listing prompt: ${promptStatus}`);
console.log("Auth: dummy API key, disposable HOME, outbound network denied");
console.log("Owner Claude files and Keychain: sandbox denied access");
