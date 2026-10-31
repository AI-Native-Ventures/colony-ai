import assert from "node:assert/strict";
import test from "node:test";
import { generateSecretKey } from "nostr-tools/pure";

import {
  KIND_CUSTOMER_ACTION,
  KIND_CUSTOMER_HEAD,
} from "@/shared/constants/kinds";
import { applyMockCustomerAction } from "../../testing/mockCustomerRecords.ts";
import {
  buildCustomerActionEvent,
  customerActions,
} from "./customerActions.ts";
import {
  TIMELINE_KINDS,
  buildCustomerRecords,
  customerDTag,
  customerRefreshIsFresh,
  latestMilestone,
  parseCustomerDTag,
  parseCustomerHead,
  projectStepLabel,
} from "./customerRecords.ts";
import {
  AYA,
  COMPUTED_AT,
  OWNER,
  PLANE_TREE_PARTY_ID,
  RELAY_PUBKEY,
  cedarCafeContent,
  planeTreeContent,
  signCustomer,
} from "./customerFixtures.mjs";

const PLANE_TREE_ORDER = [
  "found",
  "opener_approved",
  "opener_sent",
  "replied",
  "call_booked",
  "email",
  "email",
  "quote_drafted",
  "milestone",
  "file",
  "quote_accepted",
  "converted",
  "agreement_signed",
  "file",
  "invoice_issued",
  "payment_received",
  "project_started",
  "file",
];

function parse(content, overrides) {
  return parseCustomerHead(signCustomer(content, overrides), RELAY_PUBKEY);
}

test("the kinds match the relay's registry", () => {
  assert.equal(KIND_CUSTOMER_HEAD, 30679);
  assert.equal(KIND_CUSTOMER_ACTION, 47069);
});

test("the Plane Tree fixture parses and its timeline is in the relay's exact order", () => {
  const record = parse(planeTreeContent());
  assert.ok(record);
  assert.equal(record.displayName, "Plane Tree Guesthouse");
  assert.equal(record.stage, "client");
  assert.deepEqual(
    record.timeline.map((entry) => entry.kind),
    PLANE_TREE_ORDER,
  );
  // Oldest first, ties broken by the fixed order of kinds.
  for (let index = 1; index < record.timeline.length; index += 1) {
    const before = record.timeline[index - 1];
    const after = record.timeline[index];
    assert.ok(
      before.at < after.at ||
        (before.at === after.at &&
          TIMELINE_KINDS.indexOf(before.kind) <
            TIMELINE_KINDS.indexOf(after.kind)),
      `${before.entryId} should come before ${after.entryId}`,
    );
  }
  assert.equal(record.timeline[0].title, "Found in Discovery");
  assert.equal(record.timeline[0].detail, "guesthouses in Parkhurst");
  assert.equal(record.timeline.at(-1).title, "Brief and assets");
  assert.equal(record.eventId.length, 64);
});

test("the Money panel keeps exact minor units and null stays null", () => {
  const record = parse(planeTreeContent());
  assert.deepEqual(record.money, {
    currency: "ZAR",
    quoteTotalMinor: 1_800_000,
    depositPaidMinor: 900_000,
    depositPaidAt: 1_793_000_000 + 8 * 86_400 - 3_600,
    balanceDueMinor: 900_000,
    otherCurrencyFacts: 0,
  });
  const lead = parse(cedarCafeContent());
  assert.ok(lead);
  assert.equal(lead.stage, "lead");
  assert.equal(lead.money.currency, null);
  assert.equal(lead.money.quoteTotalMinor, null);
  assert.equal(lead.money.depositPaidMinor, null);
  assert.equal(lead.money.balanceDueMinor, null);
  // A figure with no currency is not something the relay writes.
  assert.equal(
    parse(
      cedarCafeContent({
        money: { ...lead.money, quoteTotalMinor: 0 },
      }),
    ),
    null,
  );
});

test("the project, chats and milestones read as the screen shows them", () => {
  const record = parse(planeTreeContent());
  assert.equal(projectStepLabel(record.project), "step 3 of 7");
  assert.equal(record.project.currentStepTitle, "Website build");
  assert.equal(projectStepLabel(null), null);
  assert.equal(record.chats.whatsapp.messageCount, 16);
  assert.equal(record.chats.emailCount, 2);
  assert.equal(
    latestMilestone(record, "call_booked").note.includes("14:00"),
    true,
  );
  assert.equal(latestMilestone(record, "agreement_signed").byPubkey, AYA);
  assert.equal(
    latestMilestone(record, "other").title,
    "Quote approved and sent",
  );
  assert.equal(record.conversion.source, "client_record");
  assert.equal(record.found.byPubkey, AYA);
});

