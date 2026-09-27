import assert from "node:assert/strict";
import test from "node:test";

import {
  BUSINESS_RECORD_SCHEMA_VERSION,
  BusinessRecordParseError,
  buildClientActionTemplate,
  buildWorkItemActionTemplate,
  canonicalJson,
  clientDTag,
  computeDeliverableDigests,
  createBusinessRecordService,
  parseClientHead,
  parseWorkItemHead,
  workItemDTag,
} from "./businessRecords.ts";
import {
  KIND_CLIENT_ACTION,
  KIND_CLIENT_HEAD,
  KIND_DELIVERABLE_APPROVAL,
  KIND_DELIVERABLE_VERSION,
  KIND_WORK_ITEM_ACTION,
  KIND_WORK_ITEM_HEAD,
} from "@/shared/constants/kinds";

const CLIENT_ID = "abcdefab-cdef-4abc-8def-abcdefabcdef";
const PARTY_ID = "22222222-2222-4222-8222-222222222222";
const WORK_ID = "33333333-3333-4333-8333-333333333333";
const PUBKEY = "ab".repeat(32);
const EVENT_ID = "01".repeat(32);
const HEAD_ID = "02".repeat(32);

function makeEvent(kind, content, tags, id = EVENT_ID) {
  return {
    id,
    pubkey: PUBKEY,
    created_at: 1_750_000_000,
    kind,
    tags,
    content: JSON.stringify(content),
    sig: "cd".repeat(64),
  };
}

function clientHeadEvent(overrides = {}) {
  return makeEvent(
    KIND_CLIENT_HEAD,
    {
      schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
      clientId: CLIENT_ID,
      partyId: PARTY_ID,
      displayName: "The Olive House",
      approverPubkeys: [PUBKEY],
      status: "active",
      sourceActionEventId: HEAD_ID,
      ...overrides,
    },
    [
      ["h", CLIENT_ID],
      ["d", clientDTag(CLIENT_ID)],
    ],
  );
}

function workItemHeadEvent({
  clientId = CLIENT_ID,
  workItemId = WORK_ID,
  tags,
  content = {},
} = {}) {
  return makeEvent(
    KIND_WORK_ITEM_HEAD,
    {
      schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
      clientId,
      workItemId,
      title: "April campaign",
      status: "active",
      assignedPubkeys: [PUBKEY],
      approverPubkeys: [PUBKEY],
      deliverables: [],
      sourceEventId: HEAD_ID,
      ...content,
    },
    tags ?? [
      ["h", clientId],
      ["d", workItemDTag(clientId, workItemId)],
    ],
  );
}

test("client heads bind their exact client channel and d tag", () => {
  const parsed = parseClientHead(clientHeadEvent());
  assert.equal(parsed.value.clientId, CLIENT_ID);
  assert.equal(parsed.value.displayName, "The Olive House");

  const wrongChannel = clientHeadEvent();
  wrongChannel.tags[0][1] = "44444444-4444-4444-8444-444444444444";
  assert.throws(() => parseClientHead(wrongChannel), BusinessRecordParseError);

  const duplicateDTag = clientHeadEvent();
  duplicateDTag.tags.push(["d", clientDTag(CLIENT_ID)]);
  assert.throws(() => parseClientHead(duplicateDTag), /exactly one d tag/);
});

test("work heads reject a route client that differs from the h tag", () => {
  const valid = parseWorkItemHead(workItemHeadEvent());
  assert.equal(valid.value.workItemId, WORK_ID);
  assert.equal(valid.value.clientId, CLIENT_ID);

  const wrongClient = workItemHeadEvent({
    tags: [
      ["h", "44444444-4444-4444-8444-444444444444"],
      ["d", workItemDTag(CLIENT_ID, WORK_ID)],
    ],
  });
  assert.throws(
    () => parseWorkItemHead(wrongClient),
    /outside its client channel/,
  );
});

