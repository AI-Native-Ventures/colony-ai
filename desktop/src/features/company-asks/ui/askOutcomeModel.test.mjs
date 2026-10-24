import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDeadline,
  formatDecisionStamp,
  formatTileDate,
} from "./askCardFormatting.ts";
import {
  cardEyebrow,
  describeOutcome,
  outcomeChip,
  outcomeVerb,
} from "./askOutcomeModel.ts";

const NOW = new Date(2026, 9, 23, 9, 55);

function head(ask, resolution) {
  return {
    schemaVersion: 1,
    askId: "ask",
    status: resolution ? "resolved" : "open",
    askerPubkey: "a",
    createdAt: "2026-10-22T09:00:00+02:00",
    ask: { schemaVersion: 1, askId: "ask", title: "T", ...ask },
    resolution: resolution ?? null,
    cancellation: null,
    sourceActionEventId: "b",
  };
}

test("outcome chips follow the board's colours and glyphs", () => {
  assert.deepEqual(outcomeChip("approved"), {
    label: "Approved",
    tone: "ok",
    icon: "check",
  });
  assert.deepEqual(outcomeChip("rejected"), {
    label: "Rejected",
    tone: "bad",
    icon: "x",
  });
  assert.deepEqual(outcomeChip("revision_requested"), {
    label: "Revision requested",
    tone: "need",
    icon: "pencil",
  });
  assert.equal(outcomeChip("answered").tone, "info");
  assert.equal(outcomeChip("chosen").label, "Choice recorded");
  assert.equal(outcomeChip("confirmed").label, "Checklist confirmed");
  assert.equal(outcomeVerb("chosen"), "Chosen");
  assert.equal(outcomeVerb("pass"), "Pass");
});

test("the eyebrow names the kind of ask", () => {
  assert.equal(
    cardEyebrow({ type: "approval", category: "general" }),
    "Approval",
  );
  assert.equal(cardEyebrow({ type: "approval", category: "money" }), "Budget");
  assert.equal(
    cardEyebrow({ type: "approval", category: "hire" }),
    "Hiring approval",
  );
  assert.equal(
    cardEyebrow({ type: "tool_consent", category: "tool" }),
    "Tool consent",
  );
  assert.equal(
    cardEyebrow({ type: "verdict", category: "general" }),
    "Verdict",
  );
});

test("a declined hire reads as a declined request", () => {
  const content = describeOutcome(
    head(
      { type: "approval", category: "hire" },
      {
        outcome: "rejected",
        reason: "Not this quarter.",
        resolvedByPubkey: "x",
        resolvedAt: "2026-10-19T10:00:00+02:00",
        responseEventId: "r",
      },
    ),
  );
  assert.equal(content.chip.label, "Request declined");
  assert.equal(content.verb, "Declined");
  assert.equal(content.quote, "Not this quarter.");
});

test("a choice lists every option with the chosen one marked", () => {
  const content = describeOutcome(
    head(
      {
        type: "choice",
        category: "general",
        options: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
      },
      {
        outcome: "chosen",
        optionId: "b",
        resolvedByPubkey: "x",
        resolvedAt: "2026-10-23T09:30:00+02:00",
        responseEventId: "r",
      },
    ),
  );
  assert.deepEqual(content.options, [
    { id: "a", label: "A", chosen: false },
    { id: "b", label: "B", chosen: true },
  ]);
  assert.equal(content.quote, null);
});

test("a confirmed checklist lists every item and has no decision line", () => {
  const content = describeOutcome(
    head(
      {
        type: "checklist",
        category: "general",
        items: [{ id: "t", label: "Tone" }],
      },
      {
        outcome: "confirmed",
        checkedItemIds: ["t"],
        resolvedByPubkey: "x",
        resolvedAt: "2026-10-23T09:30:00+02:00",
        responseEventId: "r",
      },
    ),
  );
  assert.deepEqual(content.items, [{ id: "t", label: "Tone" }]);
  assert.equal(content.verb, null);
});

test("an open ask has no outcome", () => {
  assert.equal(
    describeOutcome(head({ type: "approval", category: "general" })),
    null,
  );
});

test("decision stamps say today, yesterday, then the weekday and date", () => {
  assert.equal(
    formatDecisionStamp(new Date(2026, 9, 23, 13, 58).toISOString(), NOW),
    "Today, 13:58",
  );
  assert.equal(
    formatDecisionStamp(new Date(2026, 9, 22, 8, 0).toISOString(), NOW),
    "Yesterday",
  );
  assert.equal(
    formatDecisionStamp(new Date(2026, 9, 20, 8, 0).toISOString(), NOW),
    "Tue 20 Oct",
  );
  assert.equal(formatDecisionStamp("not a date", NOW), null);
});

test("deadlines say today, tomorrow, then the date", () => {
  assert.equal(
    formatDeadline(new Date(2026, 9, 23, 14, 0).toISOString(), { now: NOW }),
    "Today, 14:00",
  );
  assert.equal(
    formatDeadline(new Date(2026, 9, 23, 14, 0).toISOString(), {
      now: NOW,
      lowercaseDay: true,
    }),
    "today, 14:00",
  );
  assert.equal(
    formatDeadline(new Date(2026, 9, 24, 9, 5).toISOString(), { now: NOW }),
    "Tomorrow, 09:05",
  );
  assert.equal(
    formatDeadline(new Date(2026, 9, 22, 17, 0).toISOString(), { now: NOW }),
    "22 Oct, 17:00",
  );
  assert.equal(formatDeadline(null, { now: NOW }), null);
});

test("an end date is read from the stored date, not shifted by a time zone", () => {
  assert.equal(formatTileDate("2026-10-31T23:59:59+02:00"), "31 Oct 2026");
  assert.equal(formatTileDate("2026-10-31"), "31 Oct 2026");
  assert.equal(formatTileDate("soon"), null);
});
