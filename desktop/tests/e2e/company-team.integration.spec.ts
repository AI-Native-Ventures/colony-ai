import { expect, test } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

const OWNER_PUBKEY = "deadbeef".repeat(8);

test("Team keeps the relay-signed position after reload in the integration project", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const relaySecret = generateSecretKey();
  const relaySelf = getPublicKey(relaySecret);
  const alicePubkey = TEST_IDENTITIES.alice.pubkey;
  const initialPosition = finalizeEvent(
    {
      kind: 30_645,
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
    companyMemberRelayPrivateKeyHex: bytesToHex(relaySecret),
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
  await expect(page.getByTestId("company-team-member-profile")).toBeVisible();
  await page.getByRole("button", { name: "Edit role and reporting" }).click();
  await page.getByLabel("Title").fill("Customer Success Lead");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByTestId("company-team-member-profile")).toContainText(
    "Customer Success Lead",
  );

  await page.reload();
  await expect(page.getByTestId("company-team-screen")).toBeVisible({
    timeout: 20_000,
  });
  await page.getByTestId(`company-team-member-${alicePubkey}`).click();
  await expect(page.getByTestId("company-team-member-profile")).toContainText(
    "Customer Success Lead",
  );
});
