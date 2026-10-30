import assert from "node:assert/strict";
import test from "node:test";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";

import {
  KIND_NUMBERS_ACTION,
  KIND_NUMBERS_HEAD,
} from "@/shared/constants/kinds";
import { buildNeedsYou } from "./needsYou.ts";
import { buildNumbersActionEvent, numbersActions } from "./numbersActions.ts";
import {
  approvedGoals,
  buildNumbersModel,
  changeDirection,
  formatMetricValue,
  functionScorecard,
  goalBarPercent,
  goalDTag,
  isImprovement,
  openDecisions,
  parseGoalHead,
  parseNumbersHead,
  parseReviewHead,
  parseScorecardHead,
  proposedGoals,
  reviewDTag,
} from "./numbersRecords.ts";
import {
  AGENT,
  AS_OF,
  GOAL_ID,
  OWNER,
  RELAY_PUBKEY,
  RELAY_SECRET,
  REVIEW_DATE,
  goalContent,
  reviewContent,
  scorecardContent,
  signGoal,
  signReview,
  signScorecard,
} from "./numbersFixtures.mjs";

const NONE = {
  asks: [],
  plans: [],
  whatsappBatches: [],
  whatsappDrafts: [],
};

test("the kinds match the relay's registry", () => {
  assert.equal(KIND_NUMBERS_HEAD, 30678);
  assert.equal(KIND_NUMBERS_ACTION, 47068);
});

test("parseScorecardHead reads the relay's numbers for all five functions", () => {
  const card = parseScorecardHead(signScorecard(), RELAY_PUBKEY);
  assert.ok(card);
  assert.equal(card.currency, "ZAR");
  assert.equal(card.functions.length, 5);
  const sales = functionScorecard(card, "sales");
  assert.ok(sales);
  const won = sales.metrics.find((reading) => reading.metric === "won");
  assert.deepEqual(
    { value: won.value, previous: won.previous, change: won.change },
    { value: 2, previous: 0, change: 2 },
  );
  assert.deepEqual(sales.notTracked, ["calls"]);
  assert.equal(card.goals[0].percent, 60);
  assert.equal(functionScorecard(null, "sales"), null);
});

test("a number that cannot be stated stays null and is never read as zero", () => {
  const content = scorecardContent();
  content.functions[4].metrics = [
    { metric: "cost_per_win", value: null, previous: null, change: null },
  ];
  const card = parseScorecardHead(signScorecard(content), RELAY_PUBKEY);
  const reading = functionScorecard(card, "brand").metrics[0];
  assert.equal(reading.value, null);
  assert.equal(formatMetricValue(reading.value, "usd_cents", "ZAR"), null);
  assert.equal(changeDirection(reading), null);
  assert.equal(isImprovement(reading), null);
});

test("values are whole numbers and a change may be negative", () => {
  const content = scorecardContent();
  assert.ok(parseScorecardHead(signScorecard(content), RELAY_PUBKEY));
  content.functions[0].metrics[0].value = -1;
  // The relay never writes a negative count, but a change is signed. A value
  // is read as a signed whole number, so the shape check is on the field kind.
  assert.ok(parseScorecardHead(signScorecard(content), RELAY_PUBKEY));
  content.functions[0].metrics[0].value = 1.5;
  assert.equal(parseScorecardHead(signScorecard(content), RELAY_PUBKEY), null);
});

