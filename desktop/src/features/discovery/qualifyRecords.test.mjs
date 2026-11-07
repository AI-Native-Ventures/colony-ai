import assert from "node:assert/strict";
import test from "node:test";

const {
  buildQualifyObservationAction,
  parseQualifyObservationHead,
  qualifyObservationDTag,
} = await import("./qualifyRecords.ts");

const COMMUNITY = "e2e-tenant";
const CHANNEL = "e2e-sales-channel";
const LEAD_ID = "9bb3be2c-4faa-4114-9b2d-d2ad6bd09b88";
const RUN_ID = "0d13a579-215f-4c87-9f4d-646bdded3397";
const SOURCE_ID = "a".repeat(64);

function observation(overrides = {}) {
  return {
    signal: "HAS_WHATSAPP_LINK",
    state: "observed",
    value: "https://wa.me/27115550100",
    confidence: 0.95,
    evidenceUrls: ["https://olive.example/contact"],
    observedAt: 1_762_000_000,
    runId: RUN_ID,
    notCheckedReason: null,
    personalData: false,
    ...overrides,
  };
}

function head(overrides = {}) {
  return {
    schemaVersion: 1,
    leadId: LEAD_ID,
    runId: RUN_ID,
    checkedSignals: ["HAS_WHATSAPP_LINK"],
    observations: [observation()],
    checkedAt: 1_762_000_001,
    sourceActionEventId: SOURCE_ID,
    ...overrides,
  };
}

function event(content, kind = 30681) {
  return {
    id: "b".repeat(64),
    pubkey: "c".repeat(64),
    kind,
    content: JSON.stringify(content),
    created_at: 1,
    tags: [
      ["h", CHANNEL],
      ["d", qualifyObservationDTag(COMMUNITY, LEAD_ID)],
    ],
    sig: "d".repeat(128),
  };
}

test("qualification parser accepts a relay head with evidence-backed observations", () => {
  assert.deepEqual(
    parseQualifyObservationHead(event(head()), COMMUNITY, CHANNEL),
    {
      eventId: "b".repeat(64),
      dTag: qualifyObservationDTag(COMMUNITY, LEAD_ID),
      record: head(),
    },
  );
});

test("qualification parser rejects claims without required evidence", () => {
  const invalid = head({ observations: [observation({ evidenceUrls: [] })] });
  assert.equal(
    parseQualifyObservationHead(event(invalid), COMMUNITY, CHANNEL),
    null,
  );
});

test("not-checked rows cannot carry a value or confidence", () => {
  const invalid = head({
    checkedSignals: ["NO_ONLINE_BOOKING"],
    observations: [
      observation({
        signal: "NO_ONLINE_BOOKING",
        state: "not_checked",
        value: "no booking found",
        confidence: 0.6,
        evidenceUrls: [],
        notCheckedReason: "blocked_by_site",
      }),
    ],
  });
  assert.equal(
    parseQualifyObservationHead(event(invalid), COMMUNITY, CHANNEL),
    null,
  );
});

test("action builder rejects duplicate signals and preserves an exact head fence", () => {
  assert.throws(() =>
    buildQualifyObservationAction({
      leadId: LEAD_ID,
      runId: RUN_ID,
      checkedSignals: ["HAS_WHATSAPP_LINK"],
      observations: [observation(), observation()],
    }),
  );
  assert.deepEqual(
    buildQualifyObservationAction({
      leadId: LEAD_ID,
      runId: RUN_ID,
      expectedHeadEventId: SOURCE_ID,
      checkedSignals: ["HAS_WHATSAPP_LINK"],
      observations: [observation()],
    }),
    {
      schemaVersion: 1,
      leadId: LEAD_ID,
      runId: RUN_ID,
      expectedHeadEventId: SOURCE_ID,
      checkedSignals: ["HAS_WHATSAPP_LINK"],
      observations: [observation()],
    },
  );
});

test("parser and action builder enforce confidence caps for bounded negative signals", () => {
  const excessiveBooking = head({
    checkedSignals: ["NO_ONLINE_BOOKING"],
    observations: [
      observation({
        signal: "NO_ONLINE_BOOKING",
        value: "No booking found",
        confidence: 0.61,
      }),
    ],
  });
  assert.equal(
    parseQualifyObservationHead(event(excessiveBooking), COMMUNITY, CHANNEL),
    null,
  );
  assert.throws(() =>
    buildQualifyObservationAction({
      leadId: LEAD_ID,
      runId: RUN_ID,
      checkedSignals: ["NO_WHATSAPP_LINK"],
      observations: [
        observation({
          signal: "NO_WHATSAPP_LINK",
          value: "No WhatsApp link found",
          confidence: 0.71,
        }),
      ],
    }),
  );
});

test("legacy desktop event selection can ignore an unknown qualification head", () => {
  const legacyKinds = new Set([30630, 30632, 30633, 30644, 30684, 30685]);
  const known = [
    event({ schemaVersion: 1, prospectId: LEAD_ID }, 30644),
    event(head(), 30681),
  ].filter((item) => legacyKinds.has(item.kind));
  assert.equal(known.length, 1);
  assert.equal(known[0].kind, 30644);
});
