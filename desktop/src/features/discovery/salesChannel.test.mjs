import assert from "node:assert/strict";
import test from "node:test";

import { ensureSalesChannel, SalesChannelSetupError } from "./salesChannel.ts";

function channel(id, overrides = {}) {
  return {
    id,
    name: "Sales",
    channelType: "stream",
    visibility: "private",
    description: "",
    topic: null,
    purpose: null,
    memberCount: 1,
    memberPubkeys: [],
    lastMessageAt: null,
    archivedAt: null,
    participants: [],
    participantPubkeys: [],
    isMember: true,
    ttlSeconds: null,
    ttlDeadline: null,
    ...overrides,
  };
}

const isSales = (candidate) =>
  candidate.visibility === "private" &&
  candidate.channelType === "stream" &&
  candidate.isMember &&
  candidate.archivedAt === null &&
  candidate.name.trim().toLowerCase() === "sales";

/**
 * A fake relay and the effects around it. `resolve` and `salesStreams` behave
 * like the production resolver (null on none, throws on two), so the tests
 * exercise the real decision logic against a world they can change.
 */
function world(options = {}) {
  const state = {
    relay: options.relay ?? [],
    allowed: options.allowed ?? true,
    createFails: options.createFails ?? null,
    createLandsThenFails: options.createLandsThenFails ?? false,
    addEmployeesFails: options.addEmployeesFails ?? null,
    archiveFails: options.archiveFails ?? null,
    hiddenFromListAfterCreate: options.hiddenFromListAfterCreate ?? 0,
    created: [],
    archived: [],
    employeeCalls: [],
    pending: new Set(options.pending ?? []),
    listCalls: 0,
    canCreateCalls: 0,
    warnings: [],
  };
  const nextId = options.firstId ?? "m-created";
  let lock = Promise.resolve();
  const deps = {
    listChannels: async () => {
      state.listCalls += 1;
      if (state.hiddenFromListAfterCreate > 0 && state.created.length > 0) {
        state.hiddenFromListAfterCreate -= 1;
        return state.relay.filter(
          (item) => !state.created.some((made) => made.id === item.id),
        );
      }
      return [...state.relay];
    },
    resolve: async (channels) => {
      const found = channels.filter(isSales);
      if (found.length > 1) {
        throw new Error("More than one private Sales stream is available.");
      }
      return found[0]?.id ?? null;
    },
    salesStreams: (channels) => channels.filter(isSales),
    canCreate: async () => {
      state.canCreateCalls += 1;
      return state.allowed;
    },
    create: async () => {
      if (state.createLandsThenFails) {
        const landed = channel(nextId);
        state.relay.push(landed);
        throw new Error("The request timed out.");
      }
      if (state.createFails) throw new Error(state.createFails);
      const made = channel(nextId);
      state.relay.push(made);
      state.created.push(made);
      return made;
    },
    addEmployees: async (channelId) => {
      state.employeeCalls.push(channelId);
      if (state.addEmployeesFails) throw new Error(state.addEmployeesFails);
    },
    archive: async (channelId) => {
      if (state.archiveFails) throw new Error(state.archiveFails);
      state.archived.push(channelId);
      state.relay = state.relay.filter((item) => item.id !== channelId);
    },
    pendingEmployees: {
      has: (id) => state.pending.has(id),
      add: (id) => state.pending.add(id),
      remove: (id) => state.pending.delete(id),
    },
    exclusive: (run) => {
      const turn = lock.then(run, run);
      lock = turn.then(
        () => undefined,
        () => undefined,
      );
      return turn;
    },
    sleep: async () => {},
    warn: (message) => state.warnings.push(message),
  };
  return { state, deps };
}

test("an existing Sales channel is used as is: nothing is created or asked", async () => {
  const { state, deps } = world({ relay: [channel("existing")] });
  const outcome = await ensureSalesChannel(deps, state.relay);
  assert.deepEqual(outcome, {
    status: "ready",
    channelId: "existing",
    created: null,
  });
  assert.equal(state.created.length, 0);
  assert.equal(state.canCreateCalls, 0);
  assert.equal(state.listCalls, 0);
});

test("a missing Sales channel is created for an owner and re-resolved", async () => {
  const { state, deps } = world();
  const outcome = await ensureSalesChannel(deps, []);
  assert.equal(outcome.status, "ready");
  assert.equal(outcome.channelId, "m-created");
  assert.equal(outcome.created?.id, "m-created");
  assert.equal(state.created.length, 1);
  // The AI employees were added and the owed record cleared.
  assert.deepEqual(state.employeeCalls, ["m-created"]);
  assert.equal(state.pending.size, 0);
  // Resolving the relay's list again finds exactly the one channel.
  assert.equal(await deps.resolve(await deps.listChannels()), "m-created");
});

test("a person who may not create channels gets not-allowed and nothing is created", async () => {
  const { state, deps } = world({ allowed: false });
  const outcome = await ensureSalesChannel(deps, []);
  assert.deepEqual(outcome, { status: "not-allowed" });
  assert.equal(state.created.length, 0);
  assert.equal(state.listCalls, 0);
});

