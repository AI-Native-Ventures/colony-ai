import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";

import {
  OPEN_DESIGN_ARCHIVE_SHA256,
  applyColonyPatches,
  colonySandboxProfile,
  inspectRenderProof,
  runChild,
  verifyArchiveDigest,
} from "../../../../scripts/open-design/colony-design.mjs";

const helperSource = fileURLToPath(
  new URL("../../../../scripts/open-design/colony-design.mjs", import.meta.url),
);
const tempBase = process.platform === "darwin" ? "/private/tmp" : os.tmpdir();
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngCrc32(value) {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload) {
  const kind = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(pngCrc32(Buffer.concat([kind, payload])));
  return Buffer.concat([length, kind, payload, crc]);
}

function makePng(width) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.concat([
    Buffer.from([0]),
    Buffer.alloc(width * 4, 255),
  ]);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

test("Open Design packaging pins the expected source archive checksum", () => {
  assert.equal(verifyArchiveDigest(OPEN_DESIGN_ARCHIVE_SHA256), true);
  assert.equal(verifyArchiveDigest("0".repeat(64)), false);
});

test("the managed sandbox fences home scans, private folders, and sibling projects", () => {
  const home = path.join(tempBase, "colony-design-home");
  const designRoot = path.join(
    home,
    "Library",
    "Application Support",
    "Colony",
    "design",
  );
  const project = path.join(
    designRoot,
    "projects",
    "b9517e2d-46d3-493d-9e46-aed2c6320505",
  );
  const sourceRoot = path.join(designRoot, "runtime", "open-design-0.25.1");
  const profile = colonySandboxProfile(
    home,
    sourceRoot,
    path.join(designRoot, "node", "bin"),
    project,
    "codex",
    [43127],
  );
  assert.match(profile, /Library\/Mail/u);
  assert.match(profile, /Library\/Messages/u);
  assert.match(profile, /Library\/Photos/u);
  assert.match(profile, /Library\/Keychains/u);
  assert.match(profile, /\.colony/u);
  assert.match(profile, /\.buzz/u);
  assert.match(profile, /\.claude/u);
  assert.match(profile, /\.config\/opencode/u);
  assert.match(profile, /\.local\/share\/opencode/u);
  assert.doesNotMatch(profile, /require-not/u);
  assert.match(profile, /\.agent-sandbox\.sb/u);
  assert.ok(profile.includes(`(subpath "${sourceRoot}")`));
  assert.ok(profile.includes(`(deny file-read* (subpath "${home}")`));
  assert.ok(profile.includes('(deny file-read* (subpath "/Users")'));
  assert.ok(profile.includes('(deny network-outbound (remote ip "*:*"))'));
  assert.ok(profile.includes('(allow network-outbound (remote tcp "*:443"))'));
  assert.ok(profile.includes('(deny network-inbound (local ip "*:*"))'));
  assert.ok(
    profile.includes('(allow network-outbound (remote ip "localhost:43127"))'),
  );
  assert.ok(
    profile.includes('(allow network-inbound (local ip "localhost:43127"))'),
  );
  assert.doesNotMatch(profile, /localhost:\*/u);
  assert.ok(
    profile.includes(
      `(deny file-read* (subpath "${path.join(designRoot, "projects")}")`,
    ),
  );
  assert.ok(profile.includes(`(allow file-read* (subpath "${project}")`));
  const homeWriteFence = profile
    .split("\n")
    .find((line) => line.startsWith(`(deny file-write* (subpath "${home}")`));
  assert.ok(homeWriteFence);
  assert.ok(!homeWriteFence.includes(sourceRoot));
  assert.equal(
    profile
      .split("\n")
      .some((line) =>
        line.startsWith(
          `(deny file-read* (subpath "${path.join(home, ".codex")}"`,
        ),
      ),
    false,
  );
});

