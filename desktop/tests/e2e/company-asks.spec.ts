import { expect, test } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import type { RelayEvent } from "../../src/shared/api/types";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const ASK_ID = "7245ba1a-e078-42ef-b896-00be34a94f11";
const CAPTURE_ASK_MATRIX = process.env.CAPTURE_ASK_MATRIX === "1";

function initialAskHeadContent(input: {
  addresseePubkey: string;
  threadRootEventId: string;
}) {
  const now = Math.floor(Date.now() / 1_000);
  const createdAt = new Date(now * 1_000).toISOString();
  return JSON.stringify({
    schemaVersion: 1,
    askId: ASK_ID,
    status: "open",
    askerPubkey: TEST_IDENTITIES.alice.pubkey,
    createdAt,
    ask: {
      schemaVersion: 1,
      askId: ASK_ID,
      type: "approval",
      category: "general",
      title: "Approve the launch plan",
      body: "Confirm the release checklist is complete.",
      threadRootEventId: input.threadRootEventId,
      addresseePubkey: input.addresseePubkey,
      decideBy: new Date((now + 3_600) * 1_000).toISOString(),
    },
    resolution: null,
    cancellation: null,
    sourceActionEventId: "b".repeat(64),
  });
}

test("Today opens an ask page and keeps a rejected answer for retry", async ({
  page,
}) => {
  const relaySecret = generateSecretKey();
  const relaySelf = getPublicKey(relaySecret);
  await installMockBridge(page, {
    relaySelf,
    companyAskRelayPrivateKeyHex: bytesToHex(relaySecret),
    askResponseErrors: ["Temporary relay write failure"],
  });
  await page.goto("/#/today");
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

  const seedContext = await page.evaluate(async (askerPubkey) => {
    type TestWindow = Window & {
      __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: (
        command: string,
        payload?: unknown,
      ) => Promise<unknown>;
      __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
        channelName: string;
        content: string;
        kind?: number;
        parentEventId?: string | null;
        pubkey?: string;
        extraTags?: string[][];
        id?: string;
      }) => RelayEvent;
    };
    const testWindow = window as TestWindow;
    const invoke = testWindow.__BUZZ_E2E_INVOKE_MOCK_COMMAND__;
    const emit = testWindow.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
    if (!invoke || !emit) {
      throw new Error("The mock relay ask test seam is unavailable.");
    }
    const identity = (await invoke("get_identity", {})) as { pubkey: string };
    const rootId = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    const root = emit({
      channelName: "general",
      content: "Launch checklist",
      id: rootId,
      pubkey: askerPubkey,
    });
    const channelId = root.tags.find((tag) => tag[0] === "h")?.[1];
    if (!channelId) throw new Error("The seeded thread has no channel tag.");
    return { addresseePubkey: identity.pubkey, channelId, rootId: root.id };
  }, TEST_IDENTITIES.alice.pubkey);
  const content = initialAskHeadContent({
    addresseePubkey: seedContext.addresseePubkey,
    threadRootEventId: seedContext.rootId,
  });
  const head = JSON.parse(content) as {
    ask: Record<string, unknown>;
  };
  await page.evaluate(
    (input) => {
      type TestWindow = Window & {
        __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (message: {
          channelName: string;
          content: string;
          kind?: number;
          parentEventId?: string | null;
          pubkey?: string;
          extraTags?: string[][];
        }) => RelayEvent;
        __BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__?: (head: {
          channelId: string;
          askId: string;
          threadRootEventId: string;
          content: string;
        }) => RelayEvent;
      };
      const testWindow = window as TestWindow;
      const emit = testWindow.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      const publishHead = testWindow.__BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__;
      if (!emit || !publishHead) {
        throw new Error("The mock relay ask test seam is unavailable.");
      }
      publishHead({
        channelId: input.channelId,
        askId: input.askId,
        threadRootEventId: input.rootId,
        content: input.content,
      });
      emit({
        channelName: "general",
        content: JSON.stringify({
          schemaVersion: 1,
          askId: input.askId,
          action: "create",
          ask: input.ask,
        }),
        kind: 47032,
        parentEventId: input.rootId,
        pubkey: input.askerPubkey,
        extraTags: [["d", `channel:${input.channelId}:ask:${input.askId}`]],
      });
    },
    {
      ask: head.ask,
      askId: ASK_ID,
      askerPubkey: TEST_IDENTITIES.alice.pubkey,
      channelId: seedContext.channelId,
      content,
      rootId: seedContext.rootId,
    },
  );

  const todayAsk = page.getByTestId(`today-ask-${ASK_ID}`);
  await expect(todayAsk).toBeVisible();
  await todayAsk.focus();
  await expect(todayAsk).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("ask-detail-screen")).toBeVisible();
  await expect(page.getByTestId("ask-thread-root")).toContainText(
    "Launch checklist",
  );
  await expect(page.getByTestId("ask-card")).toBeVisible();
  const reason = page.getByLabel("Reason");
  await reason.fill("The checklist is complete.");
  const recordResponse = page.getByRole("button", { name: "Record response" });
  await recordResponse.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText(
    "Temporary relay write failure",
  );
  await expect(reason).toHaveValue("The checklist is complete.");
  const retry = page.getByRole("button", { name: "Retry response" });
  await expect(retry).toBeEnabled();
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("ask-resolved")).toContainText(
    "Approved by You",
  );

  await page.getByRole("link", { name: "Back to discussion" }).click();
  await expect(page.getByTestId("message-thread-panel")).toBeVisible();
  await expect(page).toHaveURL(
    new RegExp(`[?&]messageId=${seedContext.rootId}`),
  );
  await expect(page.getByTestId("message-thread-head")).toContainText(
    "Launch checklist",
  );
  await expect(page.getByTestId("ask-resolved")).toContainText(
    "Approved by You",
  );
  await page.getByTestId("ask-detail-link").click();
  await expect(page.getByTestId("ask-detail-screen")).toBeVisible();
  await page.getByRole("link", { name: "Needs me" }).click();
  await expect(page.getByRole("region", { name: "Needs me" })).toBeVisible();
  await expect(page.getByTestId(`today-ask-${ASK_ID}`)).toHaveCount(0);
});

