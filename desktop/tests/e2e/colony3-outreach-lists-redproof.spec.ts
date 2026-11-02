import {
  chromium,
  expect,
  test as base,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import { installMockBridge } from "../helpers/bridge";

const OWNER_PUBKEY = "deadbeef".repeat(8);
const appPort = Number(process.env.COLONY_E2E_PORT ?? 4173);
const test = base.extend({
  // Playwright requires the fixture argument to use object destructuring.
  // biome-ignore lint/correctness/noEmptyPattern: This fixture creates its own context.
  context: async ({}, use) => {
    const profile = process.env.OL_UI_CHROME_PROFILE;
    const options = {
      baseURL: `http://127.0.0.1:${appPort}`,
      viewport: { width: 1440, height: 900 },
    };
    if (profile) {
      const context = await chromium.launchPersistentContext(profile, {
        ...options,
        headless: true,
        channel: "chrome",
        args: ["--use-mock-keychain", "--password-store=basic"],
      });
      try {
        await use(context);
      } finally {
        await context.close();
      }
      return;
    }
    const browser = await chromium.launch({
      headless: true,
      channel: "chrome",
      args: ["--use-mock-keychain", "--password-store=basic"],
    });
    const context: BrowserContext = await browser.newContext(options);
    try {
      await use(context);
    } finally {
      await browser.close();
    }
  },
  page: async ({ context }, use) => {
    const page = context.pages()[0] ?? (await context.newPage());
    await use(page);
  },
});

function ownerLeadFixture() {
  const relaySecret = generateSecretKey();
  return {
    relaySelf: getPublicKey(relaySecret),
    companyMemberRelayPrivateKeyHex: bytesToHex(relaySecret),
    referenceWorkspace: true,
    referenceWorkspaceRole: "owner" as const,
    referenceWorkspaceLongLeadNames: true,
    referenceWorkspaceLeadCount: 8,
    referenceWorkspaceMissingLeadFields: true,
    relayRole: "owner" as const,
    relayRequiresMembership: true,
    relayMembers: [{ pubkey: OWNER_PUBKEY, role: "owner" as const }],
  };
}

async function mockLeadLogos(page: Page) {
  await page.route("https://img.logo.dev/**", async (route) => {
    await route.fulfill({
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#d9e7e3"/></svg>',
      contentType: "image/svg+xml",
    });
  });
}

test.describe("Outreach lists red proof", () => {
  test("an owner can select a lead and open Add to outreach list", async ({
    page,
  }) => {
    await mockLeadLogos(page);
    await installMockBridge(page, ownerLeadFixture());
    await page.goto("/#/leads", { waitUntil: "domcontentloaded" });

    const leads = page.getByTestId("w10-leads-page");
    await expect(leads).toBeVisible();
    const firstLeadCheckbox = leads.getByRole("checkbox").first();
    await expect(firstLeadCheckbox).toBeVisible();
    await firstLeadCheckbox.check();

    const selection = page.getByRole("toolbar", { name: "Selected leads" });
    await expect(selection).toBeVisible();
    await expect(
      selection.getByRole("button", { name: "Add to outreach list" }),
    ).toBeVisible();
  });
});