async function writePatchFixture(root) {
  const runtimes = path.join(root, "apps/daemon/src/runtimes");
  const defs = path.join(runtimes, "defs");
  await mkdir(defs, { recursive: true });
  await mkdir(path.join(root, "apps/daemon/src"), { recursive: true });
  await writeFile(
    path.join(runtimes, "registry.ts"),
    "import { claudeAgentDef } from './defs/claude.js';\nexport const SHIPPED_AGENT_DEFS = [\n  claudeAgentDef,\n  codexAgentDef,\n];\n",
  );
  await writeFile(
    path.join(defs, "claude.ts"),
    "      args.push('--permission-mode', 'bypassPermissions');\n",
  );
  await writeFile(
    path.join(runtimes, "opencode-permissions.ts"),
    "  if (agentCapabilities.get(agentId)?.skipPermissions) {\n    return true;\n  }\n",
  );
  await writeFile(
    path.join(defs, "codex.ts"),
    [
      "      const needsDangerFullAccess = codexNeedsDangerFullAccessSandbox();",
      "              'sandbox_workspace_write.network_access=true',",
      "              'sandbox_workspace_write.network_access=true',",
      "              'sandbox_workspace_write.network_access=true',",
    ].join("\n"),
  );
  await writeFile(
    path.join(root, "apps/daemon/src/server.ts"),
    [
      "          const opencodeConfigContent = buildOpenCodeMcpConfigContent(",
      "          if (opencodeConfigContent) {",
      "            env[isMiMoContent ? 'MIMOCODE_CONFIG_CONTENT' : 'OPENCODE_CONFIG_CONTENT'] = opencodeConfigContent;",
      "          }",
      "        } catch (err) {",
      "          console.warn(",
      "            '[mcp-config] failed to build OPENCODE_CONFIG_CONTENT:',",
      "            err && err.message ? err.message : err,",
      "          );",
      "        }",
    ].join("\n"),
  );
}

