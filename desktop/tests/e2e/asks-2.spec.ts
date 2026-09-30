import { expect, test } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import type { RelayEvent } from "../../src/shared/api/types";
import {
  KIND_EMPLOYEE_AI_ALLOWANCE_HEAD,
  KIND_MEMBER_POSITION_HEAD,
  KIND_STREAM_MESSAGE,
} from "../../src/shared/constants/kinds";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const CHANNEL_ROOTS = ["general", "buzz"] as const;
const HIRE_PERSONA_ID = "company-role-operations";
type MockBridgeOptions = NonNullable<Parameters<typeof installMockBridge>[1]>;

async function openAskThread(
  page: import("@playwright/test").Page,
  askActionErrors: string[] = [],
  openThread = true,
  personas?: MockBridgeOptions["personas"],
  companyMemberPositionEvents?: MockBridgeOptions["companyMemberPositionEvents"],
  relaySecret = generateSecretKey(),
  employeeAllowanceHeads?: MockBridgeOptions["employeeAllowanceHeads"],
) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const relaySelf = getPublicKey(relaySecret);
  await installMockBridge(page, {
    relaySelf,
    companyAskRelayPrivateKeyHex: bytesToHex(relaySecret),
    companyHireRelayPrivateKeyHex: bytesToHex(relaySecret),
    askActionErrors,
    relayRequiresMembership: true,
    ...(personas ? { personas } : {}),
    ...(companyMemberPositionEvents ? { companyMemberPositionEvents } : {}),
    ...(employeeAllowanceHeads ? { employeeAllowanceHeads } : {}),
  });
  await page.goto("/#/today");
  await page.waitForFunction(() => {
    const testWindow = window as Window & {
      __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: unknown;
    };
    return typeof testWindow.__BUZZ_E2E_EMIT_MOCK_MESSAGE__ === "function";
  });

  const thread = await page.evaluate(
    ({ kind }) => {
      const testWindow = window as Window & {
        __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
          channelName: string;
          content: string;
          kind: number;
          parentEventId?: string;
        }) => RelayEvent;
      };
      const emit = testWindow.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      if (!emit) throw new Error("The mock message seam is unavailable.");
      const root = emit({
        channelName: "general",
        content:
          "# Launch discussion\nShare the question that needs a decision.",
        kind,
      });
      const reply = emit({
        channelName: "general",
        content: "The third option has the clearest launch path.",
        kind,
        parentEventId: root.id,
      });
      const channelId = root.tags.find((tag) => tag[0] === "h")?.[1];
      if (!channelId) throw new Error("The seeded thread has no channel tag.");
      return { channelId, replyId: reply.id, rootId: root.id };
    },
    { kind: KIND_STREAM_MESSAGE },
  );

  await page.goto(
    openThread
      ? `/#/channels/${thread.channelId}?messageId=${thread.rootId}&threadRootId=${thread.rootId}&thread=${thread.rootId}`
      : `/#/channels/${thread.channelId}`,
  );
  if (openThread) {
    await expect(page.getByTestId("message-thread-panel")).toBeVisible();
  }
  return { ...thread, relaySelf, relaySecret };
}

function employeePositionHead(input: {
  relaySecret: Uint8Array;
  pubkey: string;
}) {
  return finalizeEvent(
    {
      kind: KIND_MEMBER_POSITION_HEAD,
      created_at: Math.floor(Date.now() / 1_000),
      tags: [["d", `company:member:${input.pubkey}`]],
      content: JSON.stringify({
        schemaVersion: 1,
        pubkey: input.pubkey,
        title: "Employee",
        kind: "employee",
        status: "active",
        sourceActionEventId: "b".repeat(64),
        updatedAt: new Date().toISOString(),
      }),
    },
    input.relaySecret,
  );
}

