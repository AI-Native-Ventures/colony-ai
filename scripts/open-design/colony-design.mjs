#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import {
  chmod,
  mkdir,
  open,
  realpath,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";

export const OPEN_DESIGN_VERSION = "0.25.1";
export const OPEN_DESIGN_COMMIT = "5a0c47777975ddb91d09c1c16b423a3ef74bf572";
export const OPEN_DESIGN_ARCHIVE_SHA256 =
  "b6c577544d74d1d3aa3352651219a1cdbe91749bcc5587e37d06e489c0c0ff01";
export const OPEN_DESIGN_ARCHIVE_MAX_BYTES = 256 * 1024 * 1024;
export const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const RUN_TIMEOUT_MS = 45 * 60 * 1000;
export const MAX_PROJECT_LOGS = 10;
const SAFE_ID = /^[0-9a-f-]{36}$/u;
const RUNTIMES = new Set(["claude", "codex", "opencode", "colony-buzz-agent"]);
function userHome() {
  return path.resolve(process.env.HOME || os.homedir());
}

function isPathInside(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function sandboxTraversalPaths(homeRoot, target) {
  if (!isPathInside(homeRoot, target)) return [];
  const paths = [homeRoot];
  let current = homeRoot;
  for (const segment of path.relative(homeRoot, target).split(path.sep)) {
    if (!segment || segment === ".") continue;
    current = path.join(current, segment);
    paths.push(current);
  }
  return paths;
}

function boundedInvocation(command, args) {
  if (process.platform !== "darwin") return { command, args };
  return {
    command: "/bin/sh",
    args: [
      "-c",
      'ulimit -t 2700 || exit 126; ulimit -n 512 || exit 126; exec "$@"',
      "colony-open-design",
      command,
      ...args,
    ],
  };
}

async function ensureSandboxAvailable() {
  if (process.platform !== "darwin") {
    fail(
      "Open Design currently requires Colony's macOS project sandbox.",
      "SANDBOX_UNAVAILABLE",
    );
  }
  try {
    await stat("/usr/bin/sandbox-exec");
  } catch {
    fail(
      "Colony could not start Open Design without the macOS private-folder sandbox.",
      "SANDBOX_UNAVAILABLE",
    );
  }
}

const HOME_SCAN_COMMANDS = [
  "find ~",
  "find ~/",
  "find $HOME",
  "find $HOME/",
  'find "$HOME"',
  "find /Users",
  "find /",
  "find -L ~",
  "find -L $HOME",
  "grep -r ~",
  "grep -R ~",
  "grep -rn ~",
  "grep -rl ~",
  "grep -ri ~",
  "grep -r $HOME",
  "grep -R $HOME",
  "grep -r /Users",
  "grep -R /Users",
  "rg ~",
  "rg --files ~",
  "rg $HOME",
  "du ~",
  "du -a ~",
  "ls -R ~",
  "ls -R $HOME",
  "tree ~",
  "tree $HOME",
];
const CUSTOMER_PROVIDER_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_ORGANIZATION",
  "OPENAI_PROJECT",
  "OPENAI_COMPAT_API_KEY",
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "GEMINI_BASE_URL",
  "AZURE_OPENAI_API_KEY",
  "AZURE_OPENAI_ENDPOINT",
  "MISTRAL_API_KEY",
  "GROQ_API_KEY",
  "XAI_API_KEY",
  "DEEPSEEK_API_KEY",
  "DATABRICKS_TOKEN",
];

const root = path.resolve(
  process.env.COLONY_DESIGN_DATA_DIR ??
    path.join(userHome(), "Library", "Application Support", "Colony", "design"),
);
const projectsRoot = path.join(root, "projects");
const sourceRoot = path.join(
  root,
  "runtime",
  `open-design-${OPEN_DESIGN_VERSION}`,
);
const helperPath = process.argv[1] ? path.resolve(process.argv[1]) : "";

export function verifyArchiveDigest(actual) {
  return actual === OPEN_DESIGN_ARCHIVE_SHA256;
}

function sandboxQuote(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function colonySandboxProfile(
  home,
  sourcePath,
  nodeBinDir,
  projectPath,
  runtime,
  localPorts = [],
) {
  const homeRoot = path.resolve(home);
  const projectRoot = path.resolve(projectPath);
  const projectCollection = path.dirname(projectRoot);
  const sourceRoot = path.resolve(sourcePath);
  // Corepack's executable in bin/ is a symlink into lib/node_modules. Give
  // the sandbox access to the managed Node runtime, rather than only bin/.
  const nodeRoot = path.resolve(nodeBinDir, "..");
  const privatePaths = [
    "Pictures",
    "Music",
    "Movies",
    "Scans",
    "Documents/Scans",
    "Documents/Scanned Documents",
    "Library/Photos",
    "Library/Mail",
    "Library/Messages",
    "Library/Calendars",
    "Library/Keychains",
    "Library/Application Support/AddressBook",
    ".colony",
    ".buzz",
    ".claude",
    ".codex",
    ".config/opencode",
    ".local/share/opencode",
    "/Volumes",
  ].map((entry) =>
    entry.startsWith("/") ? entry : path.join(homeRoot, entry),
  );
  const activeRuntimePaths =
    {
      claude: [
        path.join(homeRoot, ".claude"),
        path.join(homeRoot, ".claude.json"),
      ],
      codex: [path.join(homeRoot, ".codex")],
      opencode: [
        path.join(homeRoot, ".config", "opencode"),
        path.join(homeRoot, ".local", "share", "opencode"),
      ],
      "colony-buzz-agent": [path.join(homeRoot, ".config", "buzz-agent")],
    }[runtime] ?? [];
  const deniedPaths = privatePaths.filter(
    (target) => !activeRuntimePaths.includes(target),
  );
  const rules = [
    "(version 1)",
    "(allow default)",
    '(deny network-outbound (remote ip "*:*"))',
    '(allow network-outbound (remote tcp "*:443"))',
    '(allow network-outbound (remote tcp "*:80"))',
    '(allow network-outbound (remote tcp "*:53"))',
    '(allow network-outbound (remote udp "*:53"))',
    '(deny network-inbound (local ip "*:*"))',
  ];
  for (const port of [...new Set(localPorts)]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      fail("A local sandbox port is invalid.", "BAD_SANDBOX_PORT");
    }
    rules.push(
      `(allow network-outbound (remote ip "localhost:${port}"))`,
      `(allow network-inbound (local ip "localhost:${port}"))`,
      `(allow network-bind (local ip "localhost:${port}"))`,
    );
  }
  for (const target of deniedPaths) {
    rules.push(`(deny file-read* (subpath ${sandboxQuote(target)}))`);
    rules.push(`(deny file-write* (subpath ${sandboxQuote(target)}))`);
  }
  rules.push(`(deny file-read* (subpath ${sandboxQuote(homeRoot)}))`);
  rules.push(`(deny file-write* (subpath ${sandboxQuote(homeRoot)}))`);
  rules.push('(deny file-read* (subpath "/Users"))');
  rules.push('(deny file-write* (subpath "/Users"))');
  rules.push('(deny file-read* (subpath "/Volumes"))');
  rules.push('(deny file-write* (subpath "/Volumes"))');
  rules.push(`(deny file-read* (subpath ${sandboxQuote(projectCollection)}))`);
  rules.push(`(deny file-write* (subpath ${sandboxQuote(projectCollection)}))`);
  const readableTargets = [
    projectRoot,
    sourceRoot,
    nodeRoot,
    ...activeRuntimePaths,
  ].filter(
    (target) =>
      target === projectRoot ||
      target === sourceRoot ||
      isPathInside(homeRoot, target) ||
      isPathInside("/Users", target),
  );
  const traversalPaths = new Set(
    readableTargets.flatMap((target) =>
      sandboxTraversalPaths(homeRoot, target),
    ),
  );
  for (const target of traversalPaths) {
    rules.push(`(allow file-read-metadata (literal ${sandboxQuote(target)}))`);
  }
  for (const target of readableTargets) {
    if (
      target === projectRoot ||
      target === sourceRoot ||
      isPathInside(homeRoot, target) ||
      isPathInside("/Users", target)
    ) {
      rules.push(`(allow file-read* (subpath ${sandboxQuote(target)}))`);
    }
  }
  for (const target of [projectRoot, ...activeRuntimePaths]) {
    rules.push(`(allow file-write* (subpath ${sandboxQuote(target)}))`);
  }
  for (const filename of [
    "colony-design.json",
    ".daemon.json",
    ".supervisor.json",
    ".agent-sandbox.sb",
    ".last-used",
    "logs",
  ]) {
    rules.push(
      `(deny file-write* (subpath ${sandboxQuote(path.join(projectRoot, filename))}))`,
    );
  }
  return `${rules.join("\n")}\n`;
}

