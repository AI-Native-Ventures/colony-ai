import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { TEST_IDENTITIES } from "../helpers/bridge";
import {
  KIND_COMPANY_JOB_ACTION,
  KIND_HIRE_ACTION,
} from "../../src/shared/constants/kinds";
import { test } from "./cofounder-map-test";
import {
  AYA_PUBKEY,
  fixture,
  functionHead,
  MAP_CHANNEL_ID,
  selectMapPart,
  seedCompanyMapWhatsApp,
} from "./cofounder-map-fixtures";
import { prepareMapShell } from "./mapShellTestSupport";

const JOB_ASSIGNMENT_EXTENSION = "colony-job-assignments";
const VIEWPORT = { width: 1440, height: 900 };
const PREBUILT_SPECIALIST_CAPTURE_ENABLED =
  process.env.COLONY_PREBUILT_SPECIALIST_CAPTURE === "1";
const PREBUILT_SPECIALIST_SCREENSHOT_DIR =
  process.env.COLONY_PREBUILT_SPECIALIST_SCREENSHOT_DIR ??
  "test-results/prebuilt-specialists";
const PREBUILT_SPECIALIST_BOARD_DIR =
  "/Users/mac/.claude/coord-work/colony-prebuilt/renders";
const PREBUILT_SPECIALIST_CHANNEL = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "general",
};
const MAP_OUTREACH_CHANNEL = {
  id: MAP_CHANNEL_ID,
  name: "Outreach",
};

type FunctionId =
  | "sales"
  | "operations"
  | "customer_success"
  | "finance"
  | "brand";

type CommandLogEntry = { command: string; payload: unknown };
type SpecialistTheme = "light" | "dark";
type SpecialistViewport = { width: number; height: number };

function decodeAvatarSource(source: string) {
  const base64Prefix = "data:image/svg+xml;base64,";
  return source.startsWith(base64Prefix)
    ? Buffer.from(source.slice(base64Prefix.length), "base64").toString("utf8")
    : decodeURIComponent(source);
}

async function readCommandLog(page: Page): Promise<CommandLogEntry[]> {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __BUZZ_E2E_COMMAND_LOG__?: CommandLogEntry[];
        }
      ).__BUZZ_E2E_COMMAND_LOG__ ?? [],
  );
}

