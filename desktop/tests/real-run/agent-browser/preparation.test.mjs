import assert from "node:assert/strict";
import test from "node:test";
import { ROWS, preparedRows, judgeRow } from "./rows.mjs";
import { loopbackOrigin, prepareEnvironment } from "./environment.mjs";
import { createFakeModelResponder } from "./fake-model.mjs";

const base = {
  packaged: true,
  artifactSha256: "a".repeat(64),
  freshHome: true,
  isolatedProfile: true,
  keychainDenied: true,
  fakeProviderOnly: true,
  managedAcpSession: true,
  scopedMcpLaunchedByHarness: true,
  flagOn: true,
  realControlUi: true,
  actionLogRedacted: true,
  fixtureGranted: true,
};

test("every requested row starts unobserved and absence of a real managed session blocks approval", () => {
  assert.deepEqual(
    ROWS.map((row) => row.id),
    ["approve", "deny", "takeover", "stop", "upload", "private-url-refusal"],
  );
  assert.ok(preparedRows().every((row) => row.status === "NOT OBSERVED"));
  const complete = {
    ...base,
    confirmationVisible: true,
    personConfirmed: true,
    toolSucceeded: true,
    beforeSubmissions: 0,
    afterSubmissions: 1,
  };
  assert.equal(judgeRow("approve", complete).status, "PASS");
  for (const key of Object.keys(base))
    assert.equal(
      judgeRow("approve", { ...complete, [key]: false }).status,
      "BLOCKED",
      key,
    );
  assert.equal(
    judgeRow("approve", { ...complete, beforeSubmissions: 1 }).status,
    "FAIL",
  );
});

test("deny and ended control require zero effects, not absent counters", () => {
  const denied = {
    ...base,
    personRejected: true,
    toolRefused: true,
    afterSubmissions: 0,
  };
  assert.equal(judgeRow("deny", denied).status, "PASS");
  assert.equal(
    judgeRow("deny", { ...denied, afterSubmissions: undefined }).status,
    "FAIL",
  );
  for (const id of ["takeover", "stop"]) {
    const ended = {
      ...base,
      personControl: true,
      grantTerminated: true,
      staleActionRefused: true,
      afterSubmissions: 0,
      activeActions: 0,
    };
    assert.equal(judgeRow(id, ended).status, "PASS");
    for (const key of [
      "personControl",
      "grantTerminated",
      "staleActionRefused",
    ])
      assert.equal(judgeRow(id, { ...ended, [key]: false }).status, "FAIL");
    assert.equal(judgeRow(id, { ...ended, activeActions: 1 }).status, "FAIL");
  }
});

test("upload adoption blocks the candidate and wrong bytes or retained journals fail", () => {
  assert.equal(judgeRow("upload", base).status, "BLOCKED");
  const uploaded = {
    ...base,
    immutableUploadSliceInArtifact: true,
    nativePickerUsed: true,
    uploadRejectedWithoutEffect: true,
    personConfirmed: true,
    originalReplacedBeforeSubmit: true,
    approvedDigest: "b".repeat(64),
    receivedDigest: "b".repeat(64),
    privatePayloads: 0,
    ownershipRecords: 0,
  };
  assert.equal(judgeRow("upload", uploaded).status, "PASS");
  assert.equal(
    judgeRow("upload", { ...uploaded, receivedDigest: "c".repeat(64) }).status,
    "FAIL",
  );
  assert.equal(
    judgeRow("upload", { ...uploaded, ownershipRecords: 1 }).status,
    "FAIL",
  );
});

test("private refusal must observe all guards and zero forbidden requests", () => {
  const refused = {
    ...base,
    privateAddressRefused: true,
    redirectRefused: true,
    fileSchemeRefused: true,
    scopeUnchanged: true,
    forbiddenRequests: 0,
  };
  assert.equal(judgeRow("private-url-refusal", refused).status, "PASS");
  for (const key of [
    "privateAddressRefused",
    "redirectRefused",
    "fileSchemeRefused",
    "scopeUnchanged",
  ])
    assert.equal(
      judgeRow("private-url-refusal", { ...refused, [key]: false }).status,
      "FAIL",
    );
  assert.equal(
    judgeRow("private-url-refusal", { ...refused, forbiddenRequests: 1 })
      .status,
    "FAIL",
  );
});

