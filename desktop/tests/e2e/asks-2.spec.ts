import { expect, test } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import type { RelayEvent } from "../../src/shared/api/types";
import { KIND_STREAM_MESSAGE } from "../../src/shared/constants/kinds";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const CHANNEL_ROOTS = ["general", "marketing"] as const;

async function openAskThread(
  page: import("@playwright/test").Page,
  askActionErrors: string[] = [],
) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const relaySecret = generateSecretKey();
  const relaySelf = getPublicKey(relaySecret);
  await installMockBridge(page, {
    relaySelf,
    companyAskRelayPrivateKeyHex: bytesToHex(relaySecret),
    askActionErrors,
    relayRequiresMembership: true,
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
    `/#/channels/${thread.channelId}?messageId=${thread.rootId}&threadRootId=${thread.rootId}&thread=${thread.rootId}`,
  );
  await expect(page.getByTestId("message-thread-panel")).toBeVisible();
  return { ...thread, relaySelf };
}

test("raise an ask from the message composer and retry the same signed action", async ({
  page,
}) => {
  const thread = await openAskThread(page, ["Temporary relay write failure"]);
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
  await expect(page.getByTestId("ask-detail-screen")).toBeVisible();
  await expect(page.getByTestId("ask-thread-root")).toContainText(
    "Share the question that needs a decision.",
  );
  await expect(page.getByTestId("ask-card")).toContainText(
    "Approve the launch outline",
  );
  await page.getByRole("link", { name: "Back to discussion" }).click();
  await expect(page.getByTestId("message-thread-panel")).toBeVisible();
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
  await expect(page.getByTestId("ask-detail-screen")).toBeVisible();
  await expect(page.getByTestId("ask-thread-root")).toContainText(
    "Share the question that needs a decision.",
  );
  await expect(page.getByTestId("ask-card")).toContainText(
    "Choose the final concept",
  );
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
  await expect(
    needsMe.getByRole("heading", { name: "#marketing" }),
  ).toBeVisible();
  await expect(page.locator('[data-testid^="today-ask-"]')).toHaveCount(18);

  await page.getByTestId("needs-me-overdue-toggle").click();
  await expect(page.locator('[data-testid^="today-ask-"]')).toHaveCount(3);
  await page.getByTestId("needs-me-overdue-toggle").click();
  await expect(page.locator('[data-testid^="today-ask-"]')).toHaveCount(18);
});
