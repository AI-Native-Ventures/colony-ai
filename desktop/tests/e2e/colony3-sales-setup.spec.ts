import { expect, test, type Page } from "@playwright/test";

import { REFERENCE_AGENTS } from "../../src/testing/e2eReferenceWorkspace";
import { installMockBridge } from "../helpers/bridge";

/**
 * Discovery and Leads work in a business whose private Sales channel was never
 * created: the first open by an owner or admin creates it (private, named
 * "Sales", with the business's owners, admins and AI employees as members, so
 * an admin never has to make a second one) and carries on. Anyone else sees
 * who can set it up, and every failure keeps a working Retry.
 */

// The mock relay's member list: the signed-in person is the owner, Alice is an
// admin and Bob a plain member.
const ALICE_PUBKEY =
  "953d3363262e86b770419834c53d2446409db6d918a57f8f339d495d54ab001f";
const BOB_PUBKEY =
  "bb22a5299220cad76ffd46190ccbeede8ab5dc260faa28b6e5a2cb31b9aff260";

const NO_SALES = {
  // The company team (the AI employees) is read from the relay's signed
  // member positions, so the mock relay needs a signing identity.
  relaySelf: "c".repeat(64),
  managedAgents: [
    { pubkey: REFERENCE_AGENTS.scout.pubkey, name: "Scout" },
    { pubkey: REFERENCE_AGENTS.aya.pubkey, name: "Aya" },
  ],
  referenceWorkspace: true,
  referenceWorkspaceWithoutSales: true,
  referenceWorkspaceDiscoveryStandIn: false,
} as const;

type RawChannel = {
  id: string;
  name: string;
  visibility: string;
  channel_type: string;
};
type RawMember = { pubkey: string; role: string };

async function invoke<T>(
  page: Page,
  command: string,
  payload?: unknown,
): Promise<T> {
  return page.evaluate(
    ([name, args]) =>
      (
        window as unknown as {
          __TAURI_INTERNALS__: {
            invoke: (command: string, payload?: unknown) => Promise<unknown>;
          };
        }
      ).__TAURI_INTERNALS__.invoke(name as string, args) as Promise<T>,
    [command, payload] as const,
  );
}

async function salesChannels(page: Page): Promise<RawChannel[]> {
  const payload = await invoke<{ channels: RawChannel[] | null }>(
    page,
    "get_channels",
    { knownHash: null },
  );
  return (payload.channels ?? []).filter(
    (channel) => channel.name.toLowerCase() === "sales",
  );
}

async function installSearchStub(page: Page) {
  await page.addInitScript(() => {
    (
      window as Window & {
        __BUZZ_E2E_DISCOVERY_SEARCH__?: () => Promise<unknown>;
      }
    ).__BUZZ_E2E_DISCOVERY_SEARCH__ = async () => ({
      provider: "outscraper",
      places: [
        {
          placeId: "pl-branch",
          name: "Olive Branch Studio",
          category: "Home goods store",
          address: "1 Main Road",
          city: "Johannesburg",
          state: "Gauteng",
          phone: "+27 11 555 0100",
          rating: 4.5,
          reviews: 20,
          website: "https://olive-branch.example",
        },
        {
          placeId: "pl-kiln",
          name: "Kiln & Co",
          category: "Home goods store",
          address: "2 Main Road",
          city: "Johannesburg",
          state: "Gauteng",
          phone: "+27 11 555 0101",
          rating: 4.2,
          reviews: 12,
        },
      ],
      estimatedCostUsd: 0.01,
      nextSkip: null,
    });
  });
}

async function startHomeDecorSearch(page: Page) {
  await page
    .getByRole("textbox", { name: /Search industries/ })
    .fill("home decor");
  await page.getByRole("button", { name: "Find prospects" }).first().click();
  const typeDetails = page.getByTestId("discovery-type-details-dialog");
  await expect(typeDetails).toBeVisible();
  await typeDetails.getByRole("button", { name: /Find prospects/ }).click();
  const dialog = page.getByTestId("discovery-campaign-dialog");
  await expect(
    dialog.getByRole("heading", { name: "Find the right fit." }),
  ).toBeVisible();
  await dialog.getByLabel("Location").fill("South Africa");
  await dialog.getByLabel("Prospect target").fill("50");
  await dialog
    .getByRole("checkbox", {
      name: "I approve this campaign’s maximum budget.",
    })
    .check();
  await dialog.getByRole("button", { name: /Approve & start/ }).click();
  return dialog;
}

/** In-app navigation: a full page load would reset the mock relay's memory. */
async function goTo(page: Page, hash: string) {
  await page.evaluate((target) => {
    window.location.hash = target;
  }, hash);
}