function json(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function fail(message, code = "OPEN_DESIGN_ERROR") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function flags(args) {
  const result = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith("--")) {
      result._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) result[key] = true;
    else {
      result[key] = next;
      index += 1;
    }
  }
  return result;
}

function projectDir(id) {
  if (!SAFE_ID.test(id)) fail("Project id is invalid.", "BAD_PROJECT_ID");
  return path.join(projectsRoot, id);
}

async function writeJsonAtomic(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, file);
}

async function readManifest(id) {
  const dir = projectDir(id);
  const [canonicalProjects, canonicalDir] = await Promise.all([
    realpath(projectsRoot),
    realpath(dir),
  ]);
  if (path.dirname(canonicalDir) !== canonicalProjects) {
    fail(
      "Design project path is outside Colony data.",
      "PROJECT_PATH_MISMATCH",
    );
  }
  const manifest = JSON.parse(
    await readFile(path.join(canonicalDir, "colony-design.json"), "utf8"),
  );
  let manifestProjectPath = "";
  try {
    manifestProjectPath = await realpath(manifest.projectPath);
  } catch {}
  if (manifest.id !== id || manifestProjectPath !== canonicalDir) {
    fail(
      "Design project metadata failed its path check.",
      "PROJECT_PATH_MISMATCH",
    );
  }
  return manifest;
}

export function runChild(command, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? RUN_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const invocation = boundedInvocation(command, args);
    const child = spawn(invocation.command, invocation.args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = [];
    const err = [];
    const outCount = { value: 0 };
    const errCount = { value: 0 };
    const capture = (parts, stream, byteCount, limit) => {
      stream.on("data", (chunk) => {
        if (byteCount.value >= limit) return;
        const remaining = limit - byteCount.value;
        const slice = chunk.subarray(0, remaining);
        parts.push(slice);
        byteCount.value += slice.length;
      });
    };
    capture(out, child.stdout, outCount, 1024 * 1024);
    capture(err, child.stderr, errCount, 64 * 1024);
    const timer = setTimeout(() => {
      try {
        process.kill(
          process.platform === "win32" ? child.pid : -child.pid,
          "SIGTERM",
        );
      } catch {}
      setTimeout(() => {
        try {
          process.kill(
            process.platform === "win32" ? child.pid : -child.pid,
            "SIGKILL",
          );
        } catch {}
      }, 1500).unref();
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString("utf8");
      const stderr = Buffer.concat(err).toString("utf8");
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          Object.assign(
            new Error(stderr.trim() || `Command exited ${code ?? signal}.`),
            {
              code: "CHILD_FAILED",
              exitCode: code,
              stdout,
              stderr,
            },
          ),
        );
    });
  });
}

function nodePath() {
  return process.execPath;
}

function testOpenDesignCommand() {
  return process.env.COLONY_DESIGN_TEST_MODE === "1"
    ? process.env.COLONY_DESIGN_OD
    : undefined;
}

function openDesignCli() {
  if (testOpenDesignCommand()) return testOpenDesignCommand();
  return path.join(sourceRoot, "apps", "daemon", "bin", "od.mjs");
}