test("a head that the relay would not write is refused", () => {
  const content = planeTreeContent();
  // A signer that is not the relay.
  assert.equal(
    parseCustomerHead(
      signCustomer(content, { secret: generateSecretKey() }),
      RELAY_PUBKEY,
    ),
    null,
  );
  // Unknown keys, at the top and nested.
  assert.equal(parse({ ...content, extra: 1 }), null);
  assert.equal(
    parse({ ...content, money: { ...content.money, extra: 1 } }),
    null,
  );
  assert.equal(
    parse({
      ...content,
      timeline: [
        { ...content.timeline[0], extra: 1 },
        ...content.timeline.slice(1),
      ],
    }),
    null,
  );
  // The d-tag must name the party.
  assert.equal(
    parseCustomerHead(
      signCustomer(content, {
        tags: [
          ["d", customerDTag(PLANE_TREE_PARTY_ID.replace("6b1d", "7b1d"))],
        ],
      }),
      RELAY_PUBKEY,
    ),
    null,
  );
  assert.equal(
    parseCustomerHead(
      signCustomer(content, { tags: [["d", "company:scorecard"]] }),
      RELAY_PUBKEY,
    ),
    null,
  );
  // An extra tag, an unknown schema, a stage with no matching conversion.
  assert.equal(
    parseCustomerHead(
      signCustomer(content, {
        tags: [
          ["d", customerDTag(PLANE_TREE_PARTY_ID)],
          ["h", "x"],
        ],
      }),
      RELAY_PUBKEY,
    ),
    null,
  );
  assert.equal(parse({ ...content, schemaVersion: 2 }), null);
  assert.equal(parse({ ...content, stage: "lead" }), null);
  assert.equal(parse({ ...content, conversion: null }), null);
  // A duplicate timeline entry id, an unknown entry kind, a 4 KB+ email summary.
  assert.equal(
    parse({ ...content, timeline: [content.timeline[0], content.timeline[0]] }),
    null,
  );
  assert.equal(
    parse({
      ...content,
      timeline: [{ ...content.timeline[0], kind: "mystery" }],
    }),
    null,
  );
  const [first, ...rest] = content.attachments;
  assert.equal(
    parse({
      ...content,
      attachments: [
        { ...first, email: { ...first.email, summary: "x".repeat(4_097) } },
        ...rest,
      ],
    }),
    null,
  );
});

test("the newest head per business wins and the list is by name", () => {
  const older = parse(planeTreeContent({ updatedAt: COMPUTED_AT - 100 }));
  const newer = parse(
    planeTreeContent({
      updatedAt: COMPUTED_AT,
      displayName: "Plane Tree Guesthouse",
    }),
  );
  const cedar = parse(cedarCafeContent());
  const list = buildCustomerRecords([older, cedar, newer]);
  assert.deepEqual(
    list.map((record) => record.displayName),
    ["Cedar Café", "Plane Tree Guesthouse"],
  );
  assert.equal(list[1].eventId, newer.eventId);
});

test("refresh is fresh for a minute", () => {
  const record = parse(planeTreeContent());
  assert.equal(customerRefreshIsFresh(record, record.computedAt + 59), true);
  assert.equal(customerRefreshIsFresh(record, record.computedAt + 60), false);
});

test("d-tags round trip", () => {
  assert.equal(
    parseCustomerDTag(customerDTag(PLANE_TREE_PARTY_ID)),
    PLANE_TREE_PARTY_ID,
  );
  assert.equal(parseCustomerDTag("customer:nope"), null);
  assert.equal(parseCustomerDTag("company:scorecard"), null);
  assert.equal(parseCustomerDTag(null), null);
});

test("action builders carry only their own fields, the d-tag and the expected head", () => {
  const record = parse(planeTreeContent());
  const refresh = buildCustomerActionEvent(customerActions.refresh(record));
  assert.deepEqual(refresh.tags, [["d", customerDTag(PLANE_TREE_PARTY_ID)]]);
  assert.deepEqual(JSON.parse(refresh.content), {
    schemaVersion: 1,
    op: "refresh",
    partyId: PLANE_TREE_PARTY_ID,
    expectedHeadEventId: record.eventId,
  });
  const created = JSON.parse(
    buildCustomerActionEvent(customerActions.create(PLANE_TREE_PARTY_ID))
      .content,
  );
  assert.equal("expectedHeadEventId" in created, false);

  const milestone = JSON.parse(
    buildCustomerActionEvent(
      customerActions.recordMilestone(record, {
        milestoneKind: "call_booked",
        at: 1_793_300_000,
        note: "Friday 14:00",
        title: undefined,
      }),
    ).content,
  );
  assert.deepEqual(Object.keys(milestone).sort(), [
    "at",
    "expectedHeadEventId",
    "milestoneKind",
    "note",
    "op",
    "partyId",
    "schemaVersion",
  ]);
  const email = JSON.parse(
    buildCustomerActionEvent(
      customerActions.attachEmail(record, {
        from: "Thandeka <t@example.com>",
        subject: "Hi",
        date: 1_793_300_000,
        summary: "Short.",
      }),
    ).content,
  );
  assert.equal(email.op, "attach_email");
  assert.equal("fileRefs" in email, false);
  const file = JSON.parse(
    buildCustomerActionEvent(
      customerActions.attachFile(record, {
        label: "Brief",
        fileRef: "blossom:x",
      }),
    ).content,
  );
  assert.equal(file.fileRef, "blossom:x");
  const remove = JSON.parse(
    buildCustomerActionEvent(
      customerActions.removeAttachment(record, record.attachments[0]),
    ).content,
  );
  assert.equal(remove.attachmentId, record.attachments[0].attachmentId);
  const convert = JSON.parse(
    buildCustomerActionEvent(customerActions.convertToClient(record)).content,
  );
  assert.equal(convert.op, "convert_to_client");
});

