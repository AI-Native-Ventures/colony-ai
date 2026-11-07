import assert from "node:assert/strict";
import test from "node:test";

const { buildQualificationDraftContext } = await import(
  "./qualifyDraftContext.ts"
);

const NOW = 1_762_000_000;

function observation(overrides = {}) {
  return {
    signal: "HAS_WHATSAPP_LINK",
    state: "observed",
    value: "https://wa.me/27115550100",
    confidence: 0.95,
    evidenceUrls: ["https://olive.example/contact"],
    observedAt: NOW - 60,
    runId: "d39cf188-319a-4efc-92cc-8c55c5f2d6d2",
    notCheckedReason: null,
    personalData: false,
    ...overrides,
  };
}

function head(observations) {
  return {
    schemaVersion: 1,
    leadId: "9bb3be2c-4faa-4114-9b2d-d2ad6bd09b88",
    runId: "d39cf188-319a-4efc-92cc-8c55c5f2d6d2",
    checkedSignals: observations.map((item) => item.signal),
    observations,
    checkedAt: NOW - 60,
    sourceActionEventId: "a".repeat(64),
  };
}

test("draft context includes only fresh, confident, evidenced observations", () => {
  const context = buildQualificationDraftContext(
    head([
      observation(),
      observation({
        signal: "NO_ONLINE_BOOKING",
        value: "No booking found",
        confidence: 0.6,
      }),
      observation({
        signal: "NO_WHATSAPP_LINK",
        value: "No WhatsApp link found",
        confidence: 0.7,
      }),
      observation({ signal: "NO_HTTPS", observedAt: NOW - 31 * 24 * 60 * 60 }),
      observation({ signal: "NO_WEBSITE", evidenceUrls: [] }),
      observation({ signal: "SITE_DOWN", confidence: 0.59 }),
      observation({
        signal: "PUBLIC_EMAIL",
        value: "owner@olive.example",
        personalData: true,
      }),
      observation({
        signal: "NO_WEBSITE",
        state: "not_checked",
        value: null,
        confidence: 0,
        evidenceUrls: [],
        notCheckedReason: "blocked_by_site",
      }),
    ]),
    NOW,
  );

  assert.deepEqual(
    context.facts.map((fact) => fact.signal),
    ["HAS_WHATSAPP_LINK", "NO_ONLINE_BOOKING", "NO_WHATSAPP_LINK"],
  );
  assert.equal(
    context.facts[0]?.statement,
    "A WhatsApp link is available on the site.",
  );
  assert.equal(
    context.facts[1]?.statement,
    "I couldn't find an online booking option in the pages checked.",
  );
  assert.equal(
    context.facts[2]?.statement,
    "I couldn't find a WhatsApp link in the static pages checked.",
  );
  assert.deepEqual(context.approvalEvidence, context.facts);
});

test("no head produces no signal language, so callers use their generic opener", () => {
  assert.deepEqual(buildQualificationDraftContext(null, NOW), {
    facts: [],
    approvalEvidence: [],
  });
});