function openDesignEnv(projectPath, runtime) {
  const env = {};
  for (const key of [
    "PATH",
    "TERM",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "all_proxy",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  env.HOME = userHome();
  env.COLONY_MANAGED_NODE = nodePath();
  env.OTEL_SDK_DISABLED = "true";
  env.DO_NOT_TRACK = "1";
  env.POSTHOG_DISABLED = "1";
  env.NODE_OPTIONS = "--max-old-space-size=1536";
  env.UV_THREADPOOL_SIZE = "2";
  env.OD_DATA_DIR = path.join(projectPath, ".open-design-data");
  env.OD_BIND_HOST = "127.0.0.1";
  env.COLONY_DESIGN_MANAGED = "1";
  env.COLONY_DESIGN_PROJECT = projectPath;
  const providerKeys =
    runtime === "claude"
      ? [
          "ANTHROPIC_API_KEY",
          "ANTHROPIC_AUTH_TOKEN",
          "ANTHROPIC_BASE_URL",
          "ANTHROPIC_MODEL",
          "ANTHROPIC_SMALL_FAST_MODEL",
        ]
      : runtime === "codex"
        ? [
            "OPENAI_API_KEY",
            "OPENAI_BASE_URL",
            "OPENAI_ORGANIZATION",
            "OPENAI_PROJECT",
          ]
        : runtime === "opencode"
          ? CUSTOMER_PROVIDER_KEYS
          : [];
  for (const key of providerKeys) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  if (runtime === "colony-buzz-agent") {
    for (const key of [
      "BUZZ_PRIVATE_KEY",
      "BUZZ_RELAY_URL",
      "BUZZ_AUTH_TAG",
      "COLONY_CREDITS_GATEWAY",
      "COLONY_CREDITS_SESSION_ID",
      "COLONY_CREDITS_MODEL",
      "BUZZ_AGENT_PROVIDER",
      "BUZZ_AGENT_MODEL",
      "COLONY_WORKER_AGENT_BIN",
    ]) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    if (process.env.COLONY_DESIGN_TEST_MODE === "1") {
      for (const key of [
        "STUB_GATEWAY_URL",
        "STUB_DESKTOP_PNG",
        "STUB_MOBILE_PNG",
      ]) {
        if (process.env[key] !== undefined) env[key] = process.env[key];
      }
    }
  }
  delete env.OD_PROJECT_ID;
  delete env.OD_WORKSPACE_ID;
  delete env.OD_WORKSPACE_MEMBER_ID;
  return env;
}

async function ensureLocalTelemetryOff(projectPath) {
  const odDataDir = path.join(projectPath, ".open-design-data");
  await mkdir(odDataDir, { recursive: true, mode: 0o700 });
  await chmod(odDataDir, 0o700);
  const configPath = path.join(odDataDir, "app-config.json");
  let config = {};
  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
  } catch {}
  config.telemetry = {
    ...(config.telemetry ?? {}),
    metrics: false,
    content: false,
    artifactManifest: false,
  };
  config.privacyDecisionAt ??= Date.now();
  await writeJsonAtomic(configPath, config);
}

async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function downloadOpenDesignArchive(destination) {
  const response = await fetch(
    `https://github.com/nexu-io/open-design/archive/${OPEN_DESIGN_COMMIT}.tar.gz`,
    { redirect: "follow", signal: AbortSignal.timeout(15 * 60 * 1000) },
  );
  if (!response.ok || !response.body)
    fail(
      `Open Design download failed (${response.status}).`,
      "DOWNLOAD_FAILED",
    );
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > OPEN_DESIGN_ARCHIVE_MAX_BYTES)
    fail("Open Design archive exceeds the size limit.", "ARCHIVE_TOO_LARGE");
  let received = 0;
  const meter = new TransformStream({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > OPEN_DESIGN_ARCHIVE_MAX_BYTES) {
        controller.error(
          new Error("Open Design archive exceeds the size limit."),
        );
        return;
      }
      controller.enqueue(chunk);
    },
  });
  await pipeline(
    response.body.pipeThrough(meter),
    createWriteStream(destination, { flags: "wx", mode: 0o600 }),
  );
  const digest = await sha256File(destination);
  if (!verifyArchiveDigest(digest)) {
    await rm(destination, { force: true });
    fail(
      "Open Design source checksum did not match the pinned version.",
      "CHECKSUM_MISMATCH",
    );
  }
}

function replaceOnce(source, before, after, filename) {
  const index = source.indexOf(before);
  if (index < 0 || source.indexOf(before, index + before.length) >= 0) {
    fail(
      `Pinned Open Design source did not match the expected ${filename} patch point.`,
      "PATCH_MISMATCH",
    );
  }
  return source.slice(0, index) + after + source.slice(index + before.length);
}

