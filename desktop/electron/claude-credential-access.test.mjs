import assert from "node:assert/strict";
import { test } from "node:test";
import { requestClaudeCredential } from "./claude-credential-access.mjs";

test("Claude permission cancellation never runs a keychain process", async () => {
  let commands = 0;
  assert.equal(
    await requestClaudeCredential({
      platform: "darwin",
      confirm: async (options) => {
        assert.equal(options.defaultId, 0);
        assert.equal(options.cancelId, 0);
        assert.match(options.detail, /keychain permission/);
        return { response: 0 };
      },
      run: () => {
        commands++;
      },
    }),
    null,
  );
  assert.equal(commands, 0);
});

test("Claude credential read requires consent and a surviving trusted window, uses bounded capture", async () => {
  let confirmed = false;
  const credential = await requestClaudeCredential({
    platform: "darwin",
    env: { USER: "test" },
    confirm: async () => {
      confirmed = true;
      return { response: 1 };
    },
    run: (command, args, options, done) => {
      assert.equal(confirmed, true);
      assert.equal(command, "/usr/bin/security");
      assert.deepEqual(args, [
        "find-generic-password",
        "-a",
        "test",
        "-w",
        "-s",
        "Claude Code",
      ]);
      assert.equal(options.timeout, 15000);
      assert.equal(options.maxBuffer, 512 * 1024);
      done(
        null,
        JSON.stringify({
          claudeAiOauth: { accessToken: "private-test-secret" },
        }),
      );
    },
  });
  assert.equal(credential.claudeAiOauth.accessToken, "private-test-secret");
  let alive = true;
  assert.equal(
    await requestClaudeCredential({
      platform: "darwin",
      alive: () => alive,
      confirm: async () => {
        alive = false;
        return { response: 1 };
      },
      run: () => assert.fail("Window closed before credential access"),
    }),
    null,
  );
});

test("Claude credential failures never return process output or error details", async () => {
  const result = await requestClaudeCredential({
    platform: "darwin",
    confirm: async () => ({ response: 1 }),
    run: (_command, _args, _options, done) =>
      done(new Error("private-test-secret"), "private-test-secret"),
  });
  assert.equal(result, null);
});
