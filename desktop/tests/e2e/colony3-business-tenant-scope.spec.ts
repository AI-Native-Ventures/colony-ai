import { expect, test, type Page } from "@playwright/test";

import { KIND_PROSPECT_ACTION } from "../../src/features/discovery/businessRecordContract";
import { MOCK_TENANT_COMMUNITY_ID } from "../../src/testing/e2eTenant";
import { installMockBridge } from "../helpers/bridge";

/**
 * Business records are namespaced by the relay's tenant community UUID
 * (`business:<tenant id>:prospect:<id>`), which is not the desktop's local
 * community id. The mock relay refuses any other namespace exactly as the real
 * one does ("business record d-tag does not match its namespace"), so these
 * specs fail if any save or read goes back to the local id.
 */

const REAL_RUNNER = {
  referenceWorkspace: true,
  referenceWorkspaceDiscoveryStandIn: false,
} as const;

const LOCAL_COMMUNITY_ID = "e2e-default-community";
const RELAY_HOST = new URL(
  process.env.BUZZ_E2E_RELAY_URL ?? "http://localhost:3000",
).host;
const MEMBER_DIRECTORY = /\/api\/communities\/mine(\?.*)?$/;

type CommandLog = Array<{ kind: number; dTag: string; accepted: boolean }>;
type SearchWindow = Window & {
  __discoveryCalls?: Array<Record<string, unknown>>;
};

async function installSearchStub(page: Page) {
  await page.addInitScript(() => {
    const w = window as SearchWindow & {
      __BUZZ_E2E_DISCOVERY_SEARCH__?: (
        request: Record<string, unknown>,
      ) => Promise<unknown>;
    };
    w.__discoveryCalls = [];
    const place = (id: string, name: string) => ({
      placeId: id,
      name,
      category: "Home goods store",
      address: `1 Main Road, ${name}`,
      city: "Johannesburg",
      state: "Gauteng",
      phone: "+27 11 555 0100",
      website: `https://${id}.example`,
      rating: 4.5,
      reviews: 20,
    });
    w.__BUZZ_E2E_DISCOVERY_SEARCH__ = async (request) => {
      w.__discoveryCalls?.push(request);
      return {
        provider: "outscraper",
        places: [
          place("pl-tenant-a", "Tenant Scope Studio"),
          place("pl-tenant-b", "Namespace Goods"),
        ],
        estimatedCostUsd: 0.012,
        nextSkip: null,
      };
    };
  });
}

async function commandLog(page: Page): Promise<CommandLog> {
  return page.evaluate(
    () =>
      (window as Window & { __BUZZ_E2E_BUSINESS_COMMANDS__?: CommandLog })
        .__BUZZ_E2E_BUSINESS_COMMANDS__ ?? [],
  );
}

async function searchCalls(page: Page) {
  return page.evaluate(() => (window as SearchWindow).__discoveryCalls ?? []);
}

async function startCampaign(page: Page) {
  await page
    .getByRole("textbox", { name: /Search industries/ })
    .fill("home decor");
  await page.getByRole("button", { name: "Find prospects" }).first().click();
  const typeDetails = page.getByTestId("discovery-type-details-dialog");
  await expect(typeDetails).toBeVisible();
  await typeDetails.getByRole("button", { name: /Find prospects/ }).click();
  const dialog = page.getByTestId("discovery-campaign-dialog");
  await dialog.getByLabel("Location").fill("Johannesburg");
  await dialog.getByLabel("Prospect target").fill("2");
  await dialog
    .getByRole("checkbox", {
      name: "I approve this campaign’s maximum budget.",
    })
    .check();
  await dialog.getByRole("button", { name: /Approve & start/ }).click();
  return dialog;
}