export async function applyColonyPatches(sourceDir) {
  const runtimes = path.join(sourceDir, "apps/daemon/src/runtimes");
  const registryFile = path.join(runtimes, "registry.ts");
  let registry = await readFile(registryFile, "utf8");
  registry = replaceOnce(
    registry,
    "import { claudeAgentDef } from './defs/claude.js';",
    "import { claudeAgentDef } from './defs/claude.js';\nimport { colonyBuzzAgentDef } from './defs/colony-buzz-agent.js';",
    "runtimes/registry.ts",
  );
  registry = replaceOnce(
    registry,
    "  claudeAgentDef,\n  codexAgentDef,",
    "  claudeAgentDef,\n  colonyBuzzAgentDef,\n  codexAgentDef,",
    "runtimes/registry.ts",
  );
  await writeFile(registryFile, registry);
  await writeFile(
    path.join(runtimes, "defs/colony-buzz-agent.ts"),
    `import type { RuntimeAgentDef } from '../types.js';

// Colony's managed ACP adapter. The child inherits the existing managed-agent
// credits session and owner attestation. It never accepts a user-supplied key.
export const colonyBuzzAgentDef = {
  id: 'colony-buzz-agent',
  name: 'Colony free AI',
  bin: process.env.COLONY_WORKER_AGENT_BIN || 'buzz-agent',
  versionArgs: [],
  fallbackModels: [{ id: 'colony-credits', label: 'Colony free AI' }],
  buildArgs: () => [],
  streamFormat: 'acp-json-rpc',
  mcpDiscovery: 'mature-acp',
  externalMcpInjection: 'acp-merge',
} satisfies RuntimeAgentDef;
`,
  );

  const claudeFile = path.join(runtimes, "defs/claude.ts");
  let claude = await readFile(claudeFile, "utf8");
  const claudeManagedArgs = [
    "      if (process.env.COLONY_DESIGN_MANAGED === '1') {",
    "        args.push('--permission-mode', 'acceptEdits');",
    "        const home = process.env.HOME || process.env.USERPROFILE || '';",
    "        const privatePaths = ['Pictures', 'Music', 'Movies', 'Scans', 'Documents/Scans', 'Documents/Scanned Documents', 'Library/Photos', 'Library/Mail', 'Library/Messages', 'Library/Calendars', 'Library/Keychains', 'Library/Application Support/AddressBook', '.colony', '/Volumes'];",
    "        const targets = privatePaths.flatMap((entry) => entry.startsWith('/') ? [entry] : ['~/' + entry, ...(home ? [home + '/' + entry] : [])]);",
    "        const denies = [];",
    "        for (const target of targets) {",
    "          const pathSpec = target.startsWith('~/') ? target : '//' + target.replace(/^\\//, '');",
    "          for (const tool of ['Read', 'Glob', 'Grep', 'Edit', 'Write']) denies.push(tool + '(' + pathSpec + ')', tool + '(' + pathSpec + '/**)');",
    "          denies.push('Bash(* ' + target + ')', 'Bash(* ' + target + '/*)', 'Bash(find ' + target + ':*)', 'Bash(ls ' + target + ':*)');",
    "        }",
    `        for (const prefix of ${JSON.stringify(HOME_SCAN_COMMANDS)}) denies.push('Bash(' + prefix + ':*)');`,
    "        args.push('--disallowedTools', ...denies);",
    "      } else {",
    "        args.push('--permission-mode', 'bypassPermissions');",
    "      }",
  ].join("\n");
  claude = replaceOnce(
    claude,
    "      args.push('--permission-mode', 'bypassPermissions');",
    claudeManagedArgs,
    "runtimes/defs/claude.ts",
  );
  await writeFile(claudeFile, claude);

  const permissionFile = path.join(runtimes, "opencode-permissions.ts");
  let permissions = await readFile(permissionFile, "utf8");
  permissions = replaceOnce(
    permissions,
    "  if (agentCapabilities.get(agentId)?.skipPermissions) {",
    "  if (process.env.COLONY_DESIGN_MANAGED !== '1' && agentCapabilities.get(agentId)?.skipPermissions) {",
    "runtimes/opencode-permissions.ts",
  );
  await writeFile(permissionFile, permissions);

  const codexFile = path.join(runtimes, "defs/codex.ts");
  let codex = await readFile(codexFile, "utf8");
  codex = replaceOnce(
    codex,
    "      const needsDangerFullAccess = codexNeedsDangerFullAccessSandbox();",
    "      const needsDangerFullAccess = process.env.COLONY_DESIGN_MANAGED === '1'\n        ? false\n        : codexNeedsDangerFullAccessSandbox();",
    "runtimes/defs/codex.ts",
  );
  await writeFile(codexFile, codex);

  const serverFile = path.join(sourceDir, "apps/daemon/src/server.ts");
  let server = await readFile(serverFile, "utf8");
  server = replaceOnce(
    server,
    "          const opencodeConfigContent = buildOpenCodeMcpConfigContent(",
    "          let opencodeConfigContent = buildOpenCodeMcpConfigContent(",
    "apps/daemon/src/server.ts",
  );
  const managedOpenCodePermissions = [
    "          if (process.env.COLONY_DESIGN_MANAGED === '1' && isOpenCodeContent) {",
    "            const config = opencodeConfigContent ? JSON.parse(opencodeConfigContent) : {};",
    "            const permission = config.permission && typeof config.permission === 'object' ? config.permission : {};",
    "            const merge = (tool) => { const value = permission[tool]; permission[tool] = value && typeof value === 'object' && !Array.isArray(value) ? value : (value == null ? {} : { '*': value }); };",
    "            for (const tool of ['read', 'external_directory', 'bash']) merge(tool);",
    "            const home = process.env.HOME || process.env.USERPROFILE || '';",
    "            const privatePaths = ['Pictures', 'Music', 'Movies', 'Scans', 'Documents/Scans', 'Documents/Scanned Documents', 'Library/Photos', 'Library/Mail', 'Library/Messages', 'Library/Calendars', 'Library/Keychains', 'Library/Application Support/AddressBook', '.colony', '/Volumes'].flatMap((entry) => entry.startsWith('/') ? [entry] : ['~/' + entry, ...(home ? [path.join(home, entry)] : [])]);",
    "            for (const target of privatePaths) {",
    "              permission.read[target] = 'deny'; permission.read[target + '/**'] = 'deny';",
    "              permission.external_directory[target] = 'deny'; permission.external_directory[target + '/**'] = 'deny';",
    "              permission.bash['* ' + target + '*'] = 'deny';",
    "            }",
    `            for (const prefix of ${JSON.stringify(HOME_SCAN_COMMANDS)}) { permission.bash[prefix] = 'deny'; permission.bash[prefix + ' *'] = 'deny'; }`,
    "            const appSupport = path.join(home, 'Library', 'Application Support');",
    "            const colonyDesignData = path.join(appSupport, 'Colony', 'design');",
    "            for (const tool of ['read', 'external_directory']) { permission[tool][appSupport] = 'deny'; permission[tool][appSupport + '/**'] = 'deny'; permission[tool][colonyDesignData] = 'allow'; permission[tool][colonyDesignData + '/**'] = 'allow'; }",
    "            permission.bash['* ' + appSupport + '*'] = 'deny'; permission.bash['* ' + colonyDesignData + '*'] = 'allow';",
    "            config.permission = permission; opencodeConfigContent = JSON.stringify(config);",
    "          }",
  ].join("\n");
  server = replaceOnce(
    server,
    `          if (opencodeConfigContent) {\n            env[isMiMoContent ? 'MIMOCODE_CONFIG_CONTENT' : 'OPENCODE_CONFIG_CONTENT'] = opencodeConfigContent;\n          }`,
    `${managedOpenCodePermissions}\n          if (opencodeConfigContent || (process.env.COLONY_DESIGN_MANAGED === '1' && isOpenCodeContent)) {\n            env[isMiMoContent ? 'MIMOCODE_CONFIG_CONTENT' : 'OPENCODE_CONFIG_CONTENT'] = opencodeConfigContent || '{}';\n          }`,
    "apps/daemon/src/server.ts",
  );
  server = replaceOnce(
    server,
    `        } catch (err) {\n          console.warn(\n            '[mcp-config] failed to build OPENCODE_CONFIG_CONTENT:',`,
    `        } catch (err) {\n          if (process.env.COLONY_DESIGN_MANAGED === '1' && isOpenCodeContent) throw err;\n          console.warn(\n            '[mcp-config] failed to build OPENCODE_CONFIG_CONTENT:',`,
    "apps/daemon/src/server.ts",
  );
  await writeFile(serverFile, server);
}

async function runBuild(command, args, options = {}) {
  return runChild(command, args, {
    ...options,
    timeoutMs: options.timeoutMs ?? 30 * 60 * 1000,
  });
}

