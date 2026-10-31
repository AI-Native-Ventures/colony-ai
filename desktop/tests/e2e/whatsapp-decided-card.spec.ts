import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import {
  installWhatsAppMockBridge,
  PLANE_TREE_WA_ID,
  WHATSAPP_DECIDED_BATCH_ID,
} from "../helpers/whatsappOutreach";
import { REFERENCE_AGENTS } from "../../src/testing/e2eReferenceWorkspace";

type WhatsAppMockState = {
  commands: Array<{ kind: number; body: Record<string, unknown> }>;
};

type WhatsAppEventWindow = Window & {
  __BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?: (input: {
    channelName: string;
  }) => boolean;
  __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
    channelName: string;
    content: string;
    pubkey: string;
    kind: number;
    extraTags?: string[][];
    createdAt?: number;
  }) => unknown;
  __BUZZ_E2E_WHATSAPP_STATE__?: WhatsAppMockState;
};

type WhatsAppThreadSeedWindow = Window & {
  __BUZZ_E2E_WHATSAPP_STATE__?: {
    threads?: Record<string, { messages: unknown[] }>;
  };
};

const variants = {
  pending: "decided-card-pending",
  approved: "decided-card-approved",
  rejected: "decided-card-rejected",
  sent: "decided-card-sent",
  missing: "decided-card-missing",
} as const;

async function openChannelFromHome(
  page: Page,
  channelName: "Outreach" | "Scout",
) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("home-inbox")).toBeVisible();
  await page.getByTestId(`channel-${channelName}`).click();
  await expect(page.getByTestId("chat-title")).toHaveText(channelName);
}

async function emitBatchNotice(page: Page, channelName: "Outreach" | "Scout") {
  await expect
    .poll(() =>
      page.evaluate(
        (name) =>
          (
            window as WhatsAppEventWindow
          ).__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({ channelName: name }) ??
          false,
        channelName,
      ),
    )
    .toBe(true);
  await page.evaluate(
    ({ name, batchId, pubkey }) =>
      (window as WhatsAppEventWindow).__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: name,
        content: `Scout prepared batch ${batchId} using hl_new_site. Nothing is sent until the owner or an admin approves it.`,
        pubkey,
        kind: 9,
        extraTags: [["wa-notice", "batch_pending"]],
        createdAt: Math.floor(Date.now() / 1000),
      }),
    {
      name: channelName,
      batchId: WHATSAPP_DECIDED_BATCH_ID,
      pubkey: REFERENCE_AGENTS.scout.pubkey,
    },
  );
}

async function expectSendNowCommand(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        (batchId) =>
          (
            window as WhatsAppEventWindow
          ).__BUZZ_E2E_WHATSAPP_STATE__?.commands.some(
            ({ kind, body }) =>
              kind === 47049 &&
              body.batchId === batchId &&
              body.decision === "send_now",
          ) ?? false,
        WHATSAPP_DECIDED_BATCH_ID,
      ),
    )
    .toBe(true);
}

async function openApprovedCardFromHome(
  page: Page,
  channelName: "Outreach" | "Scout",
) {
  await openChannelFromHome(page, channelName);
  await emitBatchNotice(page, channelName);
  const card = page.getByTestId("whatsapp-channel-batch-approved");
  await expect(card).toBeVisible();
  await expect(card).toContainText("WhatsApp batch approved");
  await expect(card).toContainText("Approved by Basheer Phiri.");
  await expect(card).toContainText("Sends tomorrow at 08:00");
  await expect(
    card.getByRole("button", { name: "Send now (test)" }),
  ).toBeVisible();
  await expect(card.getByRole("button", { name: "Open chats" })).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Approve and send" }),
  ).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Reject" })).toHaveCount(0);
  return card;
}

