import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const managedAgents = Array.from({ length: 21 }, (_, index) => ({
  pubkey: (index + 1).toString(16).padStart(64, "0"),
  name: `Agent ${String(index + 1).padStart(2, "0")}`,
  runtime: "goose",
  status: "stopped" as const,
}));

test.describe("W07 agent workspace smoke", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("directory page sizes, search, and profile tabs use seeded agents", async ({
    page,
  }) => {
    await installMockBridge(page, { managedAgents });
    await page.goto("/#/agents?rows=10", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/#\/agents\?rows=10$/);
    const directory = page.getByTestId("agent-directory");
    await expect(directory).toBeVisible();
    await expect(directory.locator("tbody tr")).toHaveCount(10);
    await expect(directory.getByText("Page 1 of 3")).toBeVisible();

    await page.goto("/#/agents?rows=20", { waitUntil: "domcontentloaded" });
    await expect(directory.locator("tbody tr")).toHaveCount(20);
    await expect(directory.getByText("Page 1 of 2")).toBeVisible();

    await page.goto("/#/agents?rows=30", { waitUntil: "domcontentloaded" });
    await expect(directory.locator("tbody tr")).toHaveCount(21);
    await expect(
      directory.getByRole("button", { name: "Previous agent page" }),
    ).toHaveCount(0);

    await page.getByRole("textbox", { name: "Search agents" }).fill("Agent 12");
    await expect(directory.locator("tbody tr")).toHaveCount(1);
    await expect(
      directory.getByText("Agent 12", { exact: true }),
    ).toBeVisible();

    await page.getByRole("textbox", { name: "Search agents" }).fill("");
    await directory
      .locator("tbody tr")
      .first()
      .locator("td")
      .first()
      .getByRole("button")
      .click();
    const profile = page.getByTestId("agent-profile");
    await expect(profile).toBeVisible();
    for (const label of [
      "Model & runtime",
      "Instructions",
      "Tools & access",
      "Activity",
      "Advanced",
      "Memory",
    ]) {
      const tab = profile.getByRole("button", { name: label, exact: true });
      await expect(tab).toBeVisible();
      await tab.click();
      if (label === "Instructions") {
        const editor = profile.getByRole("textbox", {
          name: "System instructions",
        });
        const original = await editor.inputValue();
        await editor.fill("Discard this instruction change.");
        await profile.getByRole("button", { name: "Cancel" }).click();
        await expect(editor).toHaveValue(original);

        await editor.fill("Persisted instruction change.");
        await profile.getByRole("button", { name: "Save changes" }).click();
        await expect(editor).toHaveValue("Persisted instruction change.");
        await expect(
          profile.getByRole("button", { name: "Save changes" }),
        ).toBeDisabled();
      }
    }
  });

  test("team review uses real team and persona records", async ({ page }) => {
    await installMockBridge(page, {
      personas: [
        {
          id: "mina",
          displayName: "Mina",
          description: "Social media manager",
          systemPrompt: "Mina's instructions.",
        },
      ],
      replaceDefaultTeams: true,
      teams: [
        {
          id: "creative",
          name: "Client creative team",
          personaIds: ["mina"],
        },
      ],
    });
    await page.goto("/#/agents?view=teams", {
      waitUntil: "domcontentloaded",
    });

    await expect(
      page.getByRole("heading", { name: "Agent teams", level: 1 }),
    ).toBeVisible();
    const team = page.getByTestId("agent-team-creative");
    await expect(team).toBeVisible();
    await expect(
      team.getByRole("button", {
        name: "Mina, Social media manager",
      }),
    ).toBeVisible();
    await team.getByRole("button", { name: "Edit team" }).click();
    await expect(
      page.getByRole("dialog").getByRole("heading", { name: "Edit team" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("persona-linked instructions stay read-only at the instance boundary", async ({
    page,
  }) => {
    await installMockBridge(page, {
      managedAgents: [
        {
          pubkey:
            "0000000000000000000000000000000000000000000000000000000000000011",
          name: "Mina",
          about: "Social media manager",
          personaId: "mina",
          systemPrompt: null,
          status: "stopped",
        },
      ],
      personas: [
        {
          id: "mina",
          displayName: "Mina",
          systemPrompt: "Persona-owned instructions, shown exactly.",
        },
      ],
    });
    await page.goto(
      "/#/agents?agent=0000000000000000000000000000000000000000000000000000000000000011&agentTab=instructions",
      { waitUntil: "domcontentloaded" },
    );

    const profile = page.getByTestId("agent-profile");
    await expect(profile).toBeVisible();
    await expect(
      profile.getByText("Persona-owned instructions, shown exactly."),
    ).toBeVisible();
    await expect(
      profile.getByRole("textbox", { name: "System instructions" }),
    ).toHaveCount(0);
    await expect(
      profile.getByRole("button", { name: "Save changes" }),
    ).toHaveCount(0);
  });

  test("overview resolves profile role and seeded channel membership names", async ({
    page,
  }) => {
    const agentPubkey =
      "0000000000000000000000000000000000000000000000000000000000000011";
    const channelNames = [
      "Marketing",
      "The Olive House",
      "Cedar Cafe",
      "Northline Interiors",
    ];
    const visualChannels = channelNames.map((name, index) => ({
      id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
      name,
    }));
    await installMockBridge(page, {
      managedAgents: [
        {
          pubkey: agentPubkey,
          name: "Mina",
          about: "Social media manager",
          personaId: "mina",
          status: "stopped",
          channelIds: visualChannels.map((channel) => channel.id),
        },
      ],
      personas: [
        {
          id: "mina",
          displayName: "Mina",
          systemPrompt: "Mina's instructions.",
        },
      ],
      visualChannels,
    });
    await page.goto(`/#/agents?agent=${agentPubkey}&agentTab=overview`, {
      waitUntil: "domcontentloaded",
    });

    const overview = page.getByTestId("agent-overview");
    await expect(overview).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const browserWindow = window as Window & {
            __BUZZ_E2E_COMMANDS__?: string[];
          };
          return browserWindow.__BUZZ_E2E_COMMANDS__?.includes(
            "get_user_profile",
          );
        }),
      )
      .toBe(true);
    await expect(
      page.getByTestId("agent-profile").locator("header"),
    ).toContainText("Social media manager");
    for (const name of channelNames) {
      await expect(overview.getByText(name, { exact: true })).toBeVisible();
    }
  });

  test("supervision and billing show only available backend state", async ({
    page,
  }) => {
    await installMockBridge(page, { managedAgents: [] });
    await page.goto("/#/supervision", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("agent-supervision")).toBeVisible();
    await expect(
      page.getByText("No active sessions in this view."),
    ).toBeVisible();

    await page.goto("/#/power?section=history", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("power-history")).toBeVisible();
    await expect(
      page.getByText(
        "Billing history is unavailable while the payment service is disconnected.",
      ),
    ).toBeVisible();

    await page.goto("/#/power?section=checkout", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("power-checkout")).toBeVisible();
    await expect(
      page.getByText(
        "Current prices are unavailable. Your balance has not changed.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Choose amount" }),
    ).toBeDisabled();
  });
});