test("managed runtime patches fail closed and install the Colony gateway adapter", async () => {
  const temp = await mkdtemp(path.join(tempBase, "colony-design-patch-"));
  try {
    await writePatchFixture(temp);
    await applyColonyPatches(temp);
    const registry = await readFile(
      path.join(temp, "apps/daemon/src/runtimes/registry.ts"),
      "utf8",
    );
    const claude = await readFile(
      path.join(temp, "apps/daemon/src/runtimes/defs/claude.ts"),
      "utf8",
    );
    const codex = await readFile(
      path.join(temp, "apps/daemon/src/runtimes/defs/codex.ts"),
      "utf8",
    );
    const openCode = await readFile(
      path.join(temp, "apps/daemon/src/server.ts"),
      "utf8",
    );
    assert.match(registry, /colonyBuzzAgentDef/u);
    assert.match(claude, /acceptEdits/u);
    assert.match(claude, /--disallowedTools/u);
    assert.doesNotMatch(
      claude,
      /COLONY_DESIGN_MANAGED[^\n]*bypassPermissions/u,
    );
    assert.match(codex, /COLONY_DESIGN_MANAGED === '1'\s*\? false/u);
    assert.equal(
      (codex.match(/sandbox_workspace_write\.network_access=true/gu) ?? [])
        .length,
      3,
    );
    assert.match(openCode, /colonyDesignData/u);
    assert.match(openCode, /permission\.bash\[prefix\] = 'deny'/u);
    const adapter = await readFile(
      path.join(temp, "apps/daemon/src/runtimes/defs/colony-buzz-agent.ts"),
      "utf8",
    );
    assert.match(adapter, /COLONY_WORKER_AGENT_BIN \|\| 'buzz-agent'/u);
    assert.match(adapter, /acp-json-rpc/u);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("managed child timeout kills the full process group", {
  timeout: 10_000,
}, async () => {
  const temp = await mkdtemp(
    path.join(tempBase, "colony-design-process-bound-"),
  );
  const marker = path.join(temp, "grandchild-survived");
  try {
    const grandchild = `setTimeout(() => { require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'survived'); process.exit(0); }, 700);`;
    const parent = `const { spawn } = require('node:child_process'); spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' }); setInterval(() => {}, 1000);`;
    await assert.rejects(
      runChild(process.execPath, ["-e", parent], {
        cwd: temp,
        env: { HOME: temp, PATH: process.env.PATH ?? "" },
        timeoutMs: 100,
      }),
      (error) => error.code === "CHILD_FAILED",
    );
    await new Promise((resolve) => setTimeout(resolve, 900));
    await assert.rejects(readFile(marker));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("owner review requires valid 1440px and 390px PNG render proof", async () => {
  const temp = await mkdtemp(
    path.join(tempBase, "colony-design-render-proof-"),
  );
  const html = path.join(temp, "index.html");
  const desktop = path.join(temp, "desktop-1440.png");
  const mobile = path.join(temp, "mobile-390.png");
  try {
    await writeFile(html, "<!doctype html><title>Design</title>");
    await writeFile(desktop, makePng(1440));
    await writeFile(mobile, makePng(390));
    assert.deepEqual(await inspectRenderProof([html, desktop, mobile]), {
      html,
      desktop,
      mobile,
    });

    await writeFile(mobile, makePng(389));
    await assert.rejects(
      inspectRenderProof([html, desktop, mobile]),
      (error) => error.code === "RENDER_PROOF_INVALID",
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

function runHelper(helper, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [helper, ...args], {
      cwd: path.dirname(helper),
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = [];
    const err = [];
    let outBytes = 0;
    let errBytes = 0;
    const collect = (chunks, stream, counter, limit) => {
      stream.on("data", (chunk) => {
        const bytes = chunk.subarray(0, Math.max(0, limit - counter.value));
        chunks.push(bytes);
        counter.value += bytes.length;
      });
    };
    collect(
      out,
      child.stdout,
      {
        get value() {
          return outBytes;
        },
        set value(value) {
          outBytes = value;
        },
      },
      1024 * 1024,
    );
    collect(
      err,
      child.stderr,
      {
        get value() {
          return errBytes;
        },
        set value(value) {
          errBytes = value;
        },
      },
      128 * 1024,
    );
    const timeout = setTimeout(
      () => {
        try {
          process.kill(child.pid, "SIGKILL");
        } catch {}
      },
      Number(env.COLONY_DESIGN_TEST_CHILD_TIMEOUT_MS ?? 90_000),
    );
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      const result = {
        code,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      };
      if (code === 0) resolve(result);
      else
        reject(
          Object.assign(
            new Error(result.stderr || `helper exited ${code}`),
            result,
          ),
        );
    });
  });
}

const STUB_OPEN_DESIGN = `
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
const json = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
if (args[0] === 'daemon' && args[1] === 'start') {
  const port = Number(args[args.indexOf('--port') + 1]);
  const server = createServer((request, response) => {
    if (request.url === '/api/daemon/status') {
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"ready":true}');
      return;
    }
    if (request.url === '/__shutdown') {
      response.writeHead(200).end('stopping');
      server.close(() => process.exit(0));
      return;
    }
    response.writeHead(404).end();
  });
  server.listen(port, '127.0.0.1');
} else if (args[0] === 'daemon' && args[1] === 'stop') {
  const url = args[args.indexOf('--daemon-url') + 1];
  await fetch(url + '/__shutdown');
} else if (args[0] === 'project' && args[1] === 'import-folder') {
  json({ project: { id: 'stub-open-design-project' } });
} else if (args[0] === 'run') {
  if (!process.env.BUZZ_PRIVATE_KEY || !process.env.BUZZ_RELAY_URL || !process.env.BUZZ_AUTH_TAG) {
    throw new Error('the managed free runtime did not receive Colony credentials');
  }
  const response = await fetch(process.env.STUB_GATEWAY_URL, {
    method: 'POST',
    headers: {
      authorization: 'Nostr stub-owner-signed-session',
      'x-auth-tag': process.env.BUZZ_AUTH_TAG,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      session_id: process.env.COLONY_CREDITS_SESSION_ID,
      request_id: '1f2e3d4c-5b6a-7980-9a0b-1c2d3e4f5a6b',
      messages: [{ role: 'user', content: 'Create the landing page.' }],
      tools: [],
    }),
  });
  if (!response.ok) throw new Error('stub Colony free gateway refused the request');
  const gatewayAnswer = await response.json();
  writeFileSync(path.join(process.cwd(), 'index.html'), '<!doctype html><h1>Stub design</h1>');
  writeFileSync(path.join(process.cwd(), 'desktop-1440.png'), readFileSync(process.env.STUB_DESKTOP_PNG));
  writeFileSync(path.join(process.cwd(), 'mobile-390.png'), readFileSync(process.env.STUB_MOBILE_PNG));
  writeFileSync(path.join(process.cwd(), '.runtime-invocation.json'), JSON.stringify({
    args,
    managed: process.env.COLONY_DESIGN_MANAGED,
    provider: process.env.BUZZ_AGENT_PROVIDER,
    model: process.env.COLONY_CREDITS_MODEL,
    gateway: process.env.COLONY_CREDITS_GATEWAY,
    session: process.env.COLONY_CREDITS_SESSION_ID,
    relay: process.env.BUZZ_RELAY_URL,
    hasBuzzPrivateKey: Boolean(process.env.BUZZ_PRIVATE_KEY),
    authTag: process.env.BUZZ_AUTH_TAG ?? null,
    agentBinary: process.env.COLONY_WORKER_AGENT_BIN ?? null,
    ambientMarker: process.env.DESIGN_SHOULD_NOT_CROSS_BOUNDARY ?? null,
    nodeOptions: process.env.NODE_OPTIONS,
    gatewayAnswer: gatewayAnswer.choices?.[0]?.message?.content,
    customerKey: process.env.OPENAI_API_KEY ?? null,
    claudeKey: process.env.ANTHROPIC_API_KEY ?? null,
  }));
  json({ ok: true, output: 'preview generated' });
} else {
  json({ ok: true });
}
`;

test("throwaway-home run uses the Colony free gateway, renders, reviews, exports, and stops", {
  timeout: 120_000,
  skip: process.platform !== "darwin" && "requires the macOS managed sandbox",
}, async () => {
  const temp = await mkdtemp(path.join(tempBase, "colony-design-e2e-"));
  const gatewayRequests = [];
  const gateway = createServer((request, response) => {
    const chunks = [];
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes <= 1024 * 1024) chunks.push(chunk);
    });
    request.on("end", () => {
      gatewayRequests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        authTag: request.headers["x-auth-tag"],
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      });
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: "Stub free gateway answer",
              },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 },
        }),
      );
    });
  });
  await new Promise((resolve, reject) => {
    gateway.once("error", reject);
    gateway.listen(0, "127.0.0.1", resolve);
  });
  const gatewayAddress = gateway.address();
  assert.ok(gatewayAddress && typeof gatewayAddress === "object");
  const home = path.join(temp, "home");
  const appData = path.join(
    home,
    "Library",
    "Application Support",
    "Colony",
    "design",
  );
  const helper = path.join(appData, "runtime", "colony-design.mjs");
  const stub = path.join(temp, "stub-open-design.mjs");
  let projectId;
  let env;
  try {
    await mkdir(path.dirname(helper), { recursive: true, mode: 0o700 });
    await mkdir(home, { recursive: true, mode: 0o700 });
    await copyFile(helperSource, helper);
    await writeFile(stub, STUB_OPEN_DESIGN, { mode: 0o600 });
    env = {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: home,
      COLONY_DESIGN_DATA_DIR: appData,
      COLONY_MANAGED_NODE: process.execPath,
      COLONY_DESIGN_OD: stub,
      COLONY_DESIGN_TEST_MODE: "1",
      COLONY_DESIGN_TEST_CHILD_TIMEOUT_MS: "15000",
      COLONY_CREDITS_GATEWAY: "1",
      COLONY_CREDITS_SESSION_ID: "c2ded57c-9815-4cc1-bfc4-106f5777b4d9",
      COLONY_CREDITS_MODEL: "openai/gpt-4.1-mini:free",
      STUB_GATEWAY_URL: `http://127.0.0.1:${gatewayAddress.port}/api/credits-gateway/managed-inference`,
      BUZZ_AGENT_PROVIDER: "colony-credits",
      BUZZ_AGENT_MODEL: "openai/gpt-4.1-mini:free",
      COLONY_WORKER_AGENT_BIN: "/private/tmp/colony-design-test/bin/buzz-agent",
      BUZZ_PRIVATE_KEY: "nsec1throwaway-test-key",
      BUZZ_RELAY_URL: "wss://relay.example.test",
      BUZZ_AUTH_TAG: "throwaway-owner-attestation",
      OPENAI_API_KEY: "must-not-reach-the-free-runtime",
      ANTHROPIC_API_KEY: "must-not-reach-the-free-runtime",
      DESIGN_SHOULD_NOT_CROSS_BOUNDARY: "ambient-secret-marker",
    };
    const desktopPng = path.join(temp, "desktop-1440.png");
    const mobilePng = path.join(temp, "mobile-390.png");
    await writeFile(desktopPng, makePng(1440));
    await writeFile(mobilePng, makePng(390));
    env.STUB_DESKTOP_PNG = desktopPng;
    env.STUB_MOBILE_PNG = mobilePng;
    const created = await runHelper(
      helper,
      [
        "new",
        "--name",
        "North Star landing page",
        "--brief",
        "Create a calm, high-contrast landing page with desktop and mobile previews.",
        "--runtime",
        "colony-buzz-agent",
        "--channel",
        "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
      ],
      env,
    );
    const createdRecord = JSON.parse(created.stdout);
    projectId = createdRecord.id;
    assert.equal(createdRecord.runtime, "colony-buzz-agent");
    assert.equal(createdRecord.status, "created");
    assert.equal(createdRecord.channel, "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50");

    const project = path.join(appData, "projects", projectId);
    const projectStat = await stat(project);
    assert.equal(projectStat.mode & 0o777, 0o700);
    const briefStat = await stat(path.join(project, "brief.md"));
    assert.equal(briefStat.mode & 0o777, 0o600);
    assert.match(
      await readFile(path.join(project, "brief.md"), "utf8"),
      /If no colours are saved, identify them from the public website and verified logo/u,
    );
    const telemetry = JSON.parse(
      await readFile(
        path.join(project, ".open-design-data", "app-config.json"),
        "utf8",
      ),
    );
    assert.deepEqual(telemetry.telemetry, {
      metrics: false,
      content: false,
      artifactManifest: false,
    });

    const ran = await runHelper(helper, ["run", projectId], env);
    const runRecord = JSON.parse(ran.stdout);
    assert.equal(runRecord.status, "ready_for_review");
    assert.equal(runRecord.review, "pending");
    assert.ok(
      runRecord.outputPaths.some((file) => file.endsWith("desktop-1440.png")),
    );
    assert.ok(
      runRecord.outputPaths.some((file) => file.endsWith("mobile-390.png")),
    );
    const runtimeInvocation = JSON.parse(
      await readFile(path.join(project, ".runtime-invocation.json"), "utf8"),
    );
    assert.equal(runtimeInvocation.provider, "colony-credits");
    assert.equal(runtimeInvocation.gateway, "1");
    assert.equal(
      runtimeInvocation.session,
      "c2ded57c-9815-4cc1-bfc4-106f5777b4d9",
    );
    assert.equal(runtimeInvocation.relay, "wss://relay.example.test");
    assert.equal(runtimeInvocation.hasBuzzPrivateKey, true);
    assert.equal(runtimeInvocation.authTag, "throwaway-owner-attestation");
    assert.equal(
      runtimeInvocation.agentBinary,
      "/private/tmp/colony-design-test/bin/buzz-agent",
    );
    assert.equal(runtimeInvocation.customerKey, null);
    assert.equal(runtimeInvocation.claudeKey, null);
    assert.equal(runtimeInvocation.ambientMarker, null);
    assert.equal(runtimeInvocation.nodeOptions, "--max-old-space-size=1536");
    const runtime = JSON.parse(
      await readFile(path.join(project, ".runtime-invocation.json"), "utf8"),
    );
    assert.equal(runtime.managed, "1");
    assert.equal(runtime.provider, "colony-credits");
    assert.equal(runtime.model, "openai/gpt-4.1-mini:free");
    assert.equal(runtime.gateway, "1");
    assert.equal(runtime.session, "c2ded57c-9815-4cc1-bfc4-106f5777b4d9");
    assert.equal(runtime.gatewayAnswer, "Stub free gateway answer");
    assert.equal(runtime.customerKey, null);
    assert.equal(runtime.claudeKey, null);
    assert.ok(runtime.args.includes("colony-buzz-agent"));
    assert.equal(gatewayRequests.length, 1);
    assert.equal(gatewayRequests[0].method, "POST");
    assert.equal(
      gatewayRequests[0].url,
      "/api/credits-gateway/managed-inference",
    );
    assert.equal(
      gatewayRequests[0].authorization,
      "Nostr stub-owner-signed-session",
    );
    assert.equal(gatewayRequests[0].authTag, "throwaway-owner-attestation");
    assert.equal(
      gatewayRequests[0].body.session_id,
      "c2ded57c-9815-4cc1-bfc4-106f5777b4d9",
    );
    assert.equal(
      gatewayRequests[0].body.request_id,
      "1f2e3d4c-5b6a-7980-9a0b-1c2d3e4f5a6b",
    );
    assert.deepEqual(gatewayRequests[0].body.messages, [
      { role: "user", content: "Create the landing page." },
    ]);
    assert.ok((await stat(path.join(project, "logs"))).isDirectory());

    const reviewRetry = await runHelper(helper, ["run", projectId], env);
    const retryRecord = JSON.parse(reviewRetry.stdout);
    assert.equal(retryRecord.reviewCardRetry, true);
    assert.equal(retryRecord.status, "ready_for_review");
    assert.equal(retryRecord.review, "pending");
    assert.equal(gatewayRequests.length, 1);

    const manifestPath = path.join(project, "colony-design.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.review = "changes_requested";
    manifest.feedback = "Increase the hero contrast.";
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), {
      mode: 0o600,
    });
    await runHelper(helper, ["stop", projectId], env);
    await assert.rejects(readFile(path.join(project, ".daemon.json")));
    const revised = await runHelper(helper, ["run", projectId], env);
    assert.equal(JSON.parse(revised.stdout).review, "pending");
    assert.match(
      await readFile(path.join(project, "follow-up.md"), "utf8"),
      /Increase the hero contrast/u,
    );
    assert.equal(gatewayRequests.length, 2);

    await assert.rejects(
      runHelper(helper, ["export", projectId, "--format", "html"], env),
      /The owner must approve the design before it can be exported/u,
    );
    const approvedManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    approvedManifest.review = "approved";
    approvedManifest.reviewedAt = new Date().toISOString();
    await writeFile(manifestPath, JSON.stringify(approvedManifest, null, 2), {
      mode: 0o600,
    });
    const exported = await runHelper(
      helper,
      ["export", projectId, "--format", "html"],
      env,
    );
    const exportRecord = JSON.parse(exported.stdout);
    assert.equal(exportRecord.outputPaths.length, 1);
    assert.match(
      await readFile(exportRecord.outputPaths[0], "utf8"),
      /Stub design/u,
    );
    await runHelper(helper, ["stop", projectId], env);
    await assert.rejects(readFile(path.join(project, ".daemon.json")));
    await assert.rejects(readFile(path.join(project, ".supervisor.json")));
  } finally {
    if (env) {
      const projectsDir = path.join(appData, "projects");
      const projects = await readdir(projectsDir, {
        withFileTypes: true,
      }).catch(() => []);
      for (const project of projects.filter((entry) => entry.isDirectory())) {
        try {
          await runHelper(helper, ["stop", project.name], env);
        } catch {}
      }
    }
    await new Promise((resolve) => gateway.close(resolve));
    await rm(temp, { recursive: true, force: true });
  }
});
