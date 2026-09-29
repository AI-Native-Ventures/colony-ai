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

async function seedHireAsk(
  page: Parameters<typeof installMockBridge>[0],
  input: {
    status: "open" | "resolved";
    outcome?: "approved" | "rejected";
    askResponseErrors?: string[];
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
        status: "proposed",
        proposedByPubkey: TEST_IDENTITIES.alice.pubkey,
        sourceAskId: HIRE_ASK_ID,
        sourceAskChannelId: GENERAL_CHANNEL_ID,
        sourceActionEventId: "b".repeat(64),
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
    ...(input.askResponseErrors
      ? { askResponseErrors: [...input.askResponseErrors] }
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
    async ({ askId, hireId, status, outcome, askerPubkey, hireProposal }) => {
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
    },
  );
  return coordinates;
}

test("hire ask card shows the designed open and declined states", async ({
  page,
}) => {
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
  await expect(page.getByTestId("hire-review-form")).toBeVisible();
  await expect(page.getByText("Mina · Hospitality researcher")).toBeVisible();

  await page.goto(`/#/asks/${channelId}/${askId}`);
  const askCard = page.getByTestId("ask-card");
  await expect(askCard).toBeVisible();
  await askCard.getByRole("button", { name: "Decline" }).click();
  await expect(
    askCard.getByRole("heading", { name: "Decision requested" }),
  ).toBeVisible();
  await expect(askCard.getByTestId("ask-status")).toHaveText("denied");
  await expect(
    askCard.getByText("Request declined", { exact: true }),
  ).toBeVisible();
  await expect(askCard).toContainText(
    "Proposed by Mina. Scope: hospitality research for Olive Studio. Weekly allowance: USD 8.00.",
  );
  await expect(askCard).toContainText(
    /No authority or funding changed\. alice will keep the work paused\./i,
  );
  await expect(
    askCard.getByRole("link", { name: "Open conversation" }),
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
  await card.getByRole("button", { name: "Decline" }).click();
  await expect(
    card.getByRole("heading", { name: "Decision requested" }),
  ).toBeVisible();
  await expect(card.getByTestId("ask-status")).toHaveText("failed");
  await expect(
    card.getByText("Decision could not be saved", { exact: true }),
  ).toBeVisible();
  await expect(card).toContainText(
    "No action has been released. Your review is kept; retry once connected.",
  );
  await expect(card).toContainText(
    "Proposed by Mina. Scope: hospitality research for Olive Studio. Weekly allowance: USD 8.00.",
  );
  await expect(card.getByRole("button", { name: "Review hire" })).toBeVisible();
  await expect(card.getByRole("button", { name: "Decline" })).toBeVisible();
  await card.getByRole("button", { name: "Decline" }).click();
  await expect(
    card.getByText("Request declined", { exact: true }),
  ).toBeVisible();
  await expect(card.getByTestId("ask-status")).toHaveText("denied");
  await expect(card).toContainText(
    "Proposed by Mina. Scope: hospitality research for Olive Studio. Weekly allowance: USD 8.00.",
  );
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
