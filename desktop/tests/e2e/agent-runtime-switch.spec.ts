import { expect, test } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

test(
  "Scout switches from Claude Code to Codex and the DM header reports the running runtime",
  async ({ page }) => {
    const scout = TEST_IDENTITIES.tyler.pubkey;
    await installMockBridge(page, {
      updateManagedAgentDelayMs: 700,
      managedAgents: [
        {
          pubkey: scout,
          name: "Scout",
          personaId: "persona-scout-runtime-switch",
          runtime: "claude",
          model: "claude-sonnet-4-5",
          status: "running",
          channelNames: ["agents"],
        },
      ],
      personas: [
        {
          id: "persona-scout-runtime-switch",
          displayName: "Scout",
          systemPrompt: "You are Scout.",
          runtime: "claude",
          model: "claude-sonnet-4-5",
          provider: "anthropic",
        },
      ],
    });

    await page.goto(`/#/agents?agent=${scout}`);
    await expect(page.getByTestId("agent-profile-content")).toBeVisible();
    await page.getByTestId("agent-edit-configuration").click();
    await expect(page.getByTestId("edit-agent-dialog")).toBeVisible();
    await page.locator("#edit-agent-runtime").click();
    await page.getByRole("menuitemradio", { name: /Codex/ }).click();
    await expect(page.getByTestId("edit-agent-dialog-submit")).toBeEnabled();
    await page.getByTestId("edit-agent-dialog-submit").click();

    await expect(
      page.getByText("Switching to Codex...", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("edit-agent-dialog")).toBeHidden();
    await page.getByRole("button", { name: "Message" }).click();
    await expect(page.getByTestId("chat-header")).toBeVisible();
    await expect(page.getByTestId("chat-header-agent-runtime")).toContainText(
      "Codex",
    );
    await expect(page.getByTestId("chat-header-agent-runtime")).toContainText(
      "gpt-5.5",
    );
  },
);
