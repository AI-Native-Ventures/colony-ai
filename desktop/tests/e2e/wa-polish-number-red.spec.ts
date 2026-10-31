import { expect, test } from "@playwright/test";

import { installWhatsAppMockBridge } from "../helpers/whatsappOutreach";

const waId = "27683735905";
const formattedNumber = "+27 68 373 5905";
const rawNumber = "+27683735905";
type ContactSeed = { contactWaId: string; contactE164: string };

test("unnamed WhatsApp chat header displays only the formatted number", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1000, height: 650 });
  await installWhatsAppMockBridge(page, "light");
  await page.addInitScript(
    ({ contactWaId, contactE164 }: ContactSeed) => {
      type Contact = {
        waId: string;
        e164: string;
        displayName: string;
        leadId: null;
        ownerPubkey: null;
        threadRootEventId: string;
        lastInboundAt: string;
        windowOpen: true;
        windowClosesAt: string;
        optedOut: false;
        paused: false;
        pauseReason: null;
        unanswered: true;
        awaitingApproval: false;
      };
      type State = {
        contacts: Contact[];
        threads: Record<
          string,
          { contact: Contact; messages: Array<Record<string, unknown>> }
        >;
      };
      const state = (
        window as Window & { __BUZZ_E2E_WHATSAPP_STATE__?: unknown }
      ).__BUZZ_E2E_WHATSAPP_STATE__ as State | undefined;
      if (!state) throw new Error("Mock WhatsApp state is missing");
      const contact: Contact = {
        waId: contactWaId,
        e164: contactE164,
        displayName: contactE164,
        leadId: null,
        ownerPubkey: null,
        threadRootEventId: "e2e-wa-polish-unnamed-thread",
        lastInboundAt: "2026-10-30T09:14:00+02:00",
        windowOpen: true,
        windowClosesAt: "2026-11-01T09:14:00+02:00",
        optedOut: false,
        paused: false,
        pauseReason: null,
        unanswered: true,
        awaitingApproval: false,
      };
      state.contacts.unshift(contact);
      state.threads[contactWaId] = { contact, messages: [] };
    },
    { contactWaId: waId, contactE164: rawNumber },
  );

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("home-inbox")).toBeVisible();
  await page.getByTestId("channel-Outreach").click();
  await expect(page.getByTestId("chat-title")).toHaveText("Outreach");
  await page.getByTestId("channel-whatsapp-chats-trigger").click();
  await expect(page.getByTestId("work-area-panel")).toBeVisible();
  await page.getByTestId(`whatsapp-contact-${waId}`).click();

  const header = page.locator(".c3wa-thread-head");
  await expect(header).toBeVisible();
  const headerText = (await header.innerText()).replace(/\s+/gu, " ");
  expect(headerText.split(formattedNumber)).toHaveLength(2);
  expect(headerText).not.toContain(rawNumber);
});
