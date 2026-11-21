import assert from "node:assert/strict";
import test from "node:test";

const {
  BUSINESS_RECORD_PAGE_SIZE,
  BUSINESS_RECORD_RETRY_DELAYS_MS,
  MAX_BUSINESS_RECORD_PAGES,
  loadBusinessRecords,
} = await import("./businessRecordRelay.ts");
const {
  businessDTag,
  KIND_DISCOVERY_CAMPAIGN_HEAD,
  KIND_OUTREACH_LIST_HEAD,
  KIND_PROPOSAL_ACCEPTANCE,
  KIND_PROPOSAL_CONVERSION_RECEIPT,
  KIND_PROPOSAL_HEAD,
  KIND_PROPOSAL_VERSION,
  KIND_PROSPECT_HEAD,
  KIND_QUALIFY_OBSERVATION_HEAD,
  KIND_SERVICE_HEAD,
} = await import("./businessRecordContract.ts");

const CHANNEL = "sales-channel";
const COMMUNITY = "tenant-community";
const SELF = "a".repeat(64);
const PAGED_KINDS = [
  KIND_SERVICE_HEAD,
  KIND_PROSPECT_HEAD,
  KIND_PROPOSAL_HEAD,
  KIND_PROPOSAL_VERSION,
  KIND_PROPOSAL_ACCEPTANCE,
  KIND_PROPOSAL_CONVERSION_RECEIPT,
  KIND_OUTREACH_LIST_HEAD,
  KIND_DISCOVERY_CAMPAIGN_HEAD,
  KIND_QUALIFY_OBSERVATION_HEAD,
];

function eventId(index) {
  return index.toString(16).padStart(64, "0");
}