test.describe("Business records use the relay's business id", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the premise: the local community id and the relay's business id differ", async ({
    page,
  }) => {
    await installMockBridge(page, REAL_RUNNER);
    await page.goto("/#/discovery", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("w10-discovery-page")).toBeVisible();
    const stored = await page.evaluate(() => ({
      communities: JSON.parse(
        window.localStorage.getItem("buzz-communities") ?? "[]",
      ) as Array<{ id: string }>,
    }));
    expect(stored.communities.map((community) => community.id)).toEqual([
      LOCAL_COMMUNITY_ID,
    ]);
    expect(MOCK_TENANT_COMMUNITY_ID).not.toBe(LOCAL_COMMUNITY_ID);
  });

  test("a search saves every prospect under the relay's business id", async ({
    page,
  }) => {
    await installMockBridge(page, REAL_RUNNER);
    await installSearchStub(page);
    await page.goto("/#/discovery", { waitUntil: "domcontentloaded" });
    await startCampaign(page);
    await expect(
      page.getByText("Search complete", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByTestId("w10-campaign-page").locator("tbody tr"),
    ).toHaveCount(2);

    const saves = (await commandLog(page)).filter(
      (command) => command.kind === KIND_PROSPECT_ACTION,
    );
    expect(saves).toHaveLength(2);
    for (const save of saves) {
      expect(save.accepted).toBe(true);
      expect(save.dTag).toMatch(
        new RegExp(`^business:${MOCK_TENANT_COMMUNITY_ID}:prospect:`),
      );
      expect(save.dTag).not.toContain(LOCAL_COMMUNITY_ID);
    }
  });

  test("a lead changed on its page is saved under the relay's business id", async ({
    page,
  }) => {
    await installMockBridge(page, { referenceWorkspace: true });
    await page.goto("/#/sales/lead/form-field", {
      waitUntil: "domcontentloaded",
    });
    const detail = page.getByTestId("w10-prospect-page");
    await detail.getByRole("button", { name: "Qualify lead" }).click();
    await expect(detail.getByText("Qualified", { exact: true })).toBeVisible();

    const saves = (await commandLog(page)).filter(
      (command) => command.kind === KIND_PROSPECT_ACTION,
    );
    expect(saves.length).toBeGreaterThan(0);
    for (const save of saves) {
      expect(save.accepted).toBe(true);
      expect(save.dTag).toMatch(
        new RegExp(`^business:${MOCK_TENANT_COMMUNITY_ID}:prospect:`),
      );
    }
  });

  test("a new lead added by hand is saved under the relay's business id", async ({
    page,
  }) => {
    await installMockBridge(page, { referenceWorkspace: true });
    await page.goto("/#/leads", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Add lead" }).click();
    const addLead = page.getByTestId("w10-add-lead-dialog");
    await addLead.getByLabel("Business name").fill("Namespace Goods");
    await addLead.getByLabel("Contact name").fill("Jules");
    await addLead.getByLabel("Email").fill("jules@example.test");
    await addLead.getByLabel("Industry").fill("Home & Living");
    await addLead.getByLabel("Location").fill("Cape Town");
    await addLead.getByRole("button", { name: "Add lead" }).click();
    await expect(addLead).toBeHidden();

    const saves = (await commandLog(page)).filter(
      (command) => command.kind === KIND_PROSPECT_ACTION,
    );
    expect(saves).toHaveLength(1);
    expect(saves[0]?.accepted).toBe(true);
    expect(saves[0]?.dTag).toMatch(
      new RegExp(`^business:${MOCK_TENANT_COMMUNITY_ID}:prospect:`),
    );
  });

  test("a relay that cannot confirm the business stops the search before it is paid for", async ({
    page,
  }) => {
    await installMockBridge(page, REAL_RUNNER);
    await installSearchStub(page);
    await page.route(MEMBER_DIRECTORY, (route) =>
      route.fulfill({
        json: { owner_pubkey: "a".repeat(64), communities: [] },
      }),
    );
    await page.goto("/#/discovery", { waitUntil: "domcontentloaded" });
    const dialog = await startCampaign(page);
    await expect(dialog.getByRole("alert")).toContainText(
      "Colony could not confirm which business this is.",
    );
    await expect(page.getByTestId("w10-campaign-page")).toHaveCount(0);
    expect(await searchCalls(page)).toHaveLength(0);
    expect(await commandLog(page)).toHaveLength(0);
  });

  test("Leads says it cannot confirm the business, and Retry brings the records back", async ({
    page,
  }) => {
    await installMockBridge(page, { referenceWorkspace: true });
    let relayUp = false;
    await page.route(MEMBER_DIRECTORY, (route) =>
      relayUp
        ? route.fulfill({
            json: {
              owner_pubkey: "a".repeat(64),
              communities: [
                {
                  id: MOCK_TENANT_COMMUNITY_ID,
                  name: RELAY_HOST,
                  slug: RELAY_HOST,
                  normalized_host: RELAY_HOST,
                  owner_pubkey: "a".repeat(64),
                },
              ],
            },
          })
        : route.fulfill({ status: 500, json: { error: "unavailable" } }),
    );
    await page.goto("/#/leads", { waitUntil: "domcontentloaded" });
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Business could not be confirmed", {
      timeout: 15_000,
    });
    await expect(alert).toContainText(
      "Colony could not confirm which business this is.",
    );
    await expect(page.getByTestId("w10-leads-page")).toHaveCount(0);

    relayUp = true;
    await alert.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("w10-leads-page")).toBeVisible();
  });
});
