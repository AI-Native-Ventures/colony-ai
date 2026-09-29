import { expect, test } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { randomUUID } from "node:crypto";

import type { RelayEvent } from "../../src/shared/api/types";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

async function openSecretRequest(
  page: import("@playwright/test").Page,
  companySecretStoreError = false,
  companySecretActivationError = false,
) {
  const relaySecret = generateSecretKey();
  const relaySelf = getPublicKey(relaySecret);
  await installMockBridge(page, {
    relayRole: "owner",
    relayRequiresMembership: true,
    relaySelf,
    companyAskRelayPrivateKeyHex: bytesToHex(relaySecret),
    companySecretStoreError,
    companySecretActivationErrors: companySecretActivationError
      ? ["error: secret activation was not accepted"]
      : [],
  });
  await page.goto("/#/secrets?state=list");
  await page.waitForFunction(() => {
    const testWindow = window as Window & {
      __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: unknown;
      __BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__?: unknown;
    };
    return (
      typeof testWindow.__BUZZ_E2E_EMIT_MOCK_MESSAGE__ === "function" &&
      typeof testWindow.__BUZZ_E2E_PUBLISH_MOCK_ASK_HEAD__ === "function"
    );
  });

  const coordinates = await page.evaluate(
    async ({ askerPubkey, askId }) => {
      type TestWindow = Window & {
        __BUZZ_E2E_INVOKE_MOCK_COMMAND__?: (
          command: string,
          payload?: unknown,
        ) => Promise<unknown>;
        __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
          channelName: string;
          content: string;
          kind?: number;
          pubkey?: string;
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
        throw new Error("The mock secret request seam is unavailable.");
      }
      const identity = (await invoke("get_identity", {})) as { pubkey: string };
      const root = emit({
        channelName: "general",
        content: "# Launch discussion\nPrepare the campaign draft.",
        pubkey: askerPubkey,
      });
      const channelId = root.tags.find((tag) => tag[0] === "h")?.[1];
      if (!channelId)
        throw new Error("The secret request thread has no channel.");
      const now = Math.floor(Date.now() / 1_000);
      const ask = {
        schemaVersion: 1,
        askId,
        type: "question",
        category: "secret",
        title: "Connect social publishing",
        body: "Prepare campaign drafts using the requested account.",
        threadRootEventId: root.id,
        addresseePubkey: identity.pubkey,
        secretRequest: {
          toolName: "Social publishing",
          clientName: "Olive Studio",
          allowedUse: "Prepare campaign drafts",
        },
      };
      const content = JSON.stringify({
        schemaVersion: 1,
        askId,
        status: "open",
        askerPubkey,
        createdAt: new Date(now * 1_000).toISOString(),
        ask,
        resolution: null,
        cancellation: null,
        sourceActionEventId: "b".repeat(64),
      });
      publishHead({
        channelId,
        askId,
        threadRootEventId: root.id,
        content,
      });
      return { channelId, askId };
    },
    { askerPubkey: TEST_IDENTITIES.alice.pubkey, askId: randomUUID() },
  );

  await page.goto(
    `/#/secrets?state=request&channelId=${coordinates.channelId}&askId=${coordinates.askId}`,
  );
  return coordinates;
}

async function assertSentinelWasNotCaptured(
  page: import("@playwright/test").Page,
  sentinel: string,
) {
  const captured = await page.evaluate(() => {
    type TestWindow = Window & {
      __BUZZ_E2E_COMMAND_PAYLOADS__?: unknown;
      __BUZZ_E2E_COMMANDS__?: unknown;
      __BUZZ_E2E_COMMAND_LOG__?: unknown;
      __BUZZ_E2E_SIGNED_EVENTS__?: unknown;
      __BUZZ_E2E_COMPANY_SECRET_HEADS__?: () => RelayEvent[];
      __BUZZ_E2E_COMPANY_ASK_HEADS__?: () => RelayEvent[];
    };
    const testWindow = window as TestWindow;
    return JSON.stringify({
      localStorage: Object.entries(localStorage),
      commandPayloads: testWindow.__BUZZ_E2E_COMMAND_PAYLOADS__ ?? [],
      commands: testWindow.__BUZZ_E2E_COMMANDS__ ?? [],
      commandLog: testWindow.__BUZZ_E2E_COMMAND_LOG__ ?? [],
      signedEvents: testWindow.__BUZZ_E2E_SIGNED_EVENTS__ ?? [],
      secretHeads: testWindow.__BUZZ_E2E_COMPANY_SECRET_HEADS__?.() ?? [],
      askHeads: testWindow.__BUZZ_E2E_COMPANY_ASK_HEADS__?.() ?? [],
      visibleText: document.body.innerText,
    });
  });
  expect(captured).not.toContain(sentinel);
  expect(captured).not.toContain('"secretValue":');
}

