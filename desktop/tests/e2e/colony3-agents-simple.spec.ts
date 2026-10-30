import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { BUILT_IN_ROLES } from "../../src/features/company-hiring/builtInRoles";
import {
  COLONY3_AGENT_PUBKEYS,
  installColony3Agents,
} from "../helpers/colony3-agents-fixture";
import {
  HIRE_IDS,
  HIRE_ROUTES,
  installHireFixture,
} from "../helpers/colony3-hire-fixture";

const FREE_MODELS = [
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "google/gemma-4-31b-it:free",
  "poolside/laguna-s-2.1:free",
  "poolside/laguna-xs-2.1:free",
];
const THEME = process.env.COLONY3_PROOF_THEME ?? "light";
const OUT =
  process.env.COLONY3_PROOF_DIR ??
  `test-results/colony3-agents-simple/${THEME}`;
const VIEWPORTS = [
  { name: "1440", width: 1440, height: 960 },
  { name: "390", width: 390, height: 844 },
] as const;

type Capture = {
  name: string;
  board: string;
  theme: string;
  viewport: number;
  height: number;
};
const captures: Capture[] = [];

test.describe.configure({ mode: "default", timeout: 120_000 });

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/captures.json`, JSON.stringify(captures, null, 2));
});

async function installFreeModelCapabilities(page: Page) {
  await page.route("**/api/credits-gateway/capabilities", (route) =>
    route.fulfill({
      contentType: "application/json",
      json: { enabled: true, runtime: "colony", freeModels: FREE_MODELS },
    }),
  );
}

async function openAgents(
  page: Page,
  route: string,
  options: Parameters<typeof installColony3Agents>[1] = {},
) {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.clock.setFixedTime(new Date("2026-10-23T13:30:00+02:00"));
  await installColony3Agents(page, options);
  await page.goto(route);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await expectProofTheme(page);
}

async function expectProofTheme(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.classList.contains("dark")),
    )
    .toBe(THEME === "dark");
}

async function captureBoth(page: Page, name: string, board: string) {
  mkdirSync(OUT, { recursive: true });
  for (const viewport of VIEWPORTS) {
    const height =
      viewport.name === "1440"
        ? ({
            AgentEditSimple: 1056,
            HireRoleCatalogSimple: 1400,
            HireConfigureSimple: 1540,
          }[board] ?? viewport.height)
        : viewport.height;
    await page.setViewportSize({ width: viewport.width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await waitForAnimations(page);
    const path = `${OUT}/${name}-${viewport.name}.png`;
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path,
    });
    captures.push({
      name: `${name}-${viewport.name}`,
      board,
      theme: THEME,
      viewport: viewport.width,
      height,
    });
  }
}

async function expectAgentsListFits390(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  const table = await page
    .getByTestId("agent-directory-table-scroll")
    .evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
  const documentSize = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(table.scrollWidth).toBeLessThanOrEqual(table.clientWidth);
  expect(documentSize.scrollWidth).toBeLessThanOrEqual(
    documentSize.clientWidth,
  );
}

async function readCommandPayloads(page: Page) {
  return page.evaluate(() =>
    (window.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? []).map((entry) => ({
      command: entry.command,
      payload: entry.payload,
    })),
  );
}

function decodeAvatarSource(source: string) {
  const base64Prefix = "data:image/svg+xml;base64,";
  return source.startsWith(base64Prefix)
    ? Buffer.from(source.slice(base64Prefix.length), "base64").toString("utf8")
    : decodeURIComponent(source);
}

test("simple Agents list and profile keep the same hire path and owner-safe AI", async ({
  page,
}) => {
  await openAgents(page, "/#/agents?rows=10");
  const directory = page.getByTestId("agent-directory");
  await expect(directory).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(7);
  await expect(directory.getByText("[MODEL]", { exact: true })).toHaveCount(0);
  await expect(
    directory.getByText("Not reported", { exact: true }).first(),
  ).toBeVisible();

  const ayaRow = page.getByTestId(`managed-agent-${COLONY3_AGENT_PUBKEYS.aya}`);
  await expect(ayaRow.getByText("GPT-4o", { exact: true })).toBeVisible();
  await expect(ayaRow.getByText("Codex", { exact: true })).toBeVisible();
  await expect(ayaRow.getByText("OpenAI")).toHaveCount(0);
  const ayaAvatar = ayaRow.locator('img[alt="Aya avatar"]');
  await expect(ayaAvatar).toHaveAttribute("src", /^data:image\/svg\+xml/);
  await captureBoth(page, "AgentsList", "AgentsListSimple");

  await page.goto(`/#/agents?agent=${COLONY3_AGENT_PUBKEYS.aya}`);
  const profile = page.getByTestId("agent-profile");
  await expect(profile).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Aya", level: 1 }),
  ).toBeVisible();
  const ai = page.getByTestId("agent-model-selection");
  const aiSummary = ai.locator(":scope > dl");
  await expect(aiSummary.locator("dd").nth(0)).toHaveText("GPT-4o");
  await expect(aiSummary.locator("dd").nth(1)).toHaveText("Codex");
  await expect(aiSummary.getByText("OpenAI", { exact: true })).toHaveCount(0);
  await expect(ai.getByTestId("agent-subscription-usage")).toHaveCount(0);
  await expect(page.getByTestId("agent-technical-details")).not.toHaveAttribute(
    "open",
    "",
  );
  await captureBoth(page, "AgentPage", "AgentPageSimple");

  await page.goto(`/#/agents?agent=${COLONY3_AGENT_PUBKEYS.scout}`);
  const scoutProfile = page.getByTestId("agent-profile");
  await expect(scoutProfile).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Scout", level: 1 }),
  ).toBeVisible();
  const scoutAi = page.getByTestId("agent-model-selection");
  await expect(scoutAi.locator("dd").nth(0)).toHaveText(
    "Nemotron 3 Ultra 550B A55B",
  );
  await expect(scoutAi.locator("dd").nth(1)).toHaveText("Colony Agent");
  await expect(
    scoutAi.getByText("Colony free AI", { exact: true }),
  ).toBeVisible();
  const scoutEffort = scoutAi
    .locator(":scope > dl dt")
    .filter({ hasText: "Effort" })
    .locator("xpath=following-sibling::dd[1]");
  await expect(scoutEffort).toHaveText("high");
  await expect(page.getByTestId("agent-subscription-usage")).toHaveCount(0);
  await captureBoth(page, "ScoutAgentPage", "AgentPageSimple");

  await page.goto("/#/agents?rows=10");
  await expect(page.getByTestId("agent-hire-button")).toBeVisible();
  await page.getByTestId("agent-hire-button").click();
  await expect(page.getByTestId("hire-roles")).toBeVisible();

  await page.goto("/#/team");
  await expect(page.getByTestId("company-team-screen")).toBeVisible();
  await page.getByTestId("team-hire-button").click();
  await expect(page.getByTestId("hire-roles")).toBeVisible();
});

