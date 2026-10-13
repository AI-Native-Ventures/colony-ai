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
  bestSellers: ["Linen shirts"],
  website: "https://leratodesigns.co.za",
  buyLink: "https://shop.leratodesigns.co.za",
  contact: {
    email: "hello@leratodesigns.co.za",
    phone: "011 555 0100",
    whatsapp: null,
    address: null,
  },
  invoice: {
    registeredName: "Lerato Designs Pty Ltd",
    registrationNumber: null,
    vatNumber: null,
    bankDetails: null,
  },
  socialAccounts: { instagram: "@leratodesigns" },
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
    section?: "business-profile" | "connections";
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
  await page.goto(
    `/#/settings?section=${options.section ?? "business-profile"}`,
  );
  await expect(
    page.getByTestId(
      options.section === "connections"
        ? "settings-connections"
        : "settings-business-profile",
    ),
  ).toBeVisible();
}

test("Settings reads a signed shared profile, saves a revision and reads it after restart", async ({
  page,
}) => {
  await openProfile(page);
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue(
    "Lerato Designs",
  );
  await expect(page.getByLabel("Who buys from you")).toHaveValue(
    "Local shoppers",
  );
  await expect(page.getByLabel("Website", { exact: true })).toHaveValue(
    "https://leratodesigns.co.za",
  );
  await expect(page.getByLabel("Customer email")).toHaveValue(
    "hello@leratodesigns.co.za",
  );
  await expect(page.getByLabel("Registered business name")).toHaveValue(
    "Lerato Designs Pty Ltd",
  );
  await expect(page.getByText("Instagram @leratodesigns")).toBeVisible();
  await expect(page.getByLabel("Next 3 months")).toHaveCount(0);
  if (process.env.COLONY_CANARY_PROFILE_SHOT) {
    await waitForAnimations(page);
    await page.screenshot({ path: process.env.COLONY_CANARY_PROFILE_SHOT });
  }
  await page.getByLabel("Who buys from you").fill("Women in Joburg");
  await page
    .getByLabel("Where customers buy")
    .fill("https://buy.leratodesigns.co.za");
  await page.getByLabel("Customer email").fill("orders@leratodesigns.co.za");
  await page
    .getByLabel("Banking details for invoices, optional")
    .fill("Bank account 1234");
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
  await expect(page.getByLabel("Customer email")).toHaveValue(
    "orders@leratodesigns.co.za",
  );
  await expect(
    page.getByLabel("Banking details for invoices, optional"),
  ).toHaveValue("Bank account 1234");
  const savedProfile = await page.evaluate(() => {
    const events = JSON.parse(
      localStorage.getItem("buzz-e2e-business-profile-events-v1") ?? "[]",
    );
    const latest = events.find(
      (event: { kind: number }) => event.kind === 30657,
    );
    return latest ? JSON.parse(latest.content) : null;
  });
  expect(savedProfile).toMatchObject({
    website: "https://leratodesigns.co.za",
    buyLink: "https://buy.leratodesigns.co.za",
    contact: { email: "orders@leratodesigns.co.za" },
    invoice: { bankDetails: "Bank account 1234" },
    goals: ["More sales"],
    bestSellers: ["Linen shirts"],
  });
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

test("using my changes keeps unrelated facts from a newer revision", async ({
  page,
}) => {
  await openProfile(page, {
    errors: ["conflict: business profile changed; current revision is 2."],
    conflictHead: signedHead(2, { ...profile, city: "Pretoria" }),
  });
  await page.getByLabel("Who buys from you").fill("Online shoppers");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("button", { name: "Use my changes" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Use my changes" }).click();
  await expect(page.getByLabel("City", { exact: true })).toHaveValue(
    "Pretoria",
  );
  await expect(page.getByLabel("Who buys from you")).toHaveValue(
    "Online shoppers",
  );
  const savedProfile = await page.evaluate(() => {
    const events = JSON.parse(
      localStorage.getItem("buzz-e2e-business-profile-events-v1") ?? "[]",
    );
    const latest = events.find(
      (event: { kind: number }) => event.kind === 30657,
    );
    return latest
      ? {
          revision: latest.tags?.find(
            (tag: string[]) => tag[0] === "revision",
          )?.[1],
          profile: JSON.parse(latest.content),
        }
      : null;
  });
  expect(savedProfile).toMatchObject({
    revision: "3",
    profile: { city: "Pretoria", whoBuys: "Online shoppers" },
  });
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
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue(
    "Lerato Designs",
  );
  await expect(
    page.getByLabel("Business name", { exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(
    0,
  );
});

test("a disconnected profile is readable and keeps an unfinished draft", async ({
  page,
}) => {
  await openProfile(page);
  await page.getByLabel("Phone", { exact: true }).fill("011 555 0200");
  await page.evaluate(() =>
    window.__BUZZ_E2E_SET_RELAY_CONNECTION_STATE__?.("disconnected"),
  );
  await expect(
    page.getByText("Connection lost. Your business facts are readable."),
  ).toBeVisible();
  await expect(page.getByLabel("Phone", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeDisabled();
  await page.evaluate(() =>
    window.__BUZZ_E2E_SET_RELAY_CONNECTION_STATE__?.("connected"),
  );
  await expect(page.getByLabel("Phone", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("Phone", { exact: true })).toHaveValue(
    "011 555 0200",
  );
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeEnabled();
});

test("Business profile remains editable in a narrow desktop window", async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 700 });
  await openProfile(page);
  await page
    .getByLabel("Banking details for invoices, optional")
    .fill("Bank account 1234");
  await page
    .getByRole("button", { name: "Save changes" })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeInViewport();
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(horizontalOverflow).toBe(false);
  if (process.env.COLONY_CANARY_PROFILE_NARROW_SHOT) {
    await waitForAnimations(page);
    await page.screenshot({
      path: process.env.COLONY_CANARY_PROFILE_NARROW_SHOT,
    });
  }
  await page.getByRole("button", { name: "Change in Connections" }).click();
  await expect(page).toHaveURL(/\/settings\?section=connections/);
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
  await expect(page.getByLabel("Business name", { exact: true })).toHaveCount(
    0,
  );
});

test("Connections saves social names to the signed profile and updates Business profile", async ({
  page,
}) => {
  await openProfile(page, { section: "connections" });
  await expect(page.getByLabel("Instagram")).toHaveValue("@leratodesigns");
  await expect(
    page.getByText("Email forwarding is not connected yet."),
  ).toBeVisible();
  await expect(page.getByText(/inbox\.colony\.global/)).toHaveCount(0);
  if (process.env.COLONY_CANARY_CONNECTIONS_WIDE_SHOT) {
    await waitForAnimations(page);
    await page.screenshot({
      path: process.env.COLONY_CANARY_CONNECTIONS_WIDE_SHOT,
    });
  }
  await page.getByLabel("Instagram").fill("@leratostudio");
  await page.getByLabel("TikTok").fill("@leratostudio");
  await page.getByRole("button", { name: "Save accounts" }).click();
  await expect(
    page.getByRole("button", { name: "Save accounts" }),
  ).toBeDisabled();
  await page.goto("/#/settings?section=business-profile");
  await expect(
    page.getByText("Instagram @leratostudio, TikTok @leratostudio"),
  ).toBeVisible();
  const savedProfile = await page.evaluate(() => {
    const events = JSON.parse(
      localStorage.getItem("buzz-e2e-business-profile-events-v1") ?? "[]",
    );
    const latest = events.find(
      (event: { kind: number }) => event.kind === 30657,
    );
    return latest ? JSON.parse(latest.content) : null;
  });
  expect(savedProfile).toMatchObject({
    socialAccounts: { instagram: "@leratostudio", tiktok: "@leratostudio" },
    contact: { email: "hello@leratodesigns.co.za" },
    invoice: { registeredName: "Lerato Designs Pty Ltd" },
  });
});

test("Connections rebases edited accounts over unrelated concurrent facts", async ({
  page,
}) => {
  await openProfile(page, {
    section: "connections",
    errors: ["conflict: business profile changed; current revision is 2."],
    conflictHead: signedHead(2, {
      ...profile,
      contact: { ...profile.contact, phone: "011 555 0300" },
    }),
  });
  await page.getByLabel("Facebook").fill("leratodesigns");
  await page.getByRole("button", { name: "Save accounts" }).click();
  await page.getByRole("button", { name: "Use my changes" }).click();
  const savedProfile = await page.evaluate(() => {
    const events = JSON.parse(
      localStorage.getItem("buzz-e2e-business-profile-events-v1") ?? "[]",
    );
    const latest = events.find(
      (event: { kind: number }) => event.kind === 30657,
    );
    return latest ? JSON.parse(latest.content) : null;
  });
  expect(savedProfile).toMatchObject({
    contact: { phone: "011 555 0300" },
    socialAccounts: { facebook: "leratodesigns" },
  });
});

test("a member can see social names without editing them", async ({ page }) => {
  await openProfile(page, { role: "member", section: "connections" });
  await expect(page.getByLabel("Instagram")).toHaveValue("@leratodesigns");
  await expect(page.getByLabel("Instagram")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save accounts" })).toHaveCount(
    0,
  );
});

test("Connections keeps social edits through an outage and rejected write", async ({
  page,
}) => {
  await openProfile(page, {
    section: "connections",
    errors: ["error: relay temporarily unavailable"],
  });
  await page.getByLabel("TikTok").fill("@leratostudio");
  await page.evaluate(() =>
    window.__BUZZ_E2E_SET_RELAY_CONNECTION_STATE__?.("disconnected"),
  );
  await expect(page.getByLabel("TikTok")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Save accounts" }),
  ).toBeDisabled();
  await page.evaluate(() =>
    window.__BUZZ_E2E_SET_RELAY_CONNECTION_STATE__?.("connected"),
  );
  await expect(page.getByLabel("TikTok")).toHaveValue("@leratostudio");
  await page.getByRole("button", { name: "Save accounts" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "relay temporarily unavailable",
  );
  await expect(page.getByLabel("TikTok")).toHaveValue("@leratostudio");
  await page.getByRole("button", { name: "Save accounts" }).click();
  await expect(
    page.getByRole("button", { name: "Save accounts" }),
  ).toBeDisabled();
});

test("Connections is usable in a narrow desktop window", async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 700 });
  await openProfile(page, { section: "connections" });
  await page.getByLabel("Instagram").fill("@leratostudio");
  await page
    .getByRole("button", { name: "Save accounts" })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("button", { name: "Save accounts" }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  if (process.env.COLONY_CANARY_CONNECTIONS_SHOT) {
    await waitForAnimations(page);
    await page.screenshot({ path: process.env.COLONY_CANARY_CONNECTIONS_SHOT });
  }
});