test("canonical deliverable digests match the Rust JSON serialization inputs", () => {
  const body = {
    nested: { z: 1, a: 2 },
    title: "Brief",
  };
  assert.equal(canonicalJson(body), '{"nested":{"a":2,"z":1},"title":"Brief"}');
  assert.deepEqual(computeDeliverableDigests(body, []), {
    contentDigest:
      "23016925470c7fa87075af1f770e11ced7ee4d74b3bd2056b4bd8cc3a7847999",
    mediaDigest:
      "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    sortedMediaDigests: [],
    versionDigest:
      "b7c75ecce195a10d96fa44b82331b5a88836668524b3a9461c2e5edea39ca8d5",
  });
  assert.throws(() => canonicalJson({ amount: 1.25 }), /safe integer/);
});

test("action templates carry explicit scope and expected-head preconditions", () => {
  const clientTemplate = buildClientActionTemplate({
    schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
    clientId: CLIENT_ID,
    action: "update",
    expectedHeadEventId: HEAD_ID,
    head: {
      schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
      clientId: CLIENT_ID,
      partyId: PARTY_ID,
      displayName: "The Olive House",
      approverPubkeys: [PUBKEY],
      status: "active",
    },
  });
  assert.equal(clientTemplate.kind, KIND_CLIENT_ACTION);
  assert.deepEqual(clientTemplate.tags, [
    ["h", CLIENT_ID],
    ["d", clientDTag(CLIENT_ID)],
  ]);

  const workTemplate = buildWorkItemActionTemplate({
    schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
    clientId: CLIENT_ID,
    workItemId: WORK_ID,
    action: "create",
    expectedHeadEventId: null,
    head: {
      schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
      clientId: CLIENT_ID,
      workItemId: WORK_ID,
      title: "April campaign",
      status: "open",
      assignedPubkeys: [PUBKEY],
      approverPubkeys: [PUBKEY],
      deliverables: [],
    },
  });
  assert.equal(workTemplate.kind, KIND_WORK_ITEM_ACTION);
  assert.deepEqual(workTemplate.tags, [
    ["h", CLIENT_ID],
    ["d", workItemDTag(CLIENT_ID, WORK_ID)],
  ]);
  assert.throws(
    () =>
      buildWorkItemActionTemplate({
        schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
        clientId: CLIENT_ID,
        workItemId: WORK_ID,
        action: "create",
        expectedHeadEventId: HEAD_ID,
        head: {
          schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
          clientId: CLIENT_ID,
          workItemId: WORK_ID,
          title: "April campaign",
          status: "open",
          assignedPubkeys: [],
          approverPubkeys: [],
          deliverables: [],
        },
      }),
    /must not have an expected head id/,
  );
});

test("directory reads split explicit h scopes at the relay cap", async () => {
  const calls = [];
  const relay = {
    fetchEvents: async (filter) => {
      calls.push(filter);
      return filter["#h"].includes(CLIENT_ID) ? [clientHeadEvent()] : [];
    },
    publishEvent: async () => {},
    subscribeLive: async () => async () => {},
  };
  const service = createBusinessRecordService(relay, async () => {
    throw new Error("signer should not run during a read");
  });
  const ids = [CLIENT_ID];
  for (let index = 1; index < 130; index += 1) {
    ids.push(`aaaaaaaa-aaaa-4aaa-8aaa-${index.toString(16).padStart(12, "0")}`);
  }
  ids[0] = CLIENT_ID.toUpperCase();
  const result = await service.listClientHeads(ids);

  assert.equal(result.length, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((filter) => filter.kinds),
    [[KIND_CLIENT_HEAD], [KIND_CLIENT_HEAD]],
  );
  assert.deepEqual(
    calls.map((filter) => filter["#h"].length),
    [128, 2],
  );
  assert.ok(calls.every((filter) => filter.limit === filter["#h"].length));
});

