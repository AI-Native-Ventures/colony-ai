import assert from "node:assert/strict";
import test from "node:test";

import {
  filterLeads,
  isLeadAccessError,
  leadHeadFilter,
  leadInitial,
  leadMeta,
  leadReferenceContent,
  leadReferenceView,
  leadStageLabel,
  leadStageTone,
  newestLeadHead,
  summarizeLead,
} from "./leadReferenceModel.ts";

const COMMUNITY = "e2e-default-community";
const LEAD_ID = "1e1a7000-0000-4000-9000-000000001002";
const CHANNEL = "1e1a7000-0000-4000-8000-000000000001";

function prospect(overrides = {}) {
  return {
    prospectId: LEAD_ID,
    party: {
      partyId: LEAD_ID,
      partyType: "organization",
      displayName: "Form & Field",
      externalIds: [],
    },
    industry: "Home & Living",
    vertical: "Design-led home and living store",
    fitScore: 91,
    potentialMonthlyValueMinor: 650000,
    website: "https://form-field.example",
    contactName: "Jules",
    location: "Woodstock, Cape Town",
    email: null,
    phone: null,
    evidence: [],
    lastVerifiedAt: null,
    qualification: "unreviewed",
    saved: false,
    stage: "qualified",
    lostReason: null,
    ...overrides,
  };
}

function head(overrides = {}, prospectOverrides = {}) {
  return {
    schemaVersion: 1,
    prospectId: LEAD_ID,
    status: "active",
    prospect: prospect(prospectOverrides),
    activities: [],
    sourceActionEventId: "2".repeat(64),
    ...overrides,
  };
}

function headEvent(id, createdAt, content) {
  return {
    id,
    pubkey: "a".repeat(64),
    created_at: createdAt,
    kind: 30644,
    tags: [["h", CHANNEL]],
    content: JSON.stringify(content),
    sig: "b".repeat(128),
  };
}

test("an unreviewed lead reads New and neutral, like the Leads table", () => {
  const unreviewed = prospect();
  assert.equal(leadStageLabel(unreviewed), "New");
  assert.equal(leadStageTone(unreviewed), "neutral");
});

test("reviewed leads show their pipeline stage with its tone", () => {
  const cases = [
    ["qualified", "Qualified", "neutral"],
    ["in_conversation", "In conversation", "blue"],
    ["proposal", "Proposal", "amber"],
  ];
  for (const [stage, label, tone] of cases) {
    const reviewed = prospect({ qualification: "qualified", stage });
    assert.equal(leadStageLabel(reviewed), label, stage);
    assert.equal(leadStageTone(reviewed), tone, stage);
  }
});

test("won and lost always show as such, reviewed or not", () => {
  for (const qualification of ["unreviewed", "qualified", "not_fit"]) {
    const won = prospect({ qualification, stage: "won" });
    assert.equal(leadStageLabel(won), "Won");
    assert.equal(leadStageTone(won), "green");
    const lost = prospect({
      qualification,
      stage: "lost",
      lostReason: "Budget",
    });
    assert.equal(leadStageLabel(lost), "Lost");
    assert.equal(leadStageTone(lost), "red");
  }
});

test("meta joins vertical and location and skips the missing parts", () => {
  assert.equal(
    leadMeta(prospect()),
    "Design-led home and living store · Woodstock, Cape Town",
  );
  assert.equal(leadMeta(prospect({ location: null })), prospect().vertical);
  assert.equal(leadMeta(prospect({ vertical: " ", location: " " })), "");
});

test("the mark shows the first letter, uppercased", () => {
  assert.equal(leadInitial("form & field"), "F");
  assert.equal(leadInitial("  "), "?");
});

test("summarizeLead describes an active lead and skips archived ones", () => {
  assert.deepEqual(summarizeLead(head()), {
    leadId: LEAD_ID,
    name: "Form & Field",
    meta: "Design-led home and living store · Woodstock, Cape Town",
    stageLabel: "New",
    stageTone: "neutral",
    fitScore: 91,
  });
  assert.equal(summarizeLead(head({ status: "archived" })), null);
  assert.equal(
    summarizeLead(head({}, { fitScore: null })).fitScore,
    null,
    "no fit score stays null",
  );
});