function signedCompanyAction(
  entry: CommandLogEntry,
  kind: number,
  expectedAction: string,
) {
  if (entry.command !== "sign_event") return null;
  const payload = entry.payload as { content?: unknown; kind?: unknown } | null;
  if (payload?.kind !== kind || typeof payload.content !== "string") {
    return null;
  }
  try {
    const action: unknown = JSON.parse(payload.content);
    if (!action || typeof action !== "object" || Array.isArray(action)) {
      return null;
    }
    return (action as Record<string, unknown>).action === expectedAction
      ? (action as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function assertSpecialistHireSequence(
  page: Page,
  employeePubkey: string,
) {
  await expect
    .poll(async () => {
      const commands = await readCommandLog(page);
      return commands.some(
        (entry) =>
          signedCompanyAction(entry, KIND_HIRE_ACTION, "complete") !== null,
      );
    })
    .toBe(true);

  const commands = await readCommandLog(page);
  const findAction = (kind: number, action: string) =>
    commands.findIndex(
      (entry) => signedCompanyAction(entry, kind, action) !== null,
    );
  const createIndex = findAction(KIND_HIRE_ACTION, "create");
  const jobIntentIndex = findAction(KIND_COMPANY_JOB_ACTION, "hire_set");
  const approveIndex = findAction(KIND_HIRE_ACTION, "approve");
  const attachIndex = findAction(KIND_HIRE_ACTION, "attach_employee");
  const completeIndex = findAction(KIND_HIRE_ACTION, "complete");
  const createEntry = commands[createIndex];
  const jobIntentEntry = commands[jobIntentIndex];
  const completeEntry = commands[completeIndex];
  const create = createEntry
    ? signedCompanyAction(createEntry, KIND_HIRE_ACTION, "create")
    : null;
  const jobIntent = jobIntentEntry
    ? signedCompanyAction(jobIntentEntry, KIND_COMPANY_JOB_ACTION, "hire_set")
    : null;
  const completion = completeEntry
    ? signedCompanyAction(completeEntry, KIND_HIRE_ACTION, "complete")
    : null;
  const proposal = create?.proposal as Record<string, unknown> | undefined;
  const homeChannelId = proposal?.introductionChannelId;
  const hireId = create?.hireId;

  expect(createIndex).toBeGreaterThanOrEqual(0);
  expect(jobIntentIndex).toBeGreaterThan(createIndex);
  expect(approveIndex).toBeGreaterThan(jobIntentIndex);
  expect(attachIndex).toBeGreaterThan(approveIndex);
  expect(completeIndex).toBeGreaterThan(attachIndex);
  expect(hireId).toEqual(expect.any(String));
  expect(homeChannelId).toEqual(expect.any(String));
  expect(jobIntent).toMatchObject({
    action: "hire_set",
    function: "sales",
    hireId,
    jobId: "follow-ups",
  });
  expect(completion).toMatchObject({
    action: "complete",
    employeePubkey,
    hireId,
    introductionEventId: expect.any(String),
  });

  const managedAgentCreateIndex = commands.findIndex(
    (entry) => entry.command === "create_managed_agent",
  );
  const managedAgentCreate = commands[managedAgentCreateIndex]?.payload as
    | { input?: { model?: unknown; modelOverride?: unknown } }
    | undefined;
  expect(managedAgentCreateIndex).toBeGreaterThan(approveIndex);
  expect(managedAgentCreateIndex).toBeLessThan(attachIndex);
  expect(managedAgentCreate?.input?.model).toEqual(expect.any(String));
  expect(managedAgentCreate?.input?.modelOverride).toBe(
    managedAgentCreate?.input?.model,
  );

  const introductionMarker = `company-prebuilt-hire:${hireId}:introduction`;
  const firstMessageMarker = `company-prebuilt-hire:${hireId}:first-message`;
  const messages = commands
    .map((entry, index) => ({ entry, index }))
    .filter(
      ({ entry }) => entry.command === "send_managed_agent_channel_message",
    );
  const introductions = messages.filter(
    ({ entry }) =>
      (entry.payload as { marker?: unknown } | null)?.marker ===
      introductionMarker,
  );
  const firstMessages = messages.filter(
    ({ entry }) =>
      (entry.payload as { marker?: unknown } | null)?.marker ===
      firstMessageMarker,
  );
  expect(introductions).toHaveLength(1);
  expect(firstMessages).toHaveLength(1);
  const introduction = introductions[0];
  const firstMessage = firstMessages[0];
  if (!introduction || !firstMessage) {
    throw new Error("The specialist hire did not post both durable messages.");
  }
  expect(introduction.index).toBeGreaterThan(attachIndex);
  expect(introduction.index).toBeLessThan(completeIndex);
  expect(firstMessage.index).toBeGreaterThan(completeIndex);
  const introductionPayload = introduction.entry.payload as {
    agentPubkey?: unknown;
    channelId?: unknown;
    markerScope?: unknown;
  };
  const firstMessagePayload = firstMessage.entry.payload as {
    agentPubkey?: unknown;
    channelId?: unknown;
    markerScope?: unknown;
  };
  expect(introductionPayload).toMatchObject({
    agentPubkey: employeePubkey,
    channelId: homeChannelId,
    markerScope: "agent",
  });
  expect(firstMessagePayload).toMatchObject({
    agentPubkey: employeePubkey,
    markerScope: "agent",
  });
  expect(firstMessagePayload.channelId).not.toBe(homeChannelId);
}

function specialistScreenshotPath(
  screenshotDir: string,
  name: string,
  theme: SpecialistTheme,
  viewport: SpecialistViewport,
) {
  return join(
    screenshotDir,
    `${name}-${theme}-${viewport.width}x${viewport.height}.png`,
  );
}

async function captureSpecialistBoard(
  page: Page,
  screenshotDir: string,
  name: string,
  theme: SpecialistTheme,
  viewport: SpecialistViewport,
) {
  const path = specialistScreenshotPath(screenshotDir, name, theme, viewport);
  await waitForAnimations(page);
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path,
  });
  return path;
}

async function captureSpecialistComparison(
  page: Page,
  board: "PbHireNext" | "PbJob" | "PbSpotStates",
  appScreenshot: string,
  screenshotDir: string,
) {
  const boardPath = join(PREBUILT_SPECIALIST_BOARD_DIR, `${board}.png`);
  const boardHeight = board === "PbHireNext" ? 1000 : 900;
  const boardImage = readFileSync(boardPath).toString("base64");
  const appImage = readFileSync(appScreenshot).toString("base64");

  await page.setViewportSize({ width: 2880, height: boardHeight });
  await page.setContent(`
    <!doctype html>
    <html lang="en">
      <head>
        <style>
          * { box-sizing: border-box; }
          html, body { margin: 0; width: 2880px; height: ${boardHeight}px; overflow: hidden; }
          main { display: flex; width: 2880px; height: ${boardHeight}px; background: #fff; }
          img { display: block; width: 1440px; height: ${boardHeight}px; object-fit: cover; }
        </style>
      </head>
      <body>
        <main>
          <img alt="Approved ${board} board" src="data:image/png;base64,${boardImage}" />
          <img alt="Implemented ${board} state" src="data:image/png;base64,${appImage}" />
        </main>
      </body>
    </html>
  `);
  await expect(page.getByRole("img")).toHaveCount(2);
  await waitForAnimations(page);
  await page.screenshot({
    animations: "disabled",
    fullPage: false,
    path: join(screenshotDir, `${board}-compare.png`),
  });
}

function mapJobTestId(functionId: FunctionId, jobName: string) {
  return `cofounder-map-job-${functionId}-${jobName
    .toLowerCase()
    .replaceAll(" ", "-")}`;
}

function spotTestId(functionId: FunctionId, jobId: string) {
  return `job-assignment-spot-${functionId}-${jobId}`;
}

function specialistFixture({
  jobHeads = [],
  role = "owner",
  supportsJobs = true,
}: {
  jobHeads?: Array<{
    function: FunctionId;
    jobId: string;
    state: "empty" | "filled";
    assigneePubkey?: string | null;
  }>;
  role?: "owner" | "admin" | "member";
  supportsJobs?: boolean;
} = {}) {
  const base = fixture({
    includeScout: true,
    identity: TEST_IDENTITIES.tyler,
    role,
    functionHeads: [
      functionHead("sales", "filled", AYA_PUBKEY),
      functionHead("operations", "covered_by_scout"),
      functionHead("finance", "empty"),
    ],
  });
  return {
    ...base,
    companyJobHeads: jobHeads,
    relayExtensions: supportsJobs ? [JOB_ASSIGNMENT_EXTENSION] : [],
    visualChannels: [PREBUILT_SPECIALIST_CHANNEL, MAP_OUTREACH_CHANNEL],
  };
}

async function prepareSpecialistMap(
  page: Page,
  mock = specialistFixture(),
  viewport = VIEWPORT,
  theme: SpecialistTheme = "light",
) {
  await page.addInitScript(() => {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("company-map-prebuilt-")) {
        window.localStorage.removeItem(key);
      }
    }
  });
  await prepareMapShell(page, {
    cofounderEnabled: true,
    featureEnabled: true,
    height: viewport.height,
    identity: TEST_IDENTITIES.tyler,
    mock,
    theme,
    width: viewport.width,
  });
  // prepareMapShell's default WhatsApp mock is installed before this proof.
  // Install the map-ready status after it, then reload so Follow-ups and the
  // other WhatsApp jobs retain their real map-window route.
  await seedCompanyMapWhatsApp(page, MAP_CHANNEL_ID);
  await page.reload();
  await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark")),
    )
    .toBe(theme === "dark");
}

