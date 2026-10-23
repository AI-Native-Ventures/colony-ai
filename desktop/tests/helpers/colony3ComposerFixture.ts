import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import { KIND_MEMBER_POSITION_HEAD } from "../../src/shared/constants/kinds";
import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import {
  COLONY3_EXTRA_AGENTS,
  COLONY3_PEOPLE,
  colony3At,
  colony3Extras,
} from "./colony3Conversations";

/**
 * Data for the composer fork's boards (Composer states, New message, Search,
 * Pins): the Lerato Social team as the design draws it, with job titles read
 * from relay-signed team positions and agents managed by Lerato.
 */

/** The mock bridge's signed-in user (Lerato Molefe). */
export const SELF_PUBKEY = "deadbeef".repeat(8);

const OLIVE = REFERENCE_CHANNEL_IDS.oliveHouse;
const { scout, aya, mina, theo } = REFERENCE_AGENTS;
const { noor, writer } = COLONY3_EXTRA_AGENTS;

type TitleOptions = { selfTitle?: string; omit?: string[] };

function titleMap(options: TitleOptions): Record<string, string> {
  const titles: Record<string, string> = {
    [scout.pubkey]: "Chief of Staff",
    [aya.pubkey]: "Business Development",
    [mina.pubkey]: "Social Media Manager",
    [theo.pubkey]: "Software Engineer",
    [noor.pubkey]: "Bookkeeper",
    [COLONY3_PEOPLE.noluthando.pubkey]: "Account Manager",
  };
  if (options.selfTitle) titles[SELF_PUBKEY] = options.selfTitle;
  for (const pubkey of options.omit ?? []) delete titles[pubkey];
  return titles;
}

/** Relay-signed team positions plus the directory they merge with. */
export function composerTeamOptions(options: TitleOptions = {}) {
  const relaySecret = generateSecretKey();
  const titles = titleMap(options);
  const agentKeys = new Set<string>([
    scout.pubkey,
    aya.pubkey,
    mina.pubkey,
    theo.pubkey,
    noor.pubkey,
    writer.pubkey,
  ]);
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
          kind: agentKeys.has(pubkey) ? "employee" : "human",
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
    relayMembers: [
      { pubkey: SELF_PUBKEY, role: "owner" as const },
      { pubkey: COLONY3_PEOPLE.noluthando.pubkey, role: "admin" as const },
      { pubkey: COLONY3_PEOPLE.sam.pubkey, role: "member" as const },
      { pubkey: COLONY3_PEOPLE.zinhle.pubkey, role: "member" as const },
    ],
    relayAgents: [scout, aya, mina, theo, noor].map((agent) => ({
      pubkey: agent.pubkey,
      ownerPubkey: SELF_PUBKEY,
      name: agent.name,
      agentType: "agent",
    })),
    managedAgents: [scout, aya, mina, theo, noor].map((agent) => ({
      pubkey: agent.pubkey,
      name: agent.name,
      status: "running" as const,
    })),
    personas: [mina, theo, noor].map((agent) => ({
      id: `colony3-${agent.name.toLowerCase()}`,
      displayName: agent.name,
      systemPrompt: `You are ${agent.name}.`,
    })),
    teams: [
      {
        id: "colony3-content-team",
        name: "Content team",
        personaIds: ["colony3-mina", "colony3-theo", "colony3-noor"],
      },
    ],
    replaceDefaultTeams: true,
  };
}

/** Agents the design lists as managed by Lerato (profiles carry the owner). */
export function composerProfiles() {
  return [scout, aya, mina, theo, noor].map((agent) => ({
    pubkey: agent.pubkey,
    displayName: agent.name,
    isAgent: true,
    ownerPubkey: SELF_PUBKEY,
    presence: "online" as const,
  }));
}

const sha = (seed: string) => seed.repeat(32).slice(0, 64);

/** Ids of the messages the boards act on (64 hex, so they can be pinned). */
export const COMPOSER_IDS = {
  root: sha("c0"),
  minaReply: sha("c1"),
  theo: sha("c2"),
  leratoEdit: sha("c3"),
  pinLerato: sha("d0"),
  pinMina: sha("d1"),
  pinNoluthando: sha("d2"),
  pinGone: sha("d3"),
  searchLerato: sha("d4"),
  searchScout: sha("d5"),
  searchMinaDm: sha("d6"),
};

