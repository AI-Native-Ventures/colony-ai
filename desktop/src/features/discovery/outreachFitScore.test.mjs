import assert from "node:assert/strict";
import test from "node:test";

const {
  calculateOutreachFitScore,
  outreachNotContactedReason,
  OUTREACH_FIT_SIGNAL_WEIGHTS,
  OUTREACH_NOT_CONTACTED_REASON_CODES,
} = await import("./outreachFitScore.ts");

const LEAD_ID = "1e1a7000-0000-4000-9000-000000001002";
const RUN_ID = "d39cf188-319a-4efc-92cc-8c55c5f2d6d2";

function observed(signal, confidence = 1) {
  return {
    signal,
    state: "observed",
    value: signal,
    confidence,
    evidenceUrls: ["https://example.test/"],
    observedAt: 1_794_000_000,
    runId: RUN_ID,
    notCheckedReason: null,
    personalData: false,
  };
}

function qualification(observations = []) {
  return {
    schemaVersion: 1,
    leadId: LEAD_ID,
    runId: RUN_ID,
    checkedSignals: observations.map((item) => item.signal),
    observations,
    checkedAt: 1_794_000_000,
    sourceActionEventId: "a".repeat(64),
  };
}

function maps(ratingHundredths = null, reviewCount = null) {
  return { ratingHundredths, reviewCount, category: null, city: null };
}

test("fit score gives stored Maps reputation its documented bands", () => {
  const fit = calculateOutreachFitScore(maps(460, 58), qualification());

  assert.deepEqual(fit, {
    score: 18,
    parts: [
      {
        key: "maps_rating",
        label: "4.6 rating",
        points: 12,
        maximumPoints: 12,
      },
      {
        key: "maps_reviews",
        label: "58 reviews",
        points: 6,
        maximumPoints: 6,
      },
    ],
  });
});

test("fit score applies every Maps rating and review threshold", () => {
  for (const [ratingHundredths, expected] of [
    [450, 12],
    [400, 9],
    [350, 6],
    [300, 3],
    [299, 0],
  ]) {
    assert.equal(
      calculateOutreachFitScore(maps(ratingHundredths, null), qualification())
        ?.score,
      expected,
      `${String(ratingHundredths)} rating hundredths`,
    );
  }
  for (const [reviewCount, expected] of [
    [50, 6],
    [20, 4],
    [5, 2],
    [4, 0],
  ]) {
    assert.equal(
      calculateOutreachFitScore(maps(null, reviewCount), qualification())
        ?.score,
      expected,
      `${String(reviewCount)} reviews`,
    );
  }
});

test("fit score handles every scored signal through its stored confidence", () => {
  for (const [signal, weight] of Object.entries(OUTREACH_FIT_SIGNAL_WEIGHTS)) {
    const confidence = signal === "NO_WHATSAPP_LINK" ? 0.7 : 1;
    const fit = calculateOutreachFitScore(
      maps(),
      qualification([observed(signal, confidence)]),
    );
    const expected = Math.round(weight * confidence);
    assert.equal(fit?.score, expected, signal);
    if (expected === 0) {
      assert.deepEqual(fit?.parts, [], signal);
    } else {
      assert.deepEqual(fit?.parts[0], {
        key: signal,
        label: expectSignalLabel(signal),
        points: expected,
        maximumPoints: weight,
        confidence,
      });
    }
  }
});

test("fit score treats missing ratings and zero reviews as zero points", () => {
  assert.deepEqual(calculateOutreachFitScore(maps(null, 0), qualification()), {
    score: 0,
    parts: [],
  });
});

test("fit score bounds unexpected stored confidence before calculating points", () => {
  assert.equal(
    calculateOutreachFitScore(maps(), qualification([observed("SITE_DOWN", 2)]))
      ?.score,
    25,
  );
  assert.equal(
    calculateOutreachFitScore(
      maps(),
      qualification([observed("NO_WEBSITE", -1)]),
    )?.score,
    0,
  );
});

test("fit score stays unscored when a website check is absent or incomplete", () => {
  assert.equal(calculateOutreachFitScore(maps(460, 58), null), null);
  assert.equal(
    calculateOutreachFitScore(
      maps(460, 58),
      qualification([
        {
          ...observed("NO_WEBSITE"),
          state: "not_checked",
          value: null,
          confidence: 0,
          evidenceUrls: [],
          notCheckedReason: "blocked_by_site",
        },
      ]),
    ),
    null,
  );
});

test("fit score caps every combined stored signal at 100", () => {
  const fit = calculateOutreachFitScore(
    maps(460, 58),
    qualification(
      Object.keys(OUTREACH_FIT_SIGNAL_WEIGHTS).map((signal) =>
        observed(signal),
      ),
    ),
  );

  assert.equal(fit?.score, 100);
  assert.equal(
    fit?.parts.reduce((total, part) => total + part.points, 0),
    159,
  );
});

test("not-contacted reasons have a safe, single current reason", () => {
  const lowFit = { score: 48, parts: [] };
  assert.equal(
    outreachNotContactedReason({
      fit: lowFit,
      hasWhatsAppNumber: true,
      minimumFit: 60,
    })?.code,
    "below_minimum_fit",
  );
  assert.equal(
    outreachNotContactedReason({
      fit: lowFit,
      hasWhatsAppNumber: false,
      minimumFit: 60,
    })?.code,
    "no_whatsapp_number",
  );
  assert.equal(
    outreachNotContactedReason({
      fit: null,
      hasWhatsAppNumber: true,
      minimumFit: 60,
    })?.code,
    "not_checked",
  );
  assert.equal(
    outreachNotContactedReason({
      fit: lowFit,
      hasWhatsAppNumber: true,
      minimumFit: null,
    }),
    null,
  );
  assert.equal(
    outreachNotContactedReason({
      fit: null,
      hasWhatsAppNumber: true,
      minimumFit: null,
    }),
    null,
  );
  for (const invalidMinimumFit of [0, 101, 60.5]) {
    assert.equal(
      outreachNotContactedReason({
        fit: lowFit,
        hasWhatsAppNumber: true,
        minimumFit: invalidMinimumFit,
      }),
      null,
      `invalid minimum ${String(invalidMinimumFit)} stays off`,
    );
  }
});

test("not-contacted reason enum reserves the future safety states", () => {
  assert.deepEqual(OUTREACH_NOT_CONTACTED_REASON_CODES, [
    "below_minimum_fit",
    "no_whatsapp_number",
    "not_checked",
    "opted_out",
    "never_contact_list",
    "already_in_conversation",
  ]);
});

function expectSignalLabel(signal) {
  return {
    NO_WEBSITE: "No website",
    SITE_DOWN: "Website not loading",
    NO_HTTPS: "Not secure (no padlock)",
    NOT_MOBILE_FRIENDLY: "Hard to use on a phone",
    NO_ONLINE_BOOKING: "No online booking found",
    NO_WHATSAPP_LINK: "No WhatsApp button found",
    HAS_WHATSAPP_LINK: "Has a WhatsApp button",
    RUNNING_ADS: "Paying for ads",
    STALE_SITE: "Looks out of date",
    SITE_BUILDER: "Built with a site builder",
    INCUMBENT_BUILDER: "Built by another provider",
    SOCIAL_LINKS: "Social pages found",
    PUBLIC_EMAIL: "Public contact email",
  }[signal];
}