function mockRun(records, action, overrides = {}) {
  const state = { companyCustomerRecords: records };
  const context = {
    isAdmin: true,
    cofounderEnabled: true,
    now: COMPUTED_AT + 1_000,
    actorPubkey: OWNER,
    eventId: "d".repeat(64),
    currentHeadEventId: (record) => `head:${record.updatedAt}`,
    ...overrides,
  };
  const refusal = applyMockCustomerAction(
    state,
    { schemaVersion: 1, ...action },
    context,
  );
  return { refusal, record: records[0] };
}

test("the mock bridge applies milestones, emails and files like the relay and refuses strangers", () => {
  const head = (record) => `head:${record.updatedAt}`;
  const seed = () => [cedarCafeContent()];
  const party = cedarCafeContent().partyId;

  const call = mockRun(seed(), {
    partyId: party,
    op: "record_milestone",
    milestoneKind: "call_booked",
    at: COMPUTED_AT,
    note: "Friday 14:00",
    expectedHeadEventId: head(cedarCafeContent()),
  });
  assert.equal(call.refusal, null);
  assert.deepEqual(
    call.record.timeline.map((entry) => entry.kind),
    ["found", "opener_approved", "call_booked"],
  );
  assert.equal(call.record.milestones.length, 1);

  const stranger = mockRun(
    seed(),
    {
      partyId: party,
      op: "refresh",
      expectedHeadEventId: head(cedarCafeContent()),
    },
    { isAdmin: false },
  );
  assert.match(stranger.refusal, /only the owner, an admin/);

  const stale = mockRun(seed(), {
    partyId: party,
    op: "refresh",
    expectedHeadEventId: "head:0",
  });
  assert.match(stale.refusal, /^conflict: customer record changed/);

  const off = mockRun(
    seed(),
    {
      partyId: party,
      op: "refresh",
      expectedHeadEventId: head(cedarCafeContent()),
    },
    { cofounderEnabled: false },
  );
  assert.match(off.refusal, /co-founder mode is off/);

  const long = mockRun(seed(), {
    partyId: party,
    op: "attach_email",
    from: "a",
    subject: "b",
    date: COMPUTED_AT,
    summary: "x".repeat(4_097),
    expectedHeadEventId: head(cedarCafeContent()),
  });
  assert.match(long.refusal, /4 KB/);

  const converted = mockRun(seed(), {
    partyId: party,
    op: "convert_to_client",
    expectedHeadEventId: head(cedarCafeContent()),
  });
  assert.equal(converted.refusal, null);
  assert.equal(converted.record.stage, "client");
  assert.equal(converted.record.conversion.source, "owner_action");
  const entries = converted.record.timeline.map((entry) => entry.kind);
  assert.deepEqual(entries, ["found", "opener_approved", "converted"]);
  // Converting again changes nothing.
  const again = mockRun([converted.record], {
    partyId: party,
    op: "convert_to_client",
    expectedHeadEventId: head(converted.record),
  });
  assert.equal(again.refusal, null);
  assert.equal(again.record.timeline.length, 3);

  // The mock's head parses as a relay head too.
  assert.ok(parse(converted.record));
});

test("the mock bridge adds and removes an email and keeps the chats count", () => {
  const seed = [cedarCafeContent()];
  const party = seed[0].partyId;
  const context = (eventId) => ({
    isAdmin: true,
    cofounderEnabled: true,
    now: COMPUTED_AT + 1_000,
    actorPubkey: AYA,
    eventId,
    currentHeadEventId: (record) => `head:${record.updatedAt}`,
  });
  const attached = applyMockCustomerAction(
    { companyCustomerRecords: seed },
    {
      schemaVersion: 1,
      partyId: party,
      op: "attach_email",
      from: "Thandeka <t@example.com>",
      subject: "Logo",
      date: COMPUTED_AT,
      summary: "Sent the logo.",
      expectedHeadEventId: `head:${seed[0].updatedAt}`,
    },
    context("e".repeat(64)),
  );
  assert.equal(attached, null);
  assert.equal(seed[0].chats.emailCount, 1);
  assert.equal(seed[0].attachments[0].kind, "email");
  assert.equal(parse(seed[0]).chats.emailCount, 1);

  const removed = applyMockCustomerAction(
    { companyCustomerRecords: seed },
    {
      schemaVersion: 1,
      partyId: party,
      op: "remove_attachment",
      attachmentId: "e".repeat(64),
      expectedHeadEventId: `head:${seed[0].updatedAt}`,
    },
    context("f".repeat(64)),
  );
  assert.equal(removed, null);
  assert.equal(seed[0].chats.emailCount, 0);
  assert.equal(seed[0].attachments.length, 0);
  assert.deepEqual(
    seed[0].timeline.map((entry) => entry.kind),
    ["found", "opener_approved"],
  );
});