function prospectId(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function prospectEvent(index, options = {}) {
  const id = options.prospectId ?? prospectId(index);
  const displayName = options.displayName ?? `Prospect ${index}`;
  return {
    id: options.eventId ?? eventId(index),
    pubkey: SELF,
    kind: KIND_PROSPECT_HEAD,
    created_at: options.createdAt ?? 10_000 - index,
    tags: [
      ["h", CHANNEL],
      ["d", businessDTag(COMMUNITY, "prospect", id)],
    ],
    content: JSON.stringify({
      schemaVersion: 1,
      prospectId: id,
      status: "active",
      prospect: {
        prospectId: id,
        party: {
          partyId: id,
          partyType: "organization",
          displayName,
          externalIds: [],
        },
        industry: "Hospitality",
        vertical: "Guesthouses",
        website: null,
        contactName: null,
        location: null,
        email: null,
        phone: null,
        evidence: [],
        lastVerifiedAt: null,
        qualification: "unreviewed",
        saved: false,
        stage: "qualified",
        lostReason: null,
      },
      activities: [],
      sourceActionEventId: "b".repeat(64),
    }),
    sig: "c".repeat(128),
  };
}

function opaqueEvent(kind, index, createdAt = 10_000 - index) {
  return {
    id: eventId(kind * 100_000 + index),
    pubkey: SELF,
    kind,
    created_at: createdAt,
    tags: [
      ["h", CHANNEL],
      ["d", `business:${COMMUNITY}:opaque:${kind}:${index}`],
    ],
    content: "{}",
    sig: "c".repeat(128),
  };
}

function relayPage(events, filter) {
  return events
    .filter(
      (event) => filter.until === undefined || event.created_at <= filter.until,
    )
    .slice()
    .sort(
      (left, right) =>
        right.created_at - left.created_at || left.id.localeCompare(right.id),
    )
    .slice(0, filter.limit)
    .sort(
      (left, right) =>
        left.created_at - right.created_at || left.id.localeCompare(right.id),
    );
}

function loader(recordsByKind, options = {}) {
  const calls = [];
  const admissions = [];
  const attempts = new Map();
  const fetchPage = async (filter) => {
    calls.push(filter);
    const kind = filter.kinds[0];
    const attempt = (attempts.get(kind) ?? 0) + 1;
    attempts.set(kind, attempt);
    const error = options.errorFor?.(kind, attempt);
    if (error) throw error;
    return relayPage(recordsByKind.get(kind) ?? [], filter);
  };
  return {
    calls,
    admissions,
    attempts,
    dependencies: {
      fetchEvents: async (filter) => {
        admissions.push([filter]);
        return fetchPage(filter);
      },
      fetchEventsForFilters: async (filters) => {
        admissions.push([...filters]);
        const pages = await Promise.all(filters.map(fetchPage));
        return pages.flat();
      },
      getChannelMembers: async () => [{ pubkey: SELF, role: "owner" }],
      getRelaySelf: async () => SELF,
      sleep: options.sleep ?? (async () => {}),
    },
  };
}

async function load(recordsByKind, options) {
  const fake = loader(recordsByKind, options);
  const result = await loadBusinessRecords(
    CHANNEL,
    COMMUNITY,
    SELF,
    fake.dependencies,
  );
  return { ...fake, result };
}

test("loadBusinessRecords returns every one of 1,300 prospect heads", async () => {
  const prospects = Array.from({ length: 1_300 }, (_, index) =>
    prospectEvent(index),
  );
  const { calls, result } = await load(
    new Map([[KIND_PROSPECT_HEAD, prospects]]),
  );

  assert.equal(result.prospects.length, 1_300);
  assert.equal(new Set(result.prospects.map((row) => row.eventId)).size, 1_300);
  assert.equal(result.truncated.prospects, undefined);
  const prospectCalls = calls.filter(
    (filter) => filter.kinds[0] === KIND_PROSPECT_HEAD,
  );
  assert.equal(prospectCalls.length, 3);
  assert.equal(prospectCalls[0].limit, BUSINESS_RECORD_PAGE_SIZE);
  assert.equal(prospectCalls[0].until, undefined);
  assert.equal(prospectCalls[1].until, prospects[499].created_at);
});

test("2,001 prospect heads use two first-page batches and four continuations", async () => {
  const prospects = Array.from({ length: 2_001 }, (_, index) =>
    prospectEvent(index),
  );
  const { admissions, result } = await load(
    new Map([[KIND_PROSPECT_HEAD, prospects]]),
  );

  assert.equal(result.prospects.length, 2_001);
  assert.equal(result.truncated.prospects, undefined);
  assert.deepEqual(
    admissions.map((filters) => filters.length),
    [6, 3, 1, 1, 1, 1],
  );
  assert.deepEqual(
    admissions
      .slice(0, 2)
      .map((filters) => filters.map((filter) => filter.kinds[0])),
    [
      [
        KIND_SERVICE_HEAD,
        KIND_PROSPECT_HEAD,
        KIND_PROPOSAL_HEAD,
        KIND_PROPOSAL_VERSION,
        KIND_PROPOSAL_ACCEPTANCE,
        KIND_PROPOSAL_CONVERSION_RECEIPT,
      ],
      [
        KIND_OUTREACH_LIST_HEAD,
        KIND_DISCOVERY_CAMPAIGN_HEAD,
        KIND_QUALIFY_OBSERVATION_HEAD,
      ],
    ],
  );
  for (const filter of admissions.flat()) {
    assert.equal(filter.limit, BUSINESS_RECORD_PAGE_SIZE);
    assert.equal(filter.kinds.length, 1);
    assert.deepEqual(filter["#h"], [CHANNEL]);
  }
  for (const filter of admissions[1]) {
    assert.deepEqual(filter.authors, [SELF]);
  }
  for (const [filter] of admissions.slice(2)) {
    assert.equal(filter.kinds[0], KIND_PROSPECT_HEAD);
    assert.equal(typeof filter.until, "number");
  }
});

test("inclusive page edges retain same-second heads exactly once", async () => {
  const prospects = Array.from({ length: 502 }, (_, index) =>
    prospectEvent(index, {
      createdAt: index >= 497 ? 4_500 : 5_000 - index,
    }),
  );
  const { calls, result } = await load(
    new Map([[KIND_PROSPECT_HEAD, prospects]]),
  );

  assert.equal(result.prospects.length, 502);
  assert.equal(new Set(result.prospects.map((row) => row.eventId)).size, 502);
  assert.equal(
    calls.filter((filter) => filter.kinds[0] === KIND_PROSPECT_HEAD).length,
    2,
  );
});

test("a short page ends only that kind's paging loop", async () => {
  const prospects = Array.from({ length: 13 }, (_, index) =>
    prospectEvent(index),
  );
  const { calls, result } = await load(
    new Map([[KIND_PROSPECT_HEAD, prospects]]),
  );

  assert.equal(result.prospects.length, 13);
  assert.equal(
    calls.filter((filter) => filter.kinds[0] === KIND_PROSPECT_HEAD).length,
    1,
  );
});

test("the 40-page bound makes a prospect truncation visible", async () => {
  let page = 0;
  const calls = [];
  const result = await loadBusinessRecords(CHANNEL, COMMUNITY, SELF, {
    fetchEvents: async (filter) => {
      calls.push(filter);
      if (filter.kinds[0] !== KIND_PROSPECT_HEAD) return [];
      page += 1;
      return Array.from({ length: BUSINESS_RECORD_PAGE_SIZE }, (_, index) =>
        opaqueEvent(
          KIND_PROSPECT_HEAD,
          page * BUSINESS_RECORD_PAGE_SIZE + index,
          1_000_000 - page * BUSINESS_RECORD_PAGE_SIZE - index,
        ),
      );
    },
    getChannelMembers: async () => [{ pubkey: SELF, role: "owner" }],
    getRelaySelf: async () => SELF,
    sleep: async () => {},
  });

  assert.equal(page, MAX_BUSINESS_RECORD_PAGES);
  assert.equal(result.truncated.prospects, true);
  assert.equal(
    result.loaded.prospects,
    MAX_BUSINESS_RECORD_PAGES * BUSINESS_RECORD_PAGE_SIZE,
  );
  assert.equal(
    calls.filter((filter) => filter.kinds[0] === KIND_PROSPECT_HEAD).length,
    MAX_BUSINESS_RECORD_PAGES,
  );
});

test("a transport timeout retries twice then keeps the existing load error", async () => {
  const waits = [];
  const failure = new Error("Timed out while loading relay history.");
  const fake = loader(new Map(), {
    errorFor: (kind) => (kind === KIND_PROSPECT_HEAD ? failure : null),
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
    },
  });

  await assert.rejects(
    loadBusinessRecords(CHANNEL, COMMUNITY, SELF, fake.dependencies),
    failure,
  );
  assert.equal(fake.attempts.get(KIND_PROSPECT_HEAD), 3);
  assert.deepEqual(waits, [...BUSINESS_RECORD_RETRY_DELAYS_MS]);
});

