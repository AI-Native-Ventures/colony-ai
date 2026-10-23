import { createHash } from "node:crypto";

import type { Page } from "@playwright/test";

import type { Colony3Extras } from "../../src/testing/e2eBridge";
import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import {
  COLONY3_PEOPLE,
  COLONY3_SELF,
  colony3At,
} from "./colony3Conversations";

/**
 * Messages for the timeline boards (Channel, Direct message, Thread, Channel
 * states, Channel join). The Channel board is The Olive House: a thread
 * yesterday, Mina's carousel concepts and Lerato's voice note today.
 */

type Message = NonNullable<Colony3Extras["messages"]>[number];

/** Event ids are 64 hex characters, as on the relay (reactions need it). */
export function eid(label: string): string {
  return createHash("sha256").update(label).digest("hex");
}

const olive = REFERENCE_CHANNEL_IDS.oliveHouse;
const { mina, theo, aya } = REFERENCE_AGENTS;

function threadTags(rootId: string, replyTo = rootId): string[][] {
  return [
    ["e", rootId, "", "root"],
    ["e", replyTo, "", "reply"],
  ];
}

function heart(id: string, targetId: string, pubkey: string, at: number) {
  return {
    channelId: olive,
    id,
    pubkey,
    createdAt: at,
    kind: 7,
    tags: [["e", targetId]],
    content: "❤️",
  } satisfies Message;
}

const IMAGE_SHAS = ["1".repeat(64), "2".repeat(64), "3".repeat(64)];
export const COLONY3_TILE_GRADIENTS = [
  ["#DCEFD9", "#F4E7C8"],
  ["#F6E1D3", "#EBD6EE"],
  ["#DDE6FA", "#F3E2EC"],
];

export function colony3ImageTag(index: number, alt: string): string[] {
  return [
    "imeta",
    `url http://localhost:3000/media/${IMAGE_SHAS[index]}.png`,
    "m image/png",
    `x ${IMAGE_SHAS[index]}`,
    "size 2048",
    "dim 540x400",
    `alt ${alt}`,
    `filename ${alt.toLowerCase().replaceAll(" ", "-")}.png`,
  ];
}

/** Serves the gradient tiles the board's images stand in for. */
export async function routeColony3Tiles(page: Page) {
  for (const [index, sha] of IMAGE_SHAS.entries()) {
    const [from, to] = COLONY3_TILE_GRADIENTS[index];
    await page.route(`**/media/${sha}.png`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="540" height="400" viewBox="0 0 540 400"><defs><linearGradient id="g" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="540" height="400" fill="url(#g)"/></svg>`,
      }),
    );
  }
}

export function oliveChannelBoardMessages(
  selfPubkey = COLONY3_SELF,
): Message[] {
  const root = eid("c3-olive-lerato-0912");
  return [
    {
      channelId: olive,
      id: root,
      pubkey: selfPubkey,
      createdAt: colony3At(9, 12, 1),
      tags: [["p", mina.pubkey]],
      content:
        "Let’s keep a slower spring focused on the people behind the produce. Fewer posts, better stories. @Mina can you take the October plan from here?",
    },
    heart(eid("c3-olive-heart-1"), root, selfPubkey, colony3At(9, 20, 1)),
    heart(
      eid("c3-olive-heart-2"),
      root,
      COLONY3_PEOPLE.noluthando.pubkey,
      colony3At(9, 25, 1),
    ),
    {
      channelId: olive,
      id: eid("c3-olive-reply-1"),
      pubkey: mina.pubkey,
      createdAt: colony3At(15, 20, 1),
      tags: threadTags(root),
      content: "Yes. I will draft three directions from the brief.",
    },
    {
      channelId: olive,
      id: eid("c3-olive-reply-2"),
      pubkey: COLONY3_PEOPLE.noluthando.pubkey,
      createdAt: colony3At(16, 10, 1),
      tags: threadTags(root),
      content: "Please keep the farm visit in. Nandi liked it.",
    },
    {
      channelId: olive,
      id: eid("c3-olive-reply-3"),
      pubkey: mina.pubkey,
      createdAt: colony3At(16, 40, 1),
      tags: threadTags(root),
      content: "Noted. I will lead with it.",
    },
    {
      channelId: olive,
      id: eid("c3-olive-mina-1358"),
      pubkey: mina.pubkey,
      createdAt: colony3At(13, 58),
      tags: [
        colony3ImageTag(0, "Farm visit"),
        colony3ImageTag(1, "Behind the counter"),
        colony3ImageTag(2, "Spring table"),
      ],
      content: `The Olive House’s next post is ready. I drafted three carousel concepts from the spring brief; the farm-visit story leads.\n\n${IMAGE_SHAS.map((sha, index) => `![${["Farm visit", "Behind the counter", "Spring table"][index]}](http://localhost:3000/media/${sha}.png)`).join("\n")}\n\n\`mina/october-carousel-concepts.md\``,
    },
    {
      channelId: olive,
      id: eid("c3-olive-lerato-1401"),
      pubkey: selfPubkey,
      createdAt: colony3At(14, 1),
      tags: [
        [
          "imeta",
          "url https://example.invalid/voice-note-c3.wav",
          "m audio/wav",
          "filename voice-note.wav",
          "duration 24",
          "transcript Please keep the first slide simple, and let Nandi approve the final caption before we schedule it.",
        ],
      ],
      content: "[Voice note](https://example.invalid/voice-note-c3.wav)",
    },
    {
      channelId: olive,
      id: eid("c3-olive-mina-1405"),
      pubkey: mina.pubkey,
      createdAt: colony3At(14, 5),
      tags: [["p", selfPubkey]],
      content:
        "@Lerato could you review the campaign before I schedule it? Then I’ll hand the captions to @Theo for the publishing check.",
    },
    {
      channelId: olive,
      id: eid("c3-olive-theo-1412"),
      pubkey: theo.pubkey,
      createdAt: colony3At(14, 12),
      tags: [],
      content:
        "The Olive House publishing account is connected. I’ll queue the carousel as soon as the approval is in.",
    },
  ];
}

