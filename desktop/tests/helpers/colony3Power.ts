import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

import type {
  AgentUsageSeries,
  AgentUsageSeriesBucket,
  ReportedUsage,
} from "../../src/shared/api/tauriArchive";
import type { RelayEvent } from "../../src/shared/api/types";
import {
  KIND_AI_SPEND_RECORD_HEAD,
  KIND_EMPLOYEE_AI_ALLOWANCE_HEAD,
  KIND_MEMBER_POSITION_HEAD,
} from "../../src/shared/constants/kinds";
import { REFERENCE_AGENTS } from "../../src/testing/e2eReferenceWorkspace";
import { COLONY3_NOW } from "./colony3Fixture";

/**
 * The AI spend and power data the Colony 3.0 boards show for Lerato Social:
 * five AI employees with weekly allowances and positions, what they used, two
 * external costs, and a week of usage reports. Everything is relay-signed with
 * a fixed test key so the fixture reads the same on every run.
 */
const RELAY_SECRET_HEX = "11".repeat(32);
const SELF_PUBKEY = "deadbeef".repeat(8);
const SOURCE_ACTION = "b".repeat(64);
const NOOR_PUBKEY = "e9e9".repeat(16);
const NANO = 1_000_000_000;

const EMPLOYEES = [
  {
    key: "scout",
    name: "Scout",
    pubkey: REFERENCE_AGENTS.scout.pubkey,
    title: "Chief of Staff",
    status: "active" as const,
  },
  {
    key: "aya",
    name: "Aya",
    pubkey: REFERENCE_AGENTS.aya.pubkey,
    title: "Business Development",
    status: "active" as const,
  },
  {
    key: "mina",
    name: "Mina",
    pubkey: REFERENCE_AGENTS.mina.pubkey,
    title: "Social Media Manager",
    status: "active" as const,
  },
  {
    key: "theo",
    name: "Theo",
    pubkey: REFERENCE_AGENTS.theo.pubkey,
    title: "Software Engineer",
    status: "active" as const,
  },
  {
    key: "noor",
    name: "Noor",
    pubkey: NOOR_PUBKEY,
    title: "Bookkeeper",
    status: "paused" as const,
  },
];

/** Dollars used this week, per employee; null leaves the turn unpriced. */
const USED: Record<string, number | null | "none"> = {
  scout: 12.4,
  aya: "none",
  mina: 8.15,
  theo: null,
  noor: 25,
};

const relaySecret = hexToBytes(RELAY_SECRET_HEX);
const now = new Date(COLONY3_NOW);

function signed(kind: number, tags: string[][], content: unknown): RelayEvent {
  return finalizeEvent(
    {
      kind,
      created_at: Math.floor(now.getTime() / 1_000) - 3_600,
      tags,
      content: JSON.stringify(content),
    },
    relaySecret,
  ) as unknown as RelayEvent;
}

function positionHeads() {
  return EMPLOYEES.map((employee) =>
    signed(
      KIND_MEMBER_POSITION_HEAD,
      [["d", `company:member:${employee.pubkey}`]],
      {
        schemaVersion: 1,
        pubkey: employee.pubkey,
        title: employee.title,
        kind: "employee",
        status: employee.status,
        sourceActionEventId: SOURCE_ACTION,
        updatedAt: now.toISOString(),
      },
    ),
  );
}

function allowanceHeads() {
  return EMPLOYEES.map((employee) =>
    signed(
      KIND_EMPLOYEE_AI_ALLOWANCE_HEAD,
      [["d", `company:employee-allowance:${employee.pubkey}`]],
      {
        schemaVersion: 1,
        employeePubkey: employee.pubkey,
        allowance: { amountCents: "2500", period: "week" },
        fundingOrder: ["provider_subscription", "provider_api_key"],
        actorPubkey: SELF_PUBKEY,
        updatedAt: now.toISOString(),
        sourceActionEventId: SOURCE_ACTION,
      },
    ),
  );
}

function hex64(seed: number) {
  return seed.toString(16).padStart(8, "0").repeat(8);
}

function spendHeads() {
  const reportedAt = new Date(now.getTime() - 26 * 3_600_000).toISOString();
  const events: RelayEvent[] = [];
  let seed = 1;
  for (const employee of EMPLOYEES) {
    const used = USED[employee.key];
    if (used === "none") continue;
    const sourceUsageEventId = hex64(seed++);
    events.push(
      signed(
        KIND_AI_SPEND_RECORD_HEAD,
        [["d", `company:ai-spend:usage:${sourceUsageEventId}`]],
        {
          schemaVersion: 1,
          recordId: `usage:${sourceUsageEventId}`,
          record: {
            recordType: "agent_turn",
            employeePubkey: employee.pubkey,
            model: "claude-sonnet-5-5",
            sourceUsageEventId,
            ...(used === null
              ? {}
              : { estimatedAmountNanoUsd: String(Math.round(used * NANO)) }),
            isEstimate: true,
            sourceOfFunds: "provider_subscription",
            reportedAt,
          },
          status: "active",
          actorPubkey: SELF_PUBKEY,
          updatedAt: reportedAt,
          sourceActionEventId: SOURCE_ACTION,
        },
      ),
    );
  }
  const costs = [
    {
      id: "c3c30000-0000-4000-8000-000000000001",
      provider: "OpenAI",
      description: "Team plan",
      costType: "subscription",
      actualCashCostCents: "999",
      recordedDate: "2026-11-01",
    },
    {
      id: "c3c30000-0000-4000-8000-000000000002",
      provider: "OpenRouter",
      description: "Credit top-up",
      costType: "credit_top_up",
      actualCashCostCents: "2000",
      recordedDate: "2026-10-14",
    },
  ];
  for (const cost of costs) {
    const { id, ...record } = cost;
    events.push(
      signed(
        KIND_AI_SPEND_RECORD_HEAD,
        [["d", `company:ai-spend:cost:${id}`]],
        {
          schemaVersion: 1,
          recordId: `cost:${id}`,
          record: { recordType: "external_cost", ...record },
          status: "active",
          actorPubkey: SELF_PUBKEY,
          updatedAt: now.toISOString(),
          sourceActionEventId: SOURCE_ACTION,
        },
      ),
    );
  }
  return events;
}

