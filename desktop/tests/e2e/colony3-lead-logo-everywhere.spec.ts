import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  REFERENCE_CHANNEL_IDS,
  REFERENCE_PROSPECT_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import { installMockBridge } from "../helpers/bridge";
import {
  PLANE_TREE_WA_ID,
  WHATSAPP_BATCH_ID,
  gotoWhatsAppScreen,
  installWhatsAppMockBridge,
} from "../helpers/whatsappOutreach";

const FORM_FIELD = REFERENCE_PROSPECT_IDS["form-field"];

async function installLogoImageStub(page: Page) {
  await page.route("https://img.logo.dev/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#56815b"/></svg>',
    }),
  );
}

async function openSales(page: Page) {
  await installMockBridge(page, { referenceWorkspace: true });
  await page.goto(`/#/channels/${REFERENCE_CHANNEL_IDS.sales}`);
  await expect(page.getByTestId("message-input")).toBeVisible();
}

async function emitSalesMessage(page: Page, content: string) {
  await page.waitForFunction(
    () =>
      window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
        channelName: "Sales",
      }) ?? false,
  );
  const event = await page.evaluate((text) => {
    return window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
      channelName: "Sales",
      content: text,
    });
  }, content);
  if (!event) throw new Error("The mock Sales message was not emitted.");
  return event.id;
}

async function expectLogoImage(root: Locator, domain?: string) {
  const image = root.locator(".business-logo-mark img");
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute(
    "src",
    domain
      ? new RegExp(`img\\.logo\\.dev/${domain.replaceAll(".", "\\.")}`, "u")
      : /img\.logo\.dev\//u,
  );
}

test("a lead card in a message uses the stubbed logo.dev image", async ({
  page,
}) => {
  await installLogoImageStub(page);
  await openSales(page);
  await emitSalesMessage(page, `Logo proof: buzz://lead/${FORM_FIELD}`);

  const card = page.getByTestId(`lead-reference-card-${FORM_FIELD}`);
  await expect(card).toBeVisible();
  await expectLogoImage(card, "form-field.example");
});

test("a lead card in a thread uses the stubbed logo.dev image", async ({
  page,
}) => {
  await installLogoImageStub(page);
  await openSales(page);
  const messageId = await emitSalesMessage(
    page,
    `Thread logo proof: buzz://lead/${FORM_FIELD}`,
  );

  const root = page
    .getByTestId("message-timeline")
    .locator(`[data-message-id="${messageId}"]`);
  await expect(root).toBeVisible();
  await root.hover();
  await root.getByRole("button", { name: "Reply" }).click();

  const thread = page.getByTestId("message-thread-panel");
  await expect(thread).toBeVisible();
  const card = thread.getByTestId(`lead-reference-card-${FORM_FIELD}`);
  await expect(card).toBeVisible();
  await expectLogoImage(card, "form-field.example");
});

test("Cmd+K previews a lead link with the stubbed logo.dev image", async ({
  page,
}) => {
  await installLogoImageStub(page);
  await openSales(page);
  const messageId = await emitSalesMessage(
    page,
    `Searchable logo proof buzz://lead/${FORM_FIELD}`,
  );

  await page.getByTestId("open-search").click();
  const dialog = page.getByTestId("search-results");
  await dialog.getByTestId("search-dialog-input").fill("Searchable logo proof");
  const result = dialog.getByTestId(`search-result-${messageId}`);
  await expect(result).toBeVisible();
  const preview = result.getByTestId(`search-lead-preview-${FORM_FIELD}`);
  await expect(preview).toContainText("Form & Field");
  await expectLogoImage(preview, "form-field.example");
});

test("linked Outreach, WhatsApp dock, and batch rows use lead logos", async ({
  page,
}) => {
  await installLogoImageStub(page);
  await installWhatsAppMockBridge(page, "light", { deskFixture: true });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("home-inbox")).toBeVisible();
  await page.getByTestId("channel-Outreach").click();
  await expect(page.getByTestId("chat-title")).toHaveText("Outreach");

  const needsYou = page.getByTestId("outreach-desk-needs-you");
  await expect(needsYou).toBeVisible();
  await expectLogoImage(
    needsYou.locator(".c3wa-desk-contact-logo").first(),
    "form-field.example",
  );

  await page.getByTestId("channel-view-tab-pipeline").click();
  const pipeline = page.getByTestId("outreach-desk-pipeline");
  await expect(pipeline).toBeVisible();
  await expectLogoImage(pipeline.locator(".c3wa-pipeline-logo").first());

  await page.getByTestId("channel-view-tab-chats").click();
  const deskContact = page.getByTestId(`whatsapp-contact-${PLANE_TREE_WA_ID}`);
  await expect(deskContact).toBeVisible();
  await expectLogoImage(deskContact, "form-field.example");
  await deskContact.click();
  await expectLogoImage(
    page.locator(".c3wa-thread-avatar"),
    "form-field.example",
  );

  await gotoWhatsAppScreen(
    page,
    "/channels/e2e-whatsapp-general-channel",
    "batch=identity",
  );
  await page.getByRole("button", { name: "WhatsApp chats" }).click();
  await page.getByRole("tab", { name: "All" }).click();
  const dockContact = page.getByTestId(`whatsapp-contact-${PLANE_TREE_WA_ID}`);
  await expect(dockContact).toBeVisible();
  await expectLogoImage(dockContact, "form-field.example");
  await dockContact.click();
  await expectLogoImage(
    page.locator(".c3wa-thread-avatar"),
    "form-field.example",
  );

  await gotoWhatsAppScreen(
    page,
    `/whatsapp/batches/${WHATSAPP_BATCH_ID}`,
    "batch=identity",
  );
  await expect(page.getByTestId("whatsapp-batch-page")).toBeVisible();
  const batchRow = page.getByTestId("whatsapp-batch-row-0");
  await expect(batchRow).toBeVisible();
  await expectLogoImage(batchRow);
});

test("a failed logo image falls back to the initial mark", async ({ page }) => {
  await page.route("https://img.logo.dev/**", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await openSales(page);
  await emitSalesMessage(page, `Failed logo proof: buzz://lead/${FORM_FIELD}`);

  const mark = page
    .getByTestId(`lead-reference-card-${FORM_FIELD}`)
    .locator(".business-logo-mark");
  await expect(mark.locator("img")).toHaveCount(0);
  await expect(mark.locator(".business-logo-fallback")).toHaveText("F");
});
