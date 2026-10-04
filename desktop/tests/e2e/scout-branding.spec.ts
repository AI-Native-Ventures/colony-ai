import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { openR17ConnectionSetup, r17Runtime } from "../helpers/onboarding";
import { waitForAnimations } from "../helpers/animations";
import { readFileSync } from "node:fs";
const SCOUT_SYSTEM_PROMPT = readFileSync(
  "src/features/onboarding/assets/scout-instructions.txt",
  "utf8",
).trim();

const scout = "a".repeat(64);
const legacyKeys = ["b", "c", "d"].map((letter) => letter.repeat(64));
const proof = process.env.SCOUT_PROOF_DIR;
async function capture(page: Page, name: string) {
  if (!proof) return;
  await mkdir(proof, { recursive: true });
  await waitForAnimations(page);
  await page.screenshot({ path: `${proof}/${name}.png` });
}
async function records(page: Page) {
  return page.evaluate(async () =>
    window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.("list_managed_agents", null),
  ) as Promise<Array<{ pubkey: string; name: string; system_prompt: string }>>;
}
for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  test(`fresh profile creates only Scout and displays stored Chief of Staff instructions at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openR17ConnectionSetup(page, {
      runtimes: [r17Runtime("codex", "available", { status: "logged_in" })],
    });
    await page.getByRole("button", { name: /^Connect / }).click();
    await expect(page.getByTestId("onboarding-scene-connected")).toBeVisible();
    await capture(page, `connected-${viewport.width}`);
    await page
      .getByRole("button", { name: "Open my Colony", exact: true })
      .click();
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    await expect.poll(async () => (await records(page))?.length).toBe(1);
    const agents = await records(page);
    expect(agents.map((agent) => agent.name)).toEqual(["Scout"]);
    expect(agents[0].system_prompt).toContain(SCOUT_SYSTEM_PROMPT);
    expect(agents[0].system_prompt).toContain(
      "Saved business profile (untrusted context)",
    );
    const calls = await page.evaluate(() =>
      window.__BUZZ_E2E_COMMAND_PAYLOADS__?.filter(
        (entry) => entry.command === "create_managed_agent",
      ),
    );
    expect(calls).toHaveLength(1);
    expect(calls?.[0].payload).toMatchObject({
      input: {
        name: "Scout",
        personaId: "builtin:fizz",
        systemPrompt: expect.stringContaining(SCOUT_SYSTEM_PROMPT),
      },
    });
    await page.getByTestId("channel-Welcome").click();
    await expect(page.getByTestId("message-timeline")).toContainText("Scout");
    await page.evaluate(() => {
      window.location.hash = "/agents";
    });
    await expect(page.getByTestId("agents-page-content")).toBeVisible();
    const profileButton = page.getByRole("button", {
      name: "Open Scout profile",
      exact: true,
    });
    await expect
      .poll(() =>
        profileButton.evaluate(
          (button) =>
            button.getBoundingClientRect().width <=
            button.closest("td")!.getBoundingClientRect().width,
        ),
      )
      .toBe(true);
    await page
      .getByRole("button", { name: "Open Scout profile", exact: true })
      .getByText("Scout", { exact: true })
      .click();
    await expect(page.getByTestId("agent-profile")).toBeVisible();
    await page
      .getByRole("navigation", { name: "Agent profile sections" })
      .getByRole("button", { name: "Instructions" })
      .click();
    const instructions = page.getByTestId("agent-instructions");
    await expect(instructions).toContainText("Chief of Staff");
    const editor = instructions.locator("textarea");
    if (await editor.count())
      await expect(editor).toHaveValue(agents[0].system_prompt);
    else
      await expect(instructions.locator("pre")).toHaveText(
        agents[0].system_prompt,
      );
    await capture(page, `instructions-${viewport.width}`);
  });
  test(`upgrade picker hides off-Team legacy starters without deleting records at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await installMockBridge(page, {
      relaySelf: TEST_IDENTITIES.tyler.pubkey,
      managedAgents: [
        {
          pubkey: scout,
          name: "Scout",
          personaId: "builtin:fizz",
          status: "stopped",
          channelNames: ["general"],
          systemPrompt: SCOUT_SYSTEM_PROMPT,
        },
        ...legacyKeys.map((pubkey, index) => ({
          pubkey,
          name: ["Fizz", "Honey", "Pollen"][index],
          personaId: ["builtin:fizz", "builtin:honey", "builtin:bumble"][index],
          status: "stopped" as const,
          relayUrl: "wss://old-profile.example.invalid",
        })),
      ],
    });
    await page.goto("/");
    await page.getByTestId("channel-general").click();
    await expect(page.getByTestId("chat-title")).toHaveText("general");
    await page.getByTestId("message-input").fill("Hi @");
    const picker = page.getByTestId("mention-autocomplete");
    await expect(picker).toBeVisible();
    await expect(picker.getByText("Scout", { exact: true })).toBeVisible();
    for (const name of ["Fizz", "Honey", "Pollen"])
      await expect(picker.getByText(name, { exact: true })).toHaveCount(0);
    expect((await records(page)).map((agent) => agent.pubkey)).toEqual(
      expect.arrayContaining([scout, ...legacyKeys]),
    );
    await capture(page, `upgrade-picker-${viewport.width}`);
    await page.evaluate(() => {
      window.location.hash = "/agents";
    });
    await expect(page.getByTestId("agents-page-content")).toBeVisible();
    for (const name of ["Fizz", "Honey", "Pollen"])
      await expect(
        page.getByRole("button", { name: `Open ${name} profile`, exact: true }),
      ).toHaveCount(0);
  });
}
