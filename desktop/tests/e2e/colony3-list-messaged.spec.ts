import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import {
  REFERENCE_LIST_MESSAGED_IDS,
  REFERENCE_PROSPECT_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const SCREENSHOT_DIR = process.env.LIST_MESSAGED_SCREENSHOT_DIR;
const RELAY_SECRET = generateSecretKey();
const RELAY_SELF = getPublicKey(RELAY_SECRET);

type ContactMode = "ready" | "loading" | "error";

const LEAD_IDS = {
  partlyMessaged: REFERENCE_PROSPECT_IDS["woven-living"],
  finishedFirst: REFERENCE_PROSPECT_IDS["the-olive-house"],
  finishedSecond: REFERENCE_PROSPECT_IDS["quiet-owl-bb"],
} as const;

type ListMessagedWindow = Window & {
  __BUZZ_E2E_WHATSAPP__?: (request: {
    action: "post" | "command";
    body?: Record<string, unknown>;
    kind?: number;
    path?: string;
  }) => Promise<unknown>;
  __LIST_MESSAGED_RELEASE_CONTACTS__?: () => void;
};

async function installWhatsAppFixture(page: Page, mode: ContactMode) {
  await page.addInitScript(
    ({ contactsMode, leadIds }) => {
      const testWindow = window as ListMessagedWindow;
      let currentMode = contactsMode;
      let releaseContacts: (() => void) | undefined;
      const contact = (leadId: string, number: number) => {
        const e164 = `+2782555${String(number).padStart(4, "0")}`;
        return {
          waId: e164.replace(/\D/gu, ""),
          e164,
          displayName: "Reference guesthouse",
          profileName: "Reference guesthouse",
          businessName: "Reference guesthouse",
          website: null,
          label: null,
          leadId,
          ownerPubkey: null,
          threadRootEventId: null,
          lastInboundAt: null,
          lastContactedAt: "2026-11-20T09:00:00Z",
          lastOutboundState: "sent",
          lastFailureSummary: null,
          deliveryFailure: null,
          lastReplyAt: null,
          stage: "contacted",
          stageSetBy: "auto",
          stageChangedAt: "2026-11-20T09:00:00Z",
          queuedFrom: null,
          outreachStatus: null,
          hasSentOutbound: true,
          windowOpen: false,
          windowClosesAt: null,
          optedOut: false,
          paused: false,
          pauseReason: null,
          unanswered: false,
          awaitingApproval: false,
          businessOutreachStopped: false,
          businessStopReason: null,
        };
      };
      const contacts = [
        contact(leadIds.partlyMessaged, 1),
        contact(leadIds.finishedFirst, 2),
        contact(leadIds.finishedSecond, 3),
      ];
      testWindow.__LIST_MESSAGED_RELEASE_CONTACTS__ = () => {
        currentMode = "ready";
        releaseContacts?.();
      };
      testWindow.__BUZZ_E2E_WHATSAPP__ = async (request) => {
        if (
          request.action !== "post" ||
          request.path !== "/api/whatsapp/query"
        ) {
          return {};
        }
        switch (request.body?.what) {
          case "status":
            return {
              connected: true,
              connectionId: "list-messaged-e2e",
              displayPhoneNumber: "+27 61 534 0627",
              verifiedName: "Horizon Labs",
              quality: "GREEN",
              phoneStatus: "CONNECTED",
              dailyNewChatCap: 30,
              newChatsSentToday: 0,
              sendingPaused: false,
              pauseReason: null,
              issues: [],
              outreachChannelId: null,
              templatesSyncedAt: null,
              templates: [],
              webhookUrl: null,
            };
          case "templates":
            return { templates: [] };
          case "contacts":
            if (currentMode === "error") {
              throw new Error("WhatsApp contacts could not load.");
            }
            if (currentMode === "loading") {
              return new Promise((resolveContacts) => {
                releaseContacts = () => resolveContacts({ contacts });
              });
            }
            return { contacts };
          case "batches":
            return { batches: [] };
          default:
            return {};
        }
      };
    },
    { contactsMode: mode, leadIds: LEAD_IDS },
  );
}

async function openLists(
  page: Page,
  options: {
    contactMode?: ContactMode;
    mapShell?: boolean;
    viewport?: { height: number; width: number };
  } = {},
) {
  const contactMode = options.contactMode ?? "ready";
  const viewport = options.viewport ?? { width: 1440, height: 900 };
  await page.addInitScript(() => {
    window.localStorage.setItem("buzz-theme", "buzz");
    window.localStorage.setItem("buzz-follow-system", "false");
  });
  await page.emulateMedia({ colorScheme: "light" });
  await installWhatsAppFixture(page, contactMode);
  await installMockBridge(
    page,
    {
      companyMemberRelayPrivateKeyHex: bytesToHex(RELAY_SECRET),
      cofounderSettings: {
        enabled: true,
        moneyPreference: "cheapest_first",
        approvalSwitches: {
          approveEveryDiscoveryCampaign: false,
          approveEveryHire: false,
          approvePlaybookChanges: false,
        },
      },
      referenceWorkspace: true,
      referenceWorkspaceBusinessName: "Horizon Labs",
      referenceWorkspaceListMessaged: true,
      referenceWorkspaceOutreachBoard: true,
      referenceWorkspaceOutreachReady: true,
      referenceWorkspaceOutreachSidebar: true,
      relayMembers: [{ pubkey: "deadbeef".repeat(8), role: "owner" }],
      relayRequiresMembership: true,
      relayRole: "owner",
      relaySelf: RELAY_SELF,
    },
    options.mapShell
      ? { previewFeatureOverrides: { map_home: true } }
      : undefined,
  );
  await page.setViewportSize(viewport);
  await page.goto("/#/lists");
  await page.reload();
  await expect(page.getByTestId("outreach-lists-page")).toBeVisible();
}

function messagedCount(page: Page, listId: string) {
  return page.getByTestId(`outreach-messaged-${listId}`);
}

function outreachStatus(page: Page, listId: string) {
  return page.getByTestId(`outreach-status-${listId}`);
}

async function capture(page: Page, filename: string) {
  if (!SCREENSHOT_DIR) return;
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  await waitForAnimations(page);
  await page.screenshot({ path: resolve(SCREENSHOT_DIR, filename) });
}

test.describe("Lists messaged count", () => {
  test("uses contact history for counts, effective status, and sidebar filters", async ({
    page,
  }) => {
    await openLists(page);

    const lists = page.getByTestId("outreach-lists-page");
    const table = lists.getByRole("table", { name: "Outreach lists" });
    await expect(page.getByTestId("sidebar-nav-business-toggle")).toBeVisible();
    await expect(page.getByTestId("cofounder-company-map")).toHaveCount(0);
    await expect(table.locator("thead th")).toHaveText([
      "Name",
      "Leads",
      "Messaged",
      "Outreach",
      "Source",
      "Default template",
      "Updated",
    ]);

    await expect(
      messagedCount(page, REFERENCE_LIST_MESSAGED_IDS.untouched),
    ).toContainText("0 of 2");
    await expect(
      outreachStatus(page, REFERENCE_LIST_MESSAGED_IDS.untouched),
    ).toContainText("Not started");
    await expect(
      messagedCount(page, REFERENCE_LIST_MESSAGED_IDS.partlyMessaged),
    ).toContainText("1 of 2");
    await expect(
      messagedCount(page, REFERENCE_LIST_MESSAGED_IDS.partlyMessaged).locator(
        ".sr-only",
      ),
    ).toHaveText("leads messaged");
    await expect(
      outreachStatus(page, REFERENCE_LIST_MESSAGED_IDS.partlyMessaged),
    ).toContainText("In progress");
    await expect(
      messagedCount(page, REFERENCE_LIST_MESSAGED_IDS.finished),
    ).toContainText("2 of 2");
    await expect(
      outreachStatus(page, REFERENCE_LIST_MESSAGED_IDS.finished),
    ).toContainText("Done");
    await expect(
      messagedCount(page, REFERENCE_LIST_MESSAGED_IDS.explicitStatus),
    ).toContainText("0 of 2");
    await expect(
      outreachStatus(page, REFERENCE_LIST_MESSAGED_IDS.explicitStatus),
    ).toContainText("Done");

    await lists.getByRole("link", { name: "Partly messaged" }).click();
    const detail = page.getByTestId("outreach-list-detail");
    await expect(detail.getByTestId("outreach-messaged-detail")).toContainText(
      "1 of 2",
    );
    await expect(detail.getByTestId("outreach-status-detail")).toContainText(
      "In progress",
    );

    await page.goto("/#/lists");
    await expect(lists).toBeVisible();
    await lists
      .locator(".c3l-list-filter-options")
      .getByRole("button", { name: /Not started/u })
      .click();
    await expect(table.locator("tbody tr")).toHaveCount(1);
    await expect(
      table.getByRole("link", { name: "Untouched leads" }),
    ).toBeVisible();
    await expect(
      table.getByRole("link", { name: "Partly messaged" }),
    ).toHaveCount(0);
  });

  test("shows the same derived count and status in the map shell", async ({
    page,
  }) => {
    await openLists(page, { mapShell: true });

    await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
    await expect(page.getByTestId("map-outreach-desk-header")).toBeVisible();
    await expect(
      messagedCount(page, REFERENCE_LIST_MESSAGED_IDS.partlyMessaged),
    ).toContainText("1 of 2");
    await expect(
      outreachStatus(page, REFERENCE_LIST_MESSAGED_IDS.partlyMessaged),
    ).toContainText("In progress");
  });

  test("shows loading instead of a false zero until contacts arrive", async ({
    page,
  }) => {
    await openLists(page, { contactMode: "loading" });

    const count = messagedCount(page, REFERENCE_LIST_MESSAGED_IDS.untouched);
    await expect(count).toContainText("Loading…");
    await expect(count).not.toContainText("0 of 2");
    await page.evaluate(() => {
      (window as ListMessagedWindow).__LIST_MESSAGED_RELEASE_CONTACTS__?.();
    });
    await expect(count).toContainText("0 of 2");
  });

  test("shows an accessible reason when the contact load fails", async ({
    page,
  }) => {
    await openLists(page, { contactMode: "error" });

    const count = messagedCount(page, REFERENCE_LIST_MESSAGED_IDS.untouched);
    await expect(count.locator('[aria-hidden="true"]')).toHaveText("-");
    await expect(count.locator(".sr-only")).toContainText(
      "WhatsApp contacts could not load.",
    );
  });

  test("captures the light Lists overview and detail", async ({ page }) => {
    test.skip(
      !SCREENSHOT_DIR,
      "Set LIST_MESSAGED_SCREENSHOT_DIR to capture proof.",
    );

    await openLists(page, { viewport: { width: 1440, height: 900 } });
    await capture(page, "lists-overview-1440x900.png");
    await page
      .getByTestId("outreach-lists-page")
      .getByRole("link", { name: "Partly messaged" })
      .click();
    await expect(page.getByTestId("outreach-list-detail")).toBeVisible();
    await page.setViewportSize({ width: 1728, height: 1117 });
    await capture(page, "list-detail-1728x1117.png");
  });
});
