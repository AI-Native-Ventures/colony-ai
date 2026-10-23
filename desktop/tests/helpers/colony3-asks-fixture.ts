import type { Page } from "@playwright/test";

import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import { installMockBridge, TEST_IDENTITIES } from "./bridge";
import { COLONY3_NOW } from "./colony3Fixture";

type MockBridgeOptions = NonNullable<Parameters<typeof installMockBridge>[1]>;

/** People the Raise-an-ask boards name next to Lerato Molefe (the signed-in owner). */
export const ASK_PEOPLE = {
  noluthando: {
    pubkey: TEST_IDENTITIES.alice.pubkey,
    name: "Noluthando Khumalo",
    jobTitle: "Account Manager",
  },
  sam: {
    pubkey: TEST_IDENTITIES.bob.pubkey,
    name: "Sam Patel",
    jobTitle: "Designer",
  },
} as const;

/** The board's Olive House threads, newest first. */
export const ASK_THREADS = {
  october: {
    title: "October content calendar",
    startedAt: "2026-10-23T13:52:00+02:00",
  },
  spring: {
    title: "Spring campaign brief",
    startedAt: "2026-10-21T10:20:00+02:00",
  },
  photo: {
    title: "Photo shoot logistics",
    startedAt: "2026-10-19T15:05:00+02:00",
  },
} as const;

const seconds = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

/**
 * Opens the Lerato Social fixture ready for a Raise-an-ask board: the clock
 * fixed to the design's Friday, Noluthando and Sam known by name, and the
 * Olive House threads of the AskNew board seeded.
 */
export async function openAsksBoard(
  page: Page,
  options: {
    route: string;
    mock?: Partial<MockBridgeOptions>;
    /** Seed the three Olive House threads (default). */
    threads?: boolean;
  },
) {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.clock.setFixedTime(new Date(COLONY3_NOW));
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    windowFullscreen: true,
    searchProfiles: Object.values(ASK_PEOPLE).map((person) => ({
      pubkey: person.pubkey,
      displayName: person.name,
      jobTitle: person.jobTitle,
    })),
    ...options.mock,
  });
  await page.goto("/#/today");
  await page.waitForFunction(
    () =>
      typeof window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__ === "function" &&
      typeof window.__BUZZ_E2E_MUTATE_CHANNEL__ === "function",
  );
  const ids = await page.evaluate(
    ({ channelId, members, threads, seed, minaPubkey }) => {
      const mutate = window.__BUZZ_E2E_MUTATE_CHANNEL__;
      const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      if (!mutate || !emit) throw new Error("The mock seams are unavailable.");
      for (const channel of [channelId.olive, channelId.operations]) {
        mutate({
          channelId: channel,
          addMembers: members.map((pubkey) => ({ pubkey, role: "member" })),
        });
      }
      const roots: Record<string, string> = {};
      if (seed) {
        for (const [key, thread] of Object.entries(threads)) {
          const author =
            key === "october"
              ? minaPubkey
              : key === "photo"
                ? members[0]
                : undefined;
          const event = emit({
            channelName: "The Olive House",
            content: `# ${thread.title}\nThe plan for this thread.`,
            createdAt: thread.startedAt,
            ...(author ? { pubkey: author } : {}),
          });
          roots[key] = event.id;
        }
      }
      return roots;
    },
    {
      channelId: {
        olive: REFERENCE_CHANNEL_IDS.oliveHouse,
        operations: REFERENCE_CHANNEL_IDS.operations,
      },
      members: [ASK_PEOPLE.noluthando.pubkey, ASK_PEOPLE.sam.pubkey],
      seed: options.threads !== false,
      threads: {
        october: {
          title: ASK_THREADS.october.title,
          startedAt: seconds(ASK_THREADS.october.startedAt),
        },
        spring: {
          title: ASK_THREADS.spring.title,
          startedAt: seconds(ASK_THREADS.spring.startedAt),
        },
        photo: {
          title: ASK_THREADS.photo.title,
          startedAt: seconds(ASK_THREADS.photo.startedAt),
        },
      },
      minaPubkey: REFERENCE_AGENTS.mina.pubkey,
    },
  );
  await page.goto(options.route);
  return ids;
}
