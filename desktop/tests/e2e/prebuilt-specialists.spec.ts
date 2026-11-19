import { expect, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { TEST_IDENTITIES } from "../helpers/bridge";
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
    theme: "light",
    width: viewport.width,
  });
  // prepareMapShell's default WhatsApp mock is installed before this proof.
  // Install the map-ready status after it, then reload so Follow-ups and the
  // other WhatsApp jobs retain their real map-window route.
  await seedCompanyMapWhatsApp(page, MAP_CHANNEL_ID);
  await page.reload();
  await expect(page.getByTestId("cofounder-company-map")).toBeVisible();
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