test("new ask thread drafts can be canceled from the destination step", async ({
  page,
}) => {
  await installMockBridge(page, { relayRequiresMembership: true });
  await page.goto("/#/asks/new");

  const channel = page.getByLabel("Channel", { exact: true });
  await expect
    .poll(async () => channel.locator("option").count(), { timeout: 15_000 })
    .toBeGreaterThan(1);
  const channelId = await channel
    .locator("option")
    .evaluateAll(
      (options) =>
        options.find(
          (option) =>
            (option as HTMLOptionElement).value &&
            option.textContent?.toLowerCase().includes("general"),
        )?.value,
    );
  if (!channelId) {
    throw new Error("The mock ask destination has no general channel option.");
  }
  await channel.selectOption(channelId);

  await page.getByRole("button", { name: "Choose a thread" }).click();
  await page.getByRole("button", { name: "Start a new thread" }).click();
  await page
    .getByLabel("New thread title")
    .fill("A thread draft that will be canceled");
  await page
    .getByLabel("Opening context, optional")
    .fill("This context stays local until the ask is sent.");

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#\\/channels\\/${channelId}$`));
});

test("Needs me opens each ask type, records a response, and returns to its thread", async ({
  page,
}) => {
  if (CAPTURE_ASK_MATRIX) test.setTimeout(120_000);
  const relaySecret = generateSecretKey();
  const relaySelf = getPublicKey(relaySecret);
  await installMockBridge(page, {
    relaySelf,
    companyAskRelayPrivateKeyHex: bytesToHex(relaySecret),
    relayRequiresMembership: true,
  });
  await page.goto("/#/today");
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

  const askFixtures = [
    {
      askId: "10000000-0000-4000-8000-000000000001",
      type: "approval",
      category: "money",
      title: "Increase Olive Studio’s October allowance by USD 120",
      threadTitle: "Campaign direction",
      context:
        "Current allowance USD 180. Proposed allowance USD 300. Does not launch ads or publish content.",
    },
    {
      askId: "10000000-0000-4000-8000-000000000002",
      type: "question",
      category: "general",
      title: "Which client requirement should we prioritise?",
      threadTitle: "Campaign direction",
      context:
        "We can keep the launch date or add another round of creative exploration.",
    },
    {
      askId: "10000000-0000-4000-8000-000000000003",
      type: "choice",
      category: "general",
      title: "Choose the campaign direction",
      threadTitle: "Campaign direction",
      context: "Select one direction for the next draft.",
      options: [
        { id: "customer-stories", label: "Customer stories" },
        { id: "studio-process", label: "Studio process" },
        { id: "product-education", label: "Product education" },
      ],
    },
    {
      askId: "10000000-0000-4000-8000-000000000004",
      type: "checklist",
      category: "general",
      title: "Confirm the client brief is ready",
      threadTitle: "Campaign direction",
      context: "Confirm these requirements before production begins.",
      items: [
        { id: "tone", label: "Tone matches the client brief" },
        { id: "dates", label: "Dates are confirmed" },
        { id: "owner", label: "Owner is assigned" },
      ],
    },
    {
      askId: "10000000-0000-4000-8000-000000000005",
      type: "verdict",
      category: "general",
      title: "Does the revised plan meet the done condition?",
      threadTitle: "Campaign direction",
      context: "Review the three concepts, calendar and rationale.",
    },
  ];

  const seededAsks = await page.evaluate(
    async ({ askerPubkey, asks }) => {
      type TestWindow = Window & {
        __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: (
          command: string,
          payload?: unknown,
        ) => Promise<unknown>;
        __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
          channelName: string;
          content: string;
          kind?: number;
          parentEventId?: string | null;
          pubkey?: string;
          extraTags?: string[][];
        }) => RelayEvent;
        __BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__?: (head: {
          channelId: string;
          askId: string;
          threadRootEventId: string;
          content: string;
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
      const now = Math.floor(Date.now() / 1_000);
      const seeded: Array<{
        askId: string;
        type: string;
        category: string;
        title: string;
        threadTitle: string;
        context: string;
        rootId: string;
      }> = [];
      for (const askFixture of asks) {
        const root = emit({
          channelName: "general",
          content: `# ${askFixture.threadTitle}\n${askFixture.context}`,
          pubkey: askerPubkey,
        });
        const channelId = root.tags.find((tag) => tag[0] === "h")?.[1];
        if (!channelId)
          throw new Error("The seeded thread has no channel tag.");
        const ask = {
          schemaVersion: 1,
          askId: askFixture.askId,
          type: askFixture.type,
          category: askFixture.category,
          title: askFixture.title,
          threadRootEventId: root.id,
          addresseePubkey: identity.pubkey,
          decideBy: new Date((now + 3_600) * 1_000).toISOString(),
          ...(askFixture.options ? { options: askFixture.options } : {}),
          ...(askFixture.items ? { items: askFixture.items } : {}),
        };
        const content = JSON.stringify({
          schemaVersion: 1,
          askId: askFixture.askId,
          status: "open",
          askerPubkey,
          createdAt: new Date(now * 1_000).toISOString(),
          ask,
          resolution: null,
          cancellation: null,
          sourceActionEventId: "b".repeat(64),
        });
        publishHead({
          channelId,
          askId: askFixture.askId,
          threadRootEventId: root.id,
          content,
        });
        emit({
          channelName: "general",
          content: JSON.stringify({
            schemaVersion: 1,
            askId: askFixture.askId,
            action: "create",
            ask,
          }),
          kind: 47032,
          parentEventId: root.id,
          pubkey: askerPubkey,
          extraTags: [["d", `channel:${channelId}:ask:${askFixture.askId}`]],
        });
        seeded.push({
          askId: askFixture.askId,
          type: askFixture.type,
          category: askFixture.category,
          title: askFixture.title,
          threadTitle: askFixture.threadTitle,
          context: askFixture.context,
          rootId: root.id,
        });
      }
      return seeded;
    },
    { askerPubkey: TEST_IDENTITIES.alice.pubkey, asks: askFixtures },
  );

  for (const ask of seededAsks) {
    await page.goto("/#/today");
    const row = page.getByTestId(`today-ask-${ask.askId}`);
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByTestId("ask-detail-screen")).toBeVisible();
    if (ask.category === "money") {
      await expect(page.getByTestId("ask-thread-title")).toHaveText(ask.title);
      await expect(page.getByTestId("ask-detail-breadcrumb")).toHaveText(
        ask.title,
      );
      await expect(
        page.getByRole("heading", { name: "Decision requested" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Decision context" }),
      ).toBeVisible();
    } else {
      await expect(page.getByTestId("ask-thread-title")).toHaveText(
        `Decision in ${ask.threadTitle}`,
      );
      await expect(page.getByTestId("ask-detail-breadcrumb")).toHaveText(
        `Decision in ${ask.threadTitle}`,
      );
      await expect(page.getByTestId("ask-thread-root")).toBeVisible();
    }
    await expect(page.getByTestId("ask-card")).toBeVisible();

    if (CAPTURE_ASK_MATRIX) {
      const outputDirectory = resolve(
        process.cwd(),
        "../output/asks-v7-comparison/app",
      );
      mkdirSync(outputDirectory, { recursive: true });
      for (const [width, height] of [
        [1728, 1117],
        [1440, 900],
      ] as const) {
        await page.setViewportSize({ width, height });
        for (const theme of ["light", "dark"] as const) {
          await page.emulateMedia({ colorScheme: theme });
          await page.waitForFunction(
            (shouldBeDark) =>
              document.documentElement.classList.contains("dark") ===
              shouldBeDark,
            theme === "dark",
          );
          await waitForAnimations(page);
          await page.screenshot({
            path: resolve(
              outputDirectory,
              `ask-${ask.askId.slice(-1)}-${width}x${height}-${theme}.png`,
            ),
          });
        }
      }
      await page.emulateMedia({ colorScheme: "light" });
      await page.setViewportSize({ width: 1280, height: 720 });
    }

    if (ask.type === "approval") {
      await page.getByLabel("Reason").fill("The launch plan is ready.");
    } else if (ask.type === "question") {
      await page.getByLabel("Your answer").fill("Prioritise the launch date.");
    } else if (ask.type === "choice") {
      await page
        .getByLabel("Choose a direction")
        .selectOption("customer-stories");
    } else if (ask.type === "checklist") {
      await page.getByLabel("Tone matches the client brief").check();
      await page.getByLabel("Dates are confirmed").check();
      await page.getByLabel("Owner is assigned").check();
    } else {
      await page.getByLabel("Reason").fill("All checks passed.");
    }
    await page
      .getByRole("button", {
        name:
          ask.category === "money"
            ? "Record funding decision"
            : "Record response",
      })
      .click();
    await expect(page.getByTestId("ask-resolved")).toBeVisible();
    await page
      .getByRole("link", {
        name:
          ask.category === "money" ? "Open conversation" : "Back to discussion",
      })
      .click();
    await expect(page.getByTestId("message-thread-panel")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`[?&]messageId=${ask.rootId}`));
    await expect(page.getByTestId("message-thread-head")).toContainText(
      ask.threadTitle,
    );
    await expect(page.getByTestId("ask-resolved")).toBeVisible();
  }
});

test("Needs me approves and denies addressed workflow approvals", async ({
  page,
}) => {
  const createdAt = Math.floor(Date.now() / 1_000);
  const expiresAt = new Date((createdAt + 3_600) * 1_000).toISOString();
  await installMockBridge(page, {
    workflowApprovals: [
      {
        workflowId: "workflow-today-release",
        workflowName: "Release approval",
        channelName: "general",
        runId: "run-today-release",
        approvalRef: "approval-today-release",
        stepId: "release_review",
        stepIndex: 2,
        approverSpec: "current",
        approverPubkey: "current",
        expiresAt,
        createdAt,
      },
      {
        workflowId: "workflow-today-security",
        workflowName: "Security approval",
        channelName: "general",
        runId: "run-today-security",
        approvalRef: "approval-today-security",
        stepId: "security_review",
        stepIndex: 1,
        approverSpec: "any",
        approverPubkey: null,
        expiresAt,
        createdAt,
      },
      {
        workflowId: "workflow-today-other-person",
        workflowName: "Other person approval",
        channelName: "general",
        runId: "run-today-other-person",
        approvalRef: "approval-today-other-person",
        stepId: "other_person_review",
        stepIndex: 1,
        approverSpec: TEST_IDENTITIES.bob.pubkey,
        approverPubkey: TEST_IDENTITIES.bob.pubkey,
        expiresAt,
        createdAt,
      },
    ],
  });
  await page.goto("/#/today");

  const releaseRow = page.getByTestId(
    "today-workflow-approval-approval-today-release",
  );
  const securityRow = page.getByTestId(
    "today-workflow-approval-approval-today-security",
  );
  await expect(
    page.getByTestId("today-workflow-approval-approval-today-other-person"),
  ).toHaveCount(0);
  await expect(releaseRow).toBeVisible();
  await expect(securityRow).toBeVisible();
  const approve = releaseRow.getByRole("button", { name: "Approve" });
  await approve.focus();
  await page.keyboard.press("Enter");
  await expect(releaseRow).toHaveCount(0);
  const deny = securityRow.getByRole("button", { name: "Deny" });
  await deny.focus();
  await page.keyboard.press("Enter");
  await expect(securityRow).toHaveCount(0);
});