async function openJobSpot(
  page: Page,
  functionId: FunctionId,
  jobName: string,
  jobId: string,
) {
  await selectMapPart(
    page,
    functionId,
    functionId === "customer_success"
      ? "Customer Success"
      : functionId[0].toUpperCase() + functionId.slice(1),
  );
  await page.getByTestId(mapJobTestId(functionId, jobName)).click();
  await expect(page.getByTestId("fullmap-window")).toBeVisible();
  const spot = page.getByTestId(spotTestId(functionId, jobId));
  await expect(spot).toBeVisible();
  await spot.getByRole("button").click();
  const card = page.getByTestId(`job-assignment-card-${functionId}-${jobId}`);
  await expect(card).toBeVisible();
  return card;
}

async function choosePrebuiltRuntimeAndModel(page: Page) {
  await page.getByTestId("prebuilt-hire-harness").click();
  await page.getByTestId("prebuilt-hire-harness-option-goose").click();
  const model = page.getByTestId("prebuilt-hire-model");
  await expect(model).toBeEnabled();
  await model.click();
  await page
    .locator("[data-testid^='prebuilt-hire-model-option-']")
    .first()
    .click();
  const effort = page.getByTestId("prebuilt-hire-effort");
  if (await effort.isEnabled()) {
    await effort.click();
    await page
      .locator("[data-testid^='prebuilt-hire-effort-option-']")
      .first()
      .click();
  }
  await expect(page.getByTestId("prebuilt-hire-finish")).toBeEnabled();
}

