import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import { KIND_HIRE_HEAD } from "../../src/shared/constants/kinds";
import type { RelayEvent } from "../../src/shared/api/types";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

const PERSONA_ID = "company-role-hospitality-research";
const HIRE_ASK_ID = "7245ba1a-e078-42ef-b896-00be34a94f11";
const HIRE_ASK_HIRE_ID = "7916ba1a-e078-42ef-b896-00be34a94f12";
const GENERAL_CHANNEL_ID = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";

function newRelayKey() {
  const secretKey = generateSecretKey();
  return {
    privateKeyHex: bytesToHex(secretKey),
    relaySelf: getPublicKey(secretKey),
  };
}

test("owner hires from a role pack and the configured draft survives reload", async ({
  page,
}) => {
  const relay = newRelayKey();
  await installMockBridge(page, {
    relaySelf: relay.relaySelf,
    companyHireRelayPrivateKeyHex: relay.privateKeyHex,
    relayRequiresMembership: true,
    personas: [
      {
        id: PERSONA_ID,
        displayName: "Hospitality researcher",
        systemPrompt: "Research hospitality accounts and report findings.",
        isActive: true,
        runtime: "buzz-agent",
        provider: "openai",
        model: "gpt-5.5",
        envVars: { BUZZ_AGENT_PROVIDER: "openai" },
        companyRole: {
          job: "Hospitality research",
          skills: ["Market research", "Synthesis"],
          tools: [{ name: "Web search", risk: "low" }],
          workerMenu: ["buzz-agent"],
        },
      },
    ],
    discoverAgentModels: {
      models: [{ id: "gpt-5.5", name: "GPT-5.5" }],
      supportsSwitching: true,
      selectedModel: "gpt-5.5",
    },
  });

  await page.goto("/#/team");
  await page.getByRole("button", { name: "Hire employee" }).click();
  await expect(page.getByTestId(`hire-role-${PERSONA_ID}`)).toBeVisible();
  await page.getByRole("button", { name: "Edit pack" }).click();
  const roleEditor = page.getByTestId("company-role-editor");
  await expect(roleEditor).toBeVisible();
  await expect(page.getByLabel("Role title")).toHaveValue(
    "Hospitality researcher",
  );
  await expect(page.getByLabel("Job description")).toHaveValue(
    "Hospitality research",
  );
  await expect(page.getByLabel("Skills, one per line")).toHaveValue(
    "Market research\nSynthesis",
  );

  await page.goto("/#/hire/roles");
  await expect(page.getByTestId(`hire-role-${PERSONA_ID}`)).toBeVisible();
  await page.getByRole("button", { name: "Configure this role" }).click();

  const name = page.getByTestId("hire-employee-name");
  const allowance = page.getByTestId("hire-weekly-allowance");
  const workerModel = page.getByTestId("hire-worker-model");
  await expect(name).toBeVisible();
  await name.fill("Mina");
  await allowance.fill("8");
  await expect(workerModel).toHaveValue(
    JSON.stringify(["buzz-agent", "openai", "gpt-5.5"]),
  );

  await page.reload();
  await expect(page.getByTestId("hire-employee-name")).toHaveValue("Mina");
  await expect(page.getByTestId("hire-weekly-allowance")).toHaveValue("8");
  await page.getByTestId("hire-review").click();

  await expect(page.getByTestId("hire-review-form")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Review hire" }),
  ).toBeVisible();
  await expect(
    page.getByText("Review the exact scope before hiring."),
  ).toBeVisible();
  await page.getByTestId("hire-founder-confirm").check();
  await page.getByTestId("hire-approve").click();

  await expect(page.getByTestId("hire-success")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Mina joined the team.")).toBeVisible();
  await expect(page.getByText("Hire approved.", { exact: true })).toBeVisible();
  await expect(page.getByText(/Hello team\. I’ll coordinate/)).toBeVisible();
});

test("empty role catalog opens a blank role pack editor", async ({ page }) => {
  await installMockBridge(page, {
    relayRequiresMembership: true,
    personas: [],
  });
  await page.goto("/#/hire/roles");

  await expect(
    page.getByRole("heading", { name: "Your role catalog starts here" }),
  ).toBeVisible();
  await expect(
    page.getByText("There are no built-in role packs."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create role pack" }).click();

  await expect(page.getByTestId("company-role-pack-page")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Role catalog", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Back", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("community-catalog-dialog")).toHaveCount(0);
  await expect(page.getByTestId("company-role-editor")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Edit a role pack" }),
  ).toBeVisible();
  await expect(page.getByLabel("Role title")).toHaveValue("");
  await expect(page.getByLabel("Job description")).toHaveValue("");
  await expect(page.getByLabel("Skills, one per line")).toHaveValue("");
  const toolScope = page.getByLabel("Tool scope");
  await expect(toolScope).toBeDisabled();
  await expect(toolScope).toHaveValue("");
  const workerModel = page.getByLabel("Allowed worker model");
  await expect(workerModel).toBeVisible();
  await expect(workerModel).toHaveValue("");
  await expect(page.getByLabel("Default allowance")).toHaveCount(0);
  await expect(workerModel.locator("option")).toHaveText([
    "Choose worker model",
    "Goose",
    "Colony Agent",
  ]);
  const roleEditor = page.getByTestId("company-role-editor");
  const formPanel = await roleEditor
    .locator(":scope > div")
    .first()
    .boundingBox();
  const reviewPanel = await roleEditor.locator(":scope > aside").boundingBox();
  if (!formPanel || !reviewPanel) {
    throw new Error("Role pack panels must both be visible.");
  }
  expect(reviewPanel.height).toBeLessThan(formPanel.height);
  const backButton = page.getByRole("button", { name: "Back", exact: true });
  await backButton.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Role title")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Job description")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Skills, one per line")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(workerModel).toBeFocused();
  const rootFontSizeBeforeZoom = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
  );
  const zoomModifier = await page.evaluate(() =>
    /mac|iphone|ipad|ipod/i.test(navigator.platform) ? "Meta" : "Control",
  );
  await page.keyboard.press(`${zoomModifier}+Equal`);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      ),
    )
    .toBeGreaterThan(rootFontSizeBeforeZoom);
  await page.keyboard.press(`${zoomModifier}+Minus`);
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      ),
    )
    .toBeCloseTo(rootFontSizeBeforeZoom, 0);
  const visualCaptureDirectory = process.env.COMPANY_ROLE_VISUAL_CAPTURE_DIR;
  if (visualCaptureDirectory) {
    await mkdir(visualCaptureDirectory, { recursive: true });
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1728, height: 1117 },
    ]) {
      await page.setViewportSize(viewport);
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await page.waitForFunction(
          (shouldBeDark) =>
            document.documentElement.classList.contains("dark") ===
            shouldBeDark,
          theme === "dark",
        );
        await waitForAnimations(page);
        await page.screenshot({
          path: join(
            visualCaptureDirectory,
            `role-pack-${viewport.width}x${viewport.height}-${theme}.png`,
          ),
        });
      }
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForFunction(
      () => !document.documentElement.classList.contains("dark"),
    );
    await page.setViewportSize({ width: 1280, height: 720 });
  }

  await page.getByLabel("Role title").fill("Research assistant");
  await page
    .getByLabel("Job description")
    .fill("Research current hospitality accounts.");
  await page.getByLabel("Skills, one per line").fill("Research\nSynthesis");
  await workerModel.selectOption("goose");
  await expect(
    page.getByRole("button", { name: "Save role pack" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Save role pack" }).click();
  await expect(
    page.getByRole("heading", { name: "Role pack saved" }),
  ).toBeVisible();
});

test("runtime recovery returns to the role editor with its draft intact", async ({
  page,
}) => {
  await installMockBridge(page, {
    relayRequiresMembership: true,
    personas: [],
    acpRuntimesCatalog: [],
  });
  await page.goto("/#/agents?rolePack=create");

  const runtimeRecovery = page.getByTestId("company-role-runtime-recovery");
  await expect(runtimeRecovery).toBeVisible();
  await expect(
    runtimeRecovery.getByRole("heading", {
      name: "No runtime is available",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep draft and return" }).click();

  const roleEditor = page.getByTestId("company-role-editor");
  await expect(roleEditor).toBeVisible();
  await page.getByLabel("Role title").fill("Research assistant");
  await page
    .getByLabel("Job description")
    .fill("Research current hospitality accounts.");
  await page.getByLabel("Skills, one per line").fill("Research\nSynthesis");

  await page.goto("/#/hire/roles?roleRecovery=runtime-empty&rolePersonaId=new");
  await expect(page.getByTestId("company-role-runtime-recovery")).toBeVisible();
  await page.getByRole("button", { name: "Keep draft and return" }).click();

  await expect(page.getByTestId("company-role-editor")).toBeVisible();
  await expect(page.getByLabel("Role title")).toHaveValue("Research assistant");
  await expect(page.getByLabel("Job description")).toHaveValue(
    "Research current hospitality accounts.",
  );
  await expect(page.getByLabel("Skills, one per line")).toHaveValue(
    "Research\nSynthesis",
  );
});

test("role pack edits retain input after a failed save and then update the real persona", async ({
  page,
}) => {
  await installMockBridge(page, {
    relayRequiresMembership: true,
    personas: [
      {
        id: PERSONA_ID,
        displayName: "Hospitality researcher",
        systemPrompt: "Research hospitality accounts and report findings.",
        isActive: true,
        runtime: "claude",
        companyRole: {
          job: "Hospitality research",
          skills: ["Market research"],
          tools: [{ name: "Web search", risk: "low" }],
          workerMenu: ["buzz-agent"],
        },
      },
    ],
    personaWriteErrors: ["Temporary persona write failure"],
  });
  await page.goto("/#/hire/roles");
  await page.getByRole("button", { name: "Edit pack" }).click();
  await expect(page.getByTestId("company-role-pack-page")).toBeVisible();
  await expect(page.getByTestId("community-catalog-dialog")).toHaveCount(0);
  await expect(page.getByLabel("Allowed worker model")).toHaveValue(
    "buzz-agent",
  );

  const job = page.getByLabel("Job description");
  await job.fill("Research hospitality accounts and summarize evidence.");
  await page.getByRole("button", { name: "Save role pack" }).click();
  await expect(page.getByTestId("company-role-save-error")).toBeVisible();
  await expect(job).toHaveValue(
    "Research hospitality accounts and summarize evidence.",
  );
  await expect(
    page.getByText(
      "Your inputs are kept. Review them or retry without starting again.",
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Save role pack" }).click();
  await expect(page.getByTestId("company-role-save-error")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Role pack saved" }),
  ).toBeVisible();
  await expect(
    page.getByText("Research hospitality accounts and summarize evidence."),
  ).toBeVisible();
  await page.goto("/#/hire/roles");
  await expect(page.getByTestId(`hire-role-${PERSONA_ID}`)).toContainText(
    "Research hospitality accounts and summarize evidence.",
  );
  await expect(page.getByTestId(`hire-role-${PERSONA_ID}`)).toContainText(
    "No default amount",
  );
});

async function seedHireAsk(
  page: Parameters<typeof installMockBridge>[0],
  input: {
    status: "open" | "resolved";
    outcome?: "approved" | "rejected";
    askResolutionReason?: string;
    hireStatus?: "proposed" | "awaiting_founder" | "approved" | "denied";
    founderPubkey?: string;
    founderApprovalReason?: string;
    relayRole?: "owner" | "admin" | "member" | null;
    askResponseErrors?: string[];
    companyHireActionErrors?: string[];
  },
) {
  const relay = newRelayKey();
  const hireProposal = {
    hireId: HIRE_ASK_HIRE_ID,
    rolePack: {
      personaId: PERSONA_ID,
      title: "Hospitality researcher",
      job: "Hospitality research",
      skills: ["Market research"],
      tools: [{ name: "Web search", risk: "low" as const }],
      workerMenu: ["buzz-agent"],
    },
    displayName: "Mina",
    title: "Hospitality researcher",
    introductionChannelId: GENERAL_CHANNEL_ID,
    runtimeId: "buzz-agent",
    providerId: "openai",
    modelId: "gpt-5.5",
    weeklyAllowance: "8.00",
  };
  const hireHead = finalizeEvent(
    {
      kind: KIND_HIRE_HEAD,
      created_at: Math.floor(Date.now() / 1_000),
      tags: [["d", `company:hire:${HIRE_ASK_HIRE_ID}`]],
      content: JSON.stringify({
        schemaVersion: 1,
        proposal: hireProposal,
        status: input.hireStatus ?? "proposed",
        proposedByPubkey: TEST_IDENTITIES.alice.pubkey,
        sourceAskId: HIRE_ASK_ID,
        sourceAskChannelId: GENERAL_CHANNEL_ID,
        sourceActionEventId: "b".repeat(64),
        ...(input.founderPubkey ? { founderPubkey: input.founderPubkey } : {}),
        ...(input.founderApprovalReason
          ? { founderApprovalReason: input.founderApprovalReason }
          : {}),
      }),
    },
    hexToBytes(relay.privateKeyHex),
  );
  await installMockBridge(page, {
    relaySelf: relay.relaySelf,
    companyAskRelayPrivateKeyHex: relay.privateKeyHex,
    companyHireHeads: [hireHead],
    companyHireRelayPrivateKeyHex: relay.privateKeyHex,
    relayRequiresMembership: true,
    ...(input.relayRole !== undefined ? { relayRole: input.relayRole } : {}),
    ...(input.askResponseErrors
      ? { askResponseErrors: [...input.askResponseErrors] }
      : {}),
    ...(input.companyHireActionErrors
      ? { companyHireActionErrors: [...input.companyHireActionErrors] }
      : {}),
  });
  await page.goto("/#/today");
  await page.waitForFunction(() => {
    const testWindow = window as Window & {
      __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: unknown;
      __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: unknown;
      __BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__?: unknown;
    };
    return (
      typeof testWindow.__BUZZ_E2E_EMIT_MOCK_MESSAGE__ === "function" &&
      typeof testWindow.__BUZZ_E2E_INVOKE_MOCK_COMMAND__ === "function" &&
      typeof testWindow.__BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__ === "function"
    );
  });

  const coordinates = await page.evaluate(
    async ({
      askId,
      hireId,
      status,
      outcome,
      askerPubkey,
      hireProposal,
      askResolutionReason,
    }) => {
      type TestWindow = Window & {
        __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: (
          command: string,
          payload?: unknown,
        ) => Promise<unknown>;
        __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
          channelName: string;
          content: string;
          kind?: number;
          parentEventId?: string | null;
          pubkey?: string;
          extraTags?: string[][];
          id?: string;
        }) => RelayEvent;
        __BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__?: (input: {
          channelId: string;
          askId: string;
          threadRootEventId: string;
          content: string;
        }) => RelayEvent;
      };
      const testWindow = window as TestWindow;
      const invoke = testWindow.__BUZZ_E2E_INVOKE_MOCK_COMMAND__;
      const emit = testWindow.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      const publishHead = testWindow.__BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__;
      if (!invoke || !emit || !publishHead) {
        throw new Error("The mock relay hire ask test seam is unavailable.");
      }
      const identity = (await invoke("get_identity", {})) as {
        pubkey: string;
      };
      const rootId = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      const root = emit({
        channelName: "general",
        content: "Hire proposal",
        id: rootId,
        pubkey: askerPubkey,
      });
      const channelId = root.tags.find((tag) => tag[0] === "h")?.[1];
      if (!channelId) throw new Error("The seeded hire thread has no channel.");
      const createdAt = new Date().toISOString();
      const ask = {
        schemaVersion: 1,
        askId,
        type: "approval",
        category: "hire",
        title: "Hire a hospitality researcher",
        body: "Proposed by Mina. Scope: hospitality research for Olive Studio. Weekly allowance: USD 8.00.",
        threadRootEventId: root.id,
        addresseePubkey: identity.pubkey,
        decideBy: null,
        subject: { kind: "hire", id: hireId },
        hireProposal,
      };
      const content = JSON.stringify({
        schemaVersion: 1,
        askId,
        status,
        askerPubkey,
        createdAt,
        ask,
        resolution:
          status === "resolved"
            ? {
                outcome,
                ...(askResolutionReason ? { reason: askResolutionReason } : {}),
                resolvedByPubkey: identity.pubkey,
                resolvedAt: createdAt,
                responseEventId: "c".repeat(64),
              }
            : null,
        cancellation: null,
        sourceActionEventId: "b".repeat(64),
      });
      publishHead({ channelId, askId, threadRootEventId: root.id, content });
      emit({
        channelName: "general",
        content: JSON.stringify({
          schemaVersion: 1,
          askId,
          action: "create",
          ask,
        }),
        kind: 47032,
        parentEventId: root.id,
        pubkey: askerPubkey,
        extraTags: [["d", `channel:${channelId}:ask:${askId}`]],
      });
      return { channelId, askId };
    },
    {
      askId: HIRE_ASK_ID,
      hireId: HIRE_ASK_HIRE_ID,
      status: input.status,
      outcome: input.outcome,
      askerPubkey: TEST_IDENTITIES.alice.pubkey,
      hireProposal,
      askResolutionReason: input.askResolutionReason,
    },
  );
  return coordinates;
}

test("hire ask decisions use the reasoned handoff screen", async ({ page }) => {
  const { channelId, askId } = await seedHireAsk(page, { status: "open" });
  await page.goto(`/#/asks/${channelId}/${askId}`);

  const card = page.getByTestId("ask-card");
  await expect(card).toBeVisible();
  await expect(
    card.getByRole("heading", { name: "Decision requested" }),
  ).toBeVisible();
  await expect(card).toContainText(
    "Proposed by Mina. Scope: hospitality research for Olive Studio. Weekly allowance: USD 8.00.",
  );
  await expect(
    card.getByRole("heading", { name: "Decision context" }),
  ).toBeVisible();
  await expect(card).toContainText("npub1mock... · Owner");
  await expect(card.getByRole("button", { name: "Review hire" })).toBeVisible();
  await card.getByRole("button", { name: "Review hire" }).click();
  await expect(page.getByTestId("hire-handoff-form")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Proposed company position" }),
  ).toBeVisible();
  await expect(page.getByText("Mina", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign off hire" }),
  ).toBeVisible();

  await page.goto(`/#/asks/${channelId}/${askId}`);
  const askCard = page.getByTestId("ask-card");
  await expect(askCard).toBeVisible();
  await askCard.getByRole("button", { name: "Decline" }).click();
  const reason = page.getByTestId("hire-handoff-reason");
  await reason.fill("The current work plan needs another review.");
  await page.getByTestId("hire-handoff-decline").click();
  await expect(
    page.getByText("Request declined", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("The current work plan needs another review."),
  ).toBeVisible();
  await page.goto(`/#/asks/${channelId}/${askId}`);
  const declinedCard = page.getByTestId("ask-card");
  await expect(
    declinedCard.getByRole("heading", { name: "Decision requested" }),
  ).toBeVisible();
  await expect(declinedCard.getByTestId("ask-status")).toHaveText("denied");
  await expect(
    declinedCard.getByText("Request declined", { exact: true }),
  ).toBeVisible();
  await expect(declinedCard).toContainText(
    "Proposed by Mina. Scope: hospitality research for Olive Studio. Weekly allowance: USD 8.00.",
  );
  await expect(declinedCard).toContainText(
    /No authority or funding changed\. alice will keep the work paused\./i,
  );
  await expect(
    declinedCard.getByRole("link", { name: "Open conversation" }),
  ).toBeVisible();
});

test("hire ask card keeps its review and offers retry after a failed decline", async ({
  page,
}) => {
  const { channelId, askId } = await seedHireAsk(page, {
    status: "open",
    askResponseErrors: ["Temporary relay write failure"],
  });
  await page.goto(`/#/asks/${channelId}/${askId}`);

  const card = page.getByTestId("ask-card");
  await expect(card).toBeVisible();
  await expect(
    card.getByRole("heading", { name: "Decision requested" }),
  ).toBeVisible();
  await card.getByRole("button", { name: "Decline" }).click();
  const reason = page.getByTestId("hire-handoff-reason");
  await reason.fill("The proposal needs another review.");
  await page.getByTestId("hire-handoff-decline").click();
  await expect(page.getByTestId("hire-handoff-error")).toBeVisible();
  await expect(reason).toHaveValue("The proposal needs another review.");
  await expect(
    page.getByText(
      "Your inputs are kept. Review them or retry without starting again.",
    ),
  ).toBeVisible();
  await page.getByTestId("hire-handoff-decline").click();
  await expect(
    page.getByText("Request declined", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("The proposal needs another review."),
  ).toBeVisible();
  await page.goto(`/#/asks/${channelId}/${askId}`);
  await expect(card.getByTestId("ask-status")).toHaveText("denied");
  await expect(
    card.getByText("Request declined", { exact: true }),
  ).toBeVisible();
  await expect(card).toContainText(
    "Proposed by Mina. Scope: hospitality research for Olive Studio. Weekly allowance: USD 8.00.",
  );
});

test("an administrator refers the proposal without hiring the employee", async ({
  page,
}) => {
  const { channelId, askId } = await seedHireAsk(page, {
    status: "open",
    relayRole: "admin",
  });
  await page.goto(`/#/asks/${channelId}/${askId}`);
  await page.getByRole("button", { name: "Review hire" }).click();

  await expect(page.getByText("Approval is a referral")).toBeVisible();
  await page
    .getByTestId("hire-handoff-reason")
    .fill("The role scope is ready for founder review.");
  await page.getByTestId("hire-handoff-approve").click();

  await expect(
    page.getByText("Proposal approved for founder review", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "No employee has been hired. The founder must review and sign off.",
    ),
  ).toBeVisible();
  await expect(page.getByTestId("hire-open-founder-review")).toBeVisible();
  await page.getByTestId("hire-open-founder-review").click();
  await expect(page.getByTestId("ask-card")).toBeVisible();
  await expect(page.getByTestId("hire-success")).toHaveCount(0);
});

test("founder sign-off is owner-only and retains its reason after a failed write", async ({
  page,
}) => {
  const { channelId, askId } = await seedHireAsk(page, {
    status: "resolved",
    outcome: "approved",
    askResolutionReason: "The proposal is ready for the owner.",
    hireStatus: "awaiting_founder",
    relayRole: "owner",
    companyHireActionErrors: ["Temporary relay write failure"],
  });
  await page.goto(`/#/asks/${channelId}/${askId}`);
  await page.getByTestId("hire-founder-review").click();

  await expect(
    page.getByRole("heading", { name: "Founder sign-off" }),
  ).toBeVisible();
  await expect(
    page.getByText("The proposal is ready for the owner."),
  ).toBeVisible();
  const reason = page.getByTestId("hire-handoff-reason");
  await reason.fill("I approve this role and its recorded scope.");
  await page.getByTestId("hire-handoff-approve").click();
  await expect(page.getByTestId("hire-handoff-error")).toBeVisible();
  await expect(reason).toHaveValue(
    "I approve this role and its recorded scope.",
  );
  await page.getByTestId("hire-handoff-approve").click();

  await expect(
    page.getByRole("heading", { name: "Founder sign-off recorded" }),
  ).toBeVisible();
  await expect(page.getByTestId("hire-open-position")).toBeVisible();
  await page.getByTestId("hire-open-position").click();
  await expect(page.getByTestId("hire-review-form")).toBeVisible();
  await expect(page.getByTestId("hire-founder-confirm")).not.toBeChecked();
  await expect(page.getByTestId("hire-success")).toHaveCount(0);
});

test("a member can view the hire proposal but cannot resolve it", async ({
  page,
}) => {
  const { channelId, askId } = await seedHireAsk(page, {
    status: "open",
    relayRole: "member",
  });
  await page.goto(
    `/#/hire/review?hireId=${HIRE_ASK_HIRE_ID}&channelId=${channelId}&askId=${askId}`,
  );

  await expect(
    page.getByRole("heading", {
      name: "You do not have permission for this action",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Back to the record" }),
  ).toBeVisible();
  await expect(page.getByTestId("hire-handoff-form")).toHaveCount(0);
});

test("a member cannot open the role-pack curation route", async ({ page }) => {
  await installMockBridge(page, {
    relayRequiresMembership: true,
    relayRole: "member",
    personas: [],
  });
  await page.goto("/#/hire/roles");

  await expect(
    page.getByRole("heading", {
      name: "You do not have permission for this action",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create role pack" }),
  ).toHaveCount(0);
});

test("resolved hire ask card explains that the requester has the outcome", async ({
  page,
}) => {
  const { channelId, askId } = await seedHireAsk(page, {
    status: "resolved",
    outcome: "approved",
  });
  await page.goto(`/#/asks/${channelId}/${askId}`);

  const card = page.getByTestId("ask-card");
  await expect(
    card.getByRole("heading", { name: "Decision requested" }),
  ).toBeVisible();
  await expect(card.getByTestId("ask-status")).toHaveText("resolved");
  await expect(
    card.getByText("Decision recorded", { exact: true }),
  ).toBeVisible();
  await expect(card).toContainText(
    "The requester has the outcome in the original thread.",
  );
  await expect(card).toContainText(
    "Proposed by Mina. Scope: hospitality research for Olive Studio. Weekly allowance: USD 8.00.",
  );
  await expect(
    card.getByRole("link", { name: "Open conversation" }),
  ).toBeVisible();
});