function employeeAllowanceHead(input: {
  relaySecret: Uint8Array;
  pubkey: string;
}) {
  const relaySelf = getPublicKey(input.relaySecret);
  return finalizeEvent(
    {
      kind: KIND_EMPLOYEE_AI_ALLOWANCE_HEAD,
      created_at: Math.floor(Date.now() / 1_000),
      tags: [["d", `company:employee-allowance:${input.pubkey}`]],
      content: JSON.stringify({
        schemaVersion: 1,
        employeePubkey: input.pubkey,
        allowance: { amountCents: "5000", period: "week" },
        fundingOrder: [],
        actorPubkey: relaySelf,
        updatedAt: new Date().toISOString(),
        sourceActionEventId: "c".repeat(64),
      }),
    },
    input.relaySecret,
  );
}

test("raise an ask from the message composer and retry the same signed action", async ({
  page,
}) => {
  const thread = await openAskThread(
    page,
    ["Temporary relay write failure"],
    false,
  );
  await page.getByTestId("raise-ask-from-composer").click();
  await expect(
    page.getByRole("heading", { name: "Raise an ask" }),
  ).toBeVisible();
  await page
    .getByLabel("What needs a response?")
    .fill("Approve the launch outline");
  await page.getByLabel("Context").fill("The draft and owner notes are ready.");
  await page
    .getByLabel("Response from")
    .selectOption(TEST_IDENTITIES.bob.pubkey);
  await page.getByRole("button", { name: "Send ask" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "Temporary relay write failure",
  );
  await expect(page.getByLabel("What needs a response?")).toHaveValue(
    "Approve the launch outline",
  );
  await expect(page.getByLabel("Response from")).toHaveValue(
    TEST_IDENTITIES.bob.pubkey,
  );
  const signedAskActions = await page.evaluate(() => {
    const testWindow = window as Window & {
      __BUZZ_E2E_SIGNED_EVENTS__?: Array<{ kind: number }>;
    };
    return (
      testWindow.__BUZZ_E2E_SIGNED_EVENTS__?.filter(
        (event) => event.kind === 47032,
      ).length ?? 0
    );
  });
  expect(signedAskActions).toBe(1);

  await page.getByRole("button", { name: "Retry send" }).click();
  await expect(
    page.getByRole("heading", { name: "Ask raised in its thread" }),
  ).toBeVisible();
  await expect(page.getByText(/Approve the launch outline/)).toBeVisible();
  await page.getByRole("button", { name: "Open the conversation" }).click();
  await expect(page.getByTestId("message-thread-panel")).toBeVisible();
  await expect(page.getByTestId("message-thread-panel")).toContainText(
    "Share the question that needs a decision.",
  );
  await expect(page.getByTestId("ask-card")).toContainText(
    "Approve the launch outline",
  );
  await expect(page.getByTestId("ask-card")).toHaveCount(1);
  expect(thread.rootId).toMatch(/^[0-9a-f]{64}$/);
});

test("raise an ask from a message action and keep the message thread root", async ({
  page,
}) => {
  const thread = await openAskThread(page);
  const replyRow = page
    .locator(`[data-message-id="${thread.replyId}"]`)
    .first();
  await expect(replyRow).toBeVisible();
  await replyRow.hover();
  await page.getByTestId(`more-actions-${thread.replyId}`).click();
  await page.getByTestId(`raise-ask-message-${thread.replyId}`).click();

  await expect(page).toHaveURL(
    new RegExp(`threadRootEventId=${thread.rootId}`),
  );
  await page.getByRole("button", { name: "Question" }).click();
  await page
    .getByLabel("What needs a response?")
    .fill("Choose the final concept");
  await page
    .getByLabel("Response from")
    .selectOption(TEST_IDENTITIES.alice.pubkey);
  await page.getByRole("button", { name: "Send ask" }).click();
  await expect(
    page.getByRole("heading", { name: "Ask raised in its thread" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open the conversation" }).click();
  await expect(page.getByTestId("message-thread-panel")).toBeVisible();
  await expect(page.getByTestId("message-thread-panel")).toContainText(
    "Share the question that needs a decision.",
  );
  await expect(page.getByTestId("ask-card")).toContainText(
    "Choose the final concept",
  );
});

test("submit a typed hire proposal and retry without losing the selected scope", async ({
  page,
}) => {
  const personas = [
    {
      id: HIRE_PERSONA_ID,
      displayName: "Operations coordinator",
      systemPrompt: "Coordinate company operations.",
      isActive: true,
      runtime: "buzz-agent",
      provider: "openai",
      model: "gpt-5.5",
      companyRole: {
        job: "Coordinate team operations",
        skills: ["Planning"],
        tools: [{ name: "calendar_read", risk: "low" as const }],
        workerMenu: ["buzz-agent"],
      },
    },
  ] satisfies NonNullable<MockBridgeOptions["personas"]>;
  const thread = await openAskThread(
    page,
    ["Temporary relay write failure"],
    false,
    personas,
  );
  await page.getByTestId("raise-ask-from-composer").click();
  await page.getByRole("button", { name: "Hire proposal" }).click();
  await expect(
    page.getByRole("heading", { name: "Propose a hire" }),
  ).toBeVisible();
  await expect(page.getByLabel("Channel", { exact: true })).toHaveValue(
    thread.channelId,
  );
  await expect(page.getByLabel("Thread", { exact: true })).toHaveValue(
    thread.rootId,
  );
  await page.getByLabel("Recipient").selectOption(TEST_IDENTITIES.bob.pubkey);
  await page.getByLabel("Role pack").selectOption(HIRE_PERSONA_ID);
  await page.getByLabel("Proposed name").fill("Operations coordinator");
  await page.getByLabel("Job title").fill("Operations Coordinator");
  await page
    .getByLabel("Reason")
    .fill("The team needs support coordinating supplier work.");
  await page.getByLabel("Requested allowance, USD").fill("12.50");
  await page.getByLabel("Allowance period").selectOption("week");
  await expect(page.getByLabel("Recipient")).toHaveValue(
    TEST_IDENTITIES.bob.pubkey,
  );
  await page.getByRole("button", { name: "Review proposal" }).click();
  await expect(
    page.getByRole("heading", { name: "Review hire proposal" }),
  ).toBeVisible();
  await expect(page.getByText("#general / Launch discussion")).toBeVisible();
  await page.getByRole("button", { name: "Submit proposal" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "Temporary relay write failure",
  );
  await expect(page.getByText("USD 12.50 / week")).toBeVisible();
  const signedAskActions = await page.evaluate(() => {
    const testWindow = window as Window & {
      __BUZZ_E2E_SIGNED_EVENTS__?: Array<{ kind: number }>;
    };
    return (
      testWindow.__BUZZ_E2E_SIGNED_EVENTS__?.filter(
        (event) => event.kind === 47032,
      ).length ?? 0
    );
  });
  expect(signedAskActions).toBe(1);

  await page.getByRole("button", { name: "Retry send" }).click();
  await expect(
    page.getByRole("heading", { name: "Proposal raised" }),
  ).toBeVisible();
  await expect(
    page.getByText("No position or agent has been created."),
  ).toBeVisible();
  await page.getByRole("button", { name: "View proposal" }).click();
  await expect(page.getByTestId("message-thread-panel")).toBeVisible();
  await expect(page.getByTestId("ask-card")).toContainText(
    "The team needs support coordinating supplier work.",
  );
  await expect(page.getByTestId("ask-card")).toHaveAttribute(
    "data-ask-variant",
    "hire",
  );
  expect(thread.rootId).toMatch(/^[0-9a-f]{64}$/);
});

test("raise a typed allowance request from Power and retry the same signed ask", async ({
  page,
}) => {
  const relaySecret = generateSecretKey();
  const employeePubkey = getPublicKey(generateSecretKey());
  const thread = await openAskThread(
    page,
    ["Temporary relay write failure"],
    false,
    undefined,
    [employeePositionHead({ relaySecret, pubkey: employeePubkey })],
    relaySecret,
    [employeeAllowanceHead({ relaySecret, pubkey: employeePubkey })],
  );

  await page.goto("/#/power");
  const requestAllowance = page.getByRole("button", {
    name: "Request allowance change",
  });
  await expect(requestAllowance).toBeVisible();
  await requestAllowance.click();
  await expect(
    page.getByRole("heading", {
      name: "Request an allowance or cost approval",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Adjust an allowance/ }).click();
  await page
    .getByLabel("Channel", { exact: true })
    .selectOption(thread.channelId);
  await page.getByLabel("Thread", { exact: true }).selectOption("new");
  await page.getByLabel("New thread title").fill("Allowance discussion");
  await page
    .getByLabel("Opening context, optional")
    .fill("The workload has changed and needs review.");
  await page
    .getByLabel("Recipient", { exact: true })
    .selectOption(TEST_IDENTITIES.alice.pubkey);
  await page
    .getByLabel("Employee or budget", { exact: true })
    .selectOption(employeePubkey);
  await page.getByLabel("Change duration").selectOption("permanent");
  await page.getByLabel("Requested amount, USD").fill("8.75");
  await page
    .getByLabel("Reason", { exact: true })
    .fill("The employee needs more capacity for the approved work.");

  await page.getByRole("button", { name: "Review request" }).click();
  await expect(
    page.getByRole("heading", { name: "Review money request" }),
  ).toBeVisible();
  await expect(
    page.getByText("Authority is checked on response"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Submit request" }).click();
  await expect(page.getByRole("alert")).toContainText("Could not save");
  await expect(page.getByRole("alert")).toContainText(
    "Your inputs are kept. Review them or retry without starting again.",
  );
  await expect(
    page.getByLabel("Employee or budget", { exact: true }),
  ).toHaveValue(employeePubkey);
  await expect(page.getByLabel("Reason", { exact: true })).toHaveValue(
    "The employee needs more capacity for the approved work.",
  );
  const signedAskActions = await page.evaluate(() => {
    const testWindow = window as Window & {
      __BUZZ_E2E_SIGNED_EVENTS__?: Array<{ kind: number }>;
    };
    return (
      testWindow.__BUZZ_E2E_SIGNED_EVENTS__?.filter(
        (event) => event.kind === 47032,
      ).length ?? 0
    );
  });
  expect(signedAskActions).toBe(1);

  await page.getByRole("button", { name: "Retry send" }).click();
  await expect(
    page.getByRole("heading", { name: "Money request submitted" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "No balance or spending limit changes until an authorized human approves.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open decision" }).click();
  await expect(page.getByTestId("message-thread-panel")).toBeVisible();
  await expect(page.getByTestId("ask-money-allowance-proposal")).toContainText(
    "USD 8.75 / week",
  );
  await expect(page.getByTestId("ask-card")).toContainText(
    "The employee needs more capacity for the approved work.",
  );
  expect(thread.rootId).toMatch(/^[0-9a-f]{64}$/);
});

test("busy Needs me groups the full deadline-sorted queue", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const relaySecret = generateSecretKey();
  const relaySelf = getPublicKey(relaySecret);
  await installMockBridge(page, {
    relaySelf,
    companyAskRelayPrivateKeyHex: bytesToHex(relaySecret),
    relayRequiresMembership: true,
  });
  await page.goto("/#/channels/general");
  await page.waitForFunction(() => {
    const testWindow = window as Window & {
      __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: unknown;
      __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: unknown;
      __BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__?: unknown;
    };
    return (
      typeof testWindow.__BUZZ_E2E_EMIT_MOCK_MESSAGE__ === "function" &&
      typeof testWindow.__BUZZ_E2E_INVOKE_MOCK_COMMAND__ === "function" &&
      typeof testWindow.__BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__ === "function"
    );
  });

  await page.evaluate(
    async ({ kind, channelNames }) => {
      type TestWindow = Window & {
        __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: (
          command: string,
          payload?: unknown,
        ) => Promise<unknown>;
        __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
          channelName: string;
          content: string;
          kind: number;
        }) => RelayEvent;
        __BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__?: (input: {
          channelId: string;
          askId: string;
          threadRootEventId: string;
          content: string;
          createdAt: number;
        }) => RelayEvent;
      };
      const testWindow = window as TestWindow;
      const invoke = testWindow.__BUZZ_E2E_INVOKE_MOCK_COMMAND__;
      const emit = testWindow.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      const publishHead = testWindow.__BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__;
      if (!invoke || !emit || !publishHead) {
        throw new Error("The mock relay ask test seam is unavailable.");
      }
      const identity = (await invoke("get_identity", {})) as { pubkey: string };
      const roots = channelNames.map((channelName) => {
        const event = emit({
          channelName,
          content: "Ask grouping context",
          kind,
        });
        const channelId = event.tags.find((tag) => tag[0] === "h")?.[1];
        if (!channelId)
          throw new Error("The seeded thread has no channel tag.");
        return { channelId, rootId: event.id };
      });
      const now = Math.floor(Date.now() / 1_000);
      for (let index = 0; index < 18; index += 1) {
        const root = roots[index % roots.length];
        const askId = `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
        const category =
          index % 6 === 0
            ? "money"
            : index % 6 === 1
              ? "tool"
              : index % 6 === 2
                ? "hire"
                : "general";
        const type =
          category === "general"
            ? index % 2 === 0
              ? "choice"
              : "question"
            : "approval";
        const decideBy = new Date(
          (now +
            (index < 3
              ? -3_600
              : index < 7
                ? 3_600
                : index < 11
                  ? 86_400
                  : 259_200)) *
            1_000,
        ).toISOString();
        const ask = {
          schemaVersion: 1,
          askId,
          type,
          category,
          title: `Decision ${String(index + 1).padStart(2, "0")}`,
          threadRootEventId: root.rootId,
          addresseePubkey: identity.pubkey,
          decideBy,
          ...(type === "choice"
            ? {
                options: [
                  { id: "a", label: "First" },
                  { id: "b", label: "Second" },
                ],
              }
            : {}),
        };
        publishHead({
          channelId: root.channelId,
          askId,
          threadRootEventId: root.rootId,
          createdAt: now - index,
          content: JSON.stringify({
            schemaVersion: 1,
            askId,
            status: "open",
            askerPubkey: identity.pubkey,
            createdAt: new Date((now - index) * 1_000).toISOString(),
            ask,
            resolution: null,
            cancellation: null,
            sourceActionEventId: "b".repeat(64),
          }),
        });
      }
    },
    {
      kind: KIND_STREAM_MESSAGE,
      channelNames: CHANNEL_ROOTS,
    },
  );

  await page.goto("/#/today");
  const needsMe = page.getByRole("region", { name: "Needs me" });
  await expect(needsMe.getByText("18 open")).toBeVisible();
  await expect(page.locator('[data-testid^="today-ask-"]')).toHaveCount(6);
  await expect(needsMe.getByRole("heading", { name: "Overdue" })).toBeVisible();
  await expect(needsMe.getByText("3 asks are overdue")).toBeVisible();

  await page.getByTestId("needs-me-group-type").click();
  await expect(needsMe.getByRole("heading", { name: "Funding" })).toBeVisible();
  await expect(page.locator('[data-testid^="today-ask-"]')).toHaveCount(6);
  await page.getByTestId("needs-me-show-more").click();
  await expect(page.locator('[data-testid^="today-ask-"]')).toHaveCount(18);

  await page.getByTestId("needs-me-group-channel").click();
  await expect(
    needsMe.getByRole("heading", { name: "#general" }),
  ).toBeVisible();
  await expect(needsMe.getByRole("heading", { name: "#buzz" })).toBeVisible();
  await expect(page.locator('[data-testid^="today-ask-"]')).toHaveCount(18);

  await page.getByTestId("needs-me-overdue-toggle").click();
  await expect(page.locator('[data-testid^="today-ask-"]')).toHaveCount(3);
  await page.getByTestId("needs-me-overdue-toggle").click();
  await expect(page.locator('[data-testid^="today-ask-"]')).toHaveCount(18);
});
