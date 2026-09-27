import { expect, test } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import type { RelayEvent } from "../../src/shared/api/types";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const ASK_ID = "7245ba1a-e078-42ef-b896-00be34a94f11";

function initialAskHeadContent(input: {
  addresseePubkey: string;
  threadRootEventId: string;
}) {
  const now = Math.floor(Date.now() / 1_000);
  const createdAt = new Date(now * 1_000).toISOString();
  return JSON.stringify({
    schemaVersion: 1,
    askId: ASK_ID,
    status: "open",
    askerPubkey: TEST_IDENTITIES.alice.pubkey,
    createdAt,
    ask: {
      schemaVersion: 1,
      askId: ASK_ID,
      type: "approval",
      category: "general",
      title: "Approve the launch plan",
      body: "Confirm the release checklist is complete.",
      threadRootEventId: input.threadRootEventId,
      addresseePubkey: input.addresseePubkey,
      decideBy: new Date((now + 3_600) * 1_000).toISOString(),
    },
    resolution: null,
    cancellation: null,
    sourceActionEventId: "b".repeat(64),
  });
}

test("Today opens an ask thread and keeps a rejected answer for retry", async ({
  page,
}) => {
  const relaySecret = generateSecretKey();
  const relaySelf = getPublicKey(relaySecret);
  await installMockBridge(page, {
    relaySelf,
    companyAskRelayPrivateKeyHex: bytesToHex(relaySecret),
    askResponseErrors: ["Temporary relay write failure"],
  });
  await page.goto("/#/today");

  const seedContext = await page.evaluate(async (askerPubkey) => {
    type TestWindow = Window & {
      __TAURI_INTERNALS__?: {
        invoke: (command: string, payload?: unknown) => Promise<unknown>;
      };
      __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
        channelName: string;
        content: string;
        kind?: number;
        parentEventId?: string | null;
        pubkey?: string;
        extraTags?: string[][];
        id?: string;
      }) => RelayEvent;
    };
    const testWindow = window as TestWindow;
    const invoke = testWindow.__TAURI_INTERNALS__?.invoke;
    const emit = testWindow.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
    if (!invoke || !emit) {
      throw new Error("The mock relay ask test seam is unavailable.");
    }
    const identity = (await invoke("get_identity", {})) as { pubkey: string };
    const rootId = Array.from(crypto.getRandomValues(new Uint8Array(32)))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
    const root = emit({
      channelName: "general",
      content: "Launch checklist",
      id: rootId,
      pubkey: askerPubkey,
    });
    const channelId = root.tags.find((tag) => tag[0] === "h")?.[1];
    if (!channelId) throw new Error("The seeded thread has no channel tag.");
    return { addresseePubkey: identity.pubkey, channelId, rootId: root.id };
  }, TEST_IDENTITIES.alice.pubkey);
  const content = initialAskHeadContent({
    addresseePubkey: seedContext.addresseePubkey,
    threadRootEventId: seedContext.rootId,
  });
  const head = JSON.parse(content) as {
    ask: Record<string, unknown>;
  };
  await page.evaluate(
    (input) => {
      type TestWindow = Window & {
        __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (message: {
          channelName: string;
          content: string;
          kind?: number;
          parentEventId?: string | null;
          pubkey?: string;
          extraTags?: string[][];
        }) => RelayEvent;
        __BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__?: (head: {
          channelId: string;
          askId: string;
          threadRootEventId: string;
          content: string;
        }) => RelayEvent;
      };
      const testWindow = window as TestWindow;
      const emit = testWindow.__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      const publishHead = testWindow.__BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__;
      if (!emit || !publishHead) {
        throw new Error("The mock relay ask test seam is unavailable.");
      }
      publishHead({
        channelId: input.channelId,
        askId: input.askId,
        threadRootEventId: input.rootId,
        content: input.content,
      });
      emit({
        channelName: "general",
        content: JSON.stringify({
          schemaVersion: 1,
          askId: input.askId,
          action: "create",
          ask: input.ask,
        }),
        kind: 47032,
        parentEventId: input.rootId,
        pubkey: input.askerPubkey,
        extraTags: [["d", `channel:${input.channelId}:ask:${input.askId}`]],
      });
    },
    {
      ask: head.ask,
      askId: ASK_ID,
      askerPubkey: TEST_IDENTITIES.alice.pubkey,
      channelId: seedContext.channelId,
      content,
      rootId: seedContext.rootId,
    },
  );

  const todayAsk = page.getByTestId(`today-ask-${ASK_ID}`);
  await expect(todayAsk).toBeVisible();
  await todayAsk.focus();
  await expect(todayAsk).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("ask-card")).toBeVisible();
  const reason = page.getByLabel("Reason or requested changes");
  await reason.fill("The checklist is complete.");
  const recordResponse = page.getByRole("button", { name: "Record response" });
  await recordResponse.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText(
    "Temporary relay write failure",
  );
  await expect(reason).toHaveValue("The checklist is complete.");
  const retry = page.getByRole("button", { name: "Retry response" });
  await expect(retry).toBeEnabled();
  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("ask-resolved")).toContainText(
    "Approved by You",
  );

  await page.goBack();
  await expect(page.getByRole("region", { name: "Needs me" })).toBeVisible();
  await expect(page.getByTestId(`today-ask-${ASK_ID}`)).toHaveCount(0);
});

test("Needs me approves and denies addressed workflow approvals", async ({
  page,
}) => {
  const createdAt = Math.floor(Date.now() / 1_000);
  const expiresAt = new Date((createdAt + 3_600) * 1_000).toISOString();
  await installMockBridge(page, {
    workflowApprovals: [
      {
        workflowId: "workflow-today-release",
        workflowName: "Release approval",
        channelName: "general",
        runId: "run-today-release",
        approvalRef: "approval-today-release",
        stepId: "release_review",
        stepIndex: 2,
        approverSpec: "current",
        approverPubkey: "current",
        expiresAt,
        createdAt,
      },
      {
        workflowId: "workflow-today-security",
        workflowName: "Security approval",
        channelName: "general",
        runId: "run-today-security",
        approvalRef: "approval-today-security",
        stepId: "security_review",
        stepIndex: 1,
        approverSpec: "any",
        approverPubkey: null,
        expiresAt,
        createdAt,
      },
      {
        workflowId: "workflow-today-other-person",
        workflowName: "Other person approval",
        channelName: "general",
        runId: "run-today-other-person",
        approvalRef: "approval-today-other-person",
        stepId: "other_person_review",
        stepIndex: 1,
        approverSpec: TEST_IDENTITIES.bob.pubkey,
        approverPubkey: TEST_IDENTITIES.bob.pubkey,
        expiresAt,
        createdAt,
      },
    ],
  });
  await page.goto("/#/today");

  const releaseRow = page.getByTestId(
    "today-workflow-approval-approval-today-release",
  );
  const securityRow = page.getByTestId(
    "today-workflow-approval-approval-today-security",
  );
  await expect(
    page.getByTestId("today-workflow-approval-approval-today-other-person"),
  ).toHaveCount(0);
  await expect(releaseRow).toBeVisible();
  await expect(securityRow).toBeVisible();
  const approve = releaseRow.getByRole("button", { name: "Approve" });
  await approve.focus();
  await page.keyboard.press("Enter");
  await expect(releaseRow).toHaveCount(0);
  const deny = securityRow.getByRole("button", { name: "Deny" });
  await deny.focus();
  await page.keyboard.press("Enter");
  await expect(securityRow).toHaveCount(0);
});