test("launch preparation drops inherited credentials and enables only a fresh HOME and local FAKE agent", () => {
  const options = {
    home: "/private/tmp/colony-prepared-home",
    realHome: "/Users/fixture-owner",
    userDataDir: "/private/tmp/colony-prepared-home/profile",
    fixtureOrigin: "http://127.0.0.1:4401",
    providerOrigin: "http://127.0.0.1:4402",
    relayOrigin: "ws://127.0.0.1:4403",
  };
  const prepared = prepareEnvironment(
    {
      HOME: options.realHome,
      OPENAI_API_KEY: "owner-secret",
      COLONY_BROWSER_BROKER_MASTER: "owner-secret",
      PATH: "/usr/bin",
    },
    options,
  );
  assert.equal(prepared.status, "PREPARED_NOT_RUN");
  assert.equal(prepared.environment.HOME, options.home);
  assert.equal(prepared.environment.COLONY_BROWSER_AGENT, "1");
  assert.equal(prepared.environment.OPENAI_API_KEY, undefined);
  assert.equal(prepared.environment.COLONY_BROWSER_BROKER_MASTER, undefined);
  assert.equal(
    prepared.agentEnvironment.OPENAI_COMPAT_MODEL,
    "colony-browser-fake",
  );
  for (const url of [
    "https://example.com",
    "http://localhost:4402",
    "http://127.0.0.1",
    "http://127.0.0.1:4402/private",
    "http://user@127.0.0.1:4402",
  ])
    assert.throws(() => loopbackOrigin(url));
  assert.throws(() =>
    prepareEnvironment({}, { ...options, home: options.realHome }),
  );
  assert.throws(() =>
    prepareEnvironment(
      {},
      { ...options, userDataDir: `${options.home}/../../owner-profile` },
    ),
  );
});

test("FAKE responder uses advertised real-session tools and refuses other models or oversized frames", () => {
  const body = {
    model: "colony-browser-fake",
    messages: [],
    tools: [{ function: { name: "colony-browser__browser_connect" } }],
  };
  const respond = createFakeModelResponder([
    { tool: "colony-browser__browser_connect", args: {} },
    {},
  ]);
  const call = respond(body);
  assert.equal(
    call.choices[0].message.tool_calls[0].function.name,
    "colony-browser__browser_connect",
  );
  assert.equal(respond(body).choices[0].finish_reason, "stop");
  assert.throws(() => respond(body));
  assert.throws(() =>
    createFakeModelResponder([{}])({ ...body, model: "real-model" }),
  );
  assert.throws(() => createFakeModelResponder([{ tool: "missing" }])(body));
  assert.throws(() =>
    createFakeModelResponder([{}])({ ...body, messages: ["x".repeat(70_000)] }),
  );
});

test("fixture preparation allocates no listener and contains no observed side effects", async () => {
  const { createAgentBrowserFixtures } = await import("./fixtures.mjs");
  const fixtures = createAgentBrowserFixtures({
    modelPlan: [{}],
    nonce: "prepared-only",
  });
  assert.equal(fixtures.listening(), false);
  assert.deepEqual(fixtures.counters(), {
    submissions: 0,
    forbiddenRequests: 0,
    uploads: 0,
    modelRequests: 0,
    receivedDigest: undefined,
  });
  await fixtures.close();
});

test("FAKE fault replay only attempts a previously advertised browser read, never invents authority or other tools", () => {
  const name = "colony-browser__browser_snapshot";
  const body = {
    model: "colony-browser-fake",
    messages: [],
    tools: [{ function: { name } }],
  };
  const responder = createFakeModelResponder([
    { tool: name, args: { tab: "actual-tab" } },
    { tool: name, args: { tab: "actual-tab" }, allowStaleTool: true },
  ]);
  responder(body);
  assert.equal(
    responder({ ...body, tools: [] }).choices[0].message.tool_calls[0].function
      .name,
    name,
  );
  assert.throws(() =>
    createFakeModelResponder([{ tool: name, allowStaleTool: true }])({
      ...body,
      tools: [],
    }),
  );
  const shell = createFakeModelResponder([
    { tool: "shell" },
    { tool: "shell", allowStaleTool: true },
  ]);
  shell({ ...body, tools: [{ function: { name: "shell" } }] });
  assert.throws(() => shell({ ...body, tools: [] }));
  const normal = createFakeModelResponder([{ tool: name }, { tool: name }]);
  normal(body);
  assert.throws(() => normal({ ...body, tools: [] }));
});