const dmAya = REFERENCE_CHANNEL_IDS.ayaDm;

/** The Direct message board: Lerato and Aya, today, 12:40 to 13:20. */
export function ayaDirectMessages(selfPubkey = COLONY3_SELF): Message[] {
  return [
    {
      channelId: dmAya,
      id: eid("c3-dm-lerato-1240"),
      pubkey: selfPubkey,
      createdAt: colony3At(12, 40),
      content:
        "Before I review the prospects, can you check them against our service? Flag anyone who won’t need monthly social content.",
    },
    {
      channelId: dmAya,
      id: eid("c3-dm-aya-1252"),
      pubkey: aya.pubkey,
      createdAt: colony3At(12, 52),
      tags: [["p", REFERENCE_AGENTS.scout.pubkey]],
      content:
        "Done. Shops that only sell through marketplaces are marked as a weak fit, with a note on each profile. Form & Field looks strongest.\n\nI’ve asked @Scout to hold time for a first call once you’re happy with the shortlist.",
    },
    {
      channelId: dmAya,
      id: eid("c3-dm-lerato-1305"),
      pubkey: selfPubkey,
      createdAt: colony3At(13, 5),
      content:
        "Great. Please prepare a proposal for Form & Field on our standard service.",
    },
    {
      channelId: dmAya,
      id: eid("c3-dm-aya-1320"),
      pubkey: aya.pubkey,
      createdAt: colony3At(13, 20),
      content: "Version 1 is ready for your review.",
    },
  ];
}

export const AYA_DM_CHANNEL = {
  id: dmAya,
  name: "Aya",
  channelType: "dm" as const,
  visibility: "private" as const,
  members: [{ pubkey: aya.pubkey }],
  lastMessageAt: colony3At(13, 20),
};

/** The Thread board: "Spring content campaign" with six replies. */
export function springThreadMessages(selfPubkey = COLONY3_SELF): Message[] {
  const root = eid("c3-thread-root");
  return [
    {
      channelId: olive,
      id: root,
      pubkey: selfPubkey,
      createdAt: colony3At(13, 40),
      content:
        "# Spring content campaign\nLaunch posts, captions and a publishing schedule for the spring menu. Nandi reviews for the client before anything goes out.",
    },
    {
      channelId: olive,
      id: eid("c3-thread-r1"),
      pubkey: mina.pubkey,
      createdAt: colony3At(13, 58),
      tags: threadTags(root),
      content:
        "Drafted the launch posts and captions. The publishing schedule is in the canvas so Nandi can review everything in one place.",
    },
    {
      channelId: olive,
      id: eid("c3-thread-r2"),
      pubkey: selfPubkey,
      createdAt: colony3At(14, 1),
      tags: threadTags(root, eid("c3-thread-r1")),
      content: "Post two should lead with the Saturday market.",
    },
    {
      channelId: olive,
      id: eid("c3-thread-r3"),
      pubkey: mina.pubkey,
      createdAt: colony3At(14, 5),
      tags: threadTags(root, eid("c3-thread-r2")),
      content:
        "Updated. Version 2 is up with the Saturday market line on slide two.",
    },
    {
      channelId: olive,
      id: eid("c3-thread-r4"),
      pubkey: theo.pubkey,
      createdAt: colony3At(14, 9),
      tags: threadTags(root, eid("c3-thread-r1")),
      content: "Publishing check passed. Ready to queue when you say so.",
    },
    {
      channelId: olive,
      id: eid("c3-thread-r5"),
      pubkey: selfPubkey,
      createdAt: colony3At(14, 12),
      tags: threadTags(root, eid("c3-thread-r4")),
      content: "Thank you. Hold it until Nandi confirms.",
    },
    {
      channelId: olive,
      id: eid("c3-thread-r6"),
      pubkey: COLONY3_PEOPLE.nandi.pubkey,
      createdAt: colony3At(14, 20),
      tags: threadTags(root),
      content: "Can we see the captions first?",
    },
  ];
}