test("a channel made by someone else while this call waited is used, not duplicated", async () => {
  // The caller's snapshot (empty) is stale: another window already made it.
  const { state, deps } = world({ relay: [channel("from-other-window")] });
  const outcome = await ensureSalesChannel(deps, []);
  assert.deepEqual(outcome, {
    status: "ready",
    channelId: "from-other-window",
    created: null,
  });
  assert.equal(state.created.length, 0);
});

test("two calls at once make exactly one Sales channel", async () => {
  const { state, deps } = world();
  const [first, second] = await Promise.all([
    ensureSalesChannel(deps, []),
    ensureSalesChannel(deps, []),
  ]);
  assert.equal(state.created.length, 1);
  assert.equal(first.channelId, "m-created");
  assert.equal(second.channelId, "m-created");
  assert.equal(state.relay.filter(isSales).length, 1);
});

test("a failed creation throws the reason, creates nothing, and Retry then succeeds", async () => {
  const { state, deps } = world({ createFails: "Not allowed to create." });
  await assert.rejects(
    () => ensureSalesChannel(deps, []),
    (error) =>
      error instanceof SalesChannelSetupError &&
      error.message ===
        "Could not set up the private Sales channel: Not allowed to create.",
  );
  assert.equal(state.created.length, 0);
  assert.equal(state.pending.size, 0);

  state.createFails = null;
  const retry = await ensureSalesChannel(deps, []);
  assert.equal(retry.status, "ready");
  assert.equal(state.created.length, 1);
});

test("a create that timed out but landed on the relay is found, not repeated", async () => {
  const { state, deps } = world({ createLandsThenFails: true });
  const outcome = await ensureSalesChannel(deps, []);
  assert.equal(outcome.status, "ready");
  assert.equal(outcome.channelId, "m-created");
  assert.equal(state.relay.filter(isSales).length, 1);
  // The channel still gets its employees.
  assert.deepEqual(state.employeeCalls, ["m-created"]);
});

test("a new channel that the relay list shows late is still returned once visible", async () => {
  const { state, deps } = world({ hiddenFromListAfterCreate: 3 });
  const outcome = await ensureSalesChannel(deps, []);
  assert.equal(outcome.channelId, "m-created");
  assert.equal(state.created.length, 1);
});

test("two devices creating at once leave one Sales channel: the higher id archives itself", async () => {
  // This device creates "m-created"; another device's "a-first" is already
  // listed by the time the settle check runs.
  const { state, deps } = world({ firstId: "m-created" });
  const originalCreate = deps.create;
  deps.create = async () => {
    state.relay.push(channel("a-first"));
    return originalCreate();
  };
  const outcome = await ensureSalesChannel(deps, []);
  assert.equal(outcome.channelId, "a-first");
  assert.equal(outcome.created, null);
  assert.deepEqual(state.archived, ["m-created"]);
  assert.equal(state.relay.filter(isSales).length, 1);
  assert.equal(state.pending.has("m-created"), false);
});

test("two devices creating at once: the lower id keeps its channel and does not archive", async () => {
  const { state, deps } = world({ firstId: "a-first" });
  const originalCreate = deps.create;
  deps.create = async () => {
    state.relay.push(channel("z-late"));
    return originalCreate();
  };
  const outcome = await ensureSalesChannel(deps, []);
  assert.equal(outcome.channelId, "a-first");
  assert.equal(outcome.created?.id, "a-first");
  assert.deepEqual(state.archived, []);
});

test("a failed archive of the losing duplicate is reported, not swallowed", async () => {
  const { state, deps } = world({
    firstId: "m-created",
    archiveFails: "Archive refused.",
  });
  const originalCreate = deps.create;
  deps.create = async () => {
    state.relay.push(channel("a-first"));
    return originalCreate();
  };
  await assert.rejects(() => ensureSalesChannel(deps, []), /Archive refused/);
});

test("employees that could not be added do not block the channel and are retried next time", async () => {
  const { state, deps } = world({ addEmployeesFails: "Relay busy." });
  const outcome = await ensureSalesChannel(deps, []);
  assert.equal(outcome.status, "ready");
  // The owed record is durable and a warning was raised, not silence.
  assert.equal(state.pending.has("m-created"), true);
  assert.equal(state.warnings.length, 1);

  // Next open: the channel exists, the owed employees are added, record cleared.
  state.addEmployeesFails = null;
  state.employeeCalls.length = 0;
  const again = await ensureSalesChannel(deps, state.relay);
  assert.equal(again.status, "ready");
  assert.deepEqual(state.employeeCalls, ["m-created"]);
  assert.equal(state.pending.size, 0);
  assert.equal(state.created.length, 1);
});

test("a channel with nothing owed is not touched again", async () => {
  const { state, deps } = world({ relay: [channel("existing")] });
  await ensureSalesChannel(deps, state.relay);
  assert.deepEqual(state.employeeCalls, []);
});
