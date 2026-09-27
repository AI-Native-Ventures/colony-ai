import assert from "node:assert/strict";
import test from "node:test";

import { subscribeToBusinessRecords } from "./businessRecordLive.ts";

const CLIENT_A = "11111111-1111-4111-8111-111111111111";
const CLIENT_B = "22222222-2222-4222-8222-222222222222";
const EVENT = {
  id: "01".repeat(32),
  pubkey: "ab".repeat(32),
  created_at: 1_750_000_000,
  kind: 30634,
  tags: [["h", CLIENT_A]],
  content: "{}",
  sig: "cd".repeat(64),
};

test("late subscription completion is disposed after its scope is retired", async () => {
  let resolveSubscription;
  let unsubscribed = false;
  let delivered = 0;
  let currentScope = "client-a";
  const subscribePromise = subscribeToBusinessRecords({
    relay: {
      subscribeLive: (_filter, onEvent) => {
        resolveSubscription = () => {
          resolveSubscription.onEvent = onEvent;
          return () => {
            unsubscribed = true;
          };
        };
        return new Promise((resolve) => {
          resolveSubscription.resolve = resolve;
        });
      },
    },
    channelIds: [CLIENT_A],
    kinds: [30634],
    isCurrentScope: () => currentScope === "client-a",
    onEvent: () => {
      delivered += 1;
    },
  });

  currentScope = "client-b";
  const unsubscribe = await (async () => {
    resolveSubscription.resolve(resolveSubscription());
    return subscribePromise;
  })();
  unsubscribe();
  resolveSubscription.onEvent(EVENT);

  assert.equal(unsubscribed, true);
  assert.equal(delivered, 0);
});

test("live subscriptions use bounded explicit h and kind filters", async () => {
  const filters = [];
  const onEvents = [];
  const channelIds = [CLIENT_A, CLIENT_B];
  const unsubscribe = await subscribeToBusinessRecords({
    relay: {
      subscribeLive: async (filter, onEvent) => {
        filters.push(filter);
        onEvents.push(onEvent);
        return () => {};
      },
    },
    channelIds,
    kinds: [30634, 30634],
    isCurrentScope: () => true,
    onEvent: () => {},
  });

  assert.equal(filters.length, 1);
  assert.deepEqual(filters[0].kinds, [30634]);
  assert.deepEqual(filters[0]["#h"], channelIds);
  assert.equal(filters[0].limit, 0);
  unsubscribe();
});
