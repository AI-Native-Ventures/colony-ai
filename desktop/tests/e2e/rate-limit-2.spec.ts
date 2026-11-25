import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { test } from "./cofounder-map-test";
import {
  MAP_CHANNEL_ID,
  fixture,
  seedCofounderTheme,
  seedCompanyMapBusiness,
  seedCompanyMapMoneyRails,
} from "./cofounder-map-fixtures";

const ONE_MINUTE_MS = 60_000;
const MAP_VIEWPORT = { height: 900, width: 1440 };
const PROOF_VIEWPORTS = [
  { height: 900, label: "1440x900", width: 1440 },
  { height: 1117, label: "1728x1117", width: 1728 },
] as const;

type Theme = "dark" | "light";

type RateLimitScenario = Readonly<{
  closeOutreachBeforeMeasuring?: boolean;
  contactCount: number;
  name: string;
  route: string;
  screenTestId: string;
  targetPerMinute: number;
}>;

type RateLimitCall = Readonly<{
  at: number;
  counts: boolean;
  what: string;
}>;

type RateLimitMockState = {
  calls: RateLimitCall[];
  stageCountRequests: number;
  startedAt: number;
};

type RateLimitWindow = Window & {
  __RATE_LIMIT_2_MOCK__?: RateLimitMockState;
  __BUZZ_E2E_WHATSAPP__?: (request: {
    action: "command" | "post";
    body?: Record<string, unknown>;
    path?: string;
  }) => Promise<unknown>;
};

const scenarios: readonly RateLimitScenario[] = [
  {
    contactCount: 400,
    name: "map idle",
    route: "/#/",
    screenTestId: "cofounder-company-map",
    targetPerMinute: 20,
  },
  {
    contactCount: 700,
    name: "Needs you",
    route: `/#/channels/${MAP_CHANNEL_ID}?mapJob=sales%3AOutreach&whatsappDeskTab=needs-you`,
    screenTestId: "outreach-desk-needs-you",
    targetPerMinute: 120,
  },
  {
    contactCount: 400,
    name: "Leads",
    route: "/#/leads",
    screenTestId: "w10-leads-page",
    targetPerMinute: 120,
  },
  {
    contactCount: 5_000,
    name: "Lists",
    route: "/#/lists",
    screenTestId: "outreach-lists-page",
    targetPerMinute: 120,
  },
  {
    contactCount: 700,
    name: "Pipeline",
    route: `/#/channels/${MAP_CHANNEL_ID}?mapJob=sales%3AOutreach&whatsappDeskTab=pipeline`,
    screenTestId: "outreach-desk-pipeline",
    targetPerMinute: 120,
  },
  {
    contactCount: 700,
    name: "Chats",
    route: `/#/channels/${MAP_CHANNEL_ID}?mapJob=sales%3AOutreach&whatsappDeskTab=chats`,
    screenTestId: "whatsapp-outreach",
    targetPerMinute: 120,
  },
  {
    closeOutreachBeforeMeasuring: true,
    contactCount: 400,
    name: "map with Outreach closed",
    route: "/#/",
    screenTestId: "cofounder-company-map",
    targetPerMinute: 20,
  },
];

