import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { COLONY3_NOW, seedColony3Activity } from "../helpers/colony3Fixture";

/**
 * Colony 3.0 discovery and leads proof. Captures the app at each board's size
 * (and each dialog at its board rectangle) with the Lerato Social fixture, so
 * `scripts/colony3-proof-report.mjs` can lay every capture next to the design
 * reference. Not a regression gate: it writes PNGs and checks that each state
 * can be reached.
 *
 * COLONY3_PROOF_DIR chooses where the captures land.
 */
const OUT =
  process.env.COLONY3_PROOF_DIR ?? "test-results/colony3-discovery-leads-proof";

type Rect = [x: number, y: number, width: number, height: number];
type Capture = {
  name: string;
  /** Reference board the capture is judged against. */
  board: string;
  /** Part of the board the capture covers; the whole board when omitted. */
  refRect?: Rect;
  title: string;
};
const captures: Capture[] = [];

test.describe.configure({ mode: "serial", timeout: 120_000 });

async function openLerato(page: Page, route: string) {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.clock.setFixedTime(new Date(COLONY3_NOW));
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    windowFullscreen: true,
  });
  await page.goto(`/#${route}`);
  await seedColony3Activity(page);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await page.waitForTimeout(1200);
  await waitForAnimations(page);
}

async function shot(
  page: Page,
  capture: Capture,
  target?: Locator | { x: number; y: number; width: number; height: number },
) {
  await waitForAnimations(page);
  await dumpTexts(page, capture.name);
  const path = `${OUT}/${capture.name}.png`;
  if (target && "screenshot" in target) {
    // A clip of the element's box, not an element screenshot: those wait for
    // the element to hold still, which a live dialog never quite does.
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
    await page.screenshot({ animations: "disabled", clip: target, path });
  }
  captures.push(capture);
}

/**
 * Writes the text geometry of the page and of the dialog (when one is open),
 * to line up with the design's DOM (`scripts` side: scratch comparison tool).
 */