test("secret binding list, loading and unavailable routes use current state", async ({
  page,
}) => {
  const relaySecret = generateSecretKey();
  await installMockBridge(page, {
    relayRole: "owner",
    relayRequiresMembership: true,
    relaySelf: getPublicKey(relaySecret),
    companyAskRelayPrivateKeyHex: bytesToHex(relaySecret),
  });
  await page.goto("/#/secrets?state=empty");
  await expect(
    page.getByRole("heading", { name: "No secrets bound" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Connect only what your agents need for their current work.",
    ),
  ).toBeVisible();
  await expect(page.getByTestId("add-secret-binding")).toBeDisabled();

  await page.goto("/#/secrets?state=list");
  await expect(
    page.getByRole("heading", { name: "No secrets bound" }),
  ).toBeVisible();

  await page.goto("/#/secrets?state=loading");
  await expect(
    page.getByRole("heading", { name: "Loading secret bindings" }),
  ).toBeVisible();

  await page.goto("/#/secrets?state=unavailable");
  await expect(page.getByRole("alert")).toContainText(
    "Names and bindings could not be loaded",
  );

  await page.goto("/#/secrets?state=server");
  await expect(page.getByRole("alert")).toContainText(
    "does not have an encrypted secret store",
  );
});

test("device and server routes keep storage choices truthful", async ({
  page,
}) => {
  const coordinates = await openSecretRequest(page);
  await page.goto(
    `/#/secrets?state=device&channelId=${coordinates.channelId}&askId=${coordinates.askId}`,
  );
  await expect(
    page.getByRole("heading", { name: "Enter a credential securely" }),
  ).toBeVisible();
  await expect(page.getByLabel("Store on")).toHaveValue("device");

  await page.goto(
    `/#/secrets?state=server&channelId=${coordinates.channelId}&askId=${coordinates.askId}`,
  );
  await expect(page.getByLabel("Store on")).toHaveValue("server");
  await expect(
    page.getByRole("button", { name: "Bind securely" }),
  ).toBeDisabled();
  await expect(
    page.getByText(/does not have an encrypted secret store/),
  ).toBeVisible();
});

test("secret requests bind on device, then can be revoked without exposing the value", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openSecretRequest(page);
  await expect(
    page.getByRole("heading", { name: "Alice needs a connection" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Enter securely" }).click();
  await expect(
    page.getByRole("heading", { name: "Enter a credential securely" }),
  ).toBeVisible();

  const sentinel = `credential-${randomUUID()}`;
  await page.getByLabel("Connection name").fill("Publishing credential");
  await page.getByLabel("Credential").fill(sentinel);
  await page.getByRole("button", { name: "Bind securely" }).click();
  await expect(page.getByText("Binding created")).toBeVisible();
  await expect(page.getByTestId("secret-credential-input")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Review and revoke binding Publishing credential",
    }),
  ).toBeVisible();
  await assertSentinelWasNotCaptured(page, sentinel);
  const bindingId = await page.evaluate(() => {
    const testWindow = window as Window & {
      __BUZZ_E2E_COMPANY_SECRET_HEADS__?: () => RelayEvent[];
    };
    const headEvent = testWindow.__BUZZ_E2E_COMPANY_SECRET_HEADS__?.()[0];
    if (!headEvent) return null;
    const content = JSON.parse(headEvent.content) as {
      binding?: { bindingId?: string };
    };
    return content.binding?.bindingId ?? null;
  });
  expect(bindingId).toMatch(/^[0-9a-f-]{36}$/i);
  const resolvedAsk = await page.evaluate(() => {
    const testWindow = window as Window & {
      __BUZZ_E2E_COMPANY_ASK_HEADS__?: () => RelayEvent[];
    };
    const askEvent = testWindow.__BUZZ_E2E_COMPANY_ASK_HEADS__?.()[0];
    return askEvent
      ? (JSON.parse(askEvent.content) as Record<string, unknown>)
      : null;
  });
  expect(resolvedAsk?.status).toBe("resolved");
  expect(
    (resolvedAsk?.resolution as { outcome?: string; secretBindingId?: string })
      ?.outcome,
  ).toBe("secret_bound");
  expect(
    (resolvedAsk?.resolution as { outcome?: string; secretBindingId?: string })
      ?.secretBindingId,
  ).toBe(bindingId);

  await page
    .getByRole("button", {
      name: "Review and revoke binding Publishing credential",
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Revoke this binding?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Revoke binding" }).click();
  await expect(page.getByText("Binding revoked")).toBeVisible();
  await assertSentinelWasNotCaptured(page, sentinel);

  await waitForAnimations(page);
  await page.screenshot({ path: testInfo.outputPath("secrets-revoked.png") });
});

test("failed secure storage clears the credential and keeps connection details", async ({
  page,
}) => {
  await openSecretRequest(page, true);
  await page.getByRole("button", { name: "Enter securely" }).click();
  const sentinel = `credential-${randomUUID()}`;
  await page.getByLabel("Connection name").fill("Publishing credential");
  await page.getByLabel("Credential").fill(sentinel);
  await page.getByRole("button", { name: "Bind securely" }).click();
  await expect(page.getByText("Binding failed")).toBeVisible();
  await expect(page.getByLabel("Credential")).toHaveValue("");
  await expect(page.getByLabel("Connection name")).toHaveValue(
    "Publishing credential",
  );
  await assertSentinelWasNotCaptured(page, sentinel);
});

test("failed relay activation removes the pending device credential", async ({
  page,
}) => {
  await openSecretRequest(page, false, true);
  await page.getByRole("button", { name: "Enter securely" }).click();
  const sentinel = `credential-${randomUUID()}`;
  await page.getByLabel("Connection name").fill("Publishing credential");
  await page.getByLabel("Credential").fill(sentinel);
  await page.getByRole("button", { name: "Bind securely" }).click();
  await expect(page.getByText("Binding failed")).toBeVisible();
  await expect(page.getByLabel("Credential")).toHaveValue("");
  await expect(page.getByLabel("Connection name")).toHaveValue(
    "Publishing credential",
  );
  await assertSentinelWasNotCaptured(page, sentinel);
  const commands = await page.evaluate(() => {
    const testWindow = window as Window & {
      __BUZZ_E2E_COMMANDS__?: string[];
    };
    return testWindow.__BUZZ_E2E_COMMANDS__ ?? [];
  });
  expect(commands).toContain("delete_company_secret");
});

test("canceling secure entry clears the credential before returning to the request", async ({
  page,
}) => {
  await openSecretRequest(page);
  await page.getByRole("button", { name: "Enter securely" }).click();
  const sentinel = `credential-${randomUUID()}`;
  await page.getByLabel("Connection name").fill("Publishing credential");
  await page.getByLabel("Credential").fill(sentinel);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("heading", { name: "Alice needs a connection" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Enter securely" }).click();
  await expect(page.getByLabel("Credential")).toHaveValue("");
  await assertSentinelWasNotCaptured(page, sentinel);
});

test("non-admins see why secret binding is denied", async ({ page }) => {
  const relaySecret = generateSecretKey();
  await installMockBridge(page, {
    relayRole: "member",
    relaySelf: getPublicKey(relaySecret),
    companyAskRelayPrivateKeyHex: bytesToHex(relaySecret),
  });
  await page.goto("/#/secrets?state=denied");
  await expect(
    page.getByText("Only authorized people can bind secrets"),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Ask an owner or administrator to connect the requested account.",
    ),
  ).toBeVisible();
});