async function startedEmployeePubkey(page: Page) {
  const pubkey = await page.evaluate(() => {
    const entries =
      (
        window as Window & {
          __BUZZ_E2E_COMMAND_LOG__?: CommandLogEntry[];
        }
      ).__BUZZ_E2E_COMMAND_LOG__ ?? [];
    const entry = [...entries]
      .reverse()
      .find((candidate) => candidate.command === "start_managed_agent");
    const payload = entry?.payload as { pubkey?: unknown } | undefined;
    return typeof payload?.pubkey === "string" ? payload.pubkey : null;
  });
  expect(pubkey).toMatch(/^[0-9a-f]{64}$/u);
  return pubkey as string;
}

async function hireFromSpot(
  page: Page,
  card: ReturnType<Page["getByTestId"]>,
  agentName: string,
) {
  await card.getByRole("button", { name: `Hire ${agentName}` }).click();
  const dialog = page.getByTestId("prebuilt-head-hire-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(agentName);
  await choosePrebuiltRuntimeAndModel(page);
  await page.getByTestId("prebuilt-hire-finish").click();
  await expect(dialog).toBeHidden();
  return startedEmployeePubkey(page);
}

test.describe("prebuilt specialist visual proof", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1728, height: 1117 },
    ] as const) {
      test(`captures specialist boards in ${theme} at ${viewport.width}x${viewport.height}`, async ({
        page,
      }) => {
        test.skip(
          !PREBUILT_SPECIALIST_CAPTURE_ENABLED,
          "The specialist proof capture only runs when explicitly requested.",
        );
        test.setTimeout(180_000);
        mkdirSync(PREBUILT_SPECIALIST_SCREENSHOT_DIR, { recursive: true });

        await prepareSpecialistMap(page, specialistFixture(), viewport, theme);
        const jobCard = await openJobSpot(
          page,
          "sales",
          "Follow-ups",
          "follow-ups",
        );
        await expect(jobCard).toContainText(
          "Aya does Follow-ups as Head of Sales.",
        );
        const jobScreenshot = await captureSpecialistBoard(
          page,
          PREBUILT_SPECIALIST_SCREENSHOT_DIR,
          "PbJob",
          theme,
          viewport,
        );

        await prepareSpecialistMap(page, specialistFixture(), viewport, theme);
        const specialistCard = await openJobSpot(
          page,
          "sales",
          "Follow-ups",
          "follow-ups",
        );
        await hireFromSpot(page, specialistCard, "Follow-ups specialist");
        await expect(specialistCard).toContainText("Works here");
        await expect(specialistCard).toContainText("Just hired");
        await expect(
          page.getByTestId("fullmap-window-job-ring").locator("img"),
        ).toHaveCount(1);
        const specialistScreenshot = await captureSpecialistBoard(
          page,
          PREBUILT_SPECIALIST_SCREENSHOT_DIR,
          "PbSpotStates-specialist",
          theme,
          viewport,
        );

        await prepareSpecialistMap(page, specialistFixture(), viewport, theme);
        const beforeHeadCard = await openJobSpot(
          page,
          "finance",
          "Invoices",
          "invoices",
        );
        await hireFromSpot(page, beforeHeadCard, "Invoices specialist");
        await expect(beforeHeadCard).toContainText(
          "Scout leads this specialist until you hire a Head of Finance.",
        );
        await captureSpecialistBoard(
          page,
          PREBUILT_SPECIALIST_SCREENSHOT_DIR,
          "PbSpotStates-before-head",
          theme,
          viewport,
        );

        await prepareSpecialistMap(
          page,
          specialistFixture({
            jobHeads: [
              {
                function: "sales",
                jobId: "follow-ups",
                state: "filled",
                assigneePubkey: AYA_PUBKEY,
              },
            ],
            role: "member",
          }),
          viewport,
          theme,
        );
        const memberCard = await openJobSpot(
          page,
          "sales",
          "Follow-ups",
          "follow-ups",
        );
        await expect(memberCard).toContainText("Works here");
        await expect(
          memberCard.getByRole("button", { name: "Remove" }),
        ).toHaveCount(0);
        await captureSpecialistBoard(
          page,
          PREBUILT_SPECIALIST_SCREENSHOT_DIR,
          "PbSpotStates-member",
          theme,
          viewport,
        );

        await prepareSpecialistMap(page, specialistFixture(), viewport, theme);
        await selectMapPart(page, "sales", "Sales");
        await page.getByTestId(mapJobTestId("sales", "Calls")).click();
        const unavailableCard = page.getByTestId(
          "job-assignment-card-sales-calls",
        );
        await expect(unavailableCard).toContainText("Not available yet");
        await expect(unavailableCard).toContainText(
          "Colony cannot make phone calls yet.",
        );
        await captureSpecialistBoard(
          page,
          PREBUILT_SPECIALIST_SCREENSHOT_DIR,
          "PbSpotStates-not-available",
          theme,
          viewport,
        );

        await prepareSpecialistMap(page, specialistFixture(), viewport, theme);
        const firstSpecialistCard = await openJobSpot(
          page,
          "sales",
          "Follow-ups",
          "follow-ups",
        );
        await hireFromSpot(page, firstSpecialistCard, "Follow-ups specialist");
        await page.goto("/#/company/map");
        const nextSpecialistCard = await openJobSpot(
          page,
          "sales",
          "Outreach",
          "outreach",
        );
        await nextSpecialistCard
          .getByRole("button", { name: "Hire Outreach specialist" })
          .click();
        const nextHireDialog = page.getByTestId("prebuilt-head-hire-dialog");
        await expect(nextHireDialog).toBeVisible();
        await expect(nextHireDialog).toContainText("Outreach specialist");
        await expect(
          nextHireDialog.getByTestId("prebuilt-hire-choice-helper"),
        ).toHaveText("Same as your last hire. Change any of them.");
        await captureSpecialistBoard(
          page,
          PREBUILT_SPECIALIST_SCREENSHOT_DIR,
          "PbHireNext",
          theme,
          viewport,
        );

        let nextHireComparisonSource: string | null = null;
        if (
          theme === "light" &&
          viewport.width === 1440 &&
          viewport.height === 900
        ) {
          const comparisonSourceDir = join(
            PREBUILT_SPECIALIST_SCREENSHOT_DIR,
            ".compare-sources",
          );
          mkdirSync(comparisonSourceDir, { recursive: true });
          nextHireComparisonSource = join(
            comparisonSourceDir,
            "PbHireNext-light-1440x1000.png",
          );
          await page.setViewportSize({ width: 1440, height: 1000 });
          await waitForAnimations(page);
          await page.screenshot({
            animations: "disabled",
            fullPage: false,
            path: nextHireComparisonSource,
          });
          await page.setViewportSize(viewport);

          await prepareSpecialistMap(
            page,
            specialistFixture(),
            viewport,
            theme,
          );
          await captureSpecialistBoard(
            page,
            PREBUILT_SPECIALIST_SCREENSHOT_DIR,
            "MapShell-sidebar",
            theme,
            viewport,
          );

          await captureSpecialistComparison(
            page,
            "PbJob",
            jobScreenshot,
            PREBUILT_SPECIALIST_SCREENSHOT_DIR,
          );
          await captureSpecialistComparison(
            page,
            "PbSpotStates",
            specialistScreenshot,
            PREBUILT_SPECIALIST_SCREENSHOT_DIR,
          );
          await captureSpecialistComparison(
            page,
            "PbHireNext",
            nextHireComparisonSource,
            PREBUILT_SPECIALIST_SCREENSHOT_DIR,
          );
        }
      });
    }

    test(`captures the phone map in ${theme}`, async ({ page }) => {
      test.skip(
        !PREBUILT_SPECIALIST_CAPTURE_ENABLED,
        "The specialist proof capture only runs when explicitly requested.",
      );
      test.setTimeout(120_000);
      const phoneViewport = { width: 390, height: 844 };
      mkdirSync(PREBUILT_SPECIALIST_SCREENSHOT_DIR, { recursive: true });
      await prepareSpecialistMap(
        page,
        specialistFixture(),
        phoneViewport,
        theme,
      );
      await expect(page.getByTestId("cofounder-map-phone")).toBeVisible();
      await page.getByTestId("cofounder-map-phone-sales").click();
      await page
        .getByTestId("cofounder-map-phone-job-spot-sales-follow-ups")
        .click();
      await expect(
        page.getByTestId("job-assignment-card-sales-follow-ups"),
      ).toBeVisible();
      await captureSpecialistBoard(
        page,
        PREBUILT_SPECIALIST_SCREENSHOT_DIR,
        "Phone-map",
        theme,
        phoneViewport,
      );
    });
  }
});

