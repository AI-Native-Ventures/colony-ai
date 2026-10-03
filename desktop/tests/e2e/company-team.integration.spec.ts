import { expect, test } from "@playwright/test";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import { KIND_MEMBER_POSITION_HEAD } from "../../src/shared/constants/kinds";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const OWNER_PUBKEY = "deadbeef".repeat(8);

test("Team keeps the relay-signed human position after reload in the integration project", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const relaySecret = generateSecretKey();
  const relaySelf = getPublicKey(relaySecret);
  const alicePubkey = TEST_IDENTITIES.alice.pubkey;
  const initialPosition = finalizeEvent(
    {
      kind: KIND_MEMBER_POSITION_HEAD,
      created_at: Math.floor(Date.now() / 1_000),
      tags: [["d", `company:member:${alicePubkey}`]],
      content: JSON.stringify({
        schemaVersion: 1,
        pubkey: alicePubkey,
        title: "Account Manager",
        kind: "human",
        status: "active",
        sourceActionEventId: "b".repeat(64),
        updatedAt: new Date().toISOString(),
      }),
    },
    relaySecret,
  );
  await installMockBridge(page, {
    relaySelf,
    companyMemberPositionEvents: [initialPosition],
    relayMembers: [
      { pubkey: OWNER_PUBKEY, role: "owner" },
      { pubkey: alicePubkey, role: "member" },
    ],
  });

  await page.goto("/#/team");
  await expect(page.getByTestId("company-team-screen")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByTestId(`company-team-member-${alicePubkey}`).click();
  const profile = page.getByTestId("company-team-member-profile");
  const role = page.getByTestId("company-human-role");
  await expect(profile).toBeVisible();
  await expect(page.getByTestId("company-human-tab-overview")).toBeVisible();
  await expect(page.getByTestId("company-human-tab-history")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit role and reporting" }),
  ).toBeVisible();
  await expect(role).toContainText("Account Manager");
  const roleBeforeReload = await role.innerText();

  await page.reload();
  await expect(profile).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => role.innerText()).toBe(roleBeforeReload);
});
