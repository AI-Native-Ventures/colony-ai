import { bytesToHex } from "@noble/hashes/utils.js";
import type { Page } from "@playwright/test";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import {
  REFERENCE_AGENTS,
  REFERENCE_CHANNEL_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import {
  KIND_EMPLOYEE_AI_ALLOWANCE_HEAD,
  KIND_MEMBER_POSITION_HEAD,
} from "../../src/shared/constants/kinds";
import { installMockBridge, TEST_IDENTITIES } from "./bridge";
import { COLONY3_NOW } from "./colony3Fixture";

type MockBridgeOptions = NonNullable<Parameters<typeof installMockBridge>[1]>;

/**
 * People the Raise-an-ask boards name next to Lerato Molefe (the signed-in
 * owner). Bob and the outsider are the mock bridge's two human identities
 * (alice and charlie are agents there).
 */
export const ASK_PEOPLE = {
  noluthando: {
    pubkey: TEST_IDENTITIES.bob.pubkey,
    name: "Noluthando Khumalo",
    jobTitle: "Account Manager",
  },
  sam: {
    pubkey: TEST_IDENTITIES.outsider.pubkey,
    name: "Sam Patel",
    jobTitle: "Designer",
  },
} as const;

/**
 * The board's three threads, newest first. The fixture's Olive House already
 * carries its own two threads, so the boards are staged in Northline Interiors
 * (also a private client channel) and the channel name is the one difference.
 */
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
    /** Seed the three board threads (default). */
    threads?: boolean;
    /** Add Noluthando and Sam to the staged channels (default). */
    people?: boolean;
    /** More thread roots to seed: key, channel name and title. */
    extraThreads?: Array<{
      key: string;
      channelName: string;
      title: string;
      startedAt?: string;
    }>;
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
    ({ channelId, members, threads, seed, minaPubkey, extra }) => {
      const mutate = window.__BUZZ_E2E_MUTATE_CHANNEL__;
      const emit = window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      if (!mutate || !emit) throw new Error("The mock seams are unavailable.");
      for (const channel of [channelId.threads, channelId.operations]) {
        if (members.length === 0) break;
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
            channelName: "Northline Interiors",
            content: `# ${thread.title}\nThe plan for this thread.`,
            createdAt: thread.startedAt,
            ...(author ? { pubkey: author } : {}),
          });
          roots[key] = event.id;
        }
      }
      for (const thread of extra) {
        const event = emit({
          channelName: thread.channelName,
          content: `# ${thread.title}\nThe plan for this thread.`,
          createdAt: thread.startedAt,
        });
        roots[thread.key] = event.id;
      }
      return roots;
    },
    {
      channelId: {
        threads: REFERENCE_CHANNEL_IDS.northline,
        operations: REFERENCE_CHANNEL_IDS.operations,
      },
      members:
        options.people === false
          ? []
          : [ASK_PEOPLE.noluthando.pubkey, ASK_PEOPLE.sam.pubkey],
      extra: (options.extraThreads ?? []).map((thread) => ({
        key: thread.key,
        channelName: thread.channelName,
        title: thread.title,
        startedAt: seconds(thread.startedAt ?? "2026-10-22T09:00:00+02:00"),
      })),
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

/** A hire role pack the AskHire board lists (a persona with a company role). */
export const ASK_ROLE_PACKS = [
  {
    id: "colony3-role-hospitality-researcher",
    displayName: "Hospitality researcher",
    systemPrompt: "Research hospitality prospects.",
    isActive: true,
    runtime: "buzz-agent",
    provider: "openai",
    model: "gpt-5.5",
    companyRole: {
      job: "Hospitality research",
      skills: ["Market research", "Synthesis"],
      tools: [{ name: "Web search", risk: "low" as const }],
      workerMenu: ["buzz-agent"],
    },
  },
] satisfies NonNullable<MockBridgeOptions["personas"]>;

/**
 * Mock options for the AskMoney board: an employee with a weekly allowance
 * ("Olive Studio"), and two owners or admins who can decide it. Returns the
 * employee's pubkey so the board can pick it.
 */
export function moneyBoardMock(): {
  mock: Partial<MockBridgeOptions>;
  employeePubkey: string;
} {
  const relaySecret = generateSecretKey();
  const relaySelf = getPublicKey(relaySecret);
  const employeePubkey = getPublicKey(generateSecretKey());
  const now = Math.floor(new Date(COLONY3_NOW).getTime() / 1000);
  const position = finalizeEvent(
    {
      kind: KIND_MEMBER_POSITION_HEAD,
      created_at: now,
      tags: [["d", `company:member:${employeePubkey}`]],
      content: JSON.stringify({
        schemaVersion: 1,
        pubkey: employeePubkey,
        title: "weekly allowance",
        kind: "employee",
        status: "active",
        sourceActionEventId: "b".repeat(64),
        updatedAt: COLONY3_NOW,
      }),
    },
    relaySecret,
  );
  const allowance = finalizeEvent(
    {
      kind: KIND_EMPLOYEE_AI_ALLOWANCE_HEAD,
      created_at: now,
      tags: [["d", `company:employee-allowance:${employeePubkey}`]],
      content: JSON.stringify({
        schemaVersion: 1,
        employeePubkey,
        allowance: { amountCents: "5000", period: "week" },
        fundingOrder: [],
        actorPubkey: relaySelf,
        updatedAt: COLONY3_NOW,
        sourceActionEventId: "c".repeat(64),
      }),
    },
    relaySecret,
  );
  return {
    employeePubkey,
    mock: {
      relaySelf,
      companyAskRelayPrivateKeyHex: bytesToHex(relaySecret),
      companyHireRelayPrivateKeyHex: bytesToHex(relaySecret),
      companyMemberPositionEvents: [position],
      employeeAllowanceHeads: [allowance],
      relayMembers: [
        { pubkey: ASK_PEOPLE.noluthando.pubkey, role: "owner" },
        { pubkey: ASK_PEOPLE.sam.pubkey, role: "admin" },
        { pubkey: employeePubkey, role: "member" },
      ],
      searchProfiles: [
        ...Object.values(ASK_PEOPLE).map((person) => ({
          pubkey: person.pubkey,
          displayName: person.name,
          jobTitle: person.jobTitle,
        })),
        { pubkey: employeePubkey, displayName: "Olive Studio", isAgent: true },
      ],
    },
  };
}
