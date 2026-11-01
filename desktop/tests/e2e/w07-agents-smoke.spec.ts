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

  test("directory page sizes, search, and simple profile use seeded agents", async ({
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
    // The AI summary is part of the profile itself, and its technical support
    // details stay collapsed behind one disclosure.
    await expect(profile.getByRole("heading", { name: "AI" })).toBeVisible();
    await expect(
      page.getByTestId("agent-technical-details"),
    ).not.toHaveAttribute("open", "");
    await expect(
      profile.getByRole("heading", { name: "System instructions" }),
    ).toBeVisible();
    for (const label of ["Tools & access", "Activity", "Advanced", "Memory"]) {
      await expect(
        profile.getByRole("button", { name: label, exact: true }),
      ).toHaveCount(0);
    }
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
  });

  test("persona-linked instructions save into the definition they come from", async ({
    page,
  }) => {
    const pubkey =
      "0000000000000000000000000000000000000000000000000000000000000011";
    await installMockBridge(page, {
      managedAgents: [
        {
          pubkey,
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
    await page.goto(`/#/agents?agent=${pubkey}&agentTab=instructions`, {
      waitUntil: "domcontentloaded",
    });

    const profile = page.getByTestId("agent-profile");
    await expect(profile).toBeVisible();
    const editor = profile.getByRole("textbox", {
      name: "System instructions",
    });
    await expect(editor).toHaveValue(
      "Persona-owned instructions, shown exactly.",
    );
    await editor.fill("Persona-owned instructions, edited on the agent page.");
    await profile.getByRole("button", { name: "Save changes" }).click();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const bridge = window as typeof window & {
            __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: (
              command: string,
            ) => Promise<unknown>;
          };
          const personas = (await bridge.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
            "list_personas",
          )) as Array<{ id: string; system_prompt: string }> | undefined;
          return personas?.find((persona) => persona.id === "mina")
            ?.system_prompt;
        }),
      )
      .toBe("Persona-owned instructions, edited on the agent page.");
  });

  test("editing instructions shared with another agent copies the definition for this agent only", async ({
    page,
  }) => {
    const mina =
      "0000000000000000000000000000000000000000000000000000000000000011";
    const noor =
      "0000000000000000000000000000000000000000000000000000000000000012";
    await installMockBridge(page, {
      managedAgents: [
        { pubkey: mina, name: "Mina", personaId: "shared", status: "stopped" },
        { pubkey: noor, name: "Noor", personaId: "shared", status: "stopped" },
      ],
      personas: [
        {
          id: "shared",
          displayName: "Shared definition",
          systemPrompt: "Shared instructions.",
        },
      ],
    });
    await page.goto(`/#/agents?agent=${mina}`, {
      waitUntil: "domcontentloaded",
    });

    const profile = page.getByTestId("agent-profile");
    const editor = profile.getByRole("textbox", {
      name: "System instructions",
    });
    await expect(editor).toHaveValue("Shared instructions.");
    await editor.fill("Mina's own instructions.");
    await profile.getByRole("button", { name: "Save changes" }).click();
    await expect(
      profile.getByRole("button", { name: "Save changes" }),
    ).toBeDisabled();
    await expect(editor).toHaveValue("Mina's own instructions.");

    const state = await page.evaluate(async () => {
      const bridge = window as typeof window & {
        __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: (c: string) => Promise<unknown>;
      };
      const personas = (await bridge.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
        "list_personas",
      )) as Array<{ id: string; system_prompt: string }>;
      const agents = (await bridge.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
        "list_managed_agents",
      )) as Array<{ pubkey: string; persona_id: string | null }>;
      return {
        sharedPrompt: personas.find((persona) => persona.id === "shared")
          ?.system_prompt,
        minaPersona: agents.find(
          (agent) => agent.pubkey === "0".repeat(62) + "11",
        )?.persona_id,
        noorPersona: agents.find(
          (agent) => agent.pubkey === "0".repeat(62) + "12",
        )?.persona_id,
        minaPrompt: personas.find(
          (persona) =>
            persona.id ===
            agents.find((agent) => agent.pubkey === "0".repeat(62) + "11")
              ?.persona_id,
        )?.system_prompt,
      };
    });
    expect(state.sharedPrompt).toBe("Shared instructions.");
    expect(state.noorPersona).toBe("shared");
    expect(state.minaPersona).not.toBe("shared");
    expect(state.minaPrompt).toBe("Mina's own instructions.");
  });

  test("overview shows current work and instruction access", async ({
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
    await expect(
      overview.getByRole("heading", { name: "Who can give instructions" }),
    ).toBeVisible();
    await expect(
      overview.getByText("You and admins", { exact: true }),
    ).toBeVisible();
    await expect(
      overview.getByText("Nothing in progress right now.", { exact: true }),
    ).toBeVisible();
    for (const name of channelNames) {
      await expect(overview.getByText(name, { exact: true })).toHaveCount(0);
    }
  });
});

test.describe("one-time Keychain key rescue card", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  const locked = [
    { pubkey: "a".repeat(64), name: "Scout" },
    { pubkey: "b".repeat(64), name: "Nova" },
  ];

  test("is offered once, moves the keys on click, then goes quiet", async ({
    page,
  }) => {
    await installMockBridge(page, {
      managedAgents,
      keyRescueStatus: { offer: true, lockedAgents: locked, attempt: null },
    });
    await page.goto("/#/agents", { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("key-rescue-card");
    await expect(card).toContainText("still in the Mac Keychain");
    await expect(card).toContainText("choose Always Allow");
    await page.screenshot({ path: "test-results/key-rescue-offer.png" });

    await page.getByRole("button", { name: "Move my agents' keys" }).click();
    await expect(card).toContainText("Your agents' keys are moved");
    await expect(
      page.getByRole("button", { name: "Move my agents' keys" }),
    ).toHaveCount(0);
  });

  test("after a denied attempt lists the agents and the delete and add again path", async ({
    page,
  }) => {
    await installMockBridge(page, {
      managedAgents,
      keyRescueStatus: {
        offer: false,
        lockedAgents: locked,
        attempt: {
          attemptedAtUnix: 1,
          outcome: "denied",
          agentsMoved: [],
          deviceSecretsMoved: 0,
          identity: "notInKeychain",
        },
      },
    });
    await page.goto("/#/agents", { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("key-rescue-card");
    await expect(card).toContainText("did not let Colony read");
    await expect(page.getByTestId("key-rescue-agents")).toContainText(
      "Scout, Nova",
    );
    await expect(card).toContainText("add it again");
    await expect(page.getByTestId("key-rescue-move")).toHaveCount(0);
    await page.screenshot({ path: "test-results/key-rescue-denied.png" });
  });

  test("shows nothing when there is nothing to rescue", async ({ page }) => {
    await installMockBridge(page, { managedAgents });
    await page.goto("/#/agents", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("agent-directory")).toBeVisible();
    await expect(page.getByTestId("key-rescue-card")).toHaveCount(0);
  });
});