test("heads from anyone but the relay, unknown keys and wrong d tags are refused", () => {
  const stranger = generateSecretKey();
  assert.equal(
    parseScorecardHead(
      signScorecard(scorecardContent(), { secret: stranger }),
      RELAY_PUBKEY,
    ),
    null,
  );
  assert.equal(
    parseScorecardHead(
      signScorecard({ ...scorecardContent(), surprise: true }),
      RELAY_PUBKEY,
    ),
    null,
  );
  assert.equal(
    parseGoalHead(signGoal({ ...goalContent(), surprise: true }), RELAY_PUBKEY),
    null,
  );
  const wrongTag = finalizeEvent(
    {
      kind: KIND_NUMBERS_HEAD,
      content: JSON.stringify(goalContent()),
      tags: [["d", goalDTag("00000000-0000-4000-8000-000000000000")]],
      created_at: AS_OF,
    },
    RELAY_SECRET,
  );
  assert.equal(parseGoalHead(wrongTag, RELAY_PUBKEY), null);
  // Four functions are not a scorecard.
  const short = scorecardContent();
  short.functions = short.functions.slice(0, 4);
  assert.equal(parseScorecardHead(signScorecard(short), RELAY_PUBKEY), null);
  // An unknown metric is refused rather than shown.
  const unknown = scorecardContent();
  unknown.functions[0].metrics[0].metric = "vibes";
  assert.equal(parseScorecardHead(signScorecard(unknown), RELAY_PUBKEY), null);
});

test("parseGoalHead reads a goal and refuses a metric of another function", () => {
  const goal = parseGoalHead(signGoal(), RELAY_PUBKEY);
  assert.ok(goal);
  assert.equal(goal.status, "proposed");
  assert.equal(goal.metric, "won");
  assert.equal(goal.functionId, "sales");
  assert.equal(goal.reason, "Last month closed 3.");
  assert.equal(goal.decidedByPubkey, null);
  assert.equal(
    parseGoalHead(signGoal(goalContent({ metric: "cash_in" })), RELAY_PUBKEY),
    null,
    "cash_in belongs to Finance",
  );
  assert.equal(
    parseGoalHead(signGoal(goalContent({ target: 0 })), RELAY_PUBKEY),
    null,
  );
});

test("parseReviewHead keeps the numbers, the words and the decisions", () => {
  const review = parseReviewHead(signReview(), RELAY_PUBKEY);
  assert.ok(review);
  assert.equal(review.reviewDate, REVIEW_DATE);
  assert.deepEqual(review.wins, ["Two proposals accepted"]);
  assert.equal(review.decisions.length, 1);
  assert.equal(review.decisions[0].functionId, "customer_success");
  assert.equal(openDecisions(review).length, 1);
  assert.equal(review.functions.length, 5);
  // A fresh review the relay just wrote has no words and no annotation.
  const fresh = parseReviewHead(
    signReview(
      reviewContent({
        wins: [],
        misses: [],
        decisions: [],
        annotatedByPubkey: undefined,
        annotatedAt: undefined,
        sourceActionEventId: undefined,
      }),
    ),
    RELAY_PUBKEY,
  );
  assert.ok(fresh);
  assert.equal(fresh.annotatedByPubkey, null);
  assert.deepEqual(fresh.decisions, []);
});

test("parseReviewHead refuses duplicate decision ids and too many items", () => {
  const content = reviewContent();
  content.decisions = [content.decisions[0], content.decisions[0]];
  assert.equal(parseReviewHead(signReview(content), RELAY_PUBKEY), null);
  const many = reviewContent({ wins: ["a", "b", "c", "d", "e", "f"] });
  assert.equal(parseReviewHead(signReview(many), RELAY_PUBKEY), null);
  const badDate = reviewContent({ reviewDate: "30 October" });
  const event = finalizeEvent(
    {
      kind: KIND_NUMBERS_HEAD,
      content: JSON.stringify(badDate),
      tags: [["d", reviewDTag("30 October")]],
      created_at: AS_OF,
    },
    RELAY_SECRET,
  );
  assert.equal(parseReviewHead(event, RELAY_PUBKEY), null);
});

test("parseNumbersHead tells the three families apart by d tag", () => {
  assert.equal(
    parseNumbersHead(signScorecard(), RELAY_PUBKEY).kind,
    "scorecard",
  );
  assert.equal(parseNumbersHead(signGoal(), RELAY_PUBKEY).kind, "goal");
  assert.equal(parseNumbersHead(signReview(), RELAY_PUBKEY).kind, "review");
  const other = finalizeEvent(
    {
      kind: KIND_NUMBERS_HEAD,
      content: "{}",
      tags: [["d", "company:other"]],
      created_at: AS_OF,
    },
    RELAY_SECRET,
  );
  assert.equal(parseNumbersHead(other, RELAY_PUBKEY), null);
});

