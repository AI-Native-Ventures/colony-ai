import { expect, test } from "@playwright/test";

import { installRelayBridge, TEST_IDENTITIES } from "../helpers/bridge";

const LIVE_ENABLED = process.env.BUZZ_E2E_COMPANY_TEAM_LIVE === "1";
const COMMUNITY_A_ID = "company-team-live-a";
const COMMUNITY_B_ID = "company-team-live-b";

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is required for the live Team gate`);
  return value;
}

function websocketUrl(httpUrl: string): string {
  return httpUrl.replace(/^http/, "ws");
}

async function relaySelfPubkey(relayHttpUrl: string): Promise<string> {
  const response = await fetch(new URL("/", relayHttpUrl), {
    headers: { Accept: "application/nostr+json" },
  });
  if (!response.ok) throw new Error("The live relay NIP-11 request failed.");
  const relayInfo: unknown = await response.json();
  if (
    relayInfo === null ||
    typeof relayInfo !== "object" ||
    typeof (relayInfo as { self?: unknown }).self !== "string"
  ) {
    throw new Error("The live relay does not advertise its signing identity.");
  }
  return (relayInfo as { self: string }).self;
}

test.describe("company Team live relay journey", () => {
  test.skip(
    !LIVE_ENABLED,
    "set BUZZ_E2E_COMPANY_TEAM_LIVE=1 for the isolated live relay gate",
  );

  test("persists an owner position across reload and community switching", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const relayA = required(
      "BUZZ_E2E_COMPANY_TEAM_RELAY_A",
      process.env.BUZZ_E2E_COMPANY_TEAM_RELAY_A,
    );
    const relayB = required(
      "BUZZ_E2E_COMPANY_TEAM_RELAY_B",
      process.env.BUZZ_E2E_COMPANY_TEAM_RELAY_B,
    );
    const relaySelf = await relaySelfPubkey(relayA);
    await page.addInitScript(
      ({ relayA, relayB, pubkey }) => {
        window.localStorage.setItem(
          "buzz-communities",
          JSON.stringify([
            {
              id: "company-team-live-a",
              name: "Team Relay A",
              relayUrl: relayA,
              pubkey,
              addedAt: "2026-01-01T00:00:00.000Z",
            },
            {
              id: "company-team-live-b",
              name: "Team Relay B",
              relayUrl: relayB,
              pubkey,
              addedAt: "2026-01-02T00:00:00.000Z",
            },
          ]),
        );
        window.localStorage.setItem(
          "buzz-active-community-id",
          "company-team-live-a",
        );
      },
      {
        relayA: websocketUrl(relayA),
        relayB: websocketUrl(relayB),
        pubkey: TEST_IDENTITIES.tyler.pubkey,
      },
    );
    await installRelayBridge(page, "tyler", {
      relayHttpUrl: relayA,
      relaySelf,
      relayRequiresMembership: true,
      skipCommunitySeed: true,
    });

    await page.goto("/#/team");
    await expect(page.getByTestId("company-team-screen")).toBeVisible({
      timeout: 20_000,
    });
    const ownerRow = page.getByTestId(
      `company-team-member-${TEST_IDENTITIES.tyler.pubkey}`,
    );
    await expect(ownerRow).toBeVisible();
    await ownerRow.click();
    await expect(page.getByTestId("company-team-member-profile")).toBeVisible();
    await page.getByRole("button", { name: "Edit role and reporting" }).click();
    const title = `Team relay position ${Date.now()}`;
    await page.getByLabel("Title").fill(title);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByTestId("company-team-member-profile")).toContainText(
      title,
    );
    await page.reload();
    await expect(page.getByTestId("company-team-member-profile")).toContainText(
      title,
      { timeout: 20_000 },
    );

    await page.goto("/#/team");
    await page.getByTestId(`community-rail-button-${COMMUNITY_B_ID}`).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.localStorage.getItem("buzz-active-community-id"),
        ),
      )
      .toBe(COMMUNITY_B_ID);
    await expect(page.getByTestId("company-team-screen")).toBeVisible();
    await expect(page.getByTestId("company-team-list")).toBeVisible();
    await expect(page.getByTestId("company-team-list")).not.toContainText(
      title,
    );

    await page.getByTestId(`community-rail-button-${COMMUNITY_A_ID}`).click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.localStorage.getItem("buzz-active-community-id"),
        ),
      )
      .toBe(COMMUNITY_A_ID);
    await expect(page.getByTestId("company-team-list")).toContainText(title);
  });
});