async function ensureOpenDesignInstalled() {
  await ensureSandboxAvailable();
  if (testOpenDesignCommand()) return;
  const odPath = path.join(sourceRoot, "apps/daemon/bin/od.mjs");
  try {
    await stat(odPath);
    return;
  } catch {}
  await mkdir(path.dirname(sourceRoot), { recursive: true, mode: 0o700 });
  const tempSource = `${sourceRoot}.install-${process.pid}`;
  const archive = `${tempSource}.tar.gz`;
  const sandboxFile = path.join(
    path.dirname(sourceRoot),
    `.agent-sandbox-install-${process.pid}.sb`,
  );
  await rm(tempSource, { recursive: true, force: true });
  await rm(archive, { force: true });
  await mkdir(tempSource, { recursive: true, mode: 0o700 });
  try {
    await downloadOpenDesignArchive(archive);
    await runBuild("tar", [
      "-xzf",
      archive,
      "-C",
      tempSource,
      "--strip-components=1",
    ]);
    await applyColonyPatches(tempSource);
    await writeFile(
      sandboxFile,
      colonySandboxProfile(
        userHome(),
        tempSource,
        path.dirname(nodePath()),
        tempSource,
        "installer",
      ),
      { mode: 0o600 },
    );
    const env = openDesignBuildEnv(tempSource);
    const corepackPath = path.join(path.dirname(nodePath()), "corepack");
    let corepack = "corepack";
    try {
      await stat(corepackPath);
      corepack = corepackPath;
    } catch {}
    const sandboxed = (args) => ["-f", sandboxFile, corepack, ...args];
    await runBuild(
      "/usr/bin/sandbox-exec",
      sandboxed(["pnpm", "install", "--frozen-lockfile"]),
      {
        cwd: tempSource,
        env: {
          ...env,
          CI: "1",
          OPEN_DESIGN_POSTINSTALL_PHASE: "dependencies",
        },
      },
    );
    await runBuild(
      "/usr/bin/sandbox-exec",
      sandboxed(["pnpm", "--filter", "@open-design/daemon...", "run", "build"]),
      {
        cwd: tempSource,
        env: { ...env, CI: "1" },
      },
    );
    await mkdir(path.dirname(sourceRoot), { recursive: true, mode: 0o700 });
    await rename(tempSource, sourceRoot);
  } catch (error) {
    await rm(tempSource, { recursive: true, force: true });
    throw error;
  } finally {
    await rm(archive, { force: true });
    await rm(sandboxFile, { force: true });
  }
}

function openDesignBuildEnv(projectPath) {
  const home = path.join(projectPath, ".installer-home");
  return {
    HOME: home,
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    COLONY_MANAGED_NODE: nodePath(),
    COLONY_DESIGN_DATA_DIR: root,
    OD_DATA_DIR: path.join(projectPath, ".open-design-data"),
    NODE_OPTIONS: "--max-old-space-size=1536",
    UV_THREADPOOL_SIZE: "2",
    OTEL_SDK_DISABLED: "true",
    DO_NOT_TRACK: "1",
    POSTHOG_DISABLED: "1",
    COREPACK_HOME: path.join(projectPath, ".corepack"),
    npm_config_cache: path.join(projectPath, ".npm-cache"),
    PNPM_HOME: path.join(projectPath, ".pnpm-home"),
    XDG_CACHE_HOME: path.join(projectPath, ".cache"),
    XDG_CONFIG_HOME: path.join(projectPath, ".config"),
  };
}

async function getPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve) => server.close(resolve));
  if (!port)
    fail("Could not select a local Open Design port.", "PORT_UNAVAILABLE");
  return port;
}

async function runOd(args, id, options = {}) {
  await ensureOpenDesignInstalled();
  const dir = projectDir(id);
  const manifest = await readManifest(id);
  const runtime = await readRuntime(id);
  const env = openDesignEnv(dir, manifest.runtime);
  env.OD_PORT = String(runtime.port);
  env.OD_BIND_HOST = "127.0.0.1";
  const testCommand = testOpenDesignCommand();
  const command = testCommand ? process.execPath : nodePath();
  const argv = testCommand
    ? [testCommand, ...args]
    : [openDesignCli(), ...args];
  if (options.heartbeat) {
    const timer = setInterval(() => void touchProject(id), 20_000);
    timer.unref();
    try {
      return await runChild(command, argv, {
        cwd: dir,
        env,
        timeoutMs: options.timeoutMs ?? RUN_TIMEOUT_MS,
      });
    } finally {
      clearInterval(timer);
      await touchProject(id);
    }
  }
  return runChild(command, argv, {
    cwd: dir,
    env,
    timeoutMs: options.timeoutMs,
  });
}

async function readRuntime(id) {
  return JSON.parse(
    await readFile(path.join(projectDir(id), ".daemon.json"), "utf8"),
  );
}

