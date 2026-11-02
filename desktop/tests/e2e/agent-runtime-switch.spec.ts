import { expect, test } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

test("Scout switches from Claude Code to Codex and the DM header reports the running runtime", async ({
  page,
}) => {
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
  await page.waitForFunction(
    () =>
      typeof (
        window as Window & {
          __BUZZ_E2E_SEED_ACTIVE_TURNS__?: unknown;
        }
      ).__BUZZ_E2E_SEED_ACTIVE_TURNS__ === "function",
  );
  await page.evaluate((agentPubkey) => {
    const seed = (
      window as Window & {
        __BUZZ_E2E_SEED_ACTIVE_TURNS__?: (turn: {
          agentPubkey: string;
          channelId: string;
          turnId: string;
        }) => void;
      }
    ).__BUZZ_E2E_SEED_ACTIVE_TURNS__;
    seed?.({
      agentPubkey,
      channelId: "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
      turnId: "runtime-switch-active-turn",
    });
  }, scout);
  await expect(page.getByText("Working", { exact: true })).toBeVisible();
  await page.getByTestId("agent-edit-configuration").click();
  const editDialog = page.getByTestId("edit-agent-dialog");
  await expect(editDialog).toBeVisible();
  await page.locator("#edit-agent-runtime").click();
  await page.getByRole("menuitemradio", { name: /Codex/ }).click();
  await expect(page.getByTestId("edit-agent-dialog-submit")).toBeEnabled();
  await page.getByTestId("edit-agent-dialog-submit").click();

  await expect(
    editDialog.getByText("Switching to Codex...", { exact: true }),
  ).toBeVisible();
  await expect(
    editDialog.getByText(
      "The current turn will stop. Queued mentions will remain queued.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(editDialog).toBeHidden();
  await page.getByRole("button", { name: "Message" }).click();
  await expect(page.getByTestId("chat-header")).toBeVisible();
  await expect(page.getByTestId("chat-header-agent-runtime")).toContainText(
    "Codex",
  );
  await expect(page.getByTestId("chat-header-agent-runtime")).toContainText(
    "GPT-5.5",
  );
});
