import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { test } from "./cofounder-map-test";
import {
  MAP_CHANNEL_ID,
  OWNER_PUBKEY,
  SCOUT_PUBKEY,
  fixture,
  seedCofounderTheme,
  seedCompanyMapBusiness,
  seedCompanyMapMoneyRails,
  selectMapPart,
} from "./cofounder-map-fixtures";
import {
  DELIVERY_PLAYBOOK_ID,
  FOLLOW_UP_PLAYBOOK_ID,
  PLANE_TREE_JOB_ID,
  deliveryJobs,
  deliveryPlaybook,
  followUpPlaybook,
} from "../../src/testing/cofounderPlaybookFixtures";
import { REFERENCE_CHANNEL_IDS } from "../../src/testing/e2eReferenceWorkspace";
import { companyMapOperationsWindowSearch } from "../../src/features/cofounder/companyMapJobRoutes";

type Theme = "dark" | "light";

type WorkspaceSeed = {
  addedAt: string;
  id: string;
  name: string;
  relayUrl: string;
};

const workflowInput = {
  ownerPubkey: OWNER_PUBKEY,
  scoutPubkey: SCOUT_PUBKEY,
};
const OLIVE_WORK_ID = "b1b17000-0000-4000-8000-000000000001";
const MAP_WORKSPACES: WorkspaceSeed[] = [
  {
    addedAt: "2026-11-14T00:00:00.000Z",
    id: "fullmap-s3b-workspace-one",
    name: "Horizon Labs",
    relayUrl: "ws://localhost:3000",
  },
  {
    addedAt: "2026-11-14T00:01:00.000Z",
    id: "fullmap-s3b-workspace-two",
    name: "Second workspace",
    relayUrl: "ws://localhost:3001",
  },
];

function proposedOperationsPlaybook() {
  const proposal = followUpPlaybook(workflowInput);
  if (!proposal.pending)
    throw new Error("Expected the Lead follow-up proposal");
  return {
    ...proposal,
    pending: {
      ...proposal.pending,
      content: {
        ...proposal.pending.content,
        function: "operations",
      },
    },
  };
}

function workflowFixture({
  playbooks = true,
  referenceWorkspace = false,
}: {
  playbooks?: boolean;
  referenceWorkspace?: boolean;
} = {}) {
  return {
    ...fixture({ includeScout: true }),
    ...(referenceWorkspace ? { referenceWorkspace: true } : {}),
    companyPlaybooks: playbooks
      ? [deliveryPlaybook(workflowInput), proposedOperationsPlaybook()]
      : [],
    companyPlaybookJobs: playbooks ? deliveryJobs(workflowInput) : [],
    visualChannels: [{ id: MAP_CHANNEL_ID, name: "Outreach" }],
  };
}

async function installWorkflowMap(
  page: Page,
  {
    clientChannelId = null,
    mapHome = true,
    playbooks = true,
    referenceWorkspace = false,
    theme = "light",
    workspaces,
  }: {
    clientChannelId?: string | null;
    mapHome?: boolean;
    playbooks?: boolean;
    referenceWorkspace?: boolean;
    theme?: Theme;
    workspaces?: WorkspaceSeed[];
  } = {},
) {
  await seedCofounderTheme(page, theme);
  if (workspaces) {
    await page.addInitScript((seededWorkspaces) => {
      window.localStorage.setItem(
        "buzz-communities",
        JSON.stringify(seededWorkspaces),
      );
      window.localStorage.setItem(
        "buzz-active-community-id",
        seededWorkspaces[0]?.id ?? "",
      );
    }, workspaces);
  }
  await installMockBridge(
    page,
    workflowFixture({ playbooks, referenceWorkspace }),
    {
      previewFeatureOverrides: { map_home: mapHome },
      skipCommunitySeed: Boolean(workspaces),
    },
  );
  if (clientChannelId) {
    await page.addInitScript((channelId) => {
      const communities = JSON.parse(
        window.localStorage.getItem("buzz-communities") ?? "[]",
      ) as Array<Record<string, unknown>>;
      window.localStorage.setItem(
        "buzz-communities",
        JSON.stringify(
          communities.map((community) => ({
            ...community,
            clientChannelId: channelId,
          })),
        ),
      );
    }, clientChannelId);
  }
  await seedCompanyMapBusiness(page);
  await seedCompanyMapMoneyRails(page);
  await page.emulateMedia({ colorScheme: theme });
}

