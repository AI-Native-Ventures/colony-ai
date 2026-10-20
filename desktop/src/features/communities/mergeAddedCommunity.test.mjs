/**
 * Unit tests for addCommunity's merge when the relay URL is already saved.
 * A business can be deleted and recreated at the same host, so the server's
 * current business id must replace the one saved on the device.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { mergeAddedCommunity } from "./useCommunities.tsx";

const SAVED = {
  id: "local-1",
  name: "Colony",
  relayUrl: "wss://colony.example.com",
  businessCommunityId: "old-business",
  clientChannelId: "old-client",
  pubkey: "pk-1",
  addedAt: "2026-10-03T06:16:24.896Z",
};

const OTHER = {
  id: "local-2",
  name: "Other",
  relayUrl: "wss://other.example.com",
  addedAt: "2026-10-04T06:42:24.289Z",
};

test("mergeAddedCommunity_new_relay_appends_entry", () => {
  const added = {
    id: "local-3",
    name: "New",
    relayUrl: "wss://new.example.com",
    businessCommunityId: "new-business",
    addedAt: "2026-10-19T19:25:18.886Z",
  };
  assert.deepEqual(mergeAddedCommunity([SAVED, OTHER], added), [
    SAVED,
    OTHER,
    added,
  ]);
});

test("mergeAddedCommunity_saved_relay_takes_the_servers_business_id", () => {
  const [merged, other] = mergeAddedCommunity([SAVED, OTHER], {
    id: "local-new",
    name: "Colony",
    relayUrl: SAVED.relayUrl,
    businessCommunityId: "new-business",
    pubkey: "pk-1",
    addedAt: "2026-10-19T19:25:18.886Z",
  });
  assert.equal(merged.id, "local-1");
  assert.equal(merged.addedAt, SAVED.addedAt);
  assert.equal(merged.businessCommunityId, "new-business");
  // The old client channel belonged to the old business.
  assert.equal(merged.clientChannelId, undefined);
  assert.deepEqual(other, OTHER);
});

test("mergeAddedCommunity_saved_relay_takes_the_new_client_channel", () => {
  const [merged] = mergeAddedCommunity([SAVED], {
    id: "local-new",
    name: "Colony",
    relayUrl: SAVED.relayUrl,
    businessCommunityId: "old-business",
    clientChannelId: "new-client",
    addedAt: "2026-10-19T19:25:18.886Z",
  });
  assert.equal(merged.businessCommunityId, "old-business");
  assert.equal(merged.clientChannelId, "new-client");
});

test("mergeAddedCommunity_saved_relay_without_business_keeps_saved_ids", () => {
  // An invite or a deep link carries no business id.
  const [merged] = mergeAddedCommunity([SAVED], {
    id: "local-new",
    name: "",
    relayUrl: SAVED.relayUrl,
    addedAt: "2026-10-19T19:25:18.886Z",
  });
  assert.equal(merged.name, "Colony");
  assert.equal(merged.businessCommunityId, "old-business");
  assert.equal(merged.clientChannelId, "old-client");
  assert.equal(merged.pubkey, "pk-1");
});
