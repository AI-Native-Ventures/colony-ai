import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

const ACCOUNT_PUBKEY = "deadbeef".repeat(8);
const COMMUNITY_ID = "62a30d54-a5d8-42c2-a20f-1024a413ff2e";
const HOST = "lerato-designs.accounts-test.colony.ainative.ventures";

async function openBusiness(page: Page) {
  await installMockBridge(
    page,
    { accountLinked: true, legacyAccountFlow: false, joinPolicy: null },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.route("**/api/communities/config", (route) =>
    route.fulfill({
      json: {
        self_serve: true,
        domain: "accounts-test.colony.ainative.ventures",
        public: true,
      },
    }),
  );
  await page.route("**/api/communities/mine", (route) =>
    route.fulfill({
      json: { owner_pubkey: ACCOUNT_PUBKEY, communities: [] },
    }),
  );
  await page.goto("/");
  await page.getByLabel("Email address").fill("owner@example.com");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("6-digit code").fill("123456");
  await expect(page.getByTestId("onboarding-scene-business")).toBeVisible();
}

async function answerThroughSummary(page: Page) {
  const next = () =>
    page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("What should I call you?")).toBeVisible();
  await page.getByLabel("Your answer").fill("Lerato");
  await next();
  await page.getByLabel("Your answer").fill("Lerato Designs");
  await next();
  await page.getByRole("button", { name: "Clothing and fashion" }).click();
  await page.getByLabel("Tell me a bit more (optional)").fill("Linen clothing");
  await next();
  await page.getByLabel("Your answer").fill("Women in Joburg");
  await next();
  const instagram = page.getByRole("button", {
    name: "Instagram",
    exact: true,
  });
  await instagram.focus();
  await page.keyboard.press("Space");
  await expect(instagram).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("Where can I see your business online?"),
  ).toBeVisible();
  await page.getByLabel("Add a link or @name").fill("not a link");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "doesn't look like a link",
  );
  await page.getByLabel("Add a link or @name").fill("@leratodesigns");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await next();
  await expect(page.getByLabel("Your answer")).toHaveValue(/.+/);
  await next();
  await page.getByRole("button", { name: "More sales" }).click();
  await page.getByRole("button", { name: "Review answers" }).click();
  await expect(
    page.getByRole("heading", { name: "Here's what I have" }),
  ).toBeVisible();
}

test("Scout asks one question at a time, keeps the draft and creates the real company", async ({
  page,
}) => {
  await openBusiness(page);
  await expect(page.locator('[data-ant-portrait="Scout"]')).toHaveCount(2);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Tell Scout what to call you",
  );
  await answerThroughSummary(page);
  await page.getByRole("button", { name: "Change Who buys" }).click();
  await page.getByLabel("Your answer").fill("Local shoppers");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Local shoppers")).toBeVisible();
  const draft = await page.evaluate(
    (pubkey) =>
      localStorage.getItem(`colony-guided-business-draft.v1:${pubkey}`),
    ACCOUNT_PUBKEY,
  );
  expect(draft).toContain("Local shoppers");
  await page.reload();
  await page.getByLabel("Email address").fill("owner@example.com");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("6-digit code").fill("123456");
  await expect(
    page.getByRole("heading", { name: "Here's what I have" }),
  ).toBeVisible();
  await expect(page.getByText("Local shoppers")).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeInViewport();
  if (process.env.COLONY_CANARY_BUSINESS_WIDE_SHOT) {
    await waitForAnimations(page);
    await page.screenshot({
      path: process.env.COLONY_CANARY_BUSINESS_WIDE_SHOT,
    });
  }
  await page.setViewportSize({ width: 700, height: 700 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(700);

  await page.route("**/api/communities/availability?*", (route) =>
    route.fulfill({ json: { name: "lerato-designs", available: true } }),
  );
  let createCalls = 0;
  await page.route("**/api/communities", (route) => {
    createCalls += 1;
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers().authorization).toMatch(/^Nostr /);
    expect(route.request().postDataJSON()).toEqual({ name: "lerato-designs" });
    return route.fulfill({
      json: {
        community: {
          id: COMMUNITY_ID,
          name: "lerato-designs",
          slug: "lerato-designs",
          normalized_host: HOST,
          owner_pubkey: ACCOUNT_PUBKEY,
        },
      },
    });
  });
  if (process.env.COLONY_CANARY_BUSINESS_SHOT) {
    await waitForAnimations(page);
    await page.screenshot({ path: process.env.COLONY_CANARY_BUSINESS_SHOT });
  }
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByTestId("onboarding-scene-connect")).toBeVisible();
  expect(createCalls).toBe(1);
  const saved = await page.evaluate(
    (id) => localStorage.getItem(`colony-business-profile.v1:${id}`),
    COMMUNITY_ID,
  );
  expect(JSON.parse(saved ?? "{}")).toMatchObject({
    name: "Lerato Designs",
    category: "Clothing and fashion",
    buyers: "Local shoppers",
    channels: ["Instagram"],
    links: ["@leratodesigns"],
    goals: ["More sales"],
  });
  await expect
    .poll(() =>
      page.evaluate(
        (pubkey) =>
          localStorage.getItem(`colony-guided-business-draft.v1:${pubkey}`),
        ACCOUNT_PUBKEY,
      ),
    )
    .toBeNull();
});