async function installRateLimitMap(
  page: Page,
  contactCount: number,
  refuseFirstStageCount = false,
  {
    theme = "light",
    viewport = MAP_VIEWPORT,
  }: {
    theme?: Theme;
    viewport?: { height: number; width: number };
  } = {},
) {
  await page.addInitScript(() => window.localStorage.clear());
  await seedCofounderTheme(page, theme);
  await installMockBridge(
    page,
    {
      ...fixture(),
      referenceWorkspace: true,
      referenceWorkspaceLeadCount: 320,
      referenceWorkspaceOutreachBoard: true,
      referenceWorkspaceOutreachReady: true,
      referenceWorkspaceOutreachSidebar: true,
      visualChannels: [{ id: MAP_CHANNEL_ID, name: "Outreach" }],
    },
    { previewFeatureOverrides: { map_home: true } },
  );
  await seedCompanyMapBusiness(page);
  await seedCompanyMapMoneyRails(page);
  await page.addInitScript(
    ({ contactCount, refuseFirstStageCount }) => {
      const now = new Date().toISOString();
      const contacts = Array.from({ length: contactCount }, (_, index) => {
        const ordinal = String(index + 1).padStart(11, "0");
        const stage =
          index % 8 === 0
            ? "wants_call"
            : index % 6 === 0
              ? "replied"
              : index % 4 === 0
                ? "contacted"
                : "none";
        return {
          awaitingApproval: false,
          businessName: `Business ${ordinal}`,
          businessOutreachStopped: false,
          businessStopReason: null,
          deliveryFailure: null,
          displayName: `Contact ${ordinal}`,
          e164: `+2782${ordinal}`,
          hasSentOutbound: stage !== "none",
          label: null,
          lastContactedAt: stage === "none" ? null : now,
          lastFailureSummary: null,
          lastInboundAt: stage === "replied" ? now : null,
          lastOutboundState: stage === "none" ? null : "sent",
          lastReplyAt: stage === "replied" ? now : null,
          leadId: null,
          optedOut: false,
          outreachStatus: "none",
          ownerPubkey: null,
          pauseReason: null,
          paused: false,
          profileName: null,
          queuedFrom: null,
          stage,
          stageChangedAt: now,
          stageSetBy: "auto",
          threadRootEventId: `thread-${ordinal}`,
          unanswered: stage === "replied",
          waId: `2782${ordinal}`,
          website: null,
          windowClosesAt: null,
          windowOpen: stage === "replied",
        };
      });
      const rateLimitWindow = window as RateLimitWindow;
      const state: RateLimitMockState = {
        calls: [],
        stageCountRequests: 0,
        startedAt: Date.now(),
      };
      rateLimitWindow.__RATE_LIMIT_2_MOCK__ = state;
      rateLimitWindow.__BUZZ_E2E_WHATSAPP__ = async (request) => {
        if (request.action !== "post") return {};
        const body = request.body ?? {};
        const what = typeof body.what === "string" ? body.what : "unknown";
        state.calls.push({
          at: Date.now(),
          counts: body.counts === true,
          what,
        });
        if (request.path !== "/api/whatsapp/query") return {};
        if (what === "status") {
          return {
            accountRetryCount: 0,
            connected: true,
            connectionId: "rate-limit-2-map",
            dailyNewChatCap: 30,
            displayPhoneNumber: "+27 61 534 0627",
            healthSummary: { notDeliveredByMeta: 0 },
            issues: [],
            newChatsSentToday: 0,
            ownerPaused: false,
            ownerPausedAt: null,
            ownerPausedBy: null,
            outreachChannelId: "e2e-company-map-whatsapp",
            pauseReason: null,
            phoneStatus: "CONNECTED",
            quality: "GREEN",
            sendHealth: null,
            sendingPaused: false,
            templates: [],
            templatesSyncedAt: null,
            verifiedName: "Horizon Labs",
            webhookUrl: null,
          };
        }
        if (what === "contacts") {
          if (body.counts === true) {
            state.stageCountRequests += 1;
            if (refuseFirstStageCount && state.stageCountRequests === 1) {
              throw Object.assign(
                new Error("rate-limited: quota exceeded; retry in 32s"),
                { status: 429 },
              );
            }
            return {
              contacts: [],
              countsTruncated: false,
              failedNotContacted: 0,
              stageCounts: {
                contacted: Math.floor(contactCount / 4),
                none: Math.floor(contactCount / 2),
                replied: Math.floor(contactCount / 6),
                wants_call: Math.floor(contactCount / 8),
              },
              totalContacts: contactCount,
            };
          }
          const limit = typeof body.limit === "number" ? body.limit : 200;
          const start =
            typeof body.before === "string" ? Number(body.before) : 0;
          const end = Math.min(start + limit, contacts.length);
          return {
            contacts: structuredClone(contacts.slice(start, end)),
            ...(end < contacts.length ? { nextCursor: String(end) } : {}),
          };
        }
        if (what === "batches") return { batches: [] };
        if (what === "drafts") return { drafts: [] };
        if (what === "templates") return { templates: [] };
        if (what === "suppressions") {
          return { businessStops: [], suppressions: [] };
        }
        if (what === "unknown_sends") return { unknownSends: [] };
        if (what === "thread") {
          return { contact: structuredClone(contacts[0]), messages: [] };
        }
        return {};
      };
    },
    { contactCount, refuseFirstStageCount },
  );
  await page.emulateMedia({ colorScheme: theme });
  await page.setViewportSize(viewport);
}