test.describe("Sales channel setup", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Leads in a business with no Sales channel creates it and shows the real Leads screen", async ({
    page,
  }) => {
    await installMockBridge(page, NO_SALES);
    await page.goto("/#/leads", { waitUntil: "domcontentloaded" });

    await expect(page.getByTestId("w10-leads-page")).toBeVisible();
    await expect(page.getByText("Business records unavailable")).toHaveCount(0);

    // Exactly one Sales channel, private, with the business's owners, admins
    // and AI employees as members (not plain members).
    const sales = await salesChannels(page);
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({
      visibility: "private",
      channel_type: "stream",
    });
    const { members } = await invoke<{ members: RawMember[] }>(
      page,
      "get_channel_members",
      { channelId: sales[0].id },
    );
    const memberKeys = members.map((member) => member.pubkey);
    for (const agent of [REFERENCE_AGENTS.scout, REFERENCE_AGENTS.aya]) {
      expect(memberKeys).toContain(agent.pubkey);
    }
    expect(
      members.find((member) => member.pubkey === REFERENCE_AGENTS.scout.pubkey)
        ?.role,
    ).toBe("bot");
    // The admin can see the private channel, so they never make a second one.
    expect(members.find((member) => member.pubkey === ALICE_PUBKEY)?.role).toBe(
      "admin",
    );
    expect(memberKeys).not.toContain(BOB_PUBKEY);

    // Opening Leads again does not make a second channel.
    await goTo(page, "/pipeline");
    await goTo(page, "/leads");
    await expect(page.getByTestId("w10-leads-page")).toBeVisible();
    expect(await salesChannels(page)).toHaveLength(1);
  });

  test("two Sales channels left by a create race do not dead-end Leads", async ({
    page,
  }) => {
    await installMockBridge(page, NO_SALES);
    await page.goto("/#/discovery", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("w10-discovery-page")).toBeVisible();

    // Two devices created "Sales" at the same moment, behind this window's back.
    for (let made = 0; made < 2; made += 1) {
      await invoke(page, "create_channel", {
        name: "Sales",
        description: "",
        channelType: "stream",
        visibility: "private",
      });
    }
    expect(await salesChannels(page)).toHaveLength(2);

    await goTo(page, "/leads");
    await expect(page.getByTestId("w10-leads-page")).toBeVisible();
    await expect(page.getByText("Business records unavailable")).toHaveCount(0);
    // Nothing was created or archived to get there.
    expect(await salesChannels(page)).toHaveLength(2);
  });

  test("a failed creation shows the reason and Retry then creates the channel once", async ({
    page,
  }) => {
    await installMockBridge(page, {
      ...NO_SALES,
      createChannelErrors: ["The relay refused the new channel."],
    });
    await page.goto("/#/leads", { waitUntil: "domcontentloaded" });

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Sales channel could not be set up");
    await expect(alert).toContainText(
      "Could not set up the private Sales channel: The relay refused the new channel.",
    );
    expect(await salesChannels(page)).toHaveLength(0);
    await expect(page.getByTestId("w10-leads-page")).toHaveCount(0);

    await alert.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("w10-leads-page")).toBeVisible();
    expect(await salesChannels(page)).toHaveLength(1);
  });

  test("a person who is not an owner or admin sees who can set it up, and nothing is created", async ({
    page,
  }) => {
    await installMockBridge(page, {
      ...NO_SALES,
      relayRequiresMembership: true,
      relayRole: "member",
    });
    await page.goto("/#/leads", { waitUntil: "domcontentloaded" });

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("Sales channel not set up");
    await expect(alert).toContainText("owner or admin");
    await expect(page.getByTestId("w10-leads-page")).toHaveCount(0);
    expect(await salesChannels(page)).toHaveLength(0);

    // Retry stays available and does not pretend it worked.
    await alert.getByRole("button", { name: "Retry" }).click();
    await expect(alert).toContainText("Sales channel not set up");
    expect(await salesChannels(page)).toHaveLength(0);
  });

  test("Discovery Approve & start creates the missing Sales channel, then runs the search", async ({
    page,
  }) => {
    await installMockBridge(page, NO_SALES);
    await installSearchStub(page);
    await page.goto("/#/discovery", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("w10-discovery-page")).toBeVisible();
    expect(await salesChannels(page)).toHaveLength(0);

    await startHomeDecorSearch(page);
    await expect(page.getByTestId("w10-campaign-page")).toBeVisible();
    await expect(
      page.getByText("Search complete", { exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByTestId("w10-campaign-page").locator("tbody tr"),
    ).toHaveCount(2);
    await expect(page.getByText("not set up here yet")).toHaveCount(0);

    // One Sales channel, and the results were posted in it.
    const sales = await salesChannels(page);
    expect(sales).toHaveLength(1);
    await goTo(page, `/channels/${sales[0].id}`);
    await expect(page.getByTestId("message-timeline")).toContainText(
      "Found 2 prospects for",
    );

    // Leads now shows the saved prospects without making another channel.
    await goTo(page, "/leads");
    await expect(page.getByTestId("w10-leads-page")).toBeVisible();
    await expect(page.getByTestId("w10-leads-page")).toContainText(
      "Olive Branch Studio",
    );
    expect(await salesChannels(page)).toHaveLength(1);
  });

  test("Discovery for a person who cannot create channels says who can, and starts no search", async ({
    page,
  }) => {
    await installMockBridge(page, {
      ...NO_SALES,
      relayRequiresMembership: true,
      relayRole: "member",
    });
    await installSearchStub(page);
    await page.goto("/#/discovery", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("w10-discovery-page")).toBeVisible();

    const dialog = await startHomeDecorSearch(page);
    await expect(dialog.getByRole("alert")).toContainText(
      "An owner or admin of this business sets it up",
    );
    await expect(page.getByTestId("w10-campaign-page")).toHaveCount(0);
    expect(await salesChannels(page)).toHaveLength(0);
  });
});
