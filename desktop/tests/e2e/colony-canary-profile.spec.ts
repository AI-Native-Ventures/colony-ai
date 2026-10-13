import { hexToBytes } from "@noble/hashes/utils.js";
import { expect, test } from "@playwright/test";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

const RELAY_PRIVATE_KEY = TEST_IDENTITIES.charlie.privateKey;
const RELAY_SELF = getPublicKey(hexToBytes(RELAY_PRIVATE_KEY));
const profile = {
  schemaVersion: 1,
  name: "Lerato Designs",
  whatYouSell: "Linen clothing",
  whoBuys: "Local shoppers",
  whereYouSell: ["Instagram"],
  city: "Johannesburg",
  country: "South Africa",
  timeZone: "Africa/Johannesburg",
  links: ["@leratodesigns"],
  goals: ["More sales"],
};

function signedHead(revision = 1, details = profile) {
  return finalizeEvent(
    {
      kind: 30657,
      created_at: Math.floor(Date.now() / 1_000),
      tags: [
        ["d", "business-profile"],
        ["revision", String(revision)],
      ],
      content: JSON.stringify(details),
    },
    hexToBytes(RELAY_PRIVATE_KEY),
  );
}

async function openProfile(
  page: import("@playwright/test").Page,
  options: {
    events?: ReturnType<typeof signedHead>[];
    role?: "owner" | "admin" | "member";
    errors?: string[];
    conflictHead?: ReturnType<typeof signedHead>;
  } = {},
) {
  await installMockBridge(page, {
    relaySelf: RELAY_SELF,
    relayRole: options.role ?? "owner",
    relayRequiresMembership: true,
    businessProfileEvents: options.events ?? [signedHead()],
    businessProfileRelayPrivateKey: RELAY_PRIVATE_KEY,
    businessProfileActionErrors: options.errors,
    businessProfileConflictHead: options.conflictHead,
  });
  await page.goto("/#/settings?section=business-profile");
  await expect(page.getByTestId("settings-business-profile")).toBeVisible();
}

test("Settings reads a signed shared profile, saves a revision and reads it after restart", async ({
  page,
}) => {
  await openProfile(page);
  await expect(page.getByLabel("Business name")).toHaveValue("Lerato Designs");
  await expect(page.getByLabel("Who buys from you")).toHaveValue(
    "Local shoppers",
  );
  if (process.env.COLONY_CANARY_PROFILE_SHOT) {
    await waitForAnimations(page);
    await page.screenshot({ path: process.env.COLONY_CANARY_PROFILE_SHOT });
  }
  await page.getByLabel("Who buys from you").fill("Women in Joburg");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const saved = JSON.parse(
          localStorage.getItem("buzz-e2e-business-profile-events-v1") ?? "[]",
        );
        return saved.find((event: { kind: number }) => event.kind === 30657);
      }),
    )
    .toMatchObject({
      tags: [
        ["d", "business-profile"],
        ["revision", "2"],
      ],
    });
  await page.reload();
  await expect(page.getByLabel("Who buys from you")).toHaveValue(
    "Women in Joburg",
  );
  expect(
    await page.evaluate(() =>
      localStorage.getItem("colony-business-profile.v1"),
    ),
  ).toBeNull();
});

test("a concurrent revision preserves the draft until the owner loads the latest", async ({
  page,
}) => {
  await openProfile(page, {
    errors: ["conflict: business profile changed; current revision is 2."],
    conflictHead: signedHead(2, { ...profile, whoBuys: "Wholesale shops" }),
  });
  await page.getByLabel("Who buys from you").fill("Online shoppers");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "changed on another computer",
  );
  await expect(page.getByLabel("Who buys from you")).toHaveValue(
    "Online shoppers",
  );
  await page.getByRole("button", { name: "Load latest" }).click();
  await expect(page.getByLabel("Who buys from you")).toHaveValue(
    "Wholesale shops",
  );
});

test("a rejected profile save keeps typed changes and offers a retry", async ({
  page,
}) => {
  await openProfile(page, {
    errors: ["error: relay temporarily unavailable"],
  });
  await page.getByLabel("What you sell").fill("Natural linen essentials");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "relay temporarily unavailable",
  );
  await expect(page.getByLabel("What you sell")).toHaveValue(
    "Natural linen essentials",
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeDisabled();
  await expect(page.getByLabel("What you sell")).toHaveValue(
    "Natural linen essentials",
  );
});

test("a member can read the signed profile but cannot edit it", async ({
  page,
}) => {
  await openProfile(page, { role: "member" });
  await expect(page.getByLabel("Business name")).toHaveValue("Lerato Designs");
  await expect(page.getByLabel("Business name")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(
    0,
  );
});

test("Settings rejects a profile whose relay signature no longer matches", async ({
  page,
}) => {
  const tampered = {
    ...signedHead(),
    content: JSON.stringify({ ...profile, name: "Fake" }),
  };
  await openProfile(page, { events: [tampered] });
  await expect(page.getByRole("alert")).toContainText(
    "business profile could not be loaded",
  );
  await expect(page.getByLabel("Business name")).toHaveCount(0);
});
