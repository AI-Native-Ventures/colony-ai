import { expect, type Page } from "@playwright/test";

/** Opens the existing agent directory route without relying on shell placement. */
export async function openAgentsDirectoryView(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = "/agents";
  });
  await expect(page).toHaveURL(/#\/agents(?:\?|$)/, { timeout: 10_000 });
  await expect(page.getByTestId("agents-page-content")).toBeVisible({
    timeout: 10_000,
  });
}

/** Opens an agent's profile side panel on the agents route by deep link. */
export async function openAgentProfilePanel(
  page: Page,
  pubkey: string,
): Promise<void> {
  await page.evaluate((target) => {
    window.location.hash = `/agents?profile=${target}`;
  }, pubkey);
  await expect(page.getByTestId("user-profile-panel")).toBeVisible({
    timeout: 10_000,
  });
}

/** Opens an agent definition's profile side panel on the agents route by deep link. */
export async function openPersonaProfilePanel(
  page: Page,
  personaId: string,
): Promise<void> {
  await page.evaluate((target) => {
    window.location.hash = `/agents?profilePersona=${target}`;
  }, personaId);
  await expect(page.getByTestId("user-profile-panel")).toBeVisible({
    timeout: 10_000,
  });
}