test("the head filter is scoped to the business channel and the prospect d-tag", () => {
  assert.deepEqual(leadHeadFilter(CHANNEL, COMMUNITY, LEAD_ID), {
    kinds: [30644],
    "#h": [CHANNEL],
    "#d": [`business:${COMMUNITY}:prospect:${LEAD_ID}`],
    limit: 5,
  });
});

test("newestLeadHead keeps the newest parseable head and breaks ties on id", () => {
  const older = headEvent("a".repeat(64), 100, head({}, { fitScore: 10 }));
  const newer = headEvent("b".repeat(64), 200, head({}, { fitScore: 20 }));
  const tied = headEvent("c".repeat(64), 200, head({}, { fitScore: 30 }));
  const broken = { ...headEvent("d".repeat(64), 900, {}), content: "{nope" };
  const otherKind = { ...headEvent("e".repeat(64), 999, head()), kind: 9 };

  assert.equal(
    newestLeadHead([older, newer, broken, otherKind]).prospect.fitScore,
    20,
  );
  assert.equal(newestLeadHead([newer, tied, older]).prospect.fitScore, 30);
  assert.equal(newestLeadHead([broken, otherKind]), null);
  assert.equal(newestLeadHead([]), null);
});

test("access failures are told apart from network failures", () => {
  assert.equal(isLeadAccessError(new Error("restricted: not a member")), true);
  assert.equal(isLeadAccessError(new Error("blocked: no access")), true);
  assert.equal(isLeadAccessError(new Error("Request timed out")), false);
  assert.equal(isLeadAccessError(null), false);
});

test("leadReferenceView maps query state onto one card state", () => {
  assert.deepEqual(
    leadReferenceView({ isPending: true, error: null, head: undefined }),
    { kind: "loading" },
  );
  assert.deepEqual(
    leadReferenceView({ isPending: false, error: null, head: null }),
    { kind: "missing" },
  );
  assert.deepEqual(
    leadReferenceView({
      isPending: false,
      error: null,
      head: head({ status: "archived" }),
    }),
    { kind: "missing" },
  );
  assert.deepEqual(
    leadReferenceView({
      isPending: false,
      error: new Error("restricted: nope"),
      head: undefined,
    }),
    { kind: "no-access" },
  );
  assert.deepEqual(
    leadReferenceView({
      isPending: false,
      error: new Error("timed out"),
      head: undefined,
    }),
    { kind: "error" },
  );
  const ready = leadReferenceView({
    isPending: false,
    error: null,
    head: head(),
  });
  assert.equal(ready.kind, "ready");
  assert.equal(ready.lead.name, "Form & Field");
});

test("a reference chip gets a space before it only when the text needs one", () => {
  const attrs = { channelName: "Form & Field", href: "buzz://lead/x" };
  const chip = { type: "composerMessageLink", attrs };
  const space = { type: "text", text: " " };

  assert.deepEqual(
    leadReferenceContent({
      textBeforeCaret: "",
      chipNodeName: "composerMessageLink",
      attrs,
    }),
    [chip, space],
  );
  assert.deepEqual(
    leadReferenceContent({
      textBeforeCaret: "see",
      chipNodeName: "composerMessageLink",
      attrs,
    }),
    [space, chip, space],
  );
  assert.deepEqual(
    leadReferenceContent({
      textBeforeCaret: "see ",
      chipNodeName: "composerMessageLink",
      attrs,
    }),
    [chip, space],
  );
  // The character before the caret is another chip (a leaf placeholder).
  assert.deepEqual(
    leadReferenceContent({
      textBeforeCaret: "￼",
      chipNodeName: "composerMessageLink",
      attrs,
    }),
    [space, chip, space],
  );
});

test("filterLeads matches name, vertical and place without regard to case", () => {
  const leads = [
    { name: "Form & Field", meta: "Design-led store · Cape Town" },
    { name: "The Olive House", meta: "Homeware boutique · Johannesburg" },
  ];
  assert.equal(filterLeads(leads, "").length, 2);
  assert.deepEqual(
    filterLeads(leads, "  cape ").map((lead) => lead.name),
    ["Form & Field"],
  );
  assert.deepEqual(
    filterLeads(leads, "HOMEWARE").map((lead) => lead.name),
    ["The Olive House"],
  );
  assert.equal(filterLeads(leads, "zzz").length, 0);
});
