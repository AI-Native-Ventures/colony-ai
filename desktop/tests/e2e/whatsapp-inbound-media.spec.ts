import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import {
  gotoWhatsAppScreen,
  installWhatsAppMockBridge,
  OUTREACH_CHANNEL_ID,
  PLANE_TREE_WA_ID,
} from "../helpers/whatsappOutreach";
import { REFERENCE_CHANNEL_IDS } from "../../src/testing/e2eReferenceWorkspace";

const SCREENSHOT_DIR = resolve(
  process.cwd(),
  "test-results/whatsapp-inbound-media",
);

const STICKER_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><rect width="160" height="160" rx="36" fill="#fde68a"/><circle cx="58" cy="66" r="10" fill="#1c1917"/><circle cx="102" cy="66" r="10" fill="#1c1917"/><path d="M44 100q36 38 72 0" stroke="#1c1917" stroke-width="9" fill="none" stroke-linecap="round"/></svg>',
  );
const PHOTO_SVG =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><rect width="640" height="420" fill="#bfdbfe"/><rect y="250" width="640" height="170" fill="#86efac"/><rect x="200" y="140" width="240" height="150" fill="#fcd34d"/><path d="M180 150l140-90 140 90z" fill="#b45309"/></svg>',
  );

function silentWav(): string {
  const samples = 8000;
  const header = new ArrayBuffer(44 + samples);
  const view = new DataView(header);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  write(36, "data");
  view.setUint32(40, samples, true);
  new Uint8Array(header, 44).fill(128);
  let binary = "";
  for (const byte of new Uint8Array(header))
    binary += String.fromCharCode(byte);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

type MediaFixture = {
  id: string;
  text: string;
  media: Record<string, unknown>;
};

function base(media: Record<string, unknown>): Record<string, unknown> {
  return {
    state: "stored",
    url: null,
    mime: null,
    size: null,
    opaque: false,
    caption: null,
    filename: null,
    animated: false,
    error: null,
    canRetry: false,
    description: "",
    ...media,
  };
}

function fixtures(): MediaFixture[] {
  return [
    {
      id: "wa-media-sticker",
      text: "[sticker]",
      media: base({ type: "sticker", url: STICKER_SVG, mime: "image/webp" }),
    },
    {
      id: "wa-media-image",
      text: "Our front desk and the garden",
      media: base({
        type: "image",
        url: PHOTO_SVG,
        mime: "image/jpeg",
        caption: "Our front desk and the garden, as it looks today",
      }),
    },
    {
      id: "wa-media-video",
      text: "[video]",
      media: base({ type: "video", url: "data:video/mp4;base64,AAAA" }),
    },
    {
      id: "wa-media-voice",
      text: "[voice note]",
      media: base({ type: "voice", url: silentWav(), mime: "audio/ogg" }),
    },
    {
      id: "wa-media-audio",
      text: "[audio]",
      media: base({ type: "audio", url: silentWav(), mime: "audio/wav" }),
    },
    {
      id: "wa-media-document",
      text: "[document]",
      media: base({
        type: "document",
        url: "https://acme.example/media/doc.pdf",
        filename:
          "Kensington-Guest-House-quote-request-with-a-very-long-name-2026.pdf",
        mime: "application/pdf",
        size: 482_113,
      }),
    },
    {
      id: "wa-media-location",
      text: "[location] Kensington Guest House",
      media: base({
        type: "location",
        state: "none",
        name: "Kensington Guest House",
        address: "12 Main Road, Kensington, Johannesburg, 2094, South Africa",
        latitude: -26.2041,
        longitude: 28.0473,
      }),
    },
    {
      id: "wa-media-contacts",
      text: "[contact card] Sipho Dlamini",
      media: base({
        type: "contacts",
        state: "none",
        contacts: [
          {
            name: "Sipho Dlamini",
            phones: ["+27 82 111 2222", "+27 11 000 1111"],
          },
          { name: "Anele", phones: [] },
        ],
      }),
    },
    {
      id: "wa-media-pending",
      text: "[sticker]",
      media: base({ type: "sticker", state: "pending" }),
    },
    {
      id: "wa-media-failed",
      text: "[sticker]",
      media: base({
        type: "sticker",
        state: "failed",
        error: "timeout",
        canRetry: true,
      }),
    },
    {
      id: "wa-media-gone",
      text: "[image]",
      media: base({ type: "image", state: "gone", error: "not_found" }),
    },
    {
      id: "wa-media-large",
      text: "[document]",
      media: base({
        type: "document",
        state: "failed",
        error: "too_large",
        filename: "big.zip",
      }),
    },
  ];
}

async function seedMedia(page: Page, items: MediaFixture[]) {
  await page.addInitScript(
    ({ waId, rows }) => {
      const state = (
        window as unknown as {
          __BUZZ_E2E_WHATSAPP_STATE__?: {
            threads: Record<
              string,
              { messages: Array<Record<string, unknown>> }
            >;
          };
        }
      ).__BUZZ_E2E_WHATSAPP_STATE__;
      const thread = state?.threads[waId];
      if (!thread) throw new Error("The Plane Tree mock thread is missing");
      rows.forEach((row, index) => {
        thread.messages.push({
          id: row.id,
          waId,
          direction: "in",
          kind: "media",
          text: row.text,
          templateName: null,
          state: "read",
          errorCode: null,
          errorText: null,
          eventId: null,
          senderPubkey: null,
          createdAt: new Date(Date.UTC(2026, 9, 30, 8, index, 0)).toISOString(),
          media: row.media,
        });
      });
    },
    { waId: PLANE_TREE_WA_ID, rows: items },
  );
}

async function openChat(page: Page, width: number, readyId: string) {
  await gotoWhatsAppScreen(
    page,
    `/channels/${width < 600 ? REFERENCE_CHANNEL_IDS.sales : OUTREACH_CHANNEL_ID}`,
  );
  await expect(page.getByTestId("chat-title")).toBeVisible();
  if (width < 600) {
    const opened = await page.evaluate(() => {
      const trigger = document.querySelector<HTMLButtonElement>(
        '[data-testid="channel-whatsapp-chats-trigger"]',
      );
      if (!trigger) return false;
      trigger.click();
      return true;
    });
    expect(opened).toBe(true);
  } else {
    await page.getByTestId("channel-whatsapp-chats-trigger").click();
  }
  const outreach = page.getByTestId("whatsapp-outreach");
  await expect(outreach).toBeVisible();
  // On a phone the chat list opens straight into the first chat, which is this one.
  if (width >= 600) {
    await outreach.getByTestId(`whatsapp-contact-${PLANE_TREE_WA_ID}`).click();
  }
  await expect(page.getByTestId(`whatsapp-message-${readyId}`)).toBeAttached();
}

/** Every element of a message stays inside the message column, at any width. */
async function expectInsideColumn(page: Page, messageId: string) {
  const row = page.getByTestId(`whatsapp-message-${messageId}`);
  await row.scrollIntoViewIfNeeded();
  await expect(row).toBeVisible();
  const report = await row.evaluate((element) => {
    const content = element.querySelector(".c3wa-message-content");
    if (!content)
      return { missing: true, offenders: [] as string[], overflow: false };
    const column = content.getBoundingClientRect();
    const offenders = Array.from(content.querySelectorAll("*"))
      .filter((child) => {
        const box = child.getBoundingClientRect();
        return (
          box.width > 0 &&
          (box.right > column.right + 1 || box.left < column.left - 1)
        );
      })
      .map((child) => `${child.tagName}.${String(child.className)}`);
    return {
      missing: false,
      offenders,
      overflow: content.scrollWidth > content.clientWidth + 1,
    };
  });
  expect(report.missing).toBe(false);
  expect(report.offenders).toEqual([]);
  expect(report.overflow).toBe(false);
}

async function expectNoPageScroll(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

type Check = (page: Page, message: Locator) => Promise<void>;

/** What each kind of message must show. */
const CHECKS: Record<string, Check> = {
  "wa-media-sticker": async (_page, message) => {
    // A sticker is a picture with no bubble and no placeholder text.
    const sticker = message.getByTestId("whatsapp-media-sticker");
    await expect(sticker).toBeVisible();
    await expect(message).not.toContainText("[sticker]");
    await expect
      .poll(() => sticker.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
  },
  "wa-media-image": async (page, message) => {
    // A photo opens in the lightbox and keeps its caption.
    await expect(message).toContainText("Our front desk and the garden");
    await message.getByTestId("whatsapp-media-image").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  },
  "wa-media-video": async (_page, message) => {
    await expect(message.getByTestId("whatsapp-media-video")).toBeVisible();
  },
  "wa-media-voice": async (_page, message) => {
    await expect(message.getByTestId("whatsapp-media-audio")).toBeVisible();
  },
  "wa-media-audio": async (_page, message) => {
    await expect(message.getByTestId("whatsapp-media-audio")).toBeVisible();
  },
  "wa-media-document": async (_page, message) => {
    await expect(message.getByTestId("file-card")).toContainText(
      "Kensington-Guest-House-quote-request",
    );
  },
  "wa-media-location": async (_page, message) => {
    await expect(message).toContainText("Kensington Guest House");
    await expect(
      message.getByRole("link", { name: "Open in Maps" }),
    ).toHaveAttribute("href", "https://www.google.com/maps?q=-26.2041,28.0473");
  },
  "wa-media-contacts": async (_page, message) => {
    await expect(message).toContainText("Sipho Dlamini");
    await expect(
      message.getByRole("link", { name: /\+27 82 111 2222/u }),
    ).toHaveAttribute("href", "tel:+27821112222");
  },
  "wa-media-pending": async (_page, message) => {
    await expect(message.getByTestId("whatsapp-media-pending")).toContainText(
      "Loading sticker",
    );
  },
  "wa-media-failed": async (_page, message) => {
    await expect(message).toContainText("Sticker could not be loaded");
    await expect(message.getByTestId("whatsapp-media-retry")).toBeVisible();
  },
  "wa-media-gone": async (_page, message) => {
    await expect(message).toContainText("Photo is no longer available");
    await expect(message.getByTestId("whatsapp-media-retry")).toHaveCount(0);
  },
  "wa-media-large": async (_page, message) => {
    await expect(message).toContainText("Document is too large to show");
    await expect(message.getByTestId("whatsapp-media-retry")).toHaveCount(0);
  },
};

async function checkAndShoot(page: Page, ids: string[], shot: string) {
  for (const id of ids) {
    const message = page.getByTestId(`whatsapp-message-${id}`);
    // Pictures load as they scroll into view.
    await message.scrollIntoViewIfNeeded();
    await CHECKS[id](page, message);
    // Nothing leaves its card, at this width.
    await expectInsideColumn(page, id);
  }
  await expectNoPageScroll(page);
  await page
    .getByTestId(`whatsapp-message-${ids[ids.length - 1]}`)
    .scrollIntoViewIfNeeded();
  await waitForAnimations(page);
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, `${shot}.png`) });
}