test.describe("WhatsApp decided batch channel card", () => {
  test("unknown relay message states keep the WhatsApp chat visible", async ({
    page,
  }) => {
    const stateWarnings: string[] = [];
    page.on("console", (message) => {
      if (
        message.type() === "warning" &&
        message.text().includes("unknown WhatsApp message state")
      ) {
        stateWarnings.push(message.text());
      }
    });
    await installWhatsAppMockBridge(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("home-inbox")).toBeVisible();
    await page.evaluate((waId) => {
      const state = (window as WhatsAppThreadSeedWindow)
        .__BUZZ_E2E_WHATSAPP_STATE__;
      const thread = state?.threads?.[waId];
      if (!thread) throw new Error("Mock WhatsApp thread is unavailable");
      thread.messages = [
        {
          id: "e2e-wa-unknown-state",
          waId,
          direction: "out",
          kind: "text",
          text: "Unknown state must not hide this message.",
          templateName: null,
          state: "received_by_carrier",
          errorCode: null,
          errorText: null,
          eventId: null,
          senderPubkey: null,
          createdAt: "2026-10-31T09:01:00+02:00",
        },
        {
          id: "e2e-wa-unknown-state-repeat",
          waId,
          direction: "out",
          kind: "text",
          text: "A repeated unknown state is still visible.",
          templateName: null,
          state: "received_by_carrier",
          errorCode: null,
          errorText: null,
          eventId: null,
          senderPubkey: null,
          createdAt: "2026-10-31T09:02:00+02:00",
        },
        {
          id: "e2e-wa-inbound-received-state",
          waId,
          direction: "in",
          kind: "text",
          text: "Inbound received state remains visible.",
          templateName: null,
          state: "received",
          errorCode: null,
          errorText: null,
          eventId: null,
          senderPubkey: null,
          createdAt: "2026-10-31T09:00:00+02:00",
        },
      ];
    }, PLANE_TREE_WA_ID);

    await page.getByTestId("channel-general").click();
    await page.getByRole("button", { name: "Open work area" }).click();
    await expect(page.getByTestId("work-area-empty")).toBeVisible();
    await page.getByRole("button", { name: "Add work area tab" }).click();
    await page.getByRole("menuitem", { name: "WhatsApp chats" }).click();
    await expect(page.getByTestId("whatsapp-outreach")).toBeVisible();
    await page.getByTestId(`whatsapp-contact-${PLANE_TREE_WA_ID}`).click();

    const unknownMessage = page.getByTestId(
      "whatsapp-message-e2e-wa-unknown-state",
    );
    await expect(unknownMessage).toContainText(
      "Unknown state must not hide this message.",
    );
    await expect(
      page.getByTestId("whatsapp-message-e2e-wa-unknown-state-repeat"),
    ).toContainText("A repeated unknown state is still visible.");
    await expect(unknownMessage.locator(".c3wa-message-receipt")).toHaveCount(
      0,
    );
    await expect(
      page.getByTestId("whatsapp-message-e2e-wa-inbound-received-state"),
    ).toContainText("Inbound received state remains visible.");
    await expect.poll(() => stateWarnings.length).toBe(1);
  });

  test("Outreach approved card sends the exact batch after confirmation", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page, "light", {
      batchVariant: variants.approved,
    });
    const card = await openApprovedCardFromHome(page, "Outreach");
    await card.getByRole("button", { name: "Send now (test)" }).click();
    const dialog = page.getByTestId("whatsapp-send-now-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Send now", exact: true }).click();
    await expectSendNowCommand(page);
  });

  test("Scout DM approved card sends the exact batch after confirmation", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page, "light", {
      batchVariant: variants.approved,
    });
    const card = await openApprovedCardFromHome(page, "Scout");
    await card.getByRole("button", { name: "Send now (test)" }).click();
    const dialog = page.getByTestId("whatsapp-send-now-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Send now", exact: true }).click();
    await expectSendNowCommand(page);
  });

  test("approved card opens WhatsApp chats from the channel", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page, "light", {
      batchVariant: variants.approved,
    });
    const card = await openApprovedCardFromHome(page, "Outreach");
    await card.getByRole("button", { name: "Open chats" }).click();
    await expect(page.getByTestId("whatsapp-outreach")).toBeVisible();
  });

  test("pending card changes to approved after approving without reloading", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page, "light", {
      batchVariant: variants.pending,
    });
    await openChannelFromHome(page, "Outreach");
    await emitBatchNotice(page, "Outreach");
    const pendingCard = page.getByTestId("whatsapp-channel-batch-pending");
    await expect(
      pendingCard.getByRole("button", { name: "Approve and send" }),
    ).toBeVisible();
    await expect(
      pendingCard.getByRole("button", { name: "Review each message" }),
    ).toBeVisible();
    await expect(
      pendingCard.getByRole("button", { name: "Reject" }),
    ).toBeVisible();
    await pendingCard.getByRole("button", { name: "Approve and send" }).click();
    const approvedCard = page.getByTestId("whatsapp-channel-batch-approved");
    await expect(approvedCard).toBeVisible();
    await expect(
      approvedCard.getByRole("button", { name: "Approve and send" }),
    ).toHaveCount(0);
    await expect(
      approvedCard.getByRole("button", { name: "Reject" }),
    ).toHaveCount(0);
    await expect(
      approvedCard.getByRole("button", { name: "Send now (test)" }),
    ).toBeVisible();
  });

  test("rejected and fully sent batches have no actions", async ({ page }) => {
    await installWhatsAppMockBridge(page, "light");
    for (const [variant, testId, title] of [
      [
        variants.rejected,
        "whatsapp-channel-batch-rejected",
        "WhatsApp batch rejected",
      ],
      [
        variants.sent,
        "whatsapp-channel-batch-sent-state",
        "WhatsApp batch sent",
      ],
    ] as const) {
      await page.goto(`/?__waBatch=${variant}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByTestId("home-inbox")).toBeVisible();
      await page.getByTestId("channel-Outreach").click();
      await expect(page.getByTestId("chat-title")).toHaveText("Outreach");
      await emitBatchNotice(page, "Outreach");
      const card = page.getByTestId(testId);
      await expect(card).toContainText(title);
      await expect(card.getByRole("button")).toHaveCount(0);
    }
  });

  test("genuinely missing batch is one plain line with no actions", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page, "light", {
      batchVariant: variants.missing,
    });
    await openChannelFromHome(page, "Outreach");
    await emitBatchNotice(page, "Outreach");
    const card = page.getByTestId("whatsapp-channel-batch-unavailable");
    await expect(card).toHaveText("This batch is no longer available.");
    await expect(card.getByRole("button")).toHaveCount(0);
    await expect(card.getByRole("heading")).toHaveCount(0);
  });

  for (const actorCase of [
    { name: "plain member", actor: { relayRole: "member" as const } },
    {
      name: "agent",
      actor: { relayRole: "owner" as const, profileIsAgent: true },
    },
  ]) {
    test(`${actorCase.name} cannot use send now on an approved card`, async ({
      page,
    }) => {
      await installWhatsAppMockBridge(page, "light", {
        ...actorCase.actor,
        batchVariant: variants.approved,
      });
      await openChannelFromHome(page, "Outreach");
      await emitBatchNotice(page, "Outreach");
      const card = page.getByTestId("whatsapp-channel-batch-approved");
      await expect(card).toBeVisible();
      await expect(
        card.getByRole("button", { name: "Send now (test)" }),
      ).toHaveCount(0);
      await expect(
        card.getByRole("button", { name: "Open chats" }),
      ).toBeVisible();
    });
  }

  for (const theme of ["light", "dark"] as const) {
    for (const viewport of [
      { label: "1440", width: 1440, height: 900 },
      { label: "390", width: 390, height: 844 },
    ]) {
      test(`pending, approved, and rejected cards screenshot at ${viewport.label} ${theme}`, async ({
        page,
      }, testInfo) => {
        test.setTimeout(120_000);
        await installWhatsAppMockBridge(page, theme);
        await page.setViewportSize({
          width: 1440,
          height: 900,
        });
        const artifactDir = resolve(
          process.env.COLONY_WA_DECIDED_ARTIFACT_DIR ??
            "test-results/wa-decided-card",
        );
        mkdirSync(artifactDir, { recursive: true });
        for (const state of ["pending", "approved", "rejected"] as const) {
          const variant = variants[state];
          await page.setViewportSize({ width: 1440, height: 900 });
          await page.goto(`/?__waBatch=${variant}`, {
            waitUntil: "domcontentloaded",
          });
          await expect(page.getByTestId("home-inbox")).toBeVisible();
          await page.getByTestId("channel-Outreach").click();
          await expect(page.getByTestId("chat-title")).toHaveText("Outreach");
          await emitBatchNotice(page, "Outreach");
          const testId =
            state === "pending"
              ? "whatsapp-channel-batch-pending"
              : state === "approved"
                ? "whatsapp-channel-batch-approved"
                : "whatsapp-channel-batch-rejected";
          const card = page.getByTestId(testId);
          await expect(card).toBeVisible();
          await page.setViewportSize({
            width: viewport.width,
            height: viewport.height,
          });
          await expect(card).toBeVisible();
          await waitForAnimations(page);
          await card.screenshot({
            path: resolve(
              artifactDir,
              `wa-decided-${state}-${viewport.label}-${theme}.png`,
            ),
          });
          await page.goto("/");
        }
        testInfo.annotations.push({
          type: "artifact-dir",
          description: artifactDir,
        });
      });
    }
  }
});