test("Scout's live AI appears in the Agents directory", async ({ page }) => {
  await openAgents(page, "/#/agents?rows=10");
  const scoutAi = page.getByTestId(`agent-ai-${COLONY3_AGENT_PUBKEYS.scout}`);
  await expect(
    scoutAi.getByText("Nemotron 3 Ultra 550B A55B", { exact: true }),
  ).toBeVisible();
  await expect(
    scoutAi.getByText("Colony Agent", { exact: true }),
  ).toBeVisible();
});

test("Agents directory has no horizontal scroll at 390px", async ({ page }) => {
  await openAgents(page, "/#/agents?rows=10");
  await expectAgentsListFits390(page);
});

test("Scout profile displays the configured Colony Agent effort", async ({
  page,
}) => {
  await openAgents(page, `/#/agents?agent=${COLONY3_AGENT_PUBKEYS.scout}`);
  const scoutAi = page.getByTestId("agent-model-selection");
  await expect(
    scoutAi.getByText("Nemotron 3 Ultra 550B A55B", { exact: true }),
  ).toBeVisible();
  await expect(
    scoutAi.getByText("Colony Agent", { exact: true }),
  ).toBeVisible();
  const scoutEffort = scoutAi
    .locator(":scope > dl dt")
    .filter({ hasText: "Effort" })
    .locator("xpath=following-sibling::dd[1]");
  await expect(scoutEffort).toHaveText("high");
});