/** The Message actions board: three messages on top of a short thread. */
export function actionsBoardMessages(selfPubkey = COLONY3_SELF): Message[] {
  const root = eid("c3-actions-root");
  return [
    {
      channelId: olive,
      id: root,
      pubkey: mina.pubkey,
      createdAt: colony3At(13, 58),
      content:
        "Three carousel concepts from the spring brief. The farm-visit story leads.",
    },
    {
      channelId: olive,
      id: eid("c3-actions-reply-1"),
      pubkey: COLONY3_PEOPLE.noluthando.pubkey,
      createdAt: colony3At(14, 2),
      tags: threadTags(root),
      content: "Farm visit first, agreed.",
    },
    {
      channelId: olive,
      id: eid("c3-actions-reply-2"),
      pubkey: selfPubkey,
      createdAt: colony3At(14, 5),
      tags: threadTags(root),
      content:
        "Go with the farm visit. Keep slide one simple and add the market line.",
    },
    {
      channelId: olive,
      id: eid("c3-actions-nandi"),
      pubkey: COLONY3_PEOPLE.nandi.pubkey,
      createdAt: colony3At(14, 16),
      content:
        "Lovely. Could the caption on slide two mention the Saturday market? I’ll confirm the final wording tomorrow.",
    },
    {
      channelId: olive,
      id: eid("c3-actions-theo"),
      pubkey: theo.pubkey,
      createdAt: colony3At(14, 18),
      content:
        "Publishing check passed for all three slides. Nothing is scheduled until the caption is confirmed.",
    },
    {
      channelId: olive,
      id: eid("c3-actions-mina"),
      pubkey: mina.pubkey,
      createdAt: colony3At(14, 20),
      content:
        "I’ll add the Saturday market to slide two and post version 2 in the thread.",
    },
  ];
}

const marketing = REFERENCE_CHANNEL_IDS.marketing;

/** The Channel join board: #Marketing, an open channel the person has not joined. */
export function marketingMessages(): Message[] {
  const root = eid("c3-marketing-aya-0946");
  return [
    {
      channelId: marketing,
      id: eid("c3-marketing-sam-0940"),
      pubkey: COLONY3_PEOPLE.sam.pubkey,
      createdAt: colony3At(9, 40),
      tags: [["p", aya.pubkey]],
      content:
        "Kicking off the spring newsletter. @Aya can you pull together the client wins from last month?",
    },
    {
      channelId: marketing,
      id: root,
      pubkey: aya.pubkey,
      createdAt: colony3At(9, 46),
      content:
        "On it. I drafted a short section for The Olive House and Northline Interiors. The draft is in the canvas.",
    },
    {
      channelId: marketing,
      id: eid("c3-marketing-reply-1"),
      pubkey: COLONY3_PEOPLE.sam.pubkey,
      createdAt: colony3At(10, 5),
      tags: threadTags(root),
      content: "Perfect, thank you.",
    },
    {
      channelId: marketing,
      id: eid("c3-marketing-reply-2"),
      pubkey: mina.pubkey,
      createdAt: colony3At(10, 15),
      tags: threadTags(root),
      content: "I will read it before lunch.",
    },
    {
      channelId: marketing,
      id: eid("c3-marketing-mina-1022"),
      pubkey: mina.pubkey,
      createdAt: colony3At(10, 22),
      content:
        "Once Sam approves the copy I’ll turn the same wins into posts for next week.",
    },
    {
      channelId: marketing,
      id: eid("c3-marketing-sam-1031"),
      pubkey: COLONY3_PEOPLE.sam.pubkey,
      createdAt: colony3At(10, 31),
      content:
        "Looks good. Let’s keep the Northline piece short and lead with the photos.",
    },
  ];
}

/** The Channel states board: an archived channel with a closing exchange. */
export const WINTER_MENU_CHANNEL = {
  id: "1e1a7000-0000-4000-8000-000000000031",
  name: "Winter menu launch",
  channelType: "stream" as const,
  visibility: "private" as const,
  archived: true,
  members: [{ pubkey: REFERENCE_AGENTS.scout.pubkey }],
  lastMessageAt: colony3At(16, 52),
};

export function winterMenuMessages(selfPubkey = COLONY3_SELF): Message[] {
  return [
    {
      channelId: WINTER_MENU_CHANNEL.id,
      id: eid("c3-winter-scout"),
      pubkey: REFERENCE_AGENTS.scout.pubkey,
      createdAt: colony3At(16, 40),
      content: "Launch wrapped. The final recap is saved in the Work tab.",
    },
    {
      channelId: WINTER_MENU_CHANNEL.id,
      id: eid("c3-winter-lerato"),
      pubkey: selfPubkey,
      createdAt: colony3At(16, 52),
      content: "Thanks everyone. Archiving this one.",
    },
  ];
}
