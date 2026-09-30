import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAskCreateAction,
  buildAskCreateTags,
  EMPTY_ASK_COMPOSER_DRAFT,
  validateAskComposerDraft,
} from "./askComposer.ts";

const CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const THREAD_ROOT = "a".repeat(64);
const ASK_ID = "7245ba1a-e078-42ef-b896-00be34a94f11";
const ADDRESSEE = "e".repeat(64);

function validDraft(type) {
  return {
    ...EMPTY_ASK_COMPOSER_DRAFT,
    type,
    title: "Review the launch plan",
    body: "Check the latest version.",
    addresseePubkey: ADDRESSEE,
    decideBy: "2026-09-29T15:00",
    options: "Warm editorial\nBold studio",
    items: "Check spelling\nConfirm dates",
  };
}

const coordinates = {
  channelId: CHANNEL_ID,
  threadRootEventId: THREAD_ROOT,
};

test("all five ask types accept the shared required fields", () => {
  for (const type of [
    "approval",
    "question",
    "choice",
    "checklist",
    "verdict",
  ]) {
    assert.deepEqual(
      validateAskComposerDraft(validDraft(type), coordinates),
      {},
      `${type} draft should be valid`,
    );
  }
});

test("choice and checklist drafts validate their distinct list bounds", () => {
  assert.match(
    validateAskComposerDraft(
      { ...validDraft("choice"), options: "Only one" },
      coordinates,
    ).options ?? "",
    /between 2 and 8/i,
  );
  assert.match(
    validateAskComposerDraft(
      {
        ...validDraft("choice"),
        options: Array.from(
          { length: 9 },
          (_, index) => `Choice ${index}`,
        ).join("\n"),
      },
      coordinates,
    ).options ?? "",
    /between 2 and 8/i,
  );
  assert.match(
    validateAskComposerDraft(
      { ...validDraft("checklist"), items: "" },
      coordinates,
    ).items ?? "",
    /between 1 and 20/i,
  );
  assert.deepEqual(
    validateAskComposerDraft(
      {
        ...validDraft("checklist"),
        items: Array.from(
          { length: 20 },
          (_, index) => `Step ${index + 1}`,
        ).join("\n"),
      },
      coordinates,
    ),
    {},
  );
});

test("required text, addressee, decision date, and persisted coordinates are checked", () => {
  const errors = validateAskComposerDraft(
    {
      ...validDraft("approval"),
      title: " ",
      addresseePubkey: "not-a-pubkey",
      decideBy: "not-a-date",
    },
    { channelId: "bad", threadRootEventId: "bad" },
  );
  assert.match(errors.title ?? "", /thread is unavailable/i);
  assert.match(errors.addresseePubkey ?? "", /choose a person/i);
  assert.match(errors.decideBy ?? "", /valid decision date/i);
});

test("create action uses the existing channel ask schema and stable thread tags", () => {
  const draft = validDraft("choice");
  const action = buildAskCreateAction(draft, {
    ...coordinates,
    askId: ASK_ID,
  });

  assert.deepEqual(action, {
    schemaVersion: 1,
    askId: ASK_ID,
    action: "create",
    ask: {
      schemaVersion: 1,
      askId: ASK_ID,
      type: "choice",
      category: "general",
      title: "Review the launch plan",
      body: "Check the latest version.",
      threadRootEventId: THREAD_ROOT,
      addresseePubkey: ADDRESSEE,
      decideBy: new Date(draft.decideBy).toISOString(),
      options: [
        { id: "option-1", label: "Warm editorial" },
        { id: "option-2", label: "Bold studio" },
      ],
    },
  });
  assert.deepEqual(buildAskCreateTags(CHANNEL_ID, THREAD_ROOT, ASK_ID), [
    ["h", CHANNEL_ID],
    ["d", `channel:${CHANNEL_ID}:ask:${ASK_ID}`],
    ["e", THREAD_ROOT, "", "root"],
    ["e", THREAD_ROOT, "", "reply"],
  ]);
});