function overlaps(
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number },
) {
  return !(
    first.x + first.width <= second.x ||
    second.x + second.width <= first.x ||
    first.y + first.height <= second.y ||
    second.y + second.height <= first.y
  );
}

test.describe("prebuilt specialists in the map shell", () => {
  test("job cards keep the board visuals and a clean map mock", async ({
    page,
  }) => {
    await prepareSpecialistMap(page);
    const card = await openJobSpot(page, "sales", "Follow-ups", "follow-ups");
    const specialistBox = card.getByTestId("job-assignment-specialist-box");
    await expect(specialistBox).toHaveCSS(
      "background-color",
      "rgb(245, 241, 248)",
    );
    await expect(specialistBox).toHaveCSS("border-top-width", "1px");
    await expect(page.getByTestId("whatsapp-thread-messages")).toContainText(
      "Good morning. Can we talk on Tuesday?",
    );
    await expect(
      page.getByText(
        "The relay returned an invalid WhatsApp thread message list.",
      ),
    ).toHaveCount(0);

    const headAvatar = await page
      .getByTestId("fullmap-window-job-ring")
      .locator("img")
      .getAttribute("src");
    expect(decodeAvatarSource(headAvatar ?? "")).toContain("#E0826B");

    await card.getByRole("button", { name: "Close" }).click();
    await expect(card).toBeHidden();
    await page
      .getByTestId(spotTestId("sales", "follow-ups"))
      .getByRole("button")
      .click();
    await expect(card).toBeVisible();

    const spotPrimary = await card
      .getByRole("button", { name: "Hire Follow-ups specialist" })
      .evaluate((element) => window.getComputedStyle(element).backgroundColor);
    await card
      .getByRole("button", { name: "Hire Follow-ups specialist" })
      .click();
    await choosePrebuiltRuntimeAndModel(page);
    const finish = page.getByTestId("prebuilt-hire-finish");
    expect(
      await finish.evaluate(
        (element) => window.getComputedStyle(element).backgroundColor,
      ),
    ).toBe(spotPrimary);
    await finish.click();
    await expect(page.getByTestId("prebuilt-head-hire-dialog")).toBeHidden();

    const specialistAvatar = await page
      .getByTestId("fullmap-window-job-ring")
      .locator("img")
      .getAttribute("src");
    expect(decodeAvatarSource(specialistAvatar ?? "")).toContain("#E0826B");
    await expect(card.getByRole("button", { name: "Close" })).toBeVisible();
  });

  test("an owner hires and removes a specialist through the job pill", async ({
    page,
  }) => {
    await prepareSpecialistMap(page);
    const card = await openJobSpot(page, "sales", "Follow-ups", "follow-ups");
    await expect(
      page.getByTestId(spotTestId("sales", "follow-ups")),
    ).toContainText("Aya, Head of Sales, does this");
    await expect(card).toContainText("Aya does Follow-ups as Head of Sales.");
    await expect(card).toContainText("Pre-built");

    await hireFromSpot(page, card, "Follow-ups specialist");
    const employeePubkey = await startedEmployeePubkey(page);
    await assertSpecialistHireSequence(page, employeePubkey);
    await expect(card).toContainText("Follow-ups specialist");
    await expect(card).toContainText("Works here");
    await expect(card).toContainText("Just hired");
    await expect(card).toContainText(
      "I chase the leads who read your message and stayed silent.",
    );
    await expect(
      page.getByTestId("fullmap-window-job-ring").locator("img"),
    ).toHaveCount(1);

    await card.getByRole("button", { name: "Remove" }).click();
    const terminate = page.getByTestId("team-dialog-terminate");
    await expect(terminate).toBeVisible();
    await terminate.locator("#team-status-reason").fill("The test job ended.");
    await terminate.getByRole("button", { name: "Terminate employee" }).click();
    await expect(terminate).toBeHidden();
    await expect(card).toContainText("Hire Follow-ups specialist");
    await expect(card).toContainText("Aya does Follow-ups as Head of Sales.");

    await page.goto("/#/team");
    await expect(
      page.getByTestId(`company-team-member-${employeePubkey}`),
    ).toContainText("Terminated");
  });

  test("a specialist hired before its head is reparented when the head arrives", async ({
    page,
  }) => {
    await prepareSpecialistMap(page);
    const card = await openJobSpot(page, "finance", "Invoices", "invoices");
    await expect(card).toContainText(
      "Scout does Invoices for now. Nobody leads Finance yet.",
    );
    const specialistPubkey = await hireFromSpot(
      page,
      card,
      "Invoices specialist",
    );
    await expect(card).toContainText(
      "Scout leads this specialist until you hire a Head of Finance.",
    );

    await page.goto("/#/team");
    await expect(
      page.getByTestId(`company-team-member-${specialistPubkey}`),
    ).toContainText("Scout");

    await page.goto("/#/company/map");
    await selectMapPart(page, "finance", "Finance");
    await page.getByTestId("cofounder-hire-head-finance").click();
    await choosePrebuiltRuntimeAndModel(page);
    await page.getByTestId("prebuilt-hire-finish").click();
    await expect(page.getByTestId("prebuilt-head-hire-dialog")).toBeHidden();

    await page.goto("/#/team");
    await expect(
      page.getByTestId(`company-team-member-${specialistPubkey}`),
    ).toContainText("Head of Finance");

    await page.goto("/#/money/invoices?mapJob=finance%3AInvoices");
    await expect(page.getByTestId("fullmap-window")).toBeVisible();
    await page
      .getByTestId(spotTestId("finance", "invoices"))
      .getByRole("button")
      .click();
    await expect(
      page.getByTestId("job-assignment-card-finance-invoices"),
    ).toContainText("Head of Finance leads this specialist.");
  });

  test("unavailable, member, and old-relay states never offer an unauthorized hire", async ({
    page,
  }) => {
    await prepareSpecialistMap(
      page,
      specialistFixture({ supportsJobs: false }),
    );
    const oldRelayCard = await openJobSpot(
      page,
      "sales",
      "Follow-ups",
      "follow-ups",
    );
    await expect(oldRelayCard).toContainText(
      "Update this company relay to hire a specialist.",
    );
    await expect(
      oldRelayCard.getByRole("button", { name: /Hire/u }),
    ).toHaveCount(0);

    await prepareSpecialistMap(
      page,
      specialistFixture({
        jobHeads: [
          {
            function: "sales",
            jobId: "follow-ups",
            state: "filled",
            assigneePubkey: AYA_PUBKEY,
          },
        ],
        role: "member",
      }),
    );
    const memberCard = await openJobSpot(
      page,
      "sales",
      "Follow-ups",
      "follow-ups",
    );
    await expect(memberCard).toContainText("Works here");
    await expect(memberCard.getByRole("button", { name: /Hire/u })).toHaveCount(
      0,
    );
    await expect(
      memberCard.getByRole("button", { name: "Remove" }),
    ).toHaveCount(0);

    await page.goto("/#/company/map");
    await selectMapPart(page, "sales", "Sales");
    await page.getByTestId(mapJobTestId("sales", "Calls")).click();
    const callsCard = page.getByTestId("job-assignment-card-sales-calls");
    await expect(callsCard).toContainText("Not available yet");
    await expect(callsCard).toContainText(
      "Colony cannot make phone calls yet.",
    );
    await expect(callsCard.getByRole("button", { name: /Hire/u })).toHaveCount(
      0,
    );
  });

  test("the phone job spot control has a reachable touch target", async ({
    page,
  }) => {
    await prepareSpecialistMap(page, specialistFixture(), {
      width: 390,
      height: 844,
    });
    await page.getByTestId("cofounder-map-phone-sales").click();
    const spotToggle = page.getByTestId(
      "cofounder-map-phone-job-spot-sales-follow-ups",
    );
    await expect(spotToggle).toHaveAccessibleName("Who does this?");
    const box = await spotToggle.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);

    await spotToggle.click();
    await expect(
      page.getByTestId("job-assignment-card-sales-follow-ups"),
    ).toBeVisible();
  });

  test("keeps specialist details out of the no-screen card heading hierarchy", async ({
    page,
  }) => {
    await prepareSpecialistMap(page, specialistFixture());
    await page.goto("/#/company/function/sales?mapJob=sales%3ACalls");
    const noScreenCard = page.getByTestId("fullmap-no-screen-card");
    const specialistCard = page.getByTestId("job-assignment-card-sales-calls");

    await expect(noScreenCard).toBeVisible();
    await expect(specialistCard).toBeVisible();
    await expect(
      noScreenCard.getByRole("heading", { name: "No screen yet", exact: true }),
    ).toHaveCount(1);
    await expect(noScreenCard.getByRole("heading")).toHaveCount(1);
    await expect(specialistCard).toHaveAccessibleName("Calls specialist");
    await expect(specialistCard.getByRole("heading")).toHaveCount(0);
  });

  test("keeps every mobile map-shell action touch sized", async ({ page }) => {
    await prepareMapShell(page, {
      featureEnabled: true,
      height: 844,
      theme: "light",
      width: 390,
    });
    await page.getByTestId("map-shell-mobile-menu-button").click();
    const sheet = page.getByTestId("map-shell-mobile-sheet");
    await expect(sheet).toBeVisible();
    const undersizedControls = await sheet
      .locator("button:visible")
      .evaluateAll((buttons) =>
        buttons
          .map((button) => ({
            className: button.className,
            height: Math.round(button.getBoundingClientRect().height),
            label:
              button.getAttribute("aria-label") ??
              button.textContent?.trim() ??
              "unnamed action",
          }))
          .filter((button) => button.height < 44),
      );

    expect(undersizedControls).toEqual([]);
  });

  test("the job pill works by pointer and keyboard without covering map controls", async ({
    page,
  }) => {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1728, height: 1117 },
    ]) {
      await prepareSpecialistMap(page, specialistFixture(), viewport);
      await page.goto("/#/clients?mapJob=sales%3AQuotes");
      await expect(page.getByTestId("fullmap-window")).toBeVisible();
      const spot = page.getByTestId(spotTestId("sales", "quotes"));
      const pill = spot.locator("button").first();
      await pill.click();
      await expect(
        page.getByTestId("job-assignment-card-sales-quotes"),
      ).toBeVisible();
      await pill.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByTestId("job-assignment-card-sales-quotes"),
      ).toBeHidden();

      for (const target of [
        page.getByTestId("fullmap-window-close"),
        page.getByTestId("fullmap-window-job-ring"),
      ]) {
        const [pillBox, targetBox] = await Promise.all([
          pill.boundingBox(),
          target.boundingBox(),
        ]);
        if (!pillBox || !targetBox) {
          throw new Error(
            "Map controls need visible boxes for collision proof.",
          );
        }
        expect(overlaps(pillBox, targetBox)).toBe(false);
      }

      await page.goto(
        `/#/channels/${MAP_CHANNEL_ID}?mapJob=customer_success%3AClient%20chats&whatsappDeskTab=chats`,
      );
      await expect(page.getByTestId("fullmap-window")).toBeVisible();
      const leftPill = page
        .getByTestId(spotTestId("customer_success", "client-chats"))
        .locator("button")
        .first();
      for (const target of [
        page.getByTestId("fullmap-window-close"),
        page.getByTestId("fullmap-window-job-ring"),
      ]) {
        const [pillBox, targetBox] = await Promise.all([
          leftPill.boundingBox(),
          target.boundingBox(),
        ]);
        if (!pillBox || !targetBox) {
          throw new Error(
            "Map controls need visible boxes for collision proof.",
          );
        }
        expect(overlaps(pillBox, targetBox)).toBe(false);
      }
      await waitForAnimations(page);
    }
  });
});
