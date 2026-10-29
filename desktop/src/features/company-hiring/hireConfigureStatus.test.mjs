import assert from "node:assert/strict";
import { test } from "node:test";

import { hireConfigureStatus } from "./hireConfigureStatus.ts";

const settled = { isPending: false, isError: false };
const pending = { isPending: true, isError: false };
const failed = { isPending: false, isError: true };

function input(overrides = {}) {
  return {
    personas: settled,
    runtimes: settled,
    channels: settled,
    team: settled,
    identity: settled,
    membership: settled,
    head: settled,
    hasRolePack: true,
    hasForm: true,
    ...overrides,
  };
}

test("everything settled with a form is ready", () => {
  assert.equal(hireConfigureStatus(input()), "ready");
});

for (const name of ["runtimes", "channels", "team", "identity", "membership"]) {
  test(`a pending ${name} query is loading, never blank`, () => {
    assert.equal(hireConfigureStatus(input({ [name]: pending })), "loading");
  });
  test(`a failed ${name} query is an error`, () => {
    assert.equal(hireConfigureStatus(input({ [name]: failed })), "error");
  });
}

test("a failed saved-hire read is an error", () => {
  assert.equal(hireConfigureStatus(input({ head: failed })), "error");
});

test("settled queries and no form yet keep loading", () => {
  assert.equal(hireConfigureStatus(input({ hasForm: false })), "loading");
});

test("a persona list that does not hold the role says so without waiting on the relay", () => {
  assert.equal(
    hireConfigureStatus(
      input({ hasRolePack: false, hasForm: false, team: pending }),
    ),
    "role-missing",
  );
});

test("an unanswered persona list is loading, not missing", () => {
  assert.equal(
    hireConfigureStatus(
      input({ hasRolePack: false, hasForm: false, personas: pending }),
    ),
    "loading",
  );
});

test("an error wins over a missing role", () => {
  assert.equal(
    hireConfigureStatus(
      input({ hasRolePack: false, hasForm: false, membership: failed }),
    ),
    "error",
  );
});