test("business submission confirms an uncertain acknowledgement by exact event id", async () => {
  let confirmedFilter = null;
  let signedTemplate = null;
  let signedEvent = null;
  const relay = {
    fetchEvents: async (filter) => {
      confirmedFilter = filter;
      return [signedEvent];
    },
    publishEvent: async () => {
      throw new Error("relay acknowledgement timed out");
    },
    subscribeLive: async () => async () => {},
  };
  const service = createBusinessRecordService(relay, async (template) => {
    signedTemplate = template;
    signedEvent = makeEvent(
      template.kind,
      JSON.parse(template.content),
      template.tags,
      "03".repeat(32),
    );
    return signedEvent;
  });
  const template = buildClientActionTemplate({
    schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
    clientId: CLIENT_ID,
    action: "update",
    expectedHeadEventId: HEAD_ID,
    head: {
      schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
      clientId: CLIENT_ID,
      partyId: PARTY_ID,
      displayName: "The Olive House",
      approverPubkeys: [PUBKEY],
      status: "active",
    },
  });
  const result = await service.submit(template);

  assert.equal(signedTemplate.kind, KIND_CLIENT_ACTION);
  assert.equal(result.event.id, signedEvent.id);
  assert.equal(result.accepted.id, signedEvent.id);
  assert.deepEqual(confirmedFilter.ids, [signedEvent.id]);
  assert.deepEqual(confirmedFilter.kinds, [KIND_CLIENT_ACTION]);
  assert.deepEqual(confirmedFilter["#h"], [CLIENT_ID]);
});

test("a rejected stale-head action propagates without changing its expected id", async () => {
  let signedEvent = null;
  let lookupFilter = null;
  const relay = {
    fetchEvents: async (filter) => {
      lookupFilter = filter;
      return [];
    },
    publishEvent: async (event) => {
      signedEvent = event;
      throw new Error(
        "target business record changed before the command committed",
      );
    },
    subscribeLive: async () => async () => {},
  };
  const service = createBusinessRecordService(relay, async (template) =>
    makeEvent(
      template.kind,
      JSON.parse(template.content),
      template.tags,
      "04".repeat(32),
    ),
  );
  const template = buildWorkItemActionTemplate({
    schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
    clientId: CLIENT_ID,
    workItemId: WORK_ID,
    action: "update",
    expectedHeadEventId: HEAD_ID,
    head: {
      schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
      clientId: CLIENT_ID,
      workItemId: WORK_ID,
      title: "April campaign",
      status: "blocked",
      assignedPubkeys: [PUBKEY],
      approverPubkeys: [PUBKEY],
      deliverables: [],
    },
  });

  await assert.rejects(
    service.submit(template),
    /target business record changed before the command committed/,
  );
  assert.equal(JSON.parse(signedEvent.content).expectedHeadEventId, HEAD_ID);
  assert.deepEqual(lookupFilter.ids, [signedEvent.id]);
  assert.deepEqual(lookupFilter.kinds, [KIND_WORK_ITEM_ACTION]);
});

test("a command with a mismatched d coordinate is rejected before signing", async () => {
  let signCalled = false;
  const service = createBusinessRecordService(
    {
      fetchEvents: async () => [],
      publishEvent: async () => {},
      subscribeLive: async () => async () => {},
    },
    async () => {
      signCalled = true;
      throw new Error("signer should not run for an invalid command");
    },
  );
  const template = buildWorkItemActionTemplate({
    schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
    clientId: CLIENT_ID,
    workItemId: WORK_ID,
    action: "create",
    expectedHeadEventId: null,
    head: {
      schemaVersion: BUSINESS_RECORD_SCHEMA_VERSION,
      clientId: CLIENT_ID,
      workItemId: WORK_ID,
      title: "April campaign",
      status: "open",
      assignedPubkeys: [],
      approverPubkeys: [],
      deliverables: [],
    },
  });
  template.tags[1][1] = workItemDTag(
    CLIENT_ID,
    "44444444-4444-4444-8444-444444444444",
  );

  await assert.rejects(service.submit(template), /d tag does not match/);
  assert.equal(signCalled, false);
});

test("client live updates use a bounded explicit channel and kind filter", async () => {
  let filter = null;
  const relay = {
    fetchEvents: async () => [],
    publishEvent: async () => {},
    subscribeLive: async (nextFilter) => {
      filter = nextFilter;
      return async () => {};
    },
  };
  const service = createBusinessRecordService(relay, async () => {
    throw new Error("signer should not run during a subscription");
  });
  await service.subscribeToClient(CLIENT_ID, () => {});

  assert.equal(filter["#h"][0], CLIENT_ID);
  assert.equal(filter.limit, 1000);
  assert.ok(filter.since > 0);
  assert.deepEqual(filter.kinds, [
    KIND_CLIENT_HEAD,
    KIND_WORK_ITEM_HEAD,
    KIND_DELIVERABLE_VERSION,
    KIND_DELIVERABLE_APPROVAL,
  ]);
});
