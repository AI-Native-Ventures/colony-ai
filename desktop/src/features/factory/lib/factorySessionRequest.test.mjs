import assert from "node:assert/strict";
import test from "node:test";

import {
  requestFactorySessionStart,
  resetFactorySessionRequests,
  subscribeFactorySessionStart,
} from "./factorySessionRequest.ts";

const scope = {
  relayUrl: "ws://relay.test",
  identityPubkey: "a".repeat(64),
  businessCommunityId: "business-a",
  clientChannelId: null,
};

test("community reset discards pending Factory start requests", () => {
  resetFactorySessionRequests();
  requestFactorySessionStart(scope);
  resetFactorySessionRequests();

  let starts = 0;
  const unsubscribe = subscribeFactorySessionStart(scope, () => {
    starts += 1;
  });

  assert.equal(starts, 0);
  requestFactorySessionStart(scope);
  assert.equal(starts, 1);
  unsubscribe();
  resetFactorySessionRequests();
});