test("the latest prospect head wins when old and new heads land on different pages", async () => {
  const sharedId = prospectId(9_999);
  const newer = prospectEvent(0, {
    createdAt: 5_000,
    displayName: "Newest head",
    prospectId: sharedId,
  });
  const fillers = Array.from({ length: 499 }, (_, index) =>
    prospectEvent(index + 1, { createdAt: 4_999 - index }),
  );
  const older = prospectEvent(9_999, {
    createdAt: 1,
    displayName: "Old head",
    prospectId: sharedId,
  });
  const { result } = await load(
    new Map([[KIND_PROSPECT_HEAD, [newer, ...fillers, older]]]),
  );

  const current = result.prospects.find(
    ({ record }) => record.prospectId === sharedId,
  );
  assert.equal(current?.record.prospect.party.displayName, "Newest head");
});

test("every other business record kind uses the same paged relay path", async () => {
  const recordsByKind = new Map(
    PAGED_KINDS.map((kind) => [
      kind,
      Array.from({ length: BUSINESS_RECORD_PAGE_SIZE + 1 }, (_, index) =>
        opaqueEvent(kind, index),
      ),
    ]),
  );
  const { calls } = await load(recordsByKind);

  for (const kind of PAGED_KINDS) {
    assert.equal(
      calls.filter((filter) => filter.kinds[0] === kind).length,
      2,
      `kind ${kind} should request a second inclusive page`,
    );
  }
});
