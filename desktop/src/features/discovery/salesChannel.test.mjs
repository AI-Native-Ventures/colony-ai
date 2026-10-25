import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureSalesChannel,
  pickSalesStream,
  SalesChannelSetupError,
} from "./salesChannel.ts";

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
 * like the production resolver (the lowest id when two are visible, null on
 * none), so the tests exercise the real decision logic against a world they
 * can change. Private channels are listed only for their members, as the real
 * relay does; a viewer of `null` sees everything the test put on the relay.
 */
function world(options = {}) {
  const state = {
    relay: options.relay ?? [],
    members: new Map(),
    leaders: options.leaders ?? ["admin-1", "owner-1"],
    employees: options.employees ?? ["bot-1"],
    allowed: options.allowed ?? true,
    createFails: options.createFails ?? null,
    createLandsThenFails: options.createLandsThenFails ?? false,
    addMembersFails: options.addMembersFails ?? null,
    archiveFails: options.archiveFails ?? null,
    hiddenFromListAfterCreate: options.hiddenFromListAfterCreate ?? 0,
    created: [],
    archived: [],
    addCalls: [],
    pending: new Set(options.pending ?? []),
    listCalls: 0,
    canCreateCalls: 0,
    warnings: [],
  };
  const nextId = options.firstId ?? "m-created";

  function depsFor(viewer) {
    let lock = Promise.resolve();
    const visible = (list) =>
      list.filter((item) => {
        const members = state.members.get(item.id);
        return viewer === null || !members || members.has(viewer);
      });
    return {
      listChannels: async () => {
        state.listCalls += 1;
        if (state.hiddenFromListAfterCreate > 0 && state.created.length > 0) {
          state.hiddenFromListAfterCreate -= 1;
          return visible(
            state.relay.filter(
              (item) => !state.created.some((made) => made.id === item.id),
            ),
          );
        }
        return visible([...state.relay]);
      },
      resolve: async (channels) =>
        pickSalesStream(channels.filter(isSales))?.id ?? null,
      salesStreams: (channels) => channels.filter(isSales),
      canCreate: async () => {
        state.canCreateCalls += 1;
        return state.allowed;
      },
      create: async () => {
        const made = channel(nextId);
        state.members.set(made.id, new Map([[viewer ?? "creator", "owner"]]));
        if (state.createLandsThenFails) {
          state.relay.push(made);
          throw new Error("The request timed out.");
        }
        if (state.createFails) {
          state.members.delete(made.id);
          throw new Error(state.createFails);
        }
        state.relay.push(made);
        state.created.push(made);
        return made;
      },
      listPeople: async () => ({
        leaders: state.leaders.filter((pubkey) => pubkey !== viewer),
        employees: state.employees.filter((pubkey) => pubkey !== viewer),
      }),
      addMembers: async (channelId, role, pubkeys) => {
        state.addCalls.push({ channelId, role, pubkeys });
        if (state.addMembersFails?.role === role) {
          throw new Error(state.addMembersFails.message);
        }
        const members = state.members.get(channelId) ?? new Map();
        for (const pubkey of pubkeys) members.set(pubkey, role);
        state.members.set(channelId, members);
      },
      archive: async (channelId) => {
        if (state.archiveFails) throw new Error(state.archiveFails);
        state.archived.push(channelId);
        state.relay = state.relay.filter((item) => item.id !== channelId);
      },
      pendingMembers: {
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
  }

  return {
    state,
    deps: depsFor(options.viewer ?? null),
    /** The same relay, seen by another person on another device. */
    as: depsFor,
  };
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
  // Owners and admins first, then the AI employees; the owed record is cleared.
  assert.deepEqual(state.addCalls, [
    { channelId: "m-created", role: "admin", pubkeys: ["admin-1", "owner-1"] },
    { channelId: "m-created", role: "bot", pubkeys: ["bot-1"] },
  ]);
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
  // The channel still gets its members.
  assert.deepEqual(
    state.addCalls.map((call) => call.role),
    ["admin", "bot"],
  );
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

test("members that could not be added do not block the channel and are retried next time", async () => {
  const { state, deps } = world({
    addMembersFails: { role: "bot", message: "Relay busy." },
  });
  const outcome = await ensureSalesChannel(deps, []);
  assert.equal(outcome.status, "ready");
  // Owners and admins were already in; the owed record is durable and a
  // warning was raised, not silence.
  assert.equal(state.members.get("m-created").get("admin-1"), "admin");
  assert.equal(state.pending.has("m-created"), true);
  assert.equal(state.warnings.length, 1);

  // Next open: the channel exists, the owed members are added, record cleared.
  state.addMembersFails = null;
  state.addCalls.length = 0;
  const again = await ensureSalesChannel(deps, state.relay);
  assert.equal(again.status, "ready");
  assert.equal(state.members.get("m-created").get("bot-1"), "bot");
  assert.equal(state.pending.size, 0);
  assert.equal(state.created.length, 1);
});

test("an admin who was not in the channel when it was made sees it afterwards: no second Sales", async () => {
  const { state, deps, as } = world({
    viewer: "owner-1",
    leaders: ["admin-1"],
  });
  const made = await ensureSalesChannel(deps, []);
  assert.equal(made.channelId, "m-created");
  assert.equal(state.members.get("m-created").get("admin-1"), "admin");

  // The admin opens Leads with an empty snapshot: the private channel is
  // listed for them now, so it is used and nothing is created.
  const adminDeps = as("admin-1");
  const opened = await ensureSalesChannel(adminDeps, []);
  assert.deepEqual(opened, {
    status: "ready",
    channelId: "m-created",
    created: null,
  });
  assert.equal(state.created.length, 1);
  assert.equal(state.relay.filter(isSales).length, 1);
});

test("an admin who creates it adds the owner as an admin of the channel, not themselves", async () => {
  const { state, deps } = world({
    viewer: "admin-1",
    leaders: ["admin-1", "owner-1"],
    employees: ["bot-1", "admin-1"],
  });
  await ensureSalesChannel(deps, []);
  assert.deepEqual(state.addCalls[0], {
    channelId: "m-created",
    role: "admin",
    pubkeys: ["owner-1"],
  });
  assert.equal(state.members.get("m-created").get("owner-1"), "admin");
  assert.equal(state.members.get("m-created").get("admin-1"), "owner");
  assert.equal(state.members.get("m-created").get("bot-1"), "bot");
});

test("someone who is both an owner or admin and an AI employee is added once, as a leader", async () => {
  const { state, deps } = world({
    leaders: ["owner-1"],
    employees: ["owner-1", "bot-1"],
  });
  await ensureSalesChannel(deps, []);
  assert.deepEqual(state.addCalls, [
    { channelId: "m-created", role: "admin", pubkeys: ["owner-1"] },
    { channelId: "m-created", role: "bot", pubkeys: ["bot-1"] },
  ]);
});

test("two Sales streams visible: the lowest id is used and nothing throws or is created", async () => {
  const { state, deps } = world({
    relay: [channel("z-late"), channel("a-first")],
  });
  const outcome = await ensureSalesChannel(deps, state.relay);
  assert.deepEqual(outcome, {
    status: "ready",
    channelId: "a-first",
    created: null,
  });
  assert.equal(state.created.length, 0);
  assert.equal(state.canCreateCalls, 0);
});

test("pickSalesStream is the lowest id, the same on every device, and null when none", () => {
  assert.equal(pickSalesStream([]), null);
  assert.equal(
    pickSalesStream([channel("m"), channel("b"), channel("x")])?.id,
    "b",
  );
  assert.equal(
    pickSalesStream([channel("x"), channel("b"), channel("m")])?.id,
    "b",
  );
});

test("a channel with nothing owed is not touched again", async () => {
  const { state, deps } = world({ relay: [channel("existing")] });
  await ensureSalesChannel(deps, state.relay);
  assert.deepEqual(state.addCalls, []);
});