test("agent edit saves a relay-listed free model and the custom ant avatar", async ({
  page,
}) => {
  await installFreeModelCapabilities(page);
  await openAgents(page, `/#/agents?agent=${COLONY3_AGENT_PUBKEYS.aya}`, {
    ayaFreeAi: true,
  });
  const ai = page.getByTestId("agent-model-selection");
  await expect(ai.getByText("Nemotron 3 Ultra 550B A55B")).toBeVisible();
  await expect(ai.getByText("Colony free AI")).toBeVisible();

  await page.getByTestId("agent-edit-configuration").click();
  const dialog = page.getByTestId("edit-agent-dialog");
  await expect(dialog).toBeVisible();
  await captureBoth(page, "AgentEdit", "AgentEditSimple");
  const freeModelPicker = page.locator("#agent-free-model-select");
  await expect(freeModelPicker).toBeVisible();
  await freeModelPicker.click();
  await page.getByRole("menuitemradio", { name: "Gemma 4 31B IT" }).click();

  await dialog.getByRole("button", { name: "Change picture" }).click();
  const picker = page.getByTestId("agent-picture-picker");
  await expect(picker).toBeVisible();
  await expect(page.getByTestId("agent-ant-color-field")).toBeVisible();
  await expect(page.getByTestId("agent-ant-hue")).toBeVisible();
  const hex = page.getByTestId("agent-ant-hex");
  await expect(hex).toBeVisible();
  await hex.fill("#12AB34");
  await page.getByRole("button", { name: "Open colour picker" }).click();
  await expect(
    page.getByTestId("agent-ant-custom-color-spectrum"),
  ).toBeVisible();
  const preview = dialog.locator('img[alt="Aya ant"]');
  const previewUrl = await preview.getAttribute("src");
  expect(decodeAvatarSource(previewUrl ?? "")).toContain("#12AB34");
  await captureBoth(page, "AgentPicturePickerAya", "AgentPicturePickerAya");

  await page.keyboard.press("Escape");
  await page.getByTestId("edit-agent-dialog-submit").click();
  await expect(dialog).toBeHidden();
  const commands = await readCommandPayloads(page);
  const update = [...commands]
    .reverse()
    .find((entry) => entry.command === "update_managed_agent");
  expect(update).toBeDefined();
  const input = (update?.payload as { input?: Record<string, unknown> })?.input;
  expect(input?.model).toBe("google/gemma-4-31b-it:free");
  expect(typeof input?.avatarUrl).toBe("string");
  const upload = [...commands]
    .reverse()
    .find((entry) => entry.command === "upload_media_bytes");
  const uploadPayload = upload?.payload as { data?: number[] } | undefined;
  expect(uploadPayload?.data).toBeDefined();
  const uploadedSvg = Buffer.from(uploadPayload?.data ?? []).toString("utf8");
  expect(uploadedSvg).toContain("#12AB34");
  const uploadedHash = createHash("sha256")
    .update(Buffer.from(uploadPayload?.data ?? []))
    .digest("hex");
  expect(input?.avatarUrl).toBe(
    `http://localhost:3000/media/${uploadedHash}.bin`,
  );
});

test("Scout's ant picture can be recoloured with the full custom picker", async ({
  page,
}) => {
  await openAgents(page, `/#/agents?agent=${COLONY3_AGENT_PUBKEYS.scout}`);
  await page.getByTestId("agent-edit-configuration").click();
  const dialog = page.getByTestId("edit-agent-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Change picture" }).click();
  const picker = page.getByTestId("agent-picture-picker");
  await expect(picker).toBeVisible();
  const hex = page.getByTestId("agent-ant-hex");
  await hex.fill("#D35A9B");
  await page.getByRole("button", { name: "Open colour picker" }).click();
  await expect(
    page.getByTestId("agent-ant-custom-color-spectrum"),
  ).toBeVisible();
  const preview = dialog.locator('img[alt="Scout ant"]');
  const previewUrl = await preview.getAttribute("src");
  expect(decodeAvatarSource(previewUrl ?? "")).toContain("#D35A9B");
  await captureBoth(page, "AgentPicturePicker", "AgentPicturePicker");
});

