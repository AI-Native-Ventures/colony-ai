import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_QUALIFY_SELECTION,
  QUALIFY_SIGNALS,
  RECOMMENDED_QUALIFY_SIGNALS,
  extractQualificationSignals,
  qualificationFollowupLinks,
} from "./extractors.mjs";

const NOW = Date.UTC(2026, 10, 7) / 1_000;
const WEBSITE = "https://olive.example/";

function page(html, url = WEBSITE) {
  return { url, html };
}

function run(signal, overrides = {}) {
  return extractQualificationSignals({
    selectedSignals: [signal],
    maps: { website: WEBSITE },
    pages: [page("<meta name=viewport content=width=device-width>")],
    outcome: { kind: "success" },
    finalProtocol: "https:",
    observedAt: NOW,
    ...overrides,
  });
}

function hasSignal(result, signal) {
  return (
    result.observations.find((observation) => observation.signal === signal) ??
    null
  );
}

test("selection starts off and the recommended shortcut is the first seven signals", () => {
  assert.deepEqual(DEFAULT_QUALIFY_SELECTION, { enabled: false, signals: [] });
  assert.deepEqual(RECOMMENDED_QUALIFY_SIGNALS, QUALIFY_SIGNALS.slice(0, 7));
});

test("each v1 signal has a positive and negative extractor fixture", () => {
  const cases = [
    ["NO_WEBSITE", { maps: { website: null } }, { maps: { website: WEBSITE } }],
    ["SITE_DOWN", { outcome: { kind: "failed", reason: "site_down" } }, {}],
    ["NO_HTTPS", { finalProtocol: "http:" }, {}],
    [
      "NOT_MOBILE_FRIENDLY",
      { pages: [page("<html><body>Fixed page</body></html>")] },
      {},
    ],
    [
      "NO_ONLINE_BOOKING",
      { pages: [page("<html>No appointment route</html>")] },
      { pages: [page('<a href="https://calendly.com/olive">Book</a>')] },
    ],
    [
      "NO_WHATSAPP_LINK",
      { pages: [page("<html>No contact app</html>")] },
      { pages: [page('<a href="https://wa.me/27115550100">WhatsApp</a>')] },
    ],
    [
      "HAS_WHATSAPP_LINK",
      { pages: [page('<a href="https://wa.me/27115550100">WhatsApp</a>')] },
      { pages: [page("<html>No contact app</html>")] },
    ],
    ["RUNNING_ADS", { pages: [page("<script>fbq('init', 'x')</script>")] }, {}],
    [
      "STALE_SITE",
      { pages: [page("<footer>Copyright 2020 Olive</footer>")] },
      { pages: [page("<footer>Copyright 2026 Olive</footer>")] },
    ],
    [
      "SITE_BUILDER",
      { pages: [page('<meta name="generator" content="WordPress">')] },
      {},
    ],
    [
      "INCUMBENT_BUILDER",
      { pages: [page("<footer>Website by Bright Studio</footer>")] },
      {},
    ],
    [
      "SOCIAL_LINKS",
      { pages: [page('<a href="https://instagram.com/olive">Instagram</a>')] },
      {},
    ],
    [
      "PUBLIC_EMAIL",
      {
        pages: [
          page(
            "<a href=mailto:jane.doe@olive.example>jane.doe@olive.example</a>",
          ),
        ],
      },
      {},
    ],
  ];
  for (const [signal, positive, negative] of cases) {
    assert.ok(hasSignal(run(signal, positive), signal), `${signal} positive`);
    assert.equal(
      hasSignal(run(signal, negative), signal),
      null,
      `${signal} negative`,
    );
  }
});

test("negative content facts are never emitted after blocked, down, or oversized outcomes", () => {
  for (const outcome of [
    { kind: "blocked", reason: "blocked_by_site" },
    { kind: "failed", reason: "site_down" },
    { kind: "failed", reason: "body_too_large" },
  ]) {
    const result = extractQualificationSignals({
      selectedSignals: [
        "NO_ONLINE_BOOKING",
        "NO_WHATSAPP_LINK",
        "NOT_MOBILE_FRIENDLY",
      ],
      maps: { website: WEBSITE },
      pages: [],
      outcome,
      observedAt: NOW,
    });
    assert.ok(
      result.observations.every(
        (observation) => observation.state === "not_checked",
      ),
    );
  }
});

test("no WhatsApp evidence is capped at likely confidence because scripts are not executed", () => {
  const result = run("NO_WHATSAPP_LINK", {
    pages: [page("<script>addWhatsappButton()</script>")],
  });
  assert.equal(hasSignal(result, "NO_WHATSAPP_LINK")?.confidence, 0.7);
});

test("public personal-looking email is flagged while generic inboxes are not", () => {
  const personal = run("PUBLIC_EMAIL", {
    pages: [page("<p>jane.doe@olive.example</p>")],
  });
  assert.equal(hasSignal(personal, "PUBLIC_EMAIL")?.personalData, true);
  const generic = run("PUBLIC_EMAIL", {
    pages: [page("<p>hello@olive.example</p>")],
  });
  assert.equal(hasSignal(generic, "PUBLIC_EMAIL")?.personalData, false);
});

test("follow-up selection stays on the same site and within four allowed pages", () => {
  const links = qualificationFollowupLinks(
    page(`
      <a href="/contact">Contact</a><a href="/about">About</a>
      <a href="/booking">Booking</a><a href="/careers">Careers</a>
      <a href="/jobs">Jobs</a><a href="https://other.example/contact">Other</a>
    `),
  );
  assert.deepEqual(links, [
    "https://olive.example/contact",
    "https://olive.example/about",
    "https://olive.example/booking",
    "https://olive.example/careers",
  ]);
});