async function dumpTexts(page: Page, name: string) {
  const dump = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const box = dialog?.getBoundingClientRect();
    const out: Array<Record<string, unknown>> = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent?.trim() ?? "";
      const parent = node.parentElement;
      if (text && parent && !parent.closest("script,style")) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        const style = getComputedStyle(parent);
        if (rect.width > 0 && rect.height > 0) {
          out.push({
            t: text.slice(0, 48),
            x: Math.round(rect.x * 10) / 10,
            y: Math.round(rect.y * 10) / 10,
            w: Math.round(rect.width * 10) / 10,
            h: Math.round(rect.height * 10) / 10,
            fs: style.fontSize,
            fw: style.fontWeight,
            c: style.color,
            ls: style.letterSpacing,
          });
        }
      }
      node = walker.nextNode();
    }
    return {
      dialog: box ? { x: box.x, y: box.y, w: box.width, h: box.height } : null,
      texts: out,
    };
  });
  writeFileSync(`${OUT}/${name}.rects.json`, JSON.stringify(dump, null, 1));
}

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/captures.json`, JSON.stringify(captures, null, 2));
});

test("Discovery board", async ({ page }) => {
  await openLerato(page, "/discovery");
  await expect(page.getByTestId("w10-discovery-page")).toBeVisible();
  await shot(page, {
    name: "Discovery",
    board: "Discovery",
    title: "Discovery: find your next customer",
  });
});

test("Discovery industry board", async ({ page }) => {
  await openLerato(page, "/discovery");
  await page.getByRole("button", { name: /Beauty & Wellness/ }).click();
  await expect(page.getByText("13 verticals").first()).toBeVisible();
  await shot(page, {
    name: "DiscoveryCategory",
    board: "DiscoveryCategory",
    title: "Discovery: one industry",
  });
});

test("Discovery campaign dialogs board", async ({ page }) => {
  await openLerato(page, "/discovery");
  await page
    .getByRole("textbox", { name: /Search industries/ })
    .fill("home decor");
  await page.getByRole("button", { name: "Find prospects" }).first().click();
  const form = page.getByRole("dialog");
  await expect(
    form.getByRole("heading", { name: "Find the right fit." }),
  ).toBeVisible();
  await shot(
    page,
    {
      name: "DiscoveryCampaignModal-form",
      board: "DiscoveryCampaignModal",
      refRect: [206, 48, 560, 733],
      title: "New discovery campaign dialog",
    },
    form,
  );
  await page.keyboard.press("Escape");
  await expect(form).toBeHidden();
  await page.getByRole("button", { name: /All campaigns/ }).click();
  const list = page.getByRole("dialog");
  await expect(
    list.getByRole("heading", { name: "Your discovery campaigns." }),
  ).toBeVisible();
  await shot(
    page,
    {
      name: "DiscoveryCampaignModal-list",
      board: "DiscoveryCampaignModal",
      refRect: [794, 48, 440, 288],
      title: "Your discovery campaigns dialog",
    },
    list,
  );
});

test("Campaign board", async ({ page }) => {
  await openLerato(page, "/campaign");
  const campaign = page.getByTestId("w10-campaign-page");
  await expect(campaign).toBeVisible();
  await campaign
    .getByRole("checkbox", { name: "Select The Sunday Edit" })
    .check();
  await shot(page, {
    name: "Campaign",
    board: "Campaign",
    title: "Campaign: prospects with one selected",
  });
});

test("Campaign dialogs board", async ({ page }) => {
  await openLerato(page, "/campaign");
  await page.getByRole("button", { name: "Run details" }).click();
  const activity = page.getByRole("dialog");
  await expect(
    activity.getByRole("heading", { name: "Search activity." }),
  ).toBeVisible();
  await shot(
    page,
    {
      name: "CampaignModals-activity",
      board: "CampaignModals",
      refRect: [206, 64, 500, 555],
      title: "Search activity dialog",
    },
    activity,
  );
  await page.keyboard.press("Escape");
  await expect(activity).toBeHidden();
  await page.getByRole("button", { name: "Search & budget" }).click();
  const budget = page.getByRole("dialog");
  await expect(
    budget.getByRole("heading", { name: "Search & budget." }),
  ).toBeVisible();
  await shot(
    page,
    {
      name: "CampaignModals-budget",
      board: "CampaignModals",
      refRect: [734, 64, 500, 549],
      title: "Search and budget dialog",
    },
    budget,
  );
});

test("Leads board", async ({ page }) => {
  await openLerato(page, "/leads");
  await expect(page.getByTestId("w10-leads-page")).toBeVisible();
  await shot(page, {
    name: "Leads",
    board: "Leads",
    title: "Leads list",
  });
});

test("Lead detail board", async ({ page }) => {
  await openLerato(page, "/sales/lead/form-field");
  await expect(page.getByTestId("w10-prospect-page")).toBeVisible();
  await shot(page, {
    name: "LeadDetail",
    board: "LeadDetail",
    title: "Lead: Form & Field",
  });
});

test("Lead dialogs board", async ({ page }) => {
  await openLerato(page, "/leads");
  await page.getByRole("button", { name: "Add lead" }).first().click();
  const addLead = page.getByTestId("w10-add-lead-dialog");
  await addLead.getByLabel("Business name").fill("The Olive House");
  // The other fields are required, so fill them to submit, then empty them:
  // the board shows the message above an otherwise empty form.
  const required = ["Contact name", "Email", "Industry", "Location"] as const;
  const values = ["Nandi", "nandi@olive.example", "Home & Living", "Parkhurst"];
  for (const [index, label] of required.entries()) {
    await addLead.getByLabel(label).fill(values[index]);
  }
  await addLead.getByRole("button", { name: "Add lead" }).click();
  await expect(addLead.getByRole("alert")).toBeVisible();
  for (const label of required) await addLead.getByLabel(label).fill("");
  await shot(
    page,
    {
      name: "LeadDialogs-add",
      board: "LeadDialogs",
      refRect: [66, 40, 420, 625],
      title: "Add lead dialog with the duplicate message",
    },
    addLead,
  );
  await page.keyboard.press("Escape");
  await expect(addLead).toBeHidden();

  await page.goto("/#/sales/lead/form-field");
  await page.getByRole("button", { name: "Mark as lost" }).click();
  const close = page.getByTestId("w10-close-opportunity-dialog");
  await expect(close).toBeVisible();
  await shot(
    page,
    {
      name: "LeadDialogs-close",
      board: "LeadDialogs",
      refRect: [974, 40, 400, 424],
      title: "Close this opportunity dialog",
    },
    close,
  );
});