async function advanceClock(page: Page, milliseconds: number) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 250) {
    await page.clock.fastForward(Math.min(250, milliseconds - elapsed));
    await page.waitForTimeout(0);
  }
}

async function captureIfRequested(page: Page, name: string) {
  const directory = process.env.RATE_LIMIT_2_SCREENSHOT_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      try {
        animation.finish();
      } catch {
        animation.cancel();
      }
    }
  });
  await waitForAnimations(page);
  await page.screenshot({
    animations: "disabled",
    path: join(directory, `${name}.png`),
  });
}

async function openOutreachFromMap(page: Page) {
  await page.goto("/#/");
  await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
  await page.getByTestId("cofounder-map-sales").click();
  await page.getByTestId("cofounder-map-job-sales-outreach").click();
  await expect(page.getByTestId("map-outreach-desk-header")).toBeVisible();
}

async function captureMapOutreachProofs(
  page: Page,
  theme: Theme,
  viewport: (typeof PROOF_VIEWPORTS)[number],
) {
  const suffix = `${theme}-${viewport.label}`;
  const capture = (name: string) =>
    captureIfRequested(page, `${name}-${suffix}`);

  await installRateLimitMap(page, 400, false, { theme, viewport });
  await page.goto("/#/");
  await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
  await advanceClock(page, 8_000);
  await capture("map-idle");

  for (const scenario of scenarios.filter(
    (scenario) =>
      !scenario.closeOutreachBeforeMeasuring && scenario.name !== "map idle",
  )) {
    await installRateLimitMap(page, scenario.contactCount, false, {
      theme,
      viewport,
    });
    await page.goto(scenario.route);
    await expect(page.getByTestId(scenario.screenTestId)).toBeVisible();
    await advanceClock(page, 8_000);
    await capture(scenario.name.toLocaleLowerCase().replaceAll(" ", "-"));
  }

  await installRateLimitMap(page, 400, false, { theme, viewport });
  await openOutreachFromMap(page);
  await page.goto("/#/");
  await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
  await page.getByTestId("cofounder-map-sales").click();
  await advanceClock(page, 8_000);
  await capture("map-outreach-closed");
}

test.describe("rate-limit proof captures", () => {
  test.skip(
    process.env.RATE_LIMIT_2_CAPTURE !== "1",
    "capture is requested only for rate-limit proof",
  );

  test("captures rate-limit map states when requested", async ({ browser }) => {
    test.setTimeout(360_000);
    for (const theme of ["light", "dark"] as const) {
      for (const viewport of PROOF_VIEWPORTS) {
        const context = await browser.newContext({ viewport });
        try {
          const page = await context.newPage();
          await page.clock.install({
            time: new Date("2026-11-25T08:00:00.000Z"),
          });
          await captureMapOutreachProofs(page, theme, viewport);
        } finally {
          await context.close();
        }
      }
    }
  });

  test("captures the rate-limited Pipeline state when requested", async ({
    browser,
  }) => {
    test.setTimeout(240_000);
    for (const theme of ["light", "dark"] as const) {
      for (const viewport of PROOF_VIEWPORTS) {
        const context = await browser.newContext({ viewport });
        try {
          const page = await context.newPage();
          await page.clock.install({
            time: new Date("2026-11-25T08:00:00.000Z"),
          });
          await installRateLimitMap(page, 700, true, { theme, viewport });
          await openOutreachFromMap(page);
          await advanceClock(page, 12_000);
          await page.getByTestId("map-outreach-tab-pipeline").click();
          await advanceClock(page, 8_000);
          await expect(
            page.getByTestId("outreach-desk-pipeline"),
          ).toBeVisible();
          await expect(
            page.getByTestId("relay-http-rate-limit-notice"),
          ).toContainText(/Busy, trying again in (?:[1-3]\d) s/u);
          await captureIfRequested(
            page,
            `pipeline-429-${theme}-${viewport.label}`,
          );
        } finally {
          await context.close();
        }
      }
    }
  });
});