test("closing halfway resumes at the same question with the typed answer", async ({
  page,
}) => {
  await openBusiness(page);
  await page.getByLabel("Your answer").fill("Lerato");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Your answer").fill("Lerato Designs");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Services", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Who usually buys from you?")).toBeVisible();
  await page.getByLabel("Your answer").fill("Local shops");
  await page.reload();
  await page.getByLabel("Email address").fill("owner@example.com");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("6-digit code").fill("123456");
  await expect(page.getByText("Who usually buys from you?")).toBeVisible();
  await expect(page.getByLabel("Your answer")).toHaveValue("Local shops");
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByText("Where do you sell today?")).toBeVisible();
});

test("a failed company request keeps answers and can be retried", async ({
  page,
}) => {
  await openBusiness(page);
  await answerThroughSummary(page);
  await page.route("**/api/communities/availability?*", (route) =>
    route.fulfill({ json: { name: "lerato-designs", available: true } }),
  );
  let createCalls = 0;
  await page.route("**/api/communities", (route) => {
    createCalls += 1;
    if (createCalls === 1)
      return route.fulfill({ status: 503, json: { error: "request_failed" } });
    return route.fulfill({
      json: {
        community: {
          id: COMMUNITY_ID,
          name: "lerato-designs",
          slug: "lerato-designs",
          normalized_host: HOST,
          owner_pubkey: ACCOUNT_PUBKEY,
        },
      },
    });
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "couldn't set up your business yet",
  );
  expect(
    await page.evaluate(
      (pubkey) =>
        localStorage.getItem(`colony-guided-business-draft.v1:${pubkey}`),
      ACCOUNT_PUBKEY,
    ),
  ).toContain("Lerato Designs");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByTestId("onboarding-scene-connect")).toBeVisible();
  expect(createCalls).toBe(2);
});

test("a committed company with an interrupted profile handoff resumes at the summary", async ({
  page,
}) => {
  await openBusiness(page);
  await answerThroughSummary(page);
  const community = {
    id: COMMUNITY_ID,
    name: "lerato-designs",
    slug: "lerato-designs",
    normalized_host: HOST,
    owner_pubkey: ACCOUNT_PUBKEY,
  };
  let committed = false;
  let recoveryUnavailable = true;
  await page.route("**/api/communities/mine", (route) => {
    if (committed && recoveryUnavailable)
      return route.fulfill({ status: 503, json: { error: "request_failed" } });
    return route.fulfill({
      json: {
        owner_pubkey: ACCOUNT_PUBKEY,
        communities: committed ? [community] : [],
      },
    });
  });
  await page.route("**/api/communities/availability?*", (route) =>
    route.fulfill({ json: { name: "lerato-designs", available: true } }),
  );
  let createCalls = 0;
  await page.route("**/api/communities", (route) => {
    createCalls += 1;
    committed = true;
    return route.fulfill({ status: 503, json: { error: "request_failed" } });
  });
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Your answers are kept here",
  );
  recoveryUnavailable = false;
  await page.reload();
  await page.getByLabel("Email address").fill("owner@example.com");
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("6-digit code").fill("123456");
  await expect(
    page.getByRole("heading", { name: "Here's what I have" }),
  ).toBeVisible();
  await expect(page.getByText("Lerato Designs", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByTestId("onboarding-scene-connect")).toBeVisible();
  expect(createCalls).toBe(1);
});