function currentRoute(page: Page): string {
  return new URL(page.url()).hash.slice(1);
}

function hashRoute(route: string): string {
  return `/#${route}`;
}

async function expectMapWindow(page: Page, depth = 0) {
  const window = page.getByTestId("fullmap-window");
  await expect(window).toBeVisible({ timeout: 15_000 });
  await expect(window).toHaveAttribute("data-trail-depth", String(depth));
}

async function openOperationsMap(page: Page) {
  await page.goto("/#/");
  await selectMapPart(page, "operations", "Operations");
}

async function closeMapWindow(page: Page) {
  await page.getByTestId("fullmap-window-close").click();
  await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
}

function windowContent(page: Page) {
  return page.locator(".map-canvas-route-window-content");
}

async function readMapCamera(page: Page) {
  return page.getByTestId("cofounder-map-stage").evaluate((node) => {
    const value = getComputedStyle(node)
      .getPropertyValue("--company-map-transform")
      .trim();
    const match = value.match(
      /^translate\(([-\d.]+)px,\s*([-\d.]+)px\) scale\(([-\d.]+)\)$/,
    );
    if (!match) throw new Error(`Unexpected map transform: ${value}`);
    return {
      scale: Number(match[3]),
      x: Number(match[1]),
      y: Number(match[2]),
    };
  });
}

async function dispatchPrimaryWorkspaceShortcut(page: Page, digit: string) {
  const cancelled = await page.evaluate((key) => {
    const isMac = /mac|iphone|ipad|ipod/i.test(navigator.platform);
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: !isMac,
      key,
      metaKey: isMac,
    });
    const wasNotCancelled = window.dispatchEvent(event);
    return !wasNotCancelled && event.defaultPrevented;
  }, digit);
  expect(cancelled).toBe(true);
}

async function workflowGeometry(page: Page) {
  return page.getByTestId("cofounder-map-stage").evaluate(
    (stage, ids) => {
      const stageBounds = stage.getBoundingClientRect();
      const point = (testId: string, selector: string) => {
        const target = stage.querySelector<HTMLElement>(
          `[data-testid="${testId}"] ${selector}`,
        );
        const bounds = target?.getBoundingClientRect();
        if (!bounds) return null;
        return {
          x: Math.round(bounds.left - stageBounds.left + bounds.width / 2),
          y: Math.round(bounds.top - stageBounds.top + bounds.height / 2),
        };
      };
      return {
        stage: {
          height: Math.round(stageBounds.height),
          width: Math.round(stageBounds.width),
        },
        delivery: point(ids.delivery, ".company-map-workflow-disc"),
        brief: point(ids.brief, ".company-map-workflow-step-disc"),
        build: point(ids.build, ".company-map-workflow-step-disc"),
        addStep: point(ids.addStep, ".company-map-workflow-step-disc"),
        proposal: point(ids.proposal, ".company-map-workflow-disc"),
        addWorkflow: point(
          "cofounder-map-add-workflow",
          ".company-map-workflow-disc",
        ),
      };
    },
    {
      addStep: `cofounder-map-add-step-${DELIVERY_PLAYBOOK_ID}`,
      brief: `cofounder-map-workflow-step-${DELIVERY_PLAYBOOK_ID}-brief`,
      build: `cofounder-map-workflow-step-${DELIVERY_PLAYBOOK_ID}-build`,
      delivery: `cofounder-map-workflow-${DELIVERY_PLAYBOOK_ID}`,
      proposal: `cofounder-map-workflow-${FOLLOW_UP_PLAYBOOK_ID}`,
    },
  );
}

function dynamicRoute(
  input: Parameters<typeof companyMapOperationsWindowSearch>[0],
  path: string,
) {
  return `${path}?${new URLSearchParams(
    companyMapOperationsWindowSearch(input),
  ).toString()}`;
}