test("hire catalog removes Chief of Staff and sends custom roles through Scout's hire ask", async ({
  page,
}) => {
  await installHireFixture(page, "roles-empty", {
    managedAgents: [
      {
        pubkey: HIRE_IDS.scout,
        name: "Scout",
        personaId: "builtin:fizz",
        runtime: "buzz-agent",
        status: "stopped",
        channelNames: ["Marketing"],
      },
    ],
  });
  await page.goto(HIRE_ROUTES.roles);
  await expectProofTheme(page);
  await expect(page.getByTestId("hire-roles")).toBeVisible();
  const customRole = page.getByTestId("hire-custom-role");
  const catalog = page.locator('[aria-label="Role catalog"]');
  await expect(customRole).toBeVisible();
  await expect(
    catalog.getByRole("heading", { name: "Chief of Staff" }),
  ).toHaveCount(0);
  await expect(catalog.getByRole("heading", { name: "Finance" })).toBeVisible();
  const salesAnt = catalog.locator('[data-testid^="hire-role-"] img').first();
  await expect(salesAnt).toHaveAttribute("alt", /ant$/);
  expect(
    decodeAvatarSource((await salesAnt.getAttribute("src")) ?? ""),
  ).toContain("#E0826B");
  await expect(customRole).toHaveAttribute(
    "aria-label",
    "Create your own role",
  );
  const customComesFirst = await customRole.evaluate((element) => {
    const next = element.parentElement?.querySelector(
      '[aria-label="Role catalog"]',
    );
    return Boolean(
      next &&
        (element.compareDocumentPosition(next) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
          0,
    );
  });
  expect(customComesFirst).toBe(true);
  await captureBoth(page, "HireRoleCatalog", "HireRoleCatalogSimple");

  const description = page.getByTestId("hire-custom-role-description");
  await expect(description).toBeEnabled();
  await description.fill(
    "Reconcile invoices, match payments, and flag any amount that does not match.",
  );
  await captureBoth(page, "HireCustomRole", "HireCustomRole");
  await page.getByTestId("hire-custom-role-submit").click();

  await expect.poll(async () => page.url()).toContain("/channels/");
  const sentMessage = await page.evaluate(() => {
    const testWindow = window as Window & {
      __BUZZ_E2E_RELAY_FRAMES__?: Array<{ frame: unknown[] }>;
    };
    return (testWindow.__BUZZ_E2E_RELAY_FRAMES__ ?? [])
      .map(({ frame }) =>
        frame[0] === "EVENT"
          ? (frame[1] as { content?: string; tags?: string[][] })
          : null,
      )
      .find((event) => event?.content?.includes("Reconcile invoices"));
  });
  expect(sentMessage).toBeDefined();
  const content = sentMessage?.content ?? "";
  expect(content).toContain("@Scout");
  expect(content).toContain("HireRolePack");
  expect(content).toContain("buzz asks propose-hire");
  expect(content).toContain("I will review and approve the hire ask first");
});

for (const role of BUILT_IN_ROLES) {
  test(`built-in role ${role.displayName} opens Configure`, async ({
    page,
  }) => {
    await installHireFixture(page, "roles-empty");
    await page.goto(HIRE_ROUTES.roles);
    await expectProofTheme(page);

    const card = page.getByTestId(`hire-role-${role.id}`);
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Configure" }).click();

    await expect(page.getByTestId("hire-configure")).toBeVisible();
    await expect(page.getByTestId("hire-configure-form")).toBeVisible();
    await expect(page.getByTestId("hire-configure-state")).toHaveCount(0);

    await page
      .getByTestId("hire-configure-form")
      .getByRole("button", { name: "Back", exact: true })
      .click();
    await expect(page.getByTestId("hire-roles")).toBeVisible();
  });
}

test("Configure reads relay free models and carries the selected model into Review", async ({
  page,
}) => {
  await installFreeModelCapabilities(page);
  await installHireFixture(page, "configure", {
    colonyCreditsGatewayEnabled: true,
  });
  await page.goto(HIRE_ROUTES.configure);
  await expectProofTheme(page);
  const configure = page.getByTestId("hire-configure");
  await expect(configure).toBeVisible();
  await expect(page.getByTestId("hire-employee-name")).toHaveValue("Birch");
  await expect(page.getByTestId("hire-title")).toHaveValue(
    "Hospitality Researcher",
  );
  await expect(
    page.getByText(
      "If it is busy, Colony uses the next free model automatically.",
    ),
  ).toBeVisible();
  const freeChoice = page.getByRole("radio", {
    name: "Gemma 4 31B IT, Colony Agent",
  });
  await expect(freeChoice).toBeVisible();
  await freeChoice.check();
  const selectedAi = page.locator('[aria-label="Selected AI"]');
  await expect(selectedAi).toContainText("Gemma 4 31B IT");
  await expect(selectedAi).toContainText("Colony free AI");
  await expect(page.getByText(/weekly allowance/i)).toHaveCount(0);
  await captureBoth(page, "HireConfigure", "HireConfigureSimple");

  await page.getByTestId("hire-review").click();
  await expect(page.getByTestId("hire-review")).toBeVisible();
  await expect(page.getByTestId("hire-review-form")).toContainText(
    "Gemma 4 31B IT",
  );
  await expect(page.getByTestId("hire-review-form")).toContainText(
    "Colony free AI",
  );
});

test("role Configure preserves its approved avatar choice in the local hire draft", async ({
  page,
}) => {
  await installHireFixture(page, "configure");
  await page.goto(HIRE_ROUTES.configure);
  await expectProofTheme(page);
  await expect(page.getByTestId("hire-configure-form")).toBeVisible();
  await page.getByRole("button", { name: "Change picture" }).click();
  const hex = page.getByTestId("agent-ant-hex");
  await expect(hex).toBeVisible();
  await hex.fill("#2468AC");
  const preview = page.getByTestId("hire-preview-avatar").locator("img");
  const previewUrl = await preview.getAttribute("src");
  expect(decodeAvatarSource(previewUrl ?? "")).toContain("#2468AC");
  await page.keyboard.press("Escape");
  await page.getByTestId("hire-review").click();
  await expect(page.getByTestId("hire-review-form")).toBeVisible();
  const avatar = await page.evaluate((key) => {
    const draft = JSON.parse(sessionStorage.getItem(key) ?? "{}") as {
      avatarUrl?: string;
    };
    return draft.avatarUrl ?? "";
  }, `company-hire:ws://localhost:3000:${HIRE_IDS.hireId}`);
  expect(decodeAvatarSource(avatar)).toContain("#2468AC");
});
