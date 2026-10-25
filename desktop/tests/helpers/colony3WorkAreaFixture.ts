import { mkdir, mkdtemp, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateSecretKey } from "nostr-tools/pure";

import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import { channelWorkHeadEvent } from "./companyWork";
import {
  colony3At,
  colony3Extras,
  colony3PositionOptions,
} from "./colony3Conversations";

/** The file the ChannelWorkArea board shows open, relative to the workspace root. */
export const COLONY3_WORK_AREA_FILE = "mina/october-carousel-concepts.md";

/**
 * The board's document. `Lead` in backticks inside a heading is the status
 * chip, and a section called "Open questions" is the callout box.
 */
export const COLONY3_WORK_AREA_MARKDOWN = `# October carousel concepts

For The Olive House · spring content campaign. Three concepts, five slides each. Slower, story-led, fewer posts.

## 1. Farm visit \`Lead\`

Morning on the farm with the family who press the oil. Opens on the olive rows, closes on the first pour at the counter.

- Slide 1: the rows at first light, one line of text only.
- Slide 2: hands at the press, with the harvest date.
- Slide 5: “Taste it at the counter this week.”

## 2. Behind the counter

The people serving, in their own words. Each slide is one short quote.

## 3. Spring table

A simple spring table set with the house range, shot top-down.

## Open questions

Nandi approves the final caption before anything is scheduled.

Posting days: [CONFIRM WITH CLIENT]
`;

/** A real temp workspace holding Mina's October file, written at 13:57. */
export async function createColony3WorkAreaWorkspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "colony-e2e-workarea-"));
  await mkdir(path.join(root, "mina"));
  const file = path.join(root, COLONY3_WORK_AREA_FILE);
  await writeFile(file, COLONY3_WORK_AREA_MARKDOWN);
  const written = new Date(colony3At(13, 57) * 1000);
  await utimes(file, written, written);
  await writeFile(
    path.join(root, "mina/spring-brief.md"),
    "# Spring brief\n\nSlower, story-led, fewer posts.",
  );
  return root;
}

/** Mina's two messages beside the open work area, 13:58 and 14:03 today. */
export function colony3WorkAreaMessages() {
  const channelId = REFERENCE_CHANNEL_IDS.oliveHouse;
  return [
    {
      channelId,
      id: "colony3-workarea-mina-1358",
      pubkey: REFERENCE_AGENTS.mina.pubkey,
      createdAt: colony3At(13, 58),
      content: `The Olive House’s next post is ready. I drafted three carousel concepts from the spring brief.\n\n\`${COLONY3_WORK_AREA_FILE}\``,
    },
    {
      channelId,
      id: "colony3-workarea-lerato-1403",
      pubkey: "self",
      createdAt: colony3At(14, 3),
      content:
        "Farm visit first, agreed. Let’s add the harvest date to slide two.",
    },
  ];
}

/** Bridge options for the work area board: the Lerato Social fixture plus Mina's local workspace. */
export function colony3WorkAreaBridgeOptions() {
  const relaySecret = generateSecretKey();
  const channelId = REFERENCE_CHANNEL_IDS.oliveHouse;
  return {
    referenceWorkspace: true,
    colony3Sidebar: true,
    windowFullscreen: true,
    ...colony3PositionOptions(undefined, relaySecret),
    // "Work 2": two open commitments in The Olive House.
    companyWorkRelayPrivateKey: bytesToHex(relaySecret),
    companyWorkEvents: [
      channelWorkHeadEvent(relaySecret, {
        channelId,
        workItemId: "11111111-1111-4111-8111-1111111111a1",
        title: "Produce the spring content campaign",
        ownerPubkey: REFERENCE_AGENTS.mina.pubkey,
      }),
      channelWorkHeadEvent(relaySecret, {
        channelId,
        workItemId: "11111111-1111-4111-8111-1111111111a2",
        title: "Prepare October carousel concepts",
        ownerPubkey: REFERENCE_AGENTS.mina.pubkey,
      }),
    ],
    managedAgents: [
      {
        pubkey: REFERENCE_AGENTS.mina.pubkey,
        name: REFERENCE_AGENTS.mina.name,
        status: "running" as const,
        channelNames: ["The Olive House"],
      },
    ],
    colony3Extras: colony3Extras({
      clearMessageChannelIds: [REFERENCE_CHANNEL_IDS.oliveHouse],
      messages: colony3WorkAreaMessages(),
    }),
  };
}
