import { expect, test } from "@playwright/test";

import {
  JACARANDA_WA_ID,
  OAKLEAF_WA_ID,
  PLANE_TREE_LEAD_ID,
  PLANE_TREE_WA_ID,
  OUTREACH_CHANNEL_ID,
  WHATSAPP_BATCH_ID,
  installWhatsAppMockBridge,
  gotoWhatsAppScreen,
} from "../helpers/whatsappOutreach";

test.describe("WhatsApp outreach conversations and approvals", () => {
  test("sends a queued message now from the WhatsApp chats tab after confirmation", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoWhatsAppScreen(
      page,
      `/channels/${OUTREACH_CHANNEL_ID}`,
      "batch=send-now",
    );
    await page.getByTestId("channel-whatsapp-chats-trigger").click();

    const outreach = page.getByTestId("whatsapp-outreach");
    await expect(outreach).toBeVisible();
    await outreach.getByTestId(`whatsapp-contact-${JACARANDA_WA_ID}`).click();
    const queuedMessage = page.getByTestId(
      "whatsapp-message-e2e-wa-jacaranda-held-template",
    );
    await expect(queuedMessage).toContainText(
      /Sends (today at \d{2}:\d{2}|tomorrow at 08:00)/u,
    );
    await queuedMessage
      .getByRole("button", { name: "Send now (test)" })
      .click();

    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toContainText("Send now, outside 08:00 to 18:00?");
    await expect(dialog).toContainText(
      "Use this for tests to your own number.",
    );
    await dialog.getByRole("button", { name: "Send now", exact: true }).click();

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            window.__BUZZ_E2E_WHATSAPP_STATE__?.commands.find(
              ({ kind, body }) =>
                kind === 47049 &&
                body.batchId === "e2e-whatsapp-batch" &&
                body.decision === "send_now",
            )?.body,
        ),
      )
      .toEqual({
        v: 1,
        batchId: "e2e-whatsapp-batch",
        decision: "send_now",
      });
  });

  test("reviews a pending batch from WhatsApp settings", async ({ page }) => {
    await installWhatsAppMockBridge(page);
    await gotoWhatsAppScreen(page, "/settings?section=whatsapp");

    const settings = page.getByTestId("whatsapp-settings");
    const pendingBatches = settings.getByTestId("whatsapp-pending-batches");
    await expect(pendingBatches.getByRole("heading")).toHaveText(
      "Waiting for your approval",
    );
    await expect(
      pendingBatches.getByTestId(/whatsapp-pending-batch-/),
    ).toHaveCount(2);
    const firstBatch = pendingBatches.getByTestId(
      "whatsapp-pending-batch-e2e-whatsapp-batch",
    );
    await expect(firstBatch).toContainText("Built a site for you");
    await expect(firstBatch).toContainText("3 rows");
    await expect(firstBatch).toContainText("Created by Scout");
    await expect(firstBatch).toContainText("10:46");

    await firstBatch.getByRole("button", { name: "Review" }).click();
    await expect(page.getByTestId("whatsapp-batch-page")).toBeVisible();
    await expect(page).toHaveURL(/whatsappBatchId=e2e-whatsapp-batch/u);
    await page.getByRole("button", { name: /Approve all/u }).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.__BUZZ_E2E_WHATSAPP_STATE__?.commands.some(
            ({ kind, body }) =>
              kind === 47049 &&
              body.batchId === "e2e-whatsapp-batch" &&
              body.decision === "approve",
          ),
        ),
      )
      .toBe(true);
  });

  test("switches settings sections without leaving the settings route", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoWhatsAppScreen(page, "/settings?section=whatsapp");

    const settings = page.getByTestId("whatsapp-settings");
    await expect(settings).toBeVisible();
    const settingsUrl = page.url();
    const tabs = settings.getByRole("navigation", {
      name: "WhatsApp sections",
    });
    for (const [label, sectionId] of [
      ["Number", "wa-number"],
      ["Sending", "wa-sending"],
      ["Templates", "wa-templates"],
    ]) {
      await tabs.getByText(label, { exact: true }).click();
      await expect(page).toHaveURL(settingsUrl);
      await expect(settings).toBeVisible();
      await expect(settings.locator(`#${sectionId}`)).toBeInViewport();
      const activeTab = tabs.getByRole("button", { name: label });
      await expect(activeTab).toHaveAttribute("type", "button");
      await expect(activeTab).toHaveAttribute("aria-current", "page");
    }

    const numberTab = tabs.getByRole("button", { name: "Number" });
    await numberTab.focus();
    await numberTab.press("Enter");
    await expect(page).toHaveURL(settingsUrl);
    await expect(settings.locator("#wa-number")).toBeInViewport();
  });

  test("shows live conversation states, approves an agent draft, and sends owner replies directly", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoWhatsAppScreen(page, `/channels/${OUTREACH_CHANNEL_ID}`);
    await page.getByRole("button", { name: "WhatsApp chats" }).click();

    const outreach = page.getByTestId("whatsapp-outreach");
    await expect(outreach).toBeVisible();
    await expect(page.getByRole("heading", { name: "Chats" })).toBeVisible();
    await expect(
      page.getByTestId(`whatsapp-contact-${PLANE_TREE_WA_ID}`),
    ).toBeVisible();
    await expect(
      page.getByTestId("whatsapp-message-e2e-wa-inbound-button"),
    ).toContainText("Yes, tell me more");
    await expect(
      page.getByText("Has a website: open to a chat?", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Read", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText("Approved by Basheer Phiri in a batch", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Not delivered. WhatsApp only takes images up to 5 MB.", {
        exact: true,
      }),
    ).toBeVisible();

    const draft = page.getByTestId("whatsapp-draft-e2e-wa-agent-draft");
    await expect(draft.getByText("Draft by Aya, needs your OK")).toBeVisible();
    const reply = page.getByTestId("whatsapp-reply-input");
    await expect(reply).toBeEnabled();
    await reply.fill("Thanks, I will send the booking details this afternoon.");
    await page.getByTestId("whatsapp-send-message").click();
    const ownerSend = await page.evaluate(() =>
      window.__BUZZ_E2E_WHATSAPP_STATE__?.commands.at(-1),
    );
    expect(ownerSend?.kind).toBe(47050);
    expect(ownerSend?.body.text).toBe(
      "Thanks, I will send the booking details this afternoon.",
    );
    await expect(draft).toBeVisible();

    await draft.getByRole("button", { name: "Edit" }).click();
    const changedDraft =
      "I can tailor your preview to your rooms and booking flow. Would Friday work?";
    await page.getByTestId("whatsapp-draft-edit").fill(changedDraft);
    await draft.getByRole("button", { name: "Save and send" }).click();
    await expect(
      page.getByTestId("whatsapp-draft-e2e-wa-agent-draft"),
    ).toHaveCount(0);
    const draftDecision = await page.evaluate(() =>
      window.__BUZZ_E2E_WHATSAPP_STATE__?.commands.find(
        ({ kind, body }) =>
          kind === 47049 && body.draftId === "e2e-wa-agent-draft",
      ),
    );
    expect(draftDecision?.body).toMatchObject({
      decision: "approve",
      text: changedDraft,
    });

    await page.getByTestId(`whatsapp-contact-${JACARANDA_WA_ID}`).click();
    await expect(
      page.getByText(
        "Reply window closed. Choose an approved template to send a new message.",
      ),
    ).toBeVisible();
    await expect(page.getByTestId("whatsapp-reply-input")).toBeDisabled();
    await page.getByRole("button", { name: "Use a template" }).click();
    await page
      .getByRole("dialog", { name: "Choose a template" })
      .getByRole("button", { name: /Follow-up: checking in/ })
      .click();
    await page.getByTestId("whatsapp-send-message").click();
    const followUpSend = await page.evaluate(() =>
      window.__BUZZ_E2E_WHATSAPP_STATE__?.commands.at(-1),
    );
    expect(followUpSend?.kind).toBe(47050);
    expect(followUpSend?.body).toMatchObject({
      template: { name: "hl_fu_v2" },
    });

    await page.getByRole("tab", { name: "Opted out" }).click();
    await page.getByTestId(`whatsapp-contact-${OAKLEAF_WA_ID}`).click();
    await expect(page.getByText("This contact opted out.")).toBeVisible();
    await expect(page.getByTestId("whatsapp-reply-input")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Use a template" }),
    ).toBeDisabled();
  });

  test("edits and removes batch rows before approval, then shows paced progress and cap rollover", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoWhatsAppScreen(page, `/whatsapp/batches/${WHATSAPP_BATCH_ID}`);

    const batch = page.getByTestId("whatsapp-batch-page");
    await expect(batch).toBeVisible();
    await expect(batch.locator(".c3wa-batch-template-label")).toContainText(
      "Built a site for you",
    );
    await expect(
      page
        .getByTestId("whatsapp-batch-row-0")
        .getByText("Jacaranda Lane Guesthouse", { exact: true }),
    ).toBeVisible();
    await expect(batch.locator(".c3wa-batch-first-preview")).toContainText(
      "Hey, my name's Pam from Horizon Labs",
    );

    const firstRow = page.getByTestId("whatsapp-batch-row-0");
    await firstRow.getByRole("button", { name: "Edit" }).click();
    await page
      .getByRole("textbox", { name: "Row 1 variable 1" })
      .fill("guest lodges");
    await expect(firstRow.locator(".c3wa-batch-preview")).toContainText(
      "guest lodges in Melville",
    );
    await firstRow.getByRole("button", { name: "Save edit" }).click();

    const rowToRemove = page.getByTestId("whatsapp-batch-row-1");
    await rowToRemove.getByRole("button", { name: "Remove" }).click();
    await expect(rowToRemove).toContainText(
      "This row will be removed when you approve.",
    );
    await page.getByRole("button", { name: "Approve all 2" }).click();

    const progress = page.getByTestId("whatsapp-batch-progress");
    await expect(progress).toContainText("1 of 3 sent");
    await expect(
      page.getByRole("heading", {
        name: "Messaging 3 guesthouses in Melville",
      }),
    ).toBeVisible();
    await expect(batch.locator(".c3wa-batch-first-preview")).toHaveCount(0);
    await expect(progress.locator(".c3wa-batch-progress-stats")).toContainText(
      "11:40",
    );
    await expect(
      progress.locator(".c3wa-batch-progress-stats .is-held"),
    ).toContainText("1");
    await expect(page.getByTestId("whatsapp-batch-row-2")).toContainText(
      "Tomorrow",
    );
    const batchDecision = await page.evaluate(() =>
      window.__BUZZ_E2E_WHATSAPP_STATE__?.commands.find(
        ({ kind, body }) =>
          kind === 47049 && body.batchId === "e2e-whatsapp-batch",
      ),
    );
    expect(batchDecision?.body).toMatchObject({
      decision: "approve",
      dropRows: [1],
      editRows: [
        {
          idx: 0,
          params: [
            "guest lodges",
            "Melville, Johannesburg",
            "https://preview.horizonlabs.example/jacaranda-lane/",
          ],
        },
      ],
    });
  });

  test("rejects a pending first-message batch without showing send progress", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoWhatsAppScreen(page, `/whatsapp/batches/${WHATSAPP_BATCH_ID}`);

    await page.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Batch rejected" }),
    ).toBeVisible();
    await expect(
      page.getByText("No messages were sent.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("whatsapp-batch-progress")).toHaveCount(0);
    const rejection = await page.evaluate(() =>
      window.__BUZZ_E2E_WHATSAPP_STATE__?.commands.find(
        ({ kind, body }) =>
          kind === 47049 &&
          body.batchId === "e2e-whatsapp-batch" &&
          body.decision === "reject",
      ),
    );
    expect(rejection?.body).toMatchObject({ decision: "reject" });
  });

  test("lead rows and lead detail expose WhatsApp status and open the linked thread", async ({
    page,
  }) => {
    await installWhatsAppMockBridge(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoWhatsAppScreen(page, "/leads");

    const leads = page.getByTestId("w10-leads-page");
    await expect(
      leads.getByRole("columnheader", { name: "WhatsApp" }),
    ).toBeVisible();
    const leadRow = leads
      .getByRole("row")
      .filter({ hasText: "Plane Tree Guesthouse" });
    await expect(leadRow).toContainText("Replied");
    await leadRow.getByRole("button", { name: "Open chat" }).click();
    await expect(page.getByTestId("whatsapp-outreach")).toBeVisible();
    await expect(page.getByTestId("work-area-panel")).toBeVisible();
    await expect(
      page.getByTestId(`whatsapp-contact-${PLANE_TREE_WA_ID}`),
    ).toHaveAttribute("aria-current", "true");
    await expect(page.locator(".c3wa-thread-head-desktop")).toContainText(
      "Thandeka · +27 82 *** 7135 · Parkhurst",
    );

    await gotoWhatsAppScreen(page, "/leads", "batch=leads");
    await leads.getByLabel("WhatsApp status").selectOption("in-batch");
    const activeBatchRows = leads.getByRole("row").filter({
      has: page.getByText("In batch", { exact: true }),
    });
    await expect(activeBatchRows).toHaveCount(2);
    await expect(
      activeBatchRows
        .filter({ hasText: "Melville Hill Cottages" })
        .getByRole("button", { name: "View batch" }),
    ).toBeVisible();

    await gotoWhatsAppScreen(page, `/sales/lead/${PLANE_TREE_LEAD_ID}`);
    const leadDetail = page.getByTestId("w10-prospect-page");
    const whatsAppCard = leadDetail.getByTestId("whatsapp-lead-detail-card");
    await expect(
      whatsAppCard.getByRole("heading", { name: "WhatsApp" }),
    ).toBeVisible();
    await expect(
      whatsAppCard.getByText("Replied", { exact: true }),
    ).toBeVisible();
    await expect(whatsAppCard).toContainText(
      "This looks great! What would it cost?",
    );
    await expect(whatsAppCard).toContainText("Has a website: open to a chat?");
    await expect(
      leadDetail.getByRole("button", { name: "Go to #Outreach" }),
    ).toBeVisible();
    await whatsAppCard.getByRole("button", { name: "Open chat" }).click();
    await expect(page.getByTestId("whatsapp-outreach")).toBeVisible();
    await expect(page.getByTestId("work-area-panel")).toBeVisible();
    await expect(
      page.getByTestId(`whatsapp-contact-${PLANE_TREE_WA_ID}`),
    ).toHaveAttribute("aria-current", "true");
  });
});
