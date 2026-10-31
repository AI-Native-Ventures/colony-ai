import assert from "node:assert/strict";
import test from "node:test";

import { parseWhatsAppContact } from "./whatsappOutreachModels.ts";
import {
  contactDisplayName,
  getWhatsAppNeedsYouItems,
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
