import assert from "node:assert/strict";
import test from "node:test";

import { parseWhatsAppContact } from "./whatsappOutreachModels.ts";
import {
  contactDisplayName,
  getWhatsAppNeedsYouItems,
  pipelineStageTotal,
} from "./whatsappOutreachStages.ts";

function contact(overrides = {}) {
  return parseWhatsAppContact({
    waId: "27821237135",
    e164: "+27821237135",
    displayName: "Plane Tree Guesthouse",
    leadId: null,
    ownerPubkey: null,
    threadRootEventId: null,
    lastInboundAt: null,
    windowOpen: false,
    windowClosesAt: null,
    optedOut: false,
    paused: false,
    pauseReason: null,
    unanswered: false,
    ...overrides,
  });
}

test("Needs You deduplicates an unanswered wants-call contact into the higher section", () => {
  const wantsCall = contact({ stage: "wants_call", unanswered: true });
  const waiting = contact({
    waId: "27725551188",
    e164: "+27725551188",
    stage: "replied",
    unanswered: true,
  });

  const items = getWhatsAppNeedsYouItems(
    [
      wantsCall,
      contact({ ...wantsCall, stage: "replied", unanswered: true }),
      waiting,
    ],
    [{ waId: wantsCall.waId }],
  );

  assert.deepEqual(
    items.map((item) => [item.contact.waId, item.section, item.hasDraft]),
    [
      [wantsCall.waId, "wants-call", true],
      [waiting.waId, "waiting-for-reply", false],
    ],
  );
});

test("Needs You excludes queued contacts even when old draft or reply data remains", () => {
  const queued = contact({
    stage: "queued",
    unanswered: true,
  });

  assert.deepEqual(
    getWhatsAppNeedsYouItems([queued], [{ waId: queued.waId }]),
    [],
  );
});

test("contact labels override profile and business names", () => {
  assert.equal(
    contactDisplayName(
      contact({ label: "Miriam's Guesthouse", profileName: "Miriam" }),
    ),
    "Miriam's Guesthouse",
  );
  assert.equal(
    contactDisplayName(
      contact({
        label: null,
        businessName: null,
        displayName: null,
        profileName: null,
      }),
    ),
    "+27 82 123 7135",
  );
});

const counts = {
  stageCounts: { contacted: 174, replied: 20, no_thanks: 7 },
  failedNotContacted: 5,
  totalContacts: 450,
  countsTruncated: false,
};

test("a pipeline column shows the relay's true count, not the loaded one", () => {
  // 450 contacts, 200 loaded: the loaded list holds only 62 contacted.
  assert.equal(
    pipelineStageTotal({
      stage: "replied",
      loadedCount: 11,
      searching: false,
      counts,
    }),
    20,
  );
  assert.equal(
    pipelineStageTotal({
      stage: "no_thanks",
      loadedCount: 2,
      searching: false,
      counts,
    }),
    7,
  );
  // A stage the relay does not list has no contacts.
  assert.equal(
    pipelineStageTotal({
      stage: "client",
      loadedCount: 4,
      searching: false,
      counts,
    }),
    0,
  );
});

test("the Contacted column adds contacts that never reached anyone", () => {
  assert.equal(
    pipelineStageTotal({
      stage: "contacted",
      loadedCount: 62,
      searching: false,
      counts,
    }),
    179,
  );
  const regression = {
    stageCounts: { contacted: 174 },
    failedNotContacted: 0,
    totalContacts: 450,
    countsTruncated: false,
  };
  assert.equal(
    pipelineStageTotal({
      stage: "contacted",
      loadedCount: 62,
      searching: false,
      counts: regression,
    }),
    174,
  );
});

test("a search counts the matching loaded contacts", () => {
  assert.equal(
    pipelineStageTotal({
      stage: "contacted",
      loadedCount: 3,
      searching: true,
      counts,
    }),
    3,
  );
});

test("without counts the loaded number stands", () => {
  for (const missing of [null, undefined]) {
    assert.equal(
      pipelineStageTotal({
        stage: "contacted",
        loadedCount: 62,
        searching: false,
        counts: missing,
      }),
      62,
    );
  }
});

test("a lead that is ready to call needs the person it was given to", () => {
  // GUARD: `contactAwaitsCallFrom` in `getWhatsAppNeedsYouItems`. Without it every person
  // sees every ready lead as theirs, and the count on Needs you is wrong for the whole team.
  const zaina = "ab".repeat(32);
  const basheer = "cd".repeat(32);
  const mine = contact({
    waId: "27821230001",
    e164: "+27821230001",
    stage: "ready_to_call",
    callBrief: { assigneePubkey: zaina, note: "Preview is ready." },
  });
  const nobodyYet = contact({
    waId: "27821230002",
    e164: "+27821230002",
    stage: "ready_to_call",
  });
  const wantsCall = contact({
    waId: "27821230003",
    e164: "+27821230003",
    stage: "wants_call",
  });
  const theirsWithReply = contact({
    waId: "27821230004",
    e164: "+27821230004",
    stage: "ready_to_call",
    unanswered: true,
    callBrief: { assigneePubkey: zaina },
  });
  const sections = (pubkey, contacts) =>
    getWhatsAppNeedsYouItems(contacts, [], pubkey).map((item) => [
      item.contact.waId,
      item.section,
    ]);

  // Zaina: her call first, then the unassigned one, then the call still to prepare.
  assert.deepEqual(sections(zaina, [wantsCall, nobodyYet, mine]), [
    [mine.waId, "ready-to-call"],
    [nobodyYet.waId, "ready-to-call"],
    [wantsCall.waId, "wants-call"],
  ]);
  // Basheer handed it over: it no longer needs him, until there is a reply to write.
  assert.deepEqual(sections(basheer, [mine, nobodyYet, wantsCall]), [
    [nobodyYet.waId, "ready-to-call"],
    [wantsCall.waId, "wants-call"],
  ]);
  assert.deepEqual(sections(basheer, [theirsWithReply]), [
    [theirsWithReply.waId, "waiting-for-reply"],
  ]);
  assert.deepEqual(sections(zaina, [theirsWithReply]), [
    [theirsWithReply.waId, "ready-to-call"],
  ]);
  // Before the signed-in person is known, only an unassigned lead is offered.
  assert.deepEqual(sections(undefined, [mine, nobodyYet]), [
    [nobodyYet.waId, "ready-to-call"],
  ]);
});