test("buildNumbersModel keeps the newest head per record and sorts reviews by Friday", () => {
  const parsed = (event, createdAt) => ({
    record: parseNumbersHead(event, RELAY_PUBKEY),
    createdAt,
  });
  const olderGoal = signGoal(goalContent({ status: "proposed" }), {
    created_at: 100,
  });
  const newerGoal = signGoal(
    goalContent({ status: "approved", decidedByPubkey: OWNER, decidedAt: 200 }),
    {
      created_at: 200,
    },
  );
  const lastWeek = signReview(reviewContent({ reviewDate: "2026-10-23" }), {
    created_at: 50,
  });
  const model = buildNumbersModel([
    parsed(olderGoal, 100),
    parsed(newerGoal, 200),
    parsed(lastWeek, 50),
    parsed(signReview(), 300),
    parsed(signScorecard(), 300),
  ]);
  assert.equal(model.goals.length, 1);
  assert.equal(model.goals[0].status, "approved");
  assert.deepEqual(
    model.reviews.map((review) => review.reviewDate),
    ["2026-10-30", "2026-10-23"],
  );
  assert.ok(model.scorecard);
  assert.deepEqual(buildNumbersModel([]), {
    scorecard: null,
    goals: [],
    reviews: [],
  });
});

test("goal helpers split what waits for the owner from what is tracked", () => {
  const proposed = parseGoalHead(signGoal(), RELAY_PUBKEY);
  const approved = parseGoalHead(
    signGoal(
      goalContent({
        status: "approved",
        goalId: "11111111-1111-4111-8111-111111111111",
      }),
    ),
    RELAY_PUBKEY,
  );
  assert.deepEqual(proposedGoals([proposed, approved]), [proposed]);
  assert.deepEqual(approvedGoals([proposed, approved]), [approved]);
  assert.deepEqual(approvedGoals([proposed, approved], "finance"), []);
});

test("direction, improvement and formatting read the way people expect", () => {
  const up = { metric: "won", value: 2, previous: 0, change: 2 };
  const down = { metric: "replied", value: 1, previous: 2, change: -1 };
  const flat = { metric: "quotes", value: 1, previous: 1, change: 0 };
  assert.equal(changeDirection(up), "up");
  assert.equal(changeDirection(down), "down");
  assert.equal(changeDirection(flat), "flat");
  assert.equal(isImprovement(up), true);
  assert.equal(isImprovement(down), false);
  assert.equal(isImprovement(flat), null);
  // A cost that falls and a failure that falls are good news.
  assert.equal(
    isImprovement({
      metric: "worker_cost",
      value: 45,
      previous: 100,
      change: -55,
    }),
    true,
  );
  assert.equal(
    isImprovement({
      metric: "workers_failed",
      value: 1,
      previous: 0,
      change: 1,
    }),
    false,
  );
  assert.equal(
    formatMetricValue(1234, "count", "ZAR"),
    new Intl.NumberFormat("en-ZA").format(1234),
  );
  assert.match(formatMetricValue(175_050, "money", "ZAR"), /1\s?750,50/);
  assert.match(formatMetricValue(23, "usd_cents", "ZAR"), /0,23/);
  assert.equal(goalBarPercent({ percent: 250 }), 100);
  assert.equal(goalBarPercent({ percent: null }), 0);
  assert.equal(goalBarPercent({ percent: 60 }), 60);
});

