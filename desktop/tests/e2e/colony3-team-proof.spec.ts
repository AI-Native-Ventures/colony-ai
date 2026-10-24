import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { COLONY3_NOW } from "../helpers/colony3Fixture";
import {
  COLONY3_TEAM_KEYS,
  seedColony3Team,
  seedColony3TeamWorking,
} from "../helpers/colony3-team-fixture";

/**
 * Colony 3.0 Team proof (boards Team and TeamDialogs). Captures the app at the
 * board's size with the Lerato Social team, so each capture can be set next to
 * its design reference with `scripts/colony3-compare.mjs`. Not a regression
 * gate: it writes PNGs and checks that each state can be reached.
 *
 * COLONY3_PROOF_DIR chooses where the captures land.
 */
const OUT = process.env.COLONY3_PROOF_DIR ?? "test-results/colony3-team-proof";

type Rect = [x: number, y: number, width: number, height: number];
type Capture = { name: string; board: string; refRect?: Rect; title: string };
const captures: Capture[] = [];

test.describe.configure({ mode: "serial", timeout: 120_000 });

async function openTeam(page: Page, route: string) {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.clock.setFixedTime(new Date(COLONY3_NOW));
  await seedColony3Team(page, {
    bridge: {
      referenceWorkspace: true,
      colony3Sidebar: true,
      windowFullscreen: true,
    },
  });
  await page.goto(route);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
}

async function shot(page: Page, capture: Capture, target?: Locator) {
  await waitForAnimations(page);
  const path = `${OUT}/${capture.name}.png`;
  if (target) {
    const box = await target.boundingBox();
    if (!box) throw new Error(`No box to capture for ${capture.name}`);
    await page.screenshot({
      animations: "disabled",
      clip: {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      },
      path,
    });
  } else {
    await page.screenshot({
      animations: "disabled",
      clip: { x: 0, y: 0, width: 1440, height: 960 },
      path,
    });
  }
  captures.push(capture);
}

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/captures.json`, JSON.stringify(captures, null, 2));
});

test("Team board", async ({ page }) => {
  await openTeam(page, "/#/team");
  await expect(page.getByTestId("company-team-screen")).toBeVisible();
  await seedColony3TeamWorking(page);
  await expect(
    page.getByTestId(`company-team-member-${COLONY3_TEAM_KEYS.scout}`),
  ).toContainText("Working");
  await expect(page.getByTestId("company-team-counts")).toHaveText(
    "5 AI employees and 4 people",
  );
  await shot(page, {
    name: "Team",
    board: "Team",
    title: "Team: one flat list of people and AI employees",
  });
});

test("Team dialogs board", async ({ page }) => {
  await openTeam(page, `/#/team/edit/${COLONY3_TEAM_KEYS.mina}`);
  const edit = page.getByTestId("team-dialog-edit-role");
  await expect(edit).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveValue("Social Media Manager");
  await shot(
    page,
    {
      name: "TeamDialogs-edit",
      board: "TeamDialogs",
      refRect: [96, 217, 400, 526],
      title: "Edit role and reporting",
    },
    edit.locator("form"),
  );

  await page.goto(`/#/team/archive/${COLONY3_TEAM_KEYS.mina}`);
  const terminate = page.getByTestId("team-dialog-terminate");
  await expect(terminate).toBeVisible();
  await page
    .getByLabel("Reason")
    .fill(
      "The spring campaign is wrapping up and Noluthando is taking over the client posts.",
    );
  await shot(
    page,
    {
      name: "TeamDialogs-terminate",
      board: "TeamDialogs",
      refRect: [520, 257, 400, 446],
      title: "Terminate employee",
    },
    terminate.locator("form"),
  );

  await page.goto(`/#/team/archive/${COLONY3_TEAM_KEYS.mina}?dialog=rehire`);
  const rehire = page.getByTestId("team-dialog-rehire");
  await expect(rehire).toBeVisible();
  await shot(
    page,
    {
      name: "TeamDialogs-rehire",
      board: "TeamDialogs",
      refRect: [944, 254, 400, 452],
      title: "Review rehire",
    },
    rehire.locator("form"),
  );
});
