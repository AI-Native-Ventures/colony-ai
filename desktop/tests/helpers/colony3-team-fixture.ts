import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import { KIND_MEMBER_POSITION_HEAD } from "../../src/shared/constants/kinds";
import { installMockBridge, TEST_IDENTITIES } from "./bridge";

/**
 * The Colony 3.0 "Lerato Social" team (Team.dc.html): five AI employees and
 * four people, signed as company position records. Pubkeys of the AI
 * employees are fixed so specs can name them.
 */
export const COLONY3_TEAM_KEYS = {
  scout: getPublicKey(new Uint8Array(32).fill(21)),
  aya: getPublicKey(new Uint8Array(32).fill(22)),
  mina: getPublicKey(new Uint8Array(32).fill(23)),
  noor: getPublicKey(new Uint8Array(32).fill(24)),
  theo: getPublicKey(new Uint8Array(32).fill(25)),
} as const;

const OWNER = TEST_IDENTITIES.tyler.pubkey;
const NOLUTHANDO = TEST_IDENTITIES.alice.pubkey;
const SAM = TEST_IDENTITIES.bob.pubkey;
const JULES = TEST_IDENTITIES.charlie.pubkey;

type TeamRow = {
  pubkey: string;
  name: string;
  title: string;
  kind: "human" | "employee";
  managerPubkey?: string;
  status?: "active" | "paused";
  reason?: string;
  lifecycle?: "ready" | "failed" | "stopped";
};

/** Rows in the order the Team board lists them. */
export const COLONY3_TEAM_ROWS: TeamRow[] = [
  { pubkey: OWNER, name: "Lerato Molefe", title: "Founder", kind: "human" },
  {
    pubkey: COLONY3_TEAM_KEYS.scout,
    name: "Scout",
    title: "Chief of Staff",
    kind: "employee",
    managerPubkey: OWNER,
    lifecycle: "ready",
  },
  {
    pubkey: COLONY3_TEAM_KEYS.aya,
    name: "Aya",
    title: "Business Development",
    kind: "employee",
    managerPubkey: COLONY3_TEAM_KEYS.scout,
    lifecycle: "ready",
  },
  {
    pubkey: COLONY3_TEAM_KEYS.mina,
    name: "Mina",
    title: "Social Media Manager",
    kind: "employee",
    managerPubkey: NOLUTHANDO,
    status: "paused",
    reason: "Reviewing the workload.",
    lifecycle: "ready",
  },
  {
    pubkey: NOLUTHANDO,
    name: "Noluthando Khumalo",
    title: "Account Manager",
    kind: "human",
    managerPubkey: OWNER,
  },
  {
    pubkey: COLONY3_TEAM_KEYS.noor,
    name: "Noor",
    title: "Bookkeeper",
    kind: "employee",
    managerPubkey: OWNER,
    lifecycle: "failed",
  },
  {
    pubkey: COLONY3_TEAM_KEYS.theo,
    name: "Theo",
    title: "Software Engineer",
    kind: "employee",
    managerPubkey: COLONY3_TEAM_KEYS.scout,
    lifecycle: "ready",
  },
  {
    pubkey: SAM,
    name: "Sam Patel",
    title: "Designer",
    kind: "human",
    managerPubkey: NOLUTHANDO,
  },
  {
    pubkey: JULES,
    name: "Jules Adams",
    title: "Client Partner",
    kind: "human",
    managerPubkey: OWNER,
  },
];

const RELAY_URL = "ws://localhost:3000";

/** Seeds the mock bridge with the Team board's roster. Call before `page.goto`. */
export async function seedColony3Team(
  page: import("@playwright/test").Page,
  options: {
    /** Job titles also published on the people's profiles (kind:0 job_title). */
    profileJobTitles?: boolean;
    /** Replace a row, for state variations (a terminated Mina, say). */
    override?: (row: TeamRow) => TeamRow;
    /** Extra bridge options, such as the Colony 3.0 sidebar fixture. */
    bridge?: Record<string, unknown>;
  } = {},
) {
  const rows = COLONY3_TEAM_ROWS.map((row) => options.override?.(row) ?? row);
  const relaySecret = generateSecretKey();
  await page.addInitScript((identity) => {
    localStorage.setItem(
      "buzz:e2e-identity-override.v1",
      JSON.stringify(identity),
    );
  }, TEST_IDENTITIES.tyler);
  await installMockBridge(page, {
    ...options.bridge,
    relaySelf: getPublicKey(relaySecret),
    searchProfiles: rows.map((row) => ({
      pubkey: row.pubkey,
      displayName: row.name,
      ...(options.profileJobTitles && row.kind === "human"
        ? { jobTitle: row.title }
        : {}),
    })),
    // Agents are members of the community too, so the list keeps the board's order.
    relayMembers: rows.map((row) => ({
      pubkey: row.pubkey,
      role:
        row.pubkey === OWNER
          ? "owner"
          : row.kind === "employee"
            ? "bot"
            : "member",
    })),
    relayAgents: rows
      .filter((row) => row.kind === "employee")
      .map((row) => ({
        pubkey: row.pubkey,
        ownerPubkey: OWNER,
        name: row.name,
        agentType: "agent",
      })),
    managedAgents: rows
      .filter((row) => row.kind === "employee")
      .map((row) => ({
        pubkey: row.pubkey,
        name: row.name,
        status: row.lifecycle === "stopped" ? "stopped" : "running",
        channelNames: ["general"],
      })),
    managedAgentRuntimes: rows
      .filter((row) => row.kind === "employee")
      .map((row) => ({
        pubkey: row.pubkey,
        relayUrl: RELAY_URL,
        lifecycle: row.lifecycle ?? "ready",
      })),
    companyMemberPositionEvents: rows.map((row) =>
      finalizeEvent(
        {
          kind: KIND_MEMBER_POSITION_HEAD,
          created_at: Math.floor(
            new Date("2026-10-22T09:00:00Z").getTime() / 1000,
          ),
          tags: [["d", `company:member:${row.pubkey}`]],
          content: JSON.stringify({
            schemaVersion: 1,
            pubkey: row.pubkey,
            title: row.title,
            kind: row.kind,
            status: row.status ?? "active",
            ...(row.reason ? { reason: row.reason } : {}),
            ...(row.managerPubkey ? { managerPubkey: row.managerPubkey } : {}),
            sourceActionEventId: "b".repeat(64),
            updatedAt: "2026-10-22T09:00:00.000Z",
          }),
        },
        relaySecret,
      ),
    ),
  } as never);
  return { rows };
}

/** Puts Scout and Theo to work, so their rows read Working. Call after load. */
export async function seedColony3TeamWorking(
  page: import("@playwright/test").Page,
  channelId = "e2e-working-channel",
) {
  await page.waitForFunction(
    () => typeof window.__BUZZ_E2E_SEED_ACTIVE_TURNS__ === "function",
  );
  await page.evaluate(
    ({ pubkeys, channel }) => {
      const seed = window.__BUZZ_E2E_SEED_ACTIVE_TURNS__;
      if (!seed) return;
      for (const agentPubkey of pubkeys) {
        seed({
          agentPubkey,
          channelId: channel,
          turnId: `team-${agentPubkey.slice(0, 6)}`,
          startedAgoMs: 60_000,
        });
      }
    },
    {
      pubkeys: [COLONY3_TEAM_KEYS.scout, COLONY3_TEAM_KEYS.theo],
      channel: channelId,
    },
  );
}
