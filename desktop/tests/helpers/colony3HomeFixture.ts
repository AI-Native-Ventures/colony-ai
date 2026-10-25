import { bytesToHex } from "@noble/hashes/utils.js";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import type { RelayEvent } from "../../src/shared/api/types";
import { KIND_ASK_HEAD } from "../../src/shared/constants/kinds";
import { COLONY3_NOW } from "./colony3Fixture";
import { colony3At } from "./colony3Conversations";

/**
 * The open decisions the Today board shows for Lerato Social, as relay-signed
 * ask heads, plus the mock-bridge options that make the relay vouch for them.
 * Eight in all: one overdue, two today, two tomorrow and three with no
 * deadline, so the board's "Show 2 more" has something behind it.
 */
type AskSpec = {
  askId: string;
  title: string;
  channelId: string;
  asker: keyof typeof REFERENCE_AGENTS;
  type: "approval" | "question" | "choice" | "tool_consent";
  category: "general" | "money" | "tool";
  /** Minutes from the board's "now"; null for no deadline. */
  decideInMinutes: number | null;
};

/** The signed-in member's pubkey in the mock bridge: asks are addressed to it. */
const SELF = "deadbeef".repeat(8);

const MINUTE = 60_000;
const NOW = new Date(COLONY3_NOW).getTime();

const ASKS: AskSpec[] = [
  {
    askId: "c3000000-0000-4000-8000-000000000001",
    title: "Increase Olive Studio’s October allowance by USD 120",
    channelId: REFERENCE_CHANNEL_IDS.operations,
    asker: "scout",
    type: "approval",
    category: "money",
    // Thursday 22 October, 17:00 (the board's "1 overdue").
    decideInMinutes: -(16 * 60 + 55),
  },
  {
    askId: "c3000000-0000-4000-8000-000000000002",
    title: "Approve the October campaign",
    channelId: REFERENCE_CHANNEL_IDS.oliveHouse,
    asker: "mina",
    type: "approval",
    category: "general",
    decideInMinutes: 4 * 60 + 5,
  },
  {
    askId: "c3000000-0000-4000-8000-000000000003",
    title: "Connect social publishing",
    channelId: REFERENCE_CHANNEL_IDS.cedarCafe,
    asker: "theo",
    type: "tool_consent",
    category: "tool",
    decideInMinutes: 6 * 60 + 35,
  },
  {
    askId: "c3000000-0000-4000-8000-000000000004",
    title: "Weekly content plan",
    channelId: REFERENCE_CHANNEL_IDS.marketing,
    asker: "mina",
    type: "approval",
    category: "general",
    decideInMinutes: 23 * 60 + 5,
  },
  {
    askId: "c3000000-0000-4000-8000-000000000005",
    title: "Which client requirement should we prioritise?",
    channelId: REFERENCE_CHANNEL_IDS.sales,
    asker: "aya",
    type: "question",
    category: "general",
    decideInMinutes: 26 * 60 + 5,
  },
  {
    askId: "c3000000-0000-4000-8000-000000000006",
    title: "Choose the campaign direction",
    channelId: REFERENCE_CHANNEL_IDS.marketing,
    asker: "mina",
    type: "choice",
    category: "general",
    decideInMinutes: null,
  },
  {
    askId: "c3000000-0000-4000-8000-000000000007",
    title: "Pick the Cedar Café photo set",
    channelId: REFERENCE_CHANNEL_IDS.cedarCafe,
    asker: "mina",
    type: "choice",
    category: "general",
    decideInMinutes: null,
  },
  {
    askId: "c3000000-0000-4000-8000-000000000008",
    title: "Review the Northline brief",
    channelId: REFERENCE_CHANNEL_IDS.northline,
    asker: "aya",
    type: "question",
    category: "general",
    decideInMinutes: null,
  },
];

function askHead(spec: AskSpec, relaySecret: Uint8Array): RelayEvent {
  const askerPubkey = REFERENCE_AGENTS[spec.asker].pubkey;
  const threadRootEventId = spec.askId.replaceAll("-", "").padEnd(64, "a");
  const createdAt = new Date(NOW - 60 * MINUTE).toISOString();
  const decideBy =
    spec.decideInMinutes === null
      ? null
      : new Date(NOW + spec.decideInMinutes * MINUTE).toISOString();
  const options =
    spec.type === "choice"
      ? [
          { id: "a", label: "Slow spring" },
          { id: "b", label: "Harvest focus" },
        ]
      : null;
  const funding =
    spec.category === "money"
      ? {
          subject: { kind: "companyMember", id: askerPubkey },
          spendAllowanceProposal: {
            schemaVersion: 1,
            employeePubkey: askerPubkey,
            allowance: { amountCents: "12000", period: "month" },
            fundingOrder: [],
          },
        }
      : {};
  const toolConsent =
    spec.type === "tool_consent"
      ? {
          toolConsent: {
            action: "publish_publicly",
            actionPreview: "Publish the Cedar Café menu post.",
          },
        }
      : {};
  return finalizeEvent(
    {
      kind: KIND_ASK_HEAD,
      created_at: Math.floor(NOW / 1_000) - 3_600,
      tags: [
        ["d", `channel:${spec.channelId}:ask:${spec.askId}`],
        ["h", spec.channelId],
        ["e", threadRootEventId],
        ["t", spec.type],
      ],
      content: JSON.stringify({
        schemaVersion: 1,
        askId: spec.askId,
        status: "open",
        askerPubkey,
        createdAt,
        ask: {
          schemaVersion: 1,
          askId: spec.askId,
          type: spec.type,
          category: spec.category,
          title: spec.title,
          threadRootEventId,
          addresseePubkey: SELF,
          decideBy,
          options,
          ...funding,
          ...toolConsent,
        },
        resolution: null,
        cancellation: null,
        sourceActionEventId: "a".repeat(64),
      }),
    },
    relaySecret,
  ) as unknown as RelayEvent;
}

/** Recent work the Today board lists under Moving forward. */
function movingForward() {
  const item = (
    n: number,
    agent: keyof typeof REFERENCE_AGENTS,
    content: string,
    channelId: string,
    channelName: string,
    hour: number,
    minute: number,
  ) => ({
    id: (n.toString(16).padStart(2, "0") as string).repeat(32),
    kind: 9,
    pubkey: REFERENCE_AGENTS[agent].pubkey,
    content,
    created_at: colony3At(hour, minute),
    channel_id: channelId,
    channel_name: channelName,
    channel_type: null,
    tags: [["h", channelId]],
    category: "activity" as const,
  });
  return {
    activity: [
      item(
        0xb1,
        "mina",
        "Mina posted October carousel concepts for review",
        REFERENCE_CHANNEL_IDS.oliveHouse,
        "The Olive House",
        14,
        5,
      ),
      item(
        0xb2,
        "aya",
        "Aya prepared the Form & Field proposal, version 1",
        REFERENCE_CHANNEL_IDS.sales,
        "Sales",
        13,
        20,
      ),
      item(
        0xb3,
        "theo",
        "Theo’s run “Reconcile September costs” failed",
        REFERENCE_CHANNEL_IDS.operations,
        "Operations",
        11,
        48,
      ),
    ],
  };
}

/** Mock-bridge options that give the Today board its Needs me decisions. */
export function colony3TodayMockOptions() {
  const relaySecret = generateSecretKey();
  return {
    relaySelf: getPublicKey(relaySecret),
    companyAskRelayPrivateKeyHex: bytesToHex(relaySecret),
    companyAskHeads: ASKS.map((spec) => askHead(spec, relaySecret)),
    colony3Extras: { feed: movingForward() },
  };
}
