import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import {
  codexSubscription,
  claudeSubscription,
  createSubscriptionService,
  findCodex,
  readCodexAccount,
} from "./ai-subscriptions.mjs";

async function withHome(run) {
  const home = await mkdtemp(path.join(os.tmpdir(), "colony-subscriptions-"));
  try {
    await mkdir(path.join(home, ".codex"));
    await mkdir(path.join(home, ".claude"));
    await run(home);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test("Codex production RPC only reads account and limits, forces file credentials and redacts identity", async () => {
  const requests = [];
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => {};
  child.stdin.on("data", (data) => {
    const request = JSON.parse(data);
    requests.push(request);
    if (request.id === undefined) return;
    const result =
      request.id === 0
        ? {}
        : request.id === 1
          ? {
              account: {
                type: "chatgpt",
                email: "private@example.test",
                planType: "pro",
              },
            }
          : {
              rateLimits: {
                primary: {
                  usedPercent: 13,
                  windowDurationMins: 10080,
                  resetsAt: 1800000000,
                },
              },
            };
    queueMicrotask(() =>
      child.stdout.write(`${JSON.stringify({ id: request.id, result })}\n`),
    );
  });
  const result = await readCodexAccount("/trusted/codex", {
    env: {
      PATH: "/usr/bin",
      OPENAI_API_KEY: "private-test-secret",
      CODEX_API_KEY: "private-test-secret",
    },
    spawnProcess: (binary, args, options) => {
      assert.equal(binary, "/trusted/codex");
      assert.deepEqual(args, [
        "-c",
        'cli_auth_credentials_store="file"',
        "app-server",
      ]);
      assert.equal(options.env.OPENAI_API_KEY, undefined);
      assert.equal(options.env.CODEX_API_KEY, undefined);
      return child;
    },
  });
  assert.deepEqual(
    requests.map((request) => request.method),
    ["initialize", "initialized", "account/read", "account/rateLimits/read"],
  );
  assert.deepEqual(requests[2].params, { refreshToken: false });
  const safe = codexSubscription(result);
  assert.equal(safe.plan, "ChatGPT Pro");
  assert.equal(safe.windows[0].remainingPercent, 87);
  assert.equal(JSON.stringify(safe).includes("private@example.test"), false);
});

test("Codex hung server is killed and fails with bounded, safe text", async () => {
  let killed = false;
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => {
    killed = true;
  };
  await assert.rejects(
    readCodexAccount("/trusted/codex", {
      deadlineMs: 10,
      spawnProcess: () => child,
    }),
    /timed out/,
  );
  assert.equal(killed, true);
});

test("Codex overlarge server output is killed", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => {};
  const pending = readCodexAccount("/trusted/codex", {
    spawnProcess: () => child,
  });
  child.stdout.write(Buffer.alloc(513 * 1024));
  await assert.rejects(pending, /too much data/);
});

test("invalid percentages and API connections never become subscription allowances", () => {
  assert.deepEqual(
    codexSubscription({
      account: { type: "chatgpt", planType: "plus" },
      limits: { rateLimits: { primary: { usedPercent: -1 } } },
    }).windows,
    [],
  );
  assert.equal(codexSubscription({ account: { type: "apiKey" } }).plan, null);
  assert.equal(codexSubscription({ account: null }).signedIn, false);
  assert.deepEqual(
    claudeSubscription(
      { subscriptionType: "max", rateLimitTier: "default_claude_max_20x" },
      { five_hour: { utilization: "unknown" } },
    ).windows,
    [],
  );
});

test("automatic scan never invokes protected credential access and cached plan does not claim sign-in", async () =>
  withHome(async (home) => {
    await writeFile(
      path.join(home, ".claude.json"),
      JSON.stringify({
        oauthAccount: {
          organizationType: "claude_max",
          organizationRateLimitTier: "default_claude_max_20x",
          emailAddress: "private@example.test",
        },
      }),
    );
    let accesses = 0;
    const service = createSubscriptionService({
      home,
      env: {},
      find: async () => null,
      requestClaudeCredential: async () => {
        accesses++;
        return null;
      },
    });
    const result = await service.read();
    assert.equal(accesses, 0);
    assert.equal(result[0].plan, "Max 20x");
    assert.equal(result[0].source, "cached");
    assert.equal(result[0].signedIn, null);
    assert.equal(
      JSON.stringify(result).includes("private@example.test"),
      false,
    );
    await service.readClaude();
    assert.equal(accesses, 1);
  }));

test("explicit Claude scan uses Claude endpoint without redirects, returns real usage and never exposes tokens", async () =>
  withHome(async (home) => {
    let accesses = 0;
    const service = createSubscriptionService({
      home,
      env: {},
      find: async () => null,
      requestClaudeCredential: async () => {
        accesses++;
        return {
          claudeAiOauth: {
            accessToken: "private-test-secret",
            subscriptionType: "pro",
            expiresAt: Date.now() + 60000,
          },
        };
      },
      fetchUsage: async (url, options) => {
        assert.equal(url, "https://api.anthropic.com/api/oauth/usage");
        assert.equal(options.redirect, "error");
        assert.equal(
          options.headers.Authorization,
          "Bearer private-test-secret",
        );
        assert.ok(options.signal);
        return new Response(
          JSON.stringify({
            five_hour: { utilization: 28, resets_at: "2026-10-04T12:00:00Z" },
            seven_day: { utilization: 54 },
          }),
        );
      },
    });
    const result = await service.readClaude();
    assert.equal(accesses, 1);
    assert.equal(result.signedIn, true);
    assert.equal(result.plan, "Pro");
    assert.deepEqual(
      result.windows.map((window) => window.remainingPercent),
      [72, 46],
    );
    assert.equal(JSON.stringify(result).includes("private-test-secret"), false);
  }));

test("Claude HTTP errors never echo provider bodies or fabricated allowances", async () =>
  withHome(async (home) => {
    await writeFile(
      path.join(home, ".claude", ".credentials.json"),
      JSON.stringify({ claudeAiOauth: { accessToken: "private-test-secret" } }),
    );
    const result = await createSubscriptionService({
      home,
      env: {},
      find: async () => null,
      fetchUsage: async () =>
        new Response("private-test-secret", { status: 401 }),
    }).read();
    assert.equal(result[0].signedIn, false);
    assert.deepEqual(result[0].windows, []);
    assert.equal(JSON.stringify(result).includes("private-test-secret"), false);
  }));

test("Codex lookup works with empty GUI PATH and a user-local installation", async () =>
  withHome(async (home) => {
    await mkdir(path.join(home, ".local", "bin"), { recursive: true });
    const binary = path.join(home, ".local", "bin", "codex");
    await writeFile(binary, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    assert.equal(
      await findCodex({ home, env: { PATH: "" }, platform: "linux" }),
      binary,
    );
  }));

test("refreshing an explicitly read Claude allowance retains only its redacted snapshot and never rereads keychain", async () =>
  withHome(async (home) => {
    let accesses = 0;
    const service = createSubscriptionService({
      home,
      env: {},
      find: async () => null,
      requestClaudeCredential: async () => {
        accesses++;
        return {
          claudeAiOauth: {
            accessToken: "private-test-secret",
            subscriptionType: "pro",
          },
        };
      },
      fetchUsage: async () =>
        new Response(JSON.stringify({ five_hour: { utilization: 28 } })),
    });
    const explicit = await service.readClaude();
    assert.equal(explicit.source, "live");
    const refreshed = (await service.read())[0];
    assert.equal(accesses, 1);
    assert.equal(refreshed.source, "cached");
    assert.equal(refreshed.signedIn, null);
    assert.equal(refreshed.windows[0].remainingPercent, 72);
    assert.ok(refreshed.observedAt);
    assert.equal(
      JSON.stringify(refreshed).includes("private-test-secret"),
      false,
    );
  }));

test("exhausted or overused allowances show zero remaining rather than disappear", () => {
  const result = claudeSubscription(
    { subscriptionType: "pro" },
    { five_hour: { utilization: 125 } },
  );
  assert.equal(result.windows[0].remainingPercent, 0);
});

test("Codex finds a custom npm prefix with an empty GUI PATH", async () =>
  withHome(async (home) => {
    const prefix = path.join(home, "npm-custom");
    await mkdir(path.join(prefix, "bin"), { recursive: true });
    const binary = path.join(prefix, "bin", "codex");
    await writeFile(binary, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    assert.equal(
      await findCodex({
        home,
        env: { PATH: "", NPM_CONFIG_PREFIX: prefix },
        platform: "linux",
      }),
      binary,
    );
  }));

test("Windows Codex cleanup kills the probe tree and rejects containment failures", async () => {
  const { closeCodexProbe } = await import("./ai-subscriptions.mjs");
  const run = (exitCode) =>
    closeCodexProbe(
      { pid: 123 },
      {
        platform: "win32",
        spawnProcess: (command, args, options) => {
          assert.equal(command, "taskkill");
          assert.deepEqual(args, ["/PID", "123", "/T", "/F"]);
          assert.equal(options.stdio, "ignore");
          const killer = new EventEmitter();
          killer.kill = () => {};
          queueMicrotask(() => killer.emit("exit", exitCode));
          return killer;
        },
      },
    );
  await run(0);
  await assert.rejects(run(1), /closed safely/);
});

test("unrecognized plan metadata is not copied from credential records into the renderer", () => {
  assert.equal(
    codexSubscription({
      account: { type: "chatgpt", planType: "private-test-secret" },
    }).plan,
    null,
  );
  assert.equal(
    claudeSubscription({ subscriptionType: "private-test-secret" }, {}).plan,
    null,
  );
});