function usageOf(cost: number | null): ReportedUsage {
  const none = { value: null, incomplete: false };
  return {
    inputTokens: none,
    outputTokens: none,
    totalTokens: none,
    estimatedCostUsd: { value: cost, incomplete: cost === null },
    cacheReadTokens: none,
    cacheWriteTokens: none,
    freshInputTokens: none,
  };
}

/** Local midnight, `daysAgo` days before the board's today (Unix seconds). */
function dayStart(daysAgo: number) {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() - daysAgo);
  return Math.floor(day.getTime() / 1_000);
}

type ReportRow = {
  daysAgo: number;
  reports: number;
  cost: number | null;
  workTitle: string;
  source: string;
};

/** One bucket for a day; the extra fields are the optional report details. */
function bucket(row: ReportRow): AgentUsageSeriesBucket {
  const start = dayStart(row.daysAgo);
  return {
    start,
    end: start + 86_400,
    usage: usageOf(row.cost),
    reportCount: row.reports,
    hasUnknownUsage: row.cost === null,
    workTitle: row.workTitle,
    source: row.source,
  } as AgentUsageSeriesBucket;
}

function usageSeries(): AgentUsageSeries {
  const entry = (pubkey: string, rows: ReportRow[]) => ({
    agentPubkey: pubkey,
    usage: usageOf(null),
    buckets: rows.map(bucket),
    models: [],
    reportCount: rows.reduce((total, row) => total + row.reports, 0),
    hasUnknownUsage: false,
  });
  const agents = [
    entry(REFERENCE_AGENTS.scout.pubkey, []),
    entry(REFERENCE_AGENTS.mina.pubkey, [
      {
        daysAgo: 0,
        reports: 3,
        cost: 4.2,
        workTitle: "Prepare October carousel concepts",
        source: "OpenAI · Team plan",
      },
    ]),
    entry(REFERENCE_AGENTS.aya.pubkey, [
      {
        daysAgo: 0,
        reports: 2,
        cost: 2.85,
        workTitle: "Prepare Form & Field proposal",
        source: "OpenRouter",
      },
      {
        daysAgo: 4,
        reports: 1,
        cost: 1.3,
        workTitle: "Weekly research",
        source: "OpenAI · Team plan",
      },
    ]),
    entry(REFERENCE_AGENTS.theo.pubkey, [
      {
        daysAgo: 1,
        reports: 1,
        cost: null,
        workTitle: "Reconcile September costs",
        source: "Provider key",
      },
    ]),
    entry(NOOR_PUBKEY, [
      {
        daysAgo: 1,
        reports: 4,
        cost: 9.6,
        workTitle: "Revise Cedar captions",
        source: "OpenAI · Team plan",
      },
    ]),
  ];
  return {
    collectionEnabled: true,
    buckets: [],
    agents,
    coverage: {
      firstArchivedAt: null,
      lastArchivedAt: null,
      firstReportedAt: null,
      lastReportedAt: null,
      reportCount: 11,
      invalidReportCount: 0,
      hasUnknownUsage: true,
    },
    hasArchivedEvidence: null,
  };
}

/** Mock-bridge options for the AI spend boards; pass to `openLerato({ mock })`. */
export function colony3PowerMockOptions() {
  return {
    relaySelf: getPublicKey(relaySecret),
    companyMemberRelayPrivateKeyHex: bytesToHex(relaySecret),
    relayRequiresMembership: true,
    relayRole: "owner" as const,
    relayMembers: [
      { pubkey: SELF_PUBKEY, role: "owner" as const },
      ...EMPLOYEES.map((employee) => ({
        pubkey: employee.pubkey,
        role: "member" as const,
      })),
    ],
    relayAgents: EMPLOYEES.map((employee) => ({
      pubkey: employee.pubkey,
      ownerPubkey: SELF_PUBKEY,
      name: employee.name,
      agentType: "agent",
    })),
    searchProfiles: [
      {
        pubkey: NOOR_PUBKEY,
        displayName: "Noor",
        isAgent: true,
        ownerPubkey: SELF_PUBKEY,
      },
    ],
    companyMemberPositionEvents: positionHeads(),
    employeeAllowanceHeads: allowanceHeads(),
    aiSpendRecordHeads: spendHeads(),
    agentUsageSeries: usageSeries(),
  };
}