test.describe("WhatsApp inbound media", () => {
  test("every type shows properly in the chat and stays inside its card at 1440x900", async ({
    page,
  }) => {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await installWhatsAppMockBridge(page);
    await seedMedia(page, fixtures());
    await openChat(page, 1440, "wa-media-large");
    const ids = fixtures().map((fixture) => fixture.id);
    await checkAndShoot(page, ids.slice(0, 4), "chat-1440x900-a");
    await checkAndShoot(page, ids.slice(4, 7), "chat-1440x900-b");
    await checkAndShoot(page, ids.slice(7), "chat-1440x900-c");
  });

  // A phone shows only the last three messages of a chat (older ones are folded away by
  // design), so the types are checked three at a time, each group as the newest messages.
  const allPhoneFixtureIds = fixtures().map((fixture) => fixture.id);
  const phoneGroups = Array.from(
    { length: Math.ceil(allPhoneFixtureIds.length / 3) },
    (_, index) => allPhoneFixtureIds.slice(index * 3, index * 3 + 3),
  );
  for (const [index, ids] of phoneGroups.entries()) {
    test(`phone: every type stays inside its card at 390x844, group ${index + 1} (${ids.join(", ")})`, async ({
      page,
    }) => {
      mkdirSync(SCREENSHOT_DIR, { recursive: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await installWhatsAppMockBridge(page);
      const all = fixtures();
      const last = all.findIndex(
        (fixture) => fixture.id === ids[ids.length - 1],
      );
      await seedMedia(page, all.slice(0, last + 1));
      await openChat(page, 390, ids[ids.length - 1]);
      await checkAndShoot(page, ids, `chat-390x844-${index}`);
    });
  }

  test("Retry on a failed download asks the relay to try again", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installWhatsAppMockBridge(page);
    await seedMedia(page, fixtures());
    await openChat(page, 1440, "wa-media-failed");

    const failed = page.getByTestId("whatsapp-message-wa-media-failed");
    await failed.getByTestId("whatsapp-media-retry").click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                __BUZZ_E2E_WHATSAPP_STATE__?: {
                  commands: Array<{
                    kind: number;
                    body: Record<string, unknown>;
                  }>;
                };
              }
            ).__BUZZ_E2E_WHATSAPP_STATE__?.commands.filter(
              (command) => command.body.retryMedia !== undefined,
            ) ?? [],
        ),
      )
      .toEqual([
        {
          kind: 47052,
          body: {
            v: 1,
            waId: PLANE_TREE_WA_ID,
            retryMedia: "wa-media-failed",
          },
        },
      ]);
  });

  const deskPreviews = [
    { id: "wa-media-sticker", text: "Sent a sticker", thumbnail: true },
    {
      id: "wa-media-image",
      text: "Sent a photo: Our front desk and the garden, as it looks today",
      thumbnail: true,
    },
    { id: "wa-media-video", text: "Sent a video", thumbnail: false },
    { id: "wa-media-voice", text: "Sent a voice note", thumbnail: false },
    { id: "wa-media-audio", text: "Sent an audio file", thumbnail: false },
    {
      id: "wa-media-document",
      text: "Sent Kensington-Guest-House-quote-request-with-a-very-long-name-2026.pdf",
      thumbnail: false,
    },
    {
      id: "wa-media-location",
      text: "Shared a location: Kensington Guest House",
      thumbnail: false,
    },
    {
      id: "wa-media-contacts",
      text: "Shared a contact card",
      thumbnail: false,
    },
  ] as const;

  for (const preview of deskPreviews) {
    test(`desk preview shows each inbound media type: ${preview.id}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await installWhatsAppMockBridge(page, "light", { deskFixture: true });
      const fixture = fixtures().find((item) => item.id === preview.id);
      if (!fixture) throw new Error(`Missing media fixture ${preview.id}`);
      await seedMedia(page, [fixture]);
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("home-inbox")).toBeVisible();
      await page.getByTestId("channel-Outreach").click();
      const card = page.getByTestId(
        `outreach-needs-contact-${PLANE_TREE_WA_ID}`,
      );
      await expect(card).toBeVisible();
      await expect(card).toContainText(preview.text);
      if (fixture.text.startsWith("[")) {
        await expect(card).not.toContainText(fixture.text);
      }
      if (preview.thumbnail) {
        await expect(card.getByTestId("whatsapp-media-thumb")).toBeVisible();
      } else {
        await expect(card.getByTestId("whatsapp-media-thumb")).toHaveCount(0);
      }
      if (preview.id === "wa-media-sticker") {
        mkdirSync(SCREENSHOT_DIR, { recursive: true });
        await waitForAnimations(page);
        await card.screenshot({
          path: resolve(SCREENSHOT_DIR, "desk-card-1440x900.png"),
        });
      }
    });
  }
});