async function isDaemonReady(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/daemon/status`, {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function startDaemon(id) {
  await ensureOpenDesignInstalled();
  const dir = projectDir(id);
  const manifest = await readManifest(id);
  await ensureLocalTelemetryOff(dir);
  let runtime = null;
  try {
    runtime = await readRuntime(id);
  } catch {}
  if (runtime?.port && (await isDaemonReady(runtime.port))) {
    await startSupervisor(id);
    return runtime;
  }
  const port = await getPort();
  const env = openDesignEnv(dir, manifest.runtime);
  env.OD_PORT = String(port);
  env.OD_BIND_HOST = "127.0.0.1";
  const testCommand = testOpenDesignCommand();
  let daemonCommand = testCommand ? process.execPath : nodePath();
  let daemonArgs = testCommand
    ? [
        testCommand,
        "daemon",
        "start",
        "--headless",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--no-open",
      ]
    : [
        openDesignCli(),
        "daemon",
        "start",
        "--headless",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--no-open",
      ];
  if (process.platform === "darwin") {
    const sandboxExec = "/usr/bin/sandbox-exec";
    try {
      await stat(sandboxExec);
    } catch {
      fail(
        "Colony could not start Open Design without the macOS private-folder sandbox.",
        "SANDBOX_UNAVAILABLE",
      );
    }
    const sandboxFile = path.join(dir, ".agent-sandbox.sb");
    await writeFile(
      sandboxFile,
      colonySandboxProfile(
        userHome(),
        sourceRoot,
        path.dirname(nodePath()),
        dir,
        (await readManifest(id)).runtime,
        [port],
      ),
      { mode: 0o600 },
    );
    daemonArgs = ["-f", sandboxFile, daemonCommand, ...daemonArgs];
    daemonCommand = sandboxExec;
  }
  const child = spawn(daemonCommand, daemonArgs, {
    cwd: dir,
    detached: process.platform !== "win32",
    env,
    stdio: "ignore",
  });
  child.on("error", () => {});
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  const started = { pid: child.pid, port, startedAt: Date.now() };
  await writeJsonAtomic(path.join(dir, ".daemon.json"), started);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      const reason = `Open Design daemon exited during startup (${child.exitCode ?? child.signalCode}).`;
      await writeProjectLog(id, "", reason);
      fail(reason, "DAEMON_START_FAILED");
    }
    if (await isDaemonReady(port)) {
      await startSupervisor(id);
      return started;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const failure = "Open Design daemon health check timed out after 30 seconds.";
  await writeProjectLog(id, "", failure);
  await stopDaemon(id);
  fail(failure, "DAEMON_START_TIMEOUT");
}

async function startSupervisor(id) {
  const marker = path.join(projectDir(id), ".supervisor.json");
  try {
    const current = JSON.parse(await readFile(marker, "utf8"));
    if (Number.isSafeInteger(current.pid) && current.pid > 0) {
      process.kill(current.pid, 0);
      return;
    }
  } catch {}
  const env = {
    HOME: userHome(),
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    COLONY_MANAGED_NODE: nodePath(),
    COLONY_DESIGN_DATA_DIR: root,
  };
  const child = spawn(nodePath(), [helperPath, "__supervise", id], {
    detached: process.platform !== "win32",
    env,
    stdio: "ignore",
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  child.unref();
  await writeJsonAtomic(path.join(projectDir(id), ".supervisor.json"), {
    pid: child.pid,
  });
}

async function touchProject(id) {
  const dir = projectDir(id);
  await writeFile(path.join(dir, ".last-used"), `${Date.now()}\n`, {
    mode: 0o600,
  });
}

async function stopDaemon(id) {
  const dir = projectDir(id);
  let runtime;
  try {
    runtime = await readRuntime(id);
  } catch {
    await stopSupervisor(id);
    return;
  }
  let runtimeType = "none";
  try {
    runtimeType = (await readManifest(id)).runtime;
  } catch {}
  const env = openDesignEnv(dir, runtimeType);
  env.OD_PORT = String(runtime.port);
  const testCommand = testOpenDesignCommand();
  const command = testCommand ? process.execPath : nodePath();
  const args = testCommand
    ? [
        testCommand,
        "daemon",
        "stop",
        "--daemon-url",
        `http://127.0.0.1:${runtime.port}`,
      ]
    : [
        openDesignCli(),
        "daemon",
        "stop",
        "--daemon-url",
        `http://127.0.0.1:${runtime.port}`,
      ];
  try {
    await runChild(command, args, { cwd: dir, env, timeoutMs: 5000 });
  } catch {}
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!(await isDaemonReady(runtime.port))) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  try {
    process.kill(
      process.platform === "win32" ? runtime.pid : -runtime.pid,
      "SIGTERM",
    );
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 200));
  try {
    process.kill(
      process.platform === "win32" ? runtime.pid : -runtime.pid,
      "SIGKILL",
    );
  } catch {}
  await rm(path.join(dir, ".daemon.json"), { force: true });
  await stopSupervisor(id);
}

async function stopSupervisor(id) {
  const marker = path.join(projectDir(id), ".supervisor.json");
  let pid;
  try {
    const state = JSON.parse(await readFile(marker, "utf8"));
    if (Number.isSafeInteger(state.pid) && state.pid > 0) pid = state.pid;
  } catch {}
  if (pid) {
    try {
      process.kill(process.platform === "win32" ? pid : -pid, "SIGTERM");
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      process.kill(process.platform === "win32" ? pid : -pid, "SIGKILL");
    } catch {}
  }
  await rm(marker, { force: true });
}

async function supervise(id) {
  const dir = projectDir(id);
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    let lastUsed = 0;
    try {
      lastUsed = Number(
        (await readFile(path.join(dir, ".last-used"), "utf8")).trim(),
      );
    } catch {}
    if (Date.now() - lastUsed >= IDLE_TIMEOUT_MS) {
      await stopDaemon(id);
      return;
    }
    let runtime;
    try {
      runtime = await readRuntime(id);
    } catch {
      return;
    }
    if (!(await isDaemonReady(runtime.port))) return;
  }
}

async function readBrand(flags) {
  if (flags["brand-file"]) {
    fail(
      "Use the saved Colony business profile for design projects.",
      "BRAND_OVERRIDE_DENIED",
    );
  }
  const relay = process.env.BUZZ_RELAY_URL?.replace(/\/$/u, "").toLowerCase();
  if (!relay) return null;
  const brandDir = path.join(root, "brand-profiles");
  let names = [];
  try {
    names = await readdir(brandDir);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!/^[0-9a-f-]{36}\.json$/u.test(name)) continue;
    try {
      const brand = JSON.parse(
        await readFile(path.join(brandDir, name), "utf8"),
      );
      if (
        String(brand.relayUrl ?? "")
          .replace(/\/$/u, "")
          .toLowerCase() === relay
      )
        return brand.profile;
    } catch {}
  }
  return null;
}