test("new-thread asks carry their opening context without a separate root event", () => {
  const draft = {
    ...validDraft("question"),
    threadTitle: "Client delivery",
    threadContext: "The client asked for an updated launch date.",
  };
  const action = buildAskCreateAction(draft, {
    channelId: CHANNEL_ID,
    askId: ASK_ID,
  });

  assert.deepEqual(action.ask.threadStart, {
    title: "Client delivery",
    openingContext: "The client asked for an updated launch date.",
  });
  assert.equal("threadRootEventId" in action.ask, false);
  assert.deepEqual(buildAskCreateTags(CHANNEL_ID, undefined, ASK_ID), [
    ["h", CHANNEL_ID],
    ["d", `channel:${CHANNEL_ID}:ask:${ASK_ID}`],
  ]);
});

test("hire proposal drafts create one typed hire ask using the selected role record", () => {
  const draft = {
    ...validDraft("hire_proposal"),
    hireRolePackId: "persona-operations",
    hireName: "Operations assistant",
    hireTitle: "Operations Assistant",
    hireReason: "The team needs help coordinating supplier work.",
    hireAllowance: "240.00",
    hireAllowancePeriod: "week",
  };
  const hire = {
    rolePack: {
      personaId: "persona-operations",
      title: "Operations",
      job: "Coordinate team operations",
      skills: ["Planning"],
      tools: [{ name: "calendar_read", risk: "low" }],
      workerMenu: ["runtime-current"],
    },
    runtimeId: "runtime-current",
    providerId: "provider-current",
    modelId: "model-current",
  };
  const action = buildAskCreateAction(
    draft,
    {
      ...coordinates,
      askId: ASK_ID,
      hireId: "38eb1501-90ea-4f6e-9e6a-b41b6b4f09bb",
    },
    hire,
  );

  assert.equal(action.ask.type, "approval");
  assert.equal(action.ask.category, "hire");
  assert.equal(action.ask.title, "Operations Assistant");
  assert.equal(action.ask.body, draft.hireReason);
  assert.deepEqual(action.ask.subject, {
    kind: "hire",
    id: "38eb1501-90ea-4f6e-9e6a-b41b6b4f09bb",
  });
  assert.deepEqual(action.ask.hireProposal, {
    hireId: "38eb1501-90ea-4f6e-9e6a-b41b6b4f09bb",
    rolePack: hire.rolePack,
    displayName: draft.hireName,
    title: draft.hireTitle,
    introductionChannelId: CHANNEL_ID,
    runtimeId: "runtime-current",
    providerId: "provider-current",
    modelId: "model-current",
    weeklyAllowance: "240.00",
  });
  assert.equal(action.ask.threadRootEventId, THREAD_ROOT);
});

test("hire proposals require an explicit supported allowance period and reason", () => {
  const draft = {
    ...validDraft("hire_proposal"),
    hireRolePackId: "persona-operations",
    hireName: "Operations assistant",
    hireTitle: "Operations Assistant",
    hireReason: "The team needs help coordinating supplier work.",
    hireAllowance: "240.00",
    hireAllowancePeriod: "week",
  };
  const hire = {
    rolePack: {
      personaId: "persona-operations",
      title: "Operations",
      job: "Coordinate team operations",
      skills: [],
      tools: [],
      workerMenu: ["runtime-current"],
    },
    runtimeId: "runtime-current",
  };
  assert.deepEqual(validateAskComposerDraft(draft, coordinates, hire), {});
  assert.match(
    validateAskComposerDraft({ ...draft, hireReason: "   " }, coordinates, hire)
      .hireReason ?? "",
    /reason is required/i,
  );
  assert.match(
    validateAskComposerDraft(
      { ...draft, hireAllowancePeriod: "month" },
      coordinates,
      hire,
    ).hireAllowancePeriod ?? "",
    /available allowance period/i,
  );
});

test("invalid drafts cannot be converted into sendable actions", () => {
  assert.throws(
    () =>
      buildAskCreateAction(
        { ...validDraft("checklist"), items: "" },
        { ...coordinates, askId: ASK_ID },
      ),
    /draft is not valid/i,
  );
});