test("action events carry the d tag of their record and only the fields of their op", () => {
  const propose = buildNumbersActionEvent({
    op: "goal_propose",
    goalId: GOAL_ID,
    function: "sales",
    title: "5 new clients a month",
    metric: "won",
    target: 5,
    period: "month",
    reason: "",
  });
  assert.deepEqual(propose.tags, [["d", `company:fngoal:${GOAL_ID}`]]);
  const body = JSON.parse(propose.content);
  assert.deepEqual(Object.keys(body).sort(), [
    "function",
    "goalId",
    "metric",
    "op",
    "period",
    "schemaVersion",
    "target",
    "title",
  ]);
  const refresh = buildNumbersActionEvent(numbersActions.refreshScorecard());
  assert.deepEqual(refresh.tags, [["d", "company:scorecard"]]);
  assert.deepEqual(JSON.parse(refresh.content), {
    schemaVersion: 1,
    op: "scorecard_refresh",
  });
});

test("the one-tap helpers name the exact head the owner saw", () => {
  const goal = parseGoalHead(signGoal(), RELAY_PUBKEY);
  const approve = buildNumbersActionEvent(
    numbersActions.approveGoal(goal, "Go"),
  );
  assert.deepEqual(JSON.parse(approve.content), {
    schemaVersion: 1,
    op: "goal_approve",
    goalId: GOAL_ID,
    note: "Go",
    expectedHeadEventId: goal.eventId,
  });
  const review = parseReviewHead(signReview(), RELAY_PUBKEY);
  const decide = buildNumbersActionEvent(
    numbersActions.decide(review, "hire-cs", "approved"),
  );
  assert.deepEqual(decide.tags, [["d", `company:review:${REVIEW_DATE}`]]);
  assert.deepEqual(JSON.parse(decide.content), {
    schemaVersion: 1,
    op: "review_decide",
    reviewDate: REVIEW_DATE,
    decisionId: "hire-cs",
    choice: "approved",
    expectedHeadEventId: review.eventId,
  });
});

test("a proposed goal is an approve item and an open review decision is a decide item", () => {
  const goal = parseGoalHead(signGoal(), RELAY_PUBKEY);
  const review = parseReviewHead(signReview(), RELAY_PUBKEY);
  const owner = buildNeedsYou({
    ...NONE,
    canApprove: true,
    goals: [goal],
    reviews: [review],
  });
  assert.equal(owner.total, 2);
  assert.equal(owner.approve[0].id, `goal:${GOAL_ID}`);
  assert.equal(owner.approve[0].category, "goal");
  assert.equal(owner.approve[0].fromPubkey, AGENT);
  assert.deepEqual(owner.approve[0].source, { kind: "goal", goalId: GOAL_ID });
  assert.match(owner.approve[0].subtitle, /Sales/);
  assert.deepEqual(owner.approve[0].details, [
    { id: "reason", label: "Why", text: "Last month closed 3." },
  ]);
  assert.equal(owner.decide[0].id, `review-decision:${REVIEW_DATE}:hire-cs`);
  assert.equal(owner.decide[0].category, "review_decision");
  assert.deepEqual(owner.decide[0].source, {
    kind: "review_decision",
    reviewDate: REVIEW_DATE,
    decisionId: "hire-cs",
  });

  // Only an owner or admin sees them: the relay refuses everyone else.
  const member = buildNeedsYou({
    ...NONE,
    canApprove: false,
    goals: [goal],
    reviews: [review],
  });
  assert.equal(member.total, 0);

  // An approved goal and an answered decision are no longer asked.
  const approved = parseGoalHead(
    signGoal(goalContent({ status: "approved" })),
    RELAY_PUBKEY,
  );
  const answered = parseReviewHead(
    signReview(
      reviewContent({
        decisions: [
          {
            ...reviewContent().decisions[0],
            state: "approved",
            decidedByPubkey: OWNER,
            decidedAt: AS_OF + 9_000,
          },
        ],
      }),
    ),
    RELAY_PUBKEY,
  );
  assert.equal(
    buildNeedsYou({
      ...NONE,
      canApprove: true,
      goals: [approved],
      reviews: [answered],
    }).total,
    0,
  );
  // Sources left out change nothing for the callers that predate numbers.
  assert.equal(buildNeedsYou({ ...NONE, canApprove: true }).total, 0);
});