test.describe("full map canvas slice 3b", () => {
  test.describe.configure({ timeout: 90_000 });

  test("renders active and proposed Operations workflows at the board geometry", async ({
    page,
  }) => {
    await installWorkflowMap(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openOperationsMap(page);

    const delivery = page.getByTestId(
      `cofounder-map-workflow-${DELIVERY_PLAYBOOK_ID}`,
    );
    const proposal = page.getByTestId(
      `cofounder-map-workflow-${FOLLOW_UP_PLAYBOOK_ID}`,
    );
    await expect(delivery).toHaveAttribute(
      "aria-label",
      "Delivery playbook. 3 running jobs.",
    );
    await expect(proposal).toHaveAttribute(
      "aria-label",
      "Lead follow-up. New workflow waiting for your yes.",
    );
    await expect(
      page.getByTestId(
        `cofounder-map-workflow-step-${DELIVERY_PLAYBOOK_ID}-build`,
      ),
    ).toHaveAttribute("aria-label", "Website build. Opens Work.");
    await expect(
      page.getByTestId(
        `cofounder-map-workflow-step-${DELIVERY_PLAYBOOK_ID}-approval`,
      ),
    ).toHaveAttribute("aria-label", "Your approval. Needs your yes.");
    await expect(
      page.getByTestId(`cofounder-map-add-step-${DELIVERY_PLAYBOOK_ID}`),
    ).toBeVisible();
    await expect(page.getByTestId("cofounder-map-add-workflow")).toBeVisible();
    await waitForAnimations(page);

    expect(await workflowGeometry(page)).toEqual({
      stage: { height: 790, width: 1400 },
      delivery: { x: 220, y: 23 },
      brief: { x: 220, y: 68 },
      build: { x: 220, y: 128 },
      addStep: { x: 220, y: 278 },
      proposal: { x: 220, y: 323 },
      addWorkflow: { x: 220, y: 371 },
    });

    await page.setViewportSize({ width: 2000, height: 1228 });
    await waitForAnimations(page);
    expect(await workflowGeometry(page)).toEqual({
      stage: { height: 790, width: 1400 },
      delivery: { x: 220, y: 23 },
      brief: { x: 220, y: 68 },
      build: { x: 220, y: 128 },
      addStep: { x: 220, y: 278 },
      proposal: { x: 220, y: 323 },
      addWorkflow: { x: 220, y: 371 },
    });
  });

  test("opens data-backed workflow nodes by pointer and keyboard with a three-part trail", async ({
    page,
  }) => {
    await installWorkflowMap(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openOperationsMap(page);

    await page
      .getByTestId(`cofounder-map-workflow-${DELIVERY_PLAYBOOK_ID}`)
      .click();
    await expectMapWindow(page);
    await expect(page.getByTestId("cofounder-playbook-screen")).toBeVisible();
    await expect(page.getByTestId("map-shell-trail")).toHaveText(
      "Operations/Delivery playbook",
    );
    await closeMapWindow(page);

    await openOperationsMap(page);
    const build = page.getByTestId(
      `cofounder-map-workflow-step-${DELIVERY_PLAYBOOK_ID}-build`,
    );
    await build.focus();
    await page.keyboard.press("Enter");
    await expectMapWindow(page);
    await expect.poll(() => currentRoute(page)).toContain("/work");
    await expect(page.getByTestId("map-shell-trail")).toHaveText(
      "Operations/Delivery playbook/Website build",
    );
    await closeMapWindow(page);

    await openOperationsMap(page);
    await page
      .getByTestId(
        `cofounder-map-workflow-step-${DELIVERY_PLAYBOOK_ID}-approval`,
      )
      .click();
    await expectMapWindow(page);
    await expect.poll(() => currentRoute(page)).toContain("/today/needs-you");
    await expect(page.getByTestId("map-shell-trail")).toHaveText(
      "Operations/Delivery playbook/Your approval",
    );
    await closeMapWindow(page);

    await openOperationsMap(page);
    await page
      .getByTestId(`cofounder-map-workflow-step-${DELIVERY_PLAYBOOK_ID}-brief`)
      .click();
    await expectMapWindow(page);
    await expect
      .poll(() => currentRoute(page))
      .toContain("/company/function/operations");
    await expect(page.getByTestId("map-shell-trail")).toHaveText(
      "Operations/Delivery playbook/Client brief and assets",
    );
    await closeMapWindow(page);

    await openOperationsMap(page);
    await page
      .getByTestId(`cofounder-map-add-step-${DELIVERY_PLAYBOOK_ID}`)
      .click();
    await expectMapWindow(page);
    await expect(page.getByTestId("map-shell-trail")).toHaveText(
      "Operations/Delivery playbook/Add a step",
    );
    await closeMapWindow(page);

    await openOperationsMap(page);
    await page.getByTestId("cofounder-map-add-workflow").click();
    await expectMapWindow(page);
    await expect.poll(() => currentRoute(page)).toContain("/channels/");
    await expect(page.getByTestId("map-shell-trail")).toHaveText(
      "Operations/New workflow",
    );
  });

  test("uses the configured private client stream and redraws after real playbook and job updates", async ({
    page,
  }) => {
    await installWorkflowMap(page, {
      clientChannelId: REFERENCE_CHANNEL_IDS.oliveHouse,
      referenceWorkspace: true,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openOperationsMap(page);

    await page
      .getByTestId(
        `cofounder-map-workflow-step-${DELIVERY_PLAYBOOK_ID}-present`,
      )
      .click();
    await expectMapWindow(page);
    await expect
      .poll(() => currentRoute(page))
      .toContain(`/channels/${REFERENCE_CHANNEL_IDS.oliveHouse}`);
    await expect(page.getByTestId("map-shell-trail")).toHaveText(
      "Operations/Delivery playbook/Present to client",
    );
    await closeMapWindow(page);

    await page.goto(
      hashRoute(
        dynamicRoute(
          {
            kind: "step",
            playbookId: DELIVERY_PLAYBOOK_ID,
            stepId: "approval",
            target: "needs-you",
          },
          "/today/needs-you",
        ),
      ),
    );
    await expectMapWindow(page);
    const proposal = page.getByRole("button", {
      name: "Add it: New workflow: Lead follow-up",
    });
    await expect(proposal).toBeVisible();
    await proposal.click();
    await expect(proposal).toHaveCount(0);
    await closeMapWindow(page);

    await openOperationsMap(page);
    await expect(
      page.getByTestId(`cofounder-map-workflow-${FOLLOW_UP_PLAYBOOK_ID}`),
    ).toHaveAttribute("aria-label", "Lead follow-up. 0 running jobs.");

    const deliveryNeeds = page.getByTestId(
      `cofounder-map-workflow-needs-${DELIVERY_PLAYBOOK_ID}`,
    );
    await expect(deliveryNeeds).toHaveText("1");
    await page
      .getByTestId(`cofounder-map-workflow-${DELIVERY_PLAYBOOK_ID}`)
      .click();
    await expectMapWindow(page);
    await page.getByTestId(`playbook-job-${PLANE_TREE_JOB_ID}`).click();
    const detail = page.getByTestId("playbook-job-detail");
    await expect(detail).toContainText("Current step: Website build.");
    await page.getByTestId("playbook-job-complete-step").click();
    await expect(detail).toContainText("Current step: Your approval.");
    await expect(deliveryNeeds).toHaveText("2");
  });

  test("keeps the dynamic work trail through a real work item, back, and Fit", async ({
    page,
  }) => {
    await installWorkflowMap(page, { referenceWorkspace: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openOperationsMap(page);
    await page
      .getByTestId(`cofounder-map-workflow-step-${DELIVERY_PLAYBOOK_ID}-build`)
      .click();
    await expectMapWindow(page);
    await windowContent(page)
      .getByRole("button", { name: "Board", exact: true })
      .click();
    await windowContent(page)
      .getByRole("button", { name: /Produce the spring content campaign/ })
      .click();
    await expectMapWindow(page, 1);
    await expect
      .poll(() => currentRoute(page))
      .toContain(`/work/${OLIVE_WORK_ID}`);
    await expect(
      page.getByRole("heading", {
        name: "Produce the spring content campaign",
      }),
    ).toBeVisible();
    await expect(page.getByTestId("map-shell-trail")).toHaveText(
      "Operations/Delivery playbook/Website build",
    );

    await page.getByTestId("fullmap-window-close").click();
    await expectMapWindow(page);
    await expect.poll(() => currentRoute(page)).toContain("/work");
    await page.getByTestId("cofounder-map-fit").click();
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
    await expect.poll(() => currentRoute(page)).toBe("/");
  });

  test("keeps the static five Operations jobs and the phone surface when no workflow exists", async ({
    page,
  }) => {
    await installWorkflowMap(page, { playbooks: false });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openOperationsMap(page);
    const staticJobs = page.locator('[data-job^="operations:"]');
    await expect(staticJobs).toHaveCount(5);
    await expect(staticJobs).toContainText([
      "Client intake",
      "Delivery",
      "Revisions",
      "Launch",
      "Handover",
    ]);
    await expect(page.getByTestId("cofounder-map-add-workflow")).toBeVisible();
    await expect(page.locator('[data-map-kind="workflow"]')).toHaveCount(0);

    await page.setViewportSize({ width: 2000, height: 1228 });
    await expect(staticJobs).toHaveCount(5);
    await expect(page.getByTestId("cofounder-map-add-workflow")).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#/");
    await expect(page.getByTestId("cofounder-map-phone")).toBeVisible();
    await page.getByTestId("cofounder-map-phone-operations").click();
    await expect(
      page.getByTestId("cofounder-map-phone-job-operations-client-intake"),
    ).toBeVisible();
  });

  test("keeps data-backed work routes outside the map when map home is off", async ({
    page,
  }) => {
    await installWorkflowMap(page, { mapHome: false });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(
      hashRoute(
        dynamicRoute(
          {
            kind: "step",
            playbookId: DELIVERY_PLAYBOOK_ID,
            stepId: "build",
            target: "work",
          },
          "/work",
        ),
      ),
    );
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    await expect(page.getByTestId("fullmap-canvas-route-surface")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
  });

  test("keeps the second ring recoverable through pan, zoom, Fit, and a company switch", async ({
    page,
  }) => {
    await installWorkflowMap(page, { workspaces: MAP_WORKSPACES });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openOperationsMap(page);
    const viewport = page.getByTestId("cofounder-map-viewport");
    await viewport.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+Equal");
    const pannedAndZoomed = await readMapCamera(page);
    expect(pannedAndZoomed.x).toBeLessThan(0);
    expect(pannedAndZoomed.scale).toBeGreaterThan(1);
    await page.getByTestId("cofounder-map-fit").click();
    expect(await readMapCamera(page)).toEqual({ scale: 1, x: 0, y: 0 });

    await page
      .getByTestId(`cofounder-map-workflow-${DELIVERY_PLAYBOOK_ID}`)
      .click();
    await expectMapWindow(page);
    await dispatchPrimaryWorkspaceShortcut(page, "2");
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.localStorage.getItem("buzz-active-community-id"),
        ),
      )
      .toBe("fullmap-s3b-workspace-two");
    await expect.poll(() => currentRoute(page)).toBe("/");
    await expect(page.getByTestId("fullmap-window")).toHaveCount(0);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`captures Operations workflow states in ${theme} when requested`, async ({
      page,
    }) => {
      test.skip(
        process.env.FULLMAP_S3B_CAPTURE !== "1",
        "capture is requested only for Slice 3b visual proof",
      );
      test.setTimeout(180_000);
      const screenshotDir =
        process.env.FULLMAP_S3B_SCREENSHOT_DIR ?? "test-results/fullmap-s3b";
      mkdirSync(screenshotDir, { recursive: true });

      await installWorkflowMap(page, { theme });
      for (const viewport of [
        { height: 900, label: "1440x900", width: 1440 },
        { height: 1228, label: "2000x1228", width: 2000 },
        { height: 1117, label: "1728x1117", width: 1728 },
      ]) {
        await page.setViewportSize(viewport);
        await openOperationsMap(page);
        await waitForAnimations(page);
        await page.screenshot({
          animations: "disabled",
          path: join(
            screenshotDir,
            `operations-workflow-open-${theme}-${viewport.label}.png`,
          ),
        });

        await page
          .getByTestId(
            `cofounder-map-workflow-step-${DELIVERY_PLAYBOOK_ID}-build`,
          )
          .click();
        await expectMapWindow(page);
        await waitForAnimations(page);
        await page.screenshot({
          animations: "disabled",
          path: join(
            screenshotDir,
            `operations-workflow-work-${theme}-${viewport.label}.png`,
          ),
        });
      }
    });
  }
});
