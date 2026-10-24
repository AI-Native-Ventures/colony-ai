import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import { KIND_MEMBER_POSITION_HEAD } from "../../src/shared/constants/kinds";
import type { Colony3Extras } from "../../src/testing/e2eBridge";
import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import { COLONY3_NOW } from "./colony3Fixture";

/**
 * Shared data for the Colony 3.0 conversation boards (Channel, Direct message,
 * Thread, Composer states, dialogs, Search, Pins, work area). Each board's proof
 * spec composes `colony3ConversationBridge()` with its own messages; nothing
 * here is specific to one board.
 */

/** People the conversation boards show besides Lerato and the reference agents. */
export const COLONY3_PEOPLE = {
  noluthando: { name: "Noluthando Khumalo", pubkey: "e1".repeat(32) },
  sam: { name: "Sam Patel", pubkey: "e2".repeat(32) },
  zinhle: { name: "Zinhle Dlamini", pubkey: "e3".repeat(32) },
  nandi: { name: "Nandi", pubkey: "e4".repeat(32) },
} as const;

/** Agents the boards show besides the reference Scout, Aya, Mina and Theo. */
export const COLONY3_EXTRA_AGENTS = {
  noor: { name: "Noor", pubkey: "e5".repeat(32) },
  writer: { name: "Writer", pubkey: "e6".repeat(32) },
} as const;

/** Unix seconds of today at `hour:minute` in the board's clock (see COLONY3_NOW). */
export function colony3At(hour: number, minute: number, daysAgo = 0): number {
  const base = new Date(COLONY3_NOW);
  // The boards run on the design's Friday 23 October in South Africa (UTC+2).
  const day = new Date(
    Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth(),
      base.getUTCDate() - daysAgo,
      hour - 2,
      minute,
    ),
  );
  return Math.floor(day.getTime() / 1000);
}

/** Job titles, as the Team records give them. Lerato has none on most boards. */
export const COLONY3_JOB_TITLES: Record<string, string> = {
  [REFERENCE_AGENTS.scout.pubkey]: "Chief of Staff",
  [REFERENCE_AGENTS.aya.pubkey]: "Business Development",
  [REFERENCE_AGENTS.mina.pubkey]: "Social Media Manager",
  [REFERENCE_AGENTS.theo.pubkey]: "Software Engineer",
  [COLONY3_EXTRA_AGENTS.noor.pubkey]: "Bookkeeper",
  [COLONY3_PEOPLE.noluthando.pubkey]: "Account Manager",
};

/** The Olive House roster: six members, as the Channel and Members boards show. */
export function colony3OliveMembers(): NonNullable<Colony3Extras["members"]> {
  const channelId = REFERENCE_CHANNEL_IDS.oliveHouse;
  return [
    { channelId, pubkey: COLONY3_PEOPLE.noluthando.pubkey, role: "admin" },
    { channelId, pubkey: COLONY3_PEOPLE.sam.pubkey, role: "member" },
    { channelId, pubkey: REFERENCE_AGENTS.theo.pubkey, role: "member" },
    { channelId, pubkey: COLONY3_EXTRA_AGENTS.noor.pubkey, role: "member" },
  ];
}

/** People and agents the boards need as profiles. */
export function colony3Profiles(): NonNullable<Colony3Extras["profiles"]> {
  return [
    ...Object.values(COLONY3_PEOPLE).map((person) => ({
      pubkey: person.pubkey,
      displayName: person.name,
      presence: "online" as const,
    })),
    ...Object.values(COLONY3_EXTRA_AGENTS).map((agent) => ({
      pubkey: agent.pubkey,
      displayName: agent.name,
      isAgent: true,
    })),
  ];
}

/**
 * Relay-signed team positions, so message headers can read job titles. Returns
 * the options to spread into `installMockBridge`'s first argument.
 */
export function colony3PositionOptions(
  titles: Record<string, string> = COLONY3_JOB_TITLES,
) {
  const relaySecret = generateSecretKey();
  const events = Object.entries(titles).map(([pubkey, title]) =>
    finalizeEvent(
      {
        kind: KIND_MEMBER_POSITION_HEAD,
        created_at: colony3At(8, 0, 30),
        tags: [["d", `company:member:${pubkey}`]],
        content: JSON.stringify({
          schemaVersion: 1,
          pubkey,
          title,
          kind:
            Object.values(REFERENCE_AGENTS).some(
              (agent) => agent.pubkey === pubkey,
            ) ||
            Object.values(COLONY3_EXTRA_AGENTS).some(
              (agent) => agent.pubkey === pubkey,
            )
              ? "employee"
              : "human",
          status: "active",
          sourceActionEventId: "b".repeat(64),
          updatedAt: "2026-09-23T08:00:00.000Z",
        }),
      },
      relaySecret,
    ),
  );
  return {
    relaySelf: getPublicKey(relaySecret),
    companyMemberPositionEvents: events,
  };
}

/** Merges a board's own records over the shared people and channels. */
export function colony3Extras(own: Partial<Colony3Extras> = {}): Colony3Extras {
  return {
    profiles: [...colony3Profiles(), ...(own.profiles ?? [])],
    channels: own.channels ?? [],
    members: [...colony3OliveMembers(), ...(own.members ?? [])],
    leaveChannelIds: own.leaveChannelIds ?? [],
    messages: own.messages ?? [],
  };
}
