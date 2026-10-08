import assert from "node:assert/strict";
import { test } from "node:test";
import { dispatchChatGpt, CHATGPT_COMMANDS } from "./ipc.mjs";
import { fixture } from "./test-support.mjs";

test("IPC rejects secondary windows, token methods, malformed args and disabled connect", async (t) => {
  const f = await fixture(t, { env: {} });
  await assert.rejects(
    dispatchChatGpt(f.service, "get_chatgpt_plan", {}, false),
    /main_window_required/,
  );
  await assert.rejects(
    dispatchChatGpt(f.service, "get_access_token"),
    /unsupported_command/,
  );
  await assert.rejects(
    dispatchChatGpt(f.service, "connect_chatgpt_plan"),
    /feature_disabled/,
  );
  assert.equal(
    (await dispatchChatGpt(f.service, "get_chatgpt_plan")).enabled,
    false,
  );
  const service = f.create();
  for (const args of [
    null,
    [],
    { accountId: "../../secret" },
    { token: "fake-secret" },
    { consent: "true" },
    { accountId: "a".repeat(64), registrationId: "b".repeat(64) },
  ])
    await assert.rejects(
      dispatchChatGpt(service, "connect_chatgpt_plan", args),
      /invalid_arguments/,
    );
  await assert.rejects(
    dispatchChatGpt(service, "disconnect_chatgpt_plan"),
    /invalid_arguments/,
  );
  assert.equal(f.fake.requests.length, 0);
});

test("all public IPC outcomes are metadata projections across sign-in, select, refresh and sign-out", async (t) => {
  const f = await fixture(t);
  const result = await dispatchChatGpt(f.service, "connect_chatgpt_plan");
  const id = result.activeAccountId;
  const secrets = Object.values((await f.read()).accounts[0]).filter(
    (value) => typeof value === "string" && value.length > 100,
  );
  assert.equal(result.connecting, false);
  for (const command of CHATGPT_COMMANDS) {
    if (command === "connect_chatgpt_plan") continue;
    const outcome = await dispatchChatGpt(f.service, command, {
      accountId: id,
    });
    for (const secret of secrets)
      assert.equal(JSON.stringify(outcome).includes(secret), false);
  }
});

test("exhausted remote revocation still has an explicit retry affordance", async (t) => {
  const f = await fixture(t);
  const id = await f.connect();
  f.fake.faults.revokeError = true;
  await f.service.disconnect(id);
  for (let i = 0; i < 5; i++) {
    f.advance(600_000);
    await f.service.resume();
  }
  assert.equal(f.fake.counters.revoke, 5);
  delete f.fake.faults.revokeError;
  const status = await dispatchChatGpt(f.service, "disconnect_chatgpt_plan", {
    accountId: id,
  });
  assert.equal(status.accounts[0].remoteRevocationPending, false);
  assert.equal(f.fake.counters.revoke, 6);
});