export const COMPOSER_DM_IDS = {
  aya: "1e1a7000-0000-4000-8000-0000000000a1",
  mina: "1e1a7000-0000-4000-8000-0000000000a2",
};

/** The Olive House conversation the Composer states board shows behind it. */
export function composerOliveMessages() {
  const thread = (rootId: string) => [
    ["e", rootId, "", "root"],
    ["e", rootId, "", "reply"],
  ];
  return [
    {
      channelId: OLIVE,
      id: COMPOSER_IDS.root,
      pubkey: SELF_PUBKEY,
      createdAt: colony3At(14, 10),
      content: "Where are we with the October carousel?",
    },
    {
      channelId: OLIVE,
      id: COMPOSER_IDS.minaReply,
      pubkey: mina.pubkey,
      createdAt: colony3At(14, 20),
      tags: thread(COMPOSER_IDS.root),
      content: "Version 2 is up with the Saturday market line on slide two.",
    },
    {
      channelId: OLIVE,
      id: COMPOSER_IDS.theo,
      pubkey: theo.pubkey,
      createdAt: colony3At(14, 22),
      content: "Publishing check passed again. Ready to queue when you say so.",
    },
    {
      channelId: OLIVE,
      id: COMPOSER_IDS.leratoEdit,
      pubkey: SELF_PUBKEY,
      createdAt: colony3At(14, 30),
      content:
        "Go with the farm visit. Keep slide one simple and add the market line.",
    },
  ];
}

const OPERATIONS = REFERENCE_CHANNEL_IDS.operations;

/** The conversations the Search board's results come from. */
export function composerSearchMessages() {
  return [
    {
      channelId: OLIVE,
      id: COMPOSER_IDS.searchLerato,
      pubkey: SELF_PUBKEY,
      createdAt: colony3At(9, 12),
      content:
        "Let\u2019s keep a slower spring at The Olive House, focused on the courtyard and the seasonal menu.",
    },
    {
      channelId: OPERATIONS,
      id: COMPOSER_IDS.searchScout,
      pubkey: scout.pubkey,
      createdAt: colony3At(16, 40, 1),
      content: "Increase Olive Studio\u2019s October allowance by USD 120",
    },
    {
      channelId: COMPOSER_DM_IDS.mina,
      id: COMPOSER_IDS.searchMinaDm,
      pubkey: mina.pubkey,
      createdAt: colony3At(11, 5, 4),
      content: "The Olive House\u2019s next post is ready for review.",
    },
  ];
}

/** Direct messages with Aya and Mina, and the recency Search lists. */
export function composerDirectMessageChannels() {
  return [
    {
      id: COMPOSER_DM_IDS.aya,
      name: "Aya",
      channelType: "dm" as const,
      visibility: "private" as const,
      members: [{ pubkey: aya.pubkey }],
      lastMessageAt: colony3At(9, 43),
    },
    {
      id: COMPOSER_DM_IDS.mina,
      name: "Mina",
      channelType: "dm" as const,
      visibility: "private" as const,
      members: [{ pubkey: mina.pubkey }],
      lastMessageAt: colony3At(11, 5, 4),
    },
  ];
}

/** Recent activity as Search lists it: 5 minutes, 1 hour, 3 hours ago. */
export function composerRecency() {
  return {
    [OLIVE]: colony3At(9, 50),
    [REFERENCE_CHANNEL_IDS.sales]: colony3At(8, 55),
    [OPERATIONS]: colony3At(6, 55),
    [REFERENCE_CHANNEL_IDS.cedarCafe]: colony3At(9, 48, 2),
  };
}

export function composerExtras() {
  return {
    ...colony3Extras({
      profiles: composerProfiles(),
      channels: composerDirectMessageChannels(),
      messages: [...composerOliveMessages(), ...composerSearchMessages()],
    }),
    lastMessageAt: composerRecency(),
  };
}

/** The people New message offers (search results), with Noor and Zinhle. */
export function composerSearchProfiles() {
  return [
    ...[aya, mina, theo, noor, scout].map((agent) => ({
      pubkey: agent.pubkey,
      displayName: agent.name,
      isAgent: true,
      ownerPubkey: SELF_PUBKEY,
    })),
    ...Object.values(COLONY3_PEOPLE).map((person) => ({
      pubkey: person.pubkey,
      displayName: person.name,
    })),
  ];
}