test("Pipeline keeps its data through a 429 and reloads after the relay window", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.clock.install({ time: new Date("2026-11-25T08:00:00.000Z") });
  await installRateLimitMap(page, 700, true);
  await openOutreachFromMap(page);
  await advanceClock(page, 12_000);
  await expect(page.getByTestId("outreach-desk-needs-you")).toBeVisible();

  await page.getByTestId("map-outreach-tab-pipeline").click();
  await advanceClock(page, 8_000);
  const pipeline = page.getByTestId("outreach-desk-pipeline");
  await expect(pipeline).toBeVisible();
  await expect(
    pipeline.getByTestId(/^outreach-pipeline-card-/u).first(),
  ).toBeVisible();
  await expect(page.getByTestId("relay-http-rate-limit-notice")).toContainText(
    /Busy, trying again in (?:[1-3]\d) s/u,
  );
  await expect(page.getByText("Pipeline could not be loaded.")).toHaveCount(0);
  await captureIfRequested(page, "pipeline-429-light-1440x900");

  await advanceClock(page, 36_000);
  await expect(page.getByTestId("relay-http-rate-limit-notice")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as RateLimitWindow).__RATE_LIMIT_2_MOCK__
            ?.stageCountRequests ?? 0,
      ),
    )
    .toBeGreaterThan(1);
  await expect(
    pipeline.getByTestId(/^outreach-pipeline-card-/u).first(),
  ).toBeVisible();
});

test("map Outreach HTTP callers remain below the per-minute screen targets", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.clock.install({ time: new Date("2026-11-25T08:00:00.000Z") });
  for (const scenario of scenarios) {
    await installRateLimitMap(page, scenario.contactCount);
    await page.goto(scenario.route);
    if (scenario.closeOutreachBeforeMeasuring) {
      await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
      await page.getByTestId("cofounder-map-sales").click();
      await page.getByTestId("cofounder-map-job-sales-outreach").click();
      await expect(page.getByTestId("map-outreach-desk-header")).toBeVisible();
      await page.goto("/#/");
      await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
    }
    await advanceClock(page, 12_000);
    await expect(page.getByTestId(scenario.screenTestId)).toBeVisible();
    const measured = await page.evaluate(() => {
      const state = (window as RateLimitWindow).__RATE_LIMIT_2_MOCK__;
      if (!state) throw new Error("Rate-limit mock is unavailable.");
      return { startedAt: state.startedAt };
    });
    await advanceClock(page, ONE_MINUTE_MS - 12_000);
    const calls = await page.evaluate(
      ({ startedAt, windowMs }) => {
        const state = (window as RateLimitWindow).__RATE_LIMIT_2_MOCK__;
        if (!state) throw new Error("Rate-limit mock is unavailable.");
        return state.calls.filter(
          (call) => call.at >= startedAt && call.at < startedAt + windowMs,
        );
      },
      { startedAt: measured.startedAt, windowMs: ONE_MINUTE_MS },
    );
    const perMillisecond = new Map<number, number>();
    for (const call of calls) {
      perMillisecond.set(call.at, (perMillisecond.get(call.at) ?? 0) + 1);
    }
    expect(
      calls.length,
      `${scenario.name} made ${calls.length} HTTP calls in its virtual minute`,
    ).toBeLessThan(scenario.targetPerMinute);
    expect(
      Math.max(0, ...perMillisecond.values()),
      `${scenario.name} started more than one HTTP call in the same millisecond`,
    ).toBeLessThanOrEqual(1);
  }
});
