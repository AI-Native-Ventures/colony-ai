import { expect, test } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

async function readStoredPrompt(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const bridgeWindow = window as typeof window & {
      __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: (command: string) => Promise<unknown>;
    };
    const agents = await bridgeWindow.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
      "list_managed_agents",
    );
    return Array.isArray(agents)
      ? (agents[0] as { system_prompt?: string } | undefined)?.system_prompt
      : undefined;
  });
}

test("profile instructions cancel and save through the managed config path", async ({
  page,
}) => {
  const initialPrompt = "Initial agent instructions.";
  const savedPrompt = "Updated agent instructions from the profile editor.";
  await installMockBridge(page, {
    managedAgents: [
      {
        pubkey: TEST_IDENTITIES.alice.pubkey,
        name: "Profile editor agent",
        status: "stopped",
        systemPrompt: initialPrompt,
      },
    ],
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("open-agents-view")).toBeVisible({
    timeout: 10_000,
  });
  await page.getByTestId("open-agents-view").click();
  await page
    .getByRole("button", { name: "Open Profile editor agent profile" })
    .click();
  await expect(page.getByTestId("agent-profile")).toBeVisible();

  const profileNav = page.getByRole("navigation", {
    name: "Agent profile sections",
  });
  await profileNav.getByRole("button", { name: "Instructions" }).click();
  const editor = page.getByTestId("agent-system-instructions");
  const saveButton = page.getByRole("button", {
    name: "Save changes",
    exact: true,
  });
  await expect(editor).toHaveValue(initialPrompt);
  await expect(saveButton).toBeDisabled();
  await expect(
    page.getByText("Changes apply after Save and the next start."),
  ).toBeVisible();

  await editor.fill("Discard this draft.");
  await expect(saveButton).toBeEnabled();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(editor).toHaveValue(initialPrompt);
  await expect(saveButton).toBeDisabled();
  expect(await readStoredPrompt(page)).toBe(initialPrompt);

  await editor.fill(savedPrompt);
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(
    page.getByRole("button", { name: /Save changes|Saving/ }),
  ).toBeDisabled();
  expect(await readStoredPrompt(page)).toBe(savedPrompt);
});
