import assert from "node:assert/strict";
import test from "node:test";

import {
  definitionToPlainDraft,
  plainDraftToDefinition,
  plainScheduleDescription,
  plainScheduleFromCron,
  plainScheduleToCron,
} from "./plainWorkflowModel.ts";

const AGENT = "a".repeat(64);
const REVIEWER = "b".repeat(64);

const draft = {
  workflowId: "workflow-id",
  channelId: "channel-id",
  name: "Weekly client content",
  description: "Prepare a plan and review it.",
  schedule: { frequency: "weekly", day: 1, time: "08:00" },
  steps: [
    {
      id: "prepare_plan",
      kind: "agent",
      title: "Prepare next week's content plan",
      assigneePubkey: AGENT,
      instruction: "Prepare captions and creative.",
      expectedResult: "A plan with captions and proposed dates.",
    },
    {
      id: "review_plan",
      kind: "approval",
      title: "Review the content plan",
      reviewerPubkey: REVIEWER,
      message: "Approve the plan or leave feedback.",
    },
  ],
};

test("maps the supported plain workflow to the versioned engine shape", () => {
  assert.deepEqual(plainDraftToDefinition(draft), {
    name: draft.name,
    description: draft.description,
    enabled: true,
    trigger: { on: "schedule", cron: "0 6 * * 1" },
    steps: [
      {
        id: "prepare_plan",
        name: draft.steps[0].title,
        timeout_secs: 900,
        action: "ask_agent",
        agent_pubkey: AGENT,
        instruction: "Prepare captions and creative.",
        expected_result: "A plan with captions and proposed dates.",
      },
      {
        id: "review_plan",
        name: draft.steps[1].title,
        action: "request_approval",
        from: REVIEWER,
        message: "Approve the plan or leave feedback.",
      },
    ],
  });
});

test("maps plain definitions back without inventing fields", () => {
  const engine = plainDraftToDefinition(draft);
  const result = definitionToPlainDraft(engine);
  assert.equal(result.supported, true);
  if (!result.supported) assert.fail(result.reasons.join("; "));
  assert.deepEqual(result.draft, {
    name: draft.name,
    description: draft.description,
    schedule: draft.schedule,
    steps: draft.steps,
  });
});

test("converts local daily and weekly times to UTC, including the prior weekday", () => {
  assert.equal(
    plainScheduleToCron({ frequency: "daily", day: 1, time: "00:30" }),
    "30 22 * * *",
  );
  assert.equal(
    plainScheduleToCron({ frequency: "weekly", day: 0, time: "01:30" }),
    "30 23 * * 6",
  );
  assert.deepEqual(plainScheduleFromCron("30 23 * * 6"), {
    frequency: "weekly",
    day: 0,
    time: "01:30",
  });
  assert.equal(
    plainScheduleDescription({ frequency: "weekly", day: 1, time: "08:00" }),
    "Every Monday at 08:00 · Johannesburg time",
  );
});

test("manual workflows never receive a scheduled trigger", () => {
  const manual = {
    ...draft,
    schedule: { frequency: "manual", day: 1, time: "08:00" },
  };
  assert.deepEqual(plainDraftToDefinition(manual).trigger, { on: "manual" });
  assert.equal(plainScheduleToCron(manual.schedule), null);
  assert.equal(plainScheduleDescription(manual.schedule), "When I start it");
});

test("returns a plain reason when the engine definition cannot be edited safely", () => {
  const unsupported = [
    {
      ...plainDraftToDefinition(draft),
      trigger: { on: "message_posted", filter: "trigger_is_reply == false" },
    },
    {
      ...plainDraftToDefinition(draft),
      steps: [
        { id: "post", action: "call_webhook", url: "https://example.com" },
      ],
    },
    {
      ...plainDraftToDefinition(draft),
      steps: [
        {
          id: "review",
          action: "request_approval",
          from: "owner_or_admin",
          message: "Review",
        },
      ],
    },
    {
      ...plainDraftToDefinition(draft),
      steps: [{ ...plainDraftToDefinition(draft).steps[0], if: "true" }],
    },
    {
      ...plainDraftToDefinition(draft),
      steps: [{ ...plainDraftToDefinition(draft).steps[0], timeout_secs: 120 }],
    },
  ];

  for (const definition of unsupported) {
    const result = definitionToPlainDraft(definition);
    assert.equal(result.supported, false);
    if (result.supported)
      assert.fail("unsupported engine definition was editable");
    assert.ok(result.reasons.length > 0);
  }
});
