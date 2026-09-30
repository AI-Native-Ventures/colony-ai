import { expect, test } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import { KIND_MEMBER_POSITION_HEAD } from "../../src/shared/constants/kinds";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

function positionHead(input: {
  relaySecret: Uint8Array;
  pubkey: string;
  title: string;
}) {
  return finalizeEvent(
    {
      kind: KIND_MEMBER_POSITION_HEAD,
      created_at: Math.floor(Date.now() / 1_000),
      tags: [["d", `company:member:${input.pubkey}`]],
      content: JSON.stringify({
        schemaVersion: 1,
        pubkey: input.pubkey,
        title: input.title,
        kind: "employee",
        status: "active",
        sourceActionEventId: "b".repeat(64),
        updatedAt: new Date().toISOString(),
      }),
    },
    input.relaySecret,
  );
}

test("owner records, edits, and removes an external AI cost across reloads", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const relaySecret = generateSecretKey();
  const relaySelf = getPublicKey(relaySecret);
  const employeePubkey = getPublicKey(generateSecretKey());
  const owner = TEST_IDENTITIES.tyler;
  await page.addInitScript((identity) => {
    window.localStorage.setItem(
      "buzz:e2e-identity-override.v1",
      JSON.stringify(identity),
    );
  }, owner);
  await installMockBridge(page, {
    relaySelf,
    companyMemberRelayPrivateKeyHex: bytesToHex(relaySecret),
    relayRequiresMembership: true,
    relayMembers: [{ pubkey: owner.pubkey, role: "owner" }],
    searchProfiles: [
      { pubkey: owner.pubkey, displayName: owner.username },
      { pubkey: employeePubkey, displayName: "Mina" },
    ],
    companyMemberPositionEvents: [
      positionHead({
        relaySecret,
        pubkey: employeePubkey,
        title: "Social Media Manager",
      }),
    ],
    relayAgents: [
      {
        pubkey: employeePubkey,
        ownerPubkey: owner.pubkey,
        name: "Mina",
        agentType: "agent",
      },
    ],
    managedAgents: [
      {
        pubkey: employeePubkey,
        name: "Mina",
        status: "running",
        channelNames: ["general"],
      },
    ],
  });

  await page.goto("/#/power");
  await expect(page.getByTestId("ai-spend-overview")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Record external AI cost" }).click();
  await page.getByLabel("Provider", { exact: true }).fill("OpenAI");
  await page.getByLabel("Plan / description").fill("Team plan");
  await page.locator("#external-cost-type").selectOption("subscription");
  await page.getByLabel("Actual cash cost (USD)").fill("9.99");
  await page.getByLabel("Renewal date or purchase date").fill("2026-10-30");
  await page.getByRole("button", { name: "Save cost record" }).click();

  const costRow = page.getByRole("button", {
    name: "OpenAI · Team plan, USD 9.99",
  });
  await expect(costRow).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/company-spend-overview.png" });
  await page.reload();
  await expect(costRow).toBeVisible();
  await costRow.click();
  await expect(page.getByTestId("external-ai-cost-detail")).toContainText(
    "OpenAI · Team plan",
  );
  await waitForAnimations(page);
  await page.screenshot({ path: "test-results/company-spend-detail.png" });
  await page.reload();
  await expect(page.getByTestId("external-ai-cost-detail")).toContainText(
    "OpenAI · Team plan",
  );

  await page.getByRole("button", { name: "Edit record" }).click();
  await expect(
    page.getByRole("heading", { name: "Edit external AI cost" }),
  ).toBeVisible();
  await page.getByLabel("Actual cash cost (USD)").fill("10.50");
  await page.getByRole("button", { name: "Save cost record" }).click();
  await expect(page.getByTestId("external-ai-cost-detail")).toContainText(
    "USD 10.50",
  );

  await page.getByRole("button", { name: "Remove cost record" }).click();
  await expect(page.getByTestId("external-ai-cost-remove")).toBeVisible();
  await expect(
    page.getByText("This only removes the local record."),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("external-ai-cost-remove")).toBeVisible();
  await page.getByRole("button", { name: "Remove record" }).click();
  await expect(page.getByTestId("ai-spend-overview")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /OpenAI · Team plan/ }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: /OpenAI · Team plan/ }),
  ).toHaveCount(0);
});
