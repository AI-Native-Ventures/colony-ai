import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { setup } from "../helpers/companyTeamFixture";

test("Team shows signed employees as ants and opens a real employee desk", async ({
  page,
}) => {
  const { minaPk } = await setup(page);
  await page.goto("/#/team");

  const team = page.getByTestId("company-team-screen");
  await expect(team.getByRole("heading", { name: "Your team." })).toBeVisible();
  await expect(team).toContainText("4 employees.");
  await expect(
    team.getByTestId("company-team-list").getByRole("button"),
  ).toHaveCount(4);
  await expect(team.getByTestId(`team-avatar-${minaPk}`)).toHaveAttribute(
    "data-ant-portrait",
    "Mina",
  );

  if (process.env.COLONY_CANARY_TEAM_SHOT) {
    await waitForAnimations(page);
    await page.screenshot({ path: process.env.COLONY_CANARY_TEAM_SHOT });
  }

  await team.getByTestId(`company-team-member-${minaPk}`).click();
  const desk = page.getByTestId("company-employee-profile");
  await expect(desk).toBeVisible();
  await expect(desk.getByTestId("employee-header-avatar")).toHaveAttribute(
    "data-ant-portrait",
    "Mina",
  );
  await expect(desk.getByRole("tab")).toHaveCount(5);
  await expect(desk.getByRole("tab", { name: "Desk" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  if (process.env.COLONY_CANARY_DESK_SHOT) {
    await waitForAnimations(page);
    await page.screenshot({ path: process.env.COLONY_CANARY_DESK_SHOT });
  }
  await desk.getByRole("tab", { name: "Schedule" }).click();
  await expect(desk.getByTestId("employee-schedule")).toBeVisible();
  await desk.getByRole("tab", { name: "Settings" }).click();
  await expect(
    desk.getByRole("navigation", { name: "Employee settings" }),
  ).toBeVisible();
  await desk
    .getByRole("navigation", { name: "Employee settings" })
    .getByRole("button", { name: "Instructions" })
    .click();
  await expect(desk.getByTestId("employee-instructions")).toBeVisible();
});

test("Message employee opens the product's direct conversation", async ({
  page,
}) => {
  const { minaPk } = await setup(page);
  await page.goto("/#/team");
  await page.getByTestId(`company-team-member-${minaPk}`).click();
  await page.getByRole("button", { name: "Message Mina" }).click();
  await expect(page).toHaveURL(/#\/channels\//);
  await expect(page.getByTestId("chat-header-dm-avatar")).toHaveAttribute(
    "data-ant-portrait",
    "Mina",
  );
});

test("a known employee remains an ant in the conversation member strip", async ({
  page,
}) => {
  await setup(page);
  await page.goto("/#/channels/9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50");
  const participant = page
    .getByTestId("colony-conversation-header")
    .locator(".colony-canary-conversation-participant")
    .filter({ hasText: "Mina" });
  await expect(participant).toBeVisible();
  await expect(participant.locator('[data-ant-portrait="Mina"]')).toBeVisible();
});

test("Team and desk remain usable in a narrow window with keyboard tabs", async ({
  page,
}) => {
  const { minaPk } = await setup(page);
  await page.setViewportSize({ width: 700, height: 700 });
  await page.goto("/#/team");
  const roster = page.getByTestId("company-team-list");
  await expect(roster.getByRole("button")).toHaveCount(4);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(700);
  if (process.env.COLONY_CANARY_NARROW_TEAM_SHOT) {
    await waitForAnimations(page);
    await page.screenshot({ path: process.env.COLONY_CANARY_NARROW_TEAM_SHOT });
  }

  await page.getByTestId(`company-team-member-${minaPk}`).click();
  const desk = page.getByTestId("company-employee-profile");
  const deskTab = desk.getByRole("tab", { name: "Desk" });
  await deskTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(desk.getByRole("tab", { name: "Plan" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(700);
  if (process.env.COLONY_CANARY_NARROW_DESK_SHOT) {
    await waitForAnimations(page);
    await page.screenshot({ path: process.env.COLONY_CANARY_NARROW_DESK_SHOT });
  }
});