function normalizeWebsite(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function newProject(flags) {
  const name = String(flags.name ?? "").trim();
  if (!name || name.length > 120)
    fail("Pass --name with a title under 120 characters.", "BAD_NAME");
  const runtime = String(flags.runtime ?? "");
  if (!RUNTIMES.has(runtime))
    fail("Runtime must be claude, codex, opencode, or colony.", "BAD_RUNTIME");
  const brief = String(flags.brief ?? "");
  if (!brief.trim() || Buffer.byteLength(brief) > 16 * 1024)
    fail(
      "Pass --brief with a non-empty design brief under 16 KB.",
      "BAD_BRIEF",
    );
  const channel = flags.channel ? String(flags.channel) : null;
  if (channel && !/^[0-9a-f-]{36}$/iu.test(channel))
    fail("Channel must be a UUID.", "BAD_CHANNEL");
  const brand = await readBrand(flags);
  const id = randomUUID();
  const dir = projectDir(id);
  await mkdir(projectsRoot, { recursive: true, mode: 0o700 });
  await chmod(projectsRoot, 0o700);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const website = normalizeWebsite(brand?.website);
  const safeBrand = brand
    ? {
        name: typeof brand.name === "string" ? brand.name.slice(0, 200) : "",
        website,
        description:
          typeof brand.description === "string"
            ? brand.description.slice(0, 4000)
            : "",
        logoUrl:
          typeof brand.logoUrl === "string"
            ? normalizeWebsite(brand.logoUrl)
            : null,
        logoDataUrl:
          typeof brand.logoDataUrl === "string" &&
          brand.logoDataUrl.startsWith("data:image/") &&
          brand.logoDataUrl.length < 3_000_000
            ? brand.logoDataUrl
            : null,
      }
    : null;
  const prompt = [
    "Create a private visual design in this Colony-managed Open Design project.",
    "Open Design is the default design engine. Do not use Claude Design instead.",
    "Use the current runtime credentials. Keep all files in this project folder.",
    "Do not publish, deploy, upload, or send anything. The owner must approve the preview first.",
    "Use saved brand colours, logo, and website when available. If no colours are saved, identify them from the public website and verified logo; do not guess.",
    "Render and inspect desktop at 1440px and mobile at 390px. Compare to the brief and brand, fix visible differences, then capture both sizes again.",
    "Save the final screenshots as desktop-1440.png and mobile-390.png in the project root.",
    "\n## Business brand\n",
    JSON.stringify(
      safeBrand ?? { name: "", website: null, description: "" },
      null,
      2,
    ),
    "\n## Design brief\n",
    brief,
  ].join("\n");
  await writeFile(path.join(dir, "brief.md"), prompt, { mode: 0o600 });
  await writeJsonAtomic(path.join(dir, "brand.json"), safeBrand ?? {});
  const manifest = {
    id,
    title: name,
    status: "created",
    review: "pending",
    runtime,
    engine: `Open Design ${OPEN_DESIGN_VERSION}`,
    projectPath: dir,
    sourceCommit: OPEN_DESIGN_COMMIT,
    channel,
    createdAt: new Date().toISOString(),
    previewHtmlPath: null,
    outputPaths: [],
    feedback: null,
  };
  await writeJsonAtomic(path.join(dir, "colony-design.json"), manifest);
  await touchProject(id);
  try {
    const runtimeInfo = await startDaemon(id);
    const env = openDesignEnv(dir, runtime);
    const testCommand = testOpenDesignCommand();
    const command = testCommand ? process.execPath : nodePath();
    const argv = testCommand
      ? [
          testCommand,
          "project",
          "import-folder",
          dir,
          "--name",
          name,
          "--json",
          "--daemon-url",
          `http://127.0.0.1:${runtimeInfo.port}`,
        ]
      : [
          openDesignCli(),
          "project",
          "import-folder",
          dir,
          "--name",
          name,
          "--json",
          "--daemon-url",
          `http://127.0.0.1:${runtimeInfo.port}`,
        ];
    const importResult = await runChild(command, argv, {
      cwd: dir,
      env,
      timeoutMs: 2 * 60 * 1000,
    });
    let imported = {};
    try {
      imported = JSON.parse(importResult.stdout);
    } catch {}
    manifest.openDesignProjectId = imported.project?.id ?? id;
    await writeJsonAtomic(path.join(dir, "colony-design.json"), manifest);
    json({ ...manifest, previewUrl: `http://127.0.0.1:${runtimeInfo.port}/` });
  } catch (error) {
    await stopDaemon(id);
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

async function runProject(id, flags) {
  const manifest = await readManifest(id);
  if (manifest.review === "approved") {
    fail(
      "This approved design is the source for implementation. Start a new design to change it.",
      "DESIGN_APPROVED",
    );
  }
  if (manifest.status === "ready_for_review" && manifest.review === "pending") {
    if (!manifest.channel) {
      fail(
        "Create the project with --channel <current-channel-uuid> so Colony can post the owner review card.",
        "DESIGN_CHANNEL_REQUIRED",
      );
    }
    const runtime = await startDaemon(id);
    await touchProject(id);
    json({
      id,
      title: manifest.title,
      status: manifest.status,
      review: manifest.review,
      runtime: manifest.runtime,
      previewUrl: `http://127.0.0.1:${runtime.port}/`,
      previewHtmlPath: manifest.previewHtmlPath,
      outputPaths: manifest.outputPaths,
      channel: manifest.channel,
      reviewCardRetry: true,
    });
    return;
  }
  if (
    manifest.status === "ready_for_review" &&
    manifest.review !== "changes_requested"
  ) {
    fail(
      "Wait for the owner to approve or request changes before running this design again.",
      "OWNER_REVIEW_REQUIRED",
    );
  }
  if (!manifest.channel) {
    fail(
      "Create the project with --channel <current-channel-uuid> so Colony can post the owner review card.",
      "DESIGN_CHANNEL_REQUIRED",
    );
  }
  const runtime = await startDaemon(id);
  await touchProject(id);
  const extra = flags.prompt ? String(flags.prompt) : "";
  if (extra.length > 16_000)
    fail("Follow-up prompt is too large.", "PROMPT_TOO_LARGE");
  const ownerFeedback =
    manifest.review === "changes_requested"
      ? String(manifest.feedback ?? "")
      : "";
  const followUp = [ownerFeedback, extra].filter(Boolean).join("\n\n");
  if (followUp)
    await writeFile(path.join(projectDir(id), "follow-up.md"), followUp, {
      mode: 0o600,
    });
  const promptFile = followUp
    ? path.join(projectDir(id), "follow-up.md")
    : path.join(projectDir(id), "brief.md");
  const args = [
    "run",
    "redesign",
    "--path",
    projectDir(id),
    "--prompt-file",
    promptFile,
    "--agent",
    manifest.runtime,
    "--follow",
    "--json",
    "--daemon-url",
    `http://127.0.0.1:${runtime.port}`,
  ];
  let response;
  try {
    response = await runOd(args, id, {
      heartbeat: true,
      timeoutMs: RUN_TIMEOUT_MS,
    });
  } catch (error) {
    await writeProjectLog(
      id,
      error.stdout ?? "",
      error.stderr ?? error.message ?? "Open Design run failed.",
    );
    manifest.status = "failed";
    manifest.lastRunAt = new Date().toISOString();
    manifest.lastRunError = String(
      error.message ?? "Open Design run failed.",
    ).slice(0, 4096);
    await writeJsonAtomic(
      path.join(projectDir(id), "colony-design.json"),
      manifest,
    );
    await stopDaemon(id);
    throw error;
  }
  await writeProjectLog(id, response.stdout, response.stderr);
  const files = await collectOutputFiles(projectDir(id));
  let renderProof;
  try {
    renderProof = await inspectRenderProof(files);
  } catch (error) {
    manifest.status = "failed";
    manifest.lastRunAt = new Date().toISOString();
    manifest.lastRunError = String(
      error.message ?? "Required render proof is missing.",
    ).slice(0, 4096);
    manifest.outputPaths = files;
    await writeJsonAtomic(
      path.join(projectDir(id), "colony-design.json"),
      manifest,
    );
    await stopDaemon(id);
    throw error;
  }
  manifest.status = "ready_for_review";
  manifest.review = "pending";
  manifest.previewHtmlPath = renderProof.html;
  manifest.outputPaths = files;
  manifest.lastRunAt = new Date().toISOString();
  manifest.lastRunOutput = response.stdout.slice(-16_000);
  await writeJsonAtomic(
    path.join(projectDir(id), "colony-design.json"),
    manifest,
  );
  json({
    id,
    title: manifest.title,
    status: manifest.status,
    review: manifest.review,
    runtime: manifest.runtime,
    previewUrl: `http://127.0.0.1:${runtime.port}/`,
    previewHtmlPath: renderProof.html,
    outputPaths: files,
    channel: manifest.channel,
  });
}

export async function inspectRenderProof(files) {
  const html =
    files.find((file) => path.basename(file).toLowerCase() === "index.html") ??
    files.find((file) => file.toLowerCase().endsWith(".html")) ??
    null;
  if (!html) {
    fail(
      "Open Design must produce an HTML preview and desktop/mobile screenshots before owner review.",
      "RENDER_PROOF_MISSING",
    );
  }
  for (const [name, expectedWidth] of [
    ["desktop-1440.png", 1440],
    ["mobile-390.png", 390],
  ]) {
    const image = files.find(
      (file) => path.basename(file).toLowerCase() === name,
    );
    if (!image) {
      fail(
        `Open Design is missing ${name}; owner review requires both final screenshots.`,
        "RENDER_PROOF_MISSING",
      );
    }
    const metadata = await stat(image);
    if (
      !metadata.isFile() ||
      metadata.size < 24 ||
      metadata.size > 32 * 1024 * 1024
    ) {
      fail(
        `${name} is not a bounded PNG image. Capture it again before owner review.`,
        "RENDER_PROOF_INVALID",
      );
    }
    const handle = await open(image, "r");
    let header;
    try {
      header = Buffer.alloc(24);
      const result = await handle.read(header, 0, header.length, 0);
      if (result.bytesRead !== header.length) header = Buffer.alloc(0);
    } finally {
      await handle.close();
    }
    if (
      header.length !== 24 ||
      !header
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      header.toString("ascii", 12, 16) !== "IHDR" ||
      header.readUInt32BE(16) !== expectedWidth ||
      header.readUInt32BE(20) === 0
    ) {
      fail(
        `${name} does not have the required ${expectedWidth}px PNG width. Capture it again before owner review.`,
        "RENDER_PROOF_INVALID",
      );
    }
  }
  return {
    html,
    desktop: files.find(
      (file) => path.basename(file).toLowerCase() === "desktop-1440.png",
    ),
    mobile: files.find(
      (file) => path.basename(file).toLowerCase() === "mobile-390.png",
    ),
  };
}

async function collectOutputFiles(dir) {
  const output = [];
  async function visit(current, depth) {
    if (depth > 5 || output.length >= 60) return;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(target, depth + 1);
      else if (
        /\.(html|css|js|svg|png|jpe?g|webp|pdf|pptx|zip|md)$/iu.test(entry.name)
      )
        output.push(target);
    }
  }
  await visit(dir, 0);
  return output;
}

async function writeProjectLog(id, stdout, stderr) {
  const dir = path.join(projectDir(id), "logs");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  const stamp = new Date().toISOString().replaceAll(":", "-");
  const file = path.join(dir, `${stamp}-${process.pid}.log`);
  const boundedOut = String(stdout).slice(-48 * 1024);
  const boundedErr = String(stderr).slice(-16 * 1024);
  await writeFile(file, `stdout:\n${boundedOut}\nstderr:\n${boundedErr}\n`, {
    mode: 0o600,
  });
  const names = (await readdir(dir))
    .filter((name) => name.endsWith(".log"))
    .sort();
  for (const stale of names.slice(
    0,
    Math.max(0, names.length - MAX_PROJECT_LOGS),
  )) {
    await rm(path.join(dir, stale), { force: true });
  }
}

async function statusProject(id) {
  const manifest = await readManifest(id);
  await touchProject(id);
  json({
    ...manifest,
    previewHtmlPath: manifest.previewHtmlPath,
    outputPaths: manifest.outputPaths,
  });
}

async function previewProject(id) {
  const manifest = await readManifest(id);
  const runtime = await startDaemon(id);
  await touchProject(id);
  json({
    id,
    previewUrl: `http://127.0.0.1:${runtime.port}/`,
    htmlPath: manifest.previewHtmlPath,
    outputPaths: manifest.outputPaths,
  });
}

async function exportProject(id, flags) {
  const manifest = await readManifest(id);
  if (manifest.review !== "approved") {
    fail(
      "The owner must approve the design before it can be exported.",
      "OWNER_APPROVAL_REQUIRED",
    );
  }
  const out = path.resolve(
    String(flags.out ?? path.join(projectDir(id), "exports")),
  );
  const rootResolved = path.resolve(projectsRoot) + path.sep;
  if (!out.startsWith(rootResolved))
    fail("Exports must stay inside Colony design data.", "EXPORT_PATH_DENIED");
  await mkdir(out, { recursive: true, mode: 0o700 });
  const canonicalOut = await realpath(out);
  if (!canonicalOut.startsWith(rootResolved))
    fail("Exports must stay inside Colony design data.", "EXPORT_PATH_DENIED");
  const format = String(flags.format ?? "html").toLowerCase();
  const candidates = manifest.outputPaths.filter((file) =>
    path.resolve(file).startsWith(path.resolve(projectDir(id)) + path.sep),
  );
  const selected = candidates.filter(
    (file) => path.extname(file).slice(1).toLowerCase() === format,
  );
  const copied = [];
  for (const source of selected) {
    const dest = path.join(canonicalOut, path.basename(source));
    await writeFile(dest, await readFile(source), { mode: 0o600 });
    copied.push(dest);
  }
  json({ id, format, outputPaths: copied });
}

async function main(args = process.argv.slice(2)) {
  const [command, id, ...tail] = args;
  const parsed = flags(tail);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  if (command === "__supervise") return supervise(id);
  if (command === "new") return newProject(flags([id, ...tail]));
  if (command === "run") return runProject(id, parsed);
  if (command === "status") return statusProject(id);
  if (command === "preview") return previewProject(id);
  if (command === "export") return exportProject(id, parsed);
  if (command === "stop") return stopDaemon(id);
  fail("Usage: colony design new|run|status|preview|export|stop", "USAGE");
}

if (helperPath && import.meta.url === pathToFileURL(helperPath).href) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({ error: error.code ?? "OPEN_DESIGN_ERROR", message: error.message })}\n`,
    );
    process.exitCode = 1;
  });
}
