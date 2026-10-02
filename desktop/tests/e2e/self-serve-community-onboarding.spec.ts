import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { seedActiveIdentity } from "../helpers/onboarding";

const COMMUNITY_DOMAIN = "canary.colony.ainative.ventures";
const RELAY_HTTP_BASE = "http://localhost:3000";

test("first-run community creation checks, signs, creates, then connects as owner", async ({
  page,
}) => {
  await seedActiveIdentity(page, TEST_IDENTITIES.tyler);
  await page.addInitScript((pubkey) => {
    window.localStorage.setItem(
      `buzz-machine-onboarding-complete.v2:${pubkey}`,
      "true",
    );
  }, TEST_IDENTITIES.tyler.pubkey);
  await installMockBridge(
    page,
    {},
    {
      relayWsUrl: "ws://localhost:3000",
      skipOnboardingSeed: true,
      skipCommunitySeed: true,
    },
  );
  await page.setViewportSize({ width: 800, height: 720 });

  const requests: string[] = [];
  await page.route("**/api/communities/config", async (route) => {
    requests.push("config");
    await route.fulfill({
      json: {
        self_serve: true,
        domain: COMMUNITY_DOMAIN,
        public: true,
        max_per_owner: 5,
      },
    });
  });
  await page.route("**/api/communities/availability?**", async (route) => {
    const availabilityUrl = new URL(route.request().url());
    const slug = availabilityUrl.searchParams.get("name") ?? "";
    requests.push(availabilityUrl.toString());
    await route.fulfill({
      json: {
        name: slug,
        normalized_host: `${slug}.${COMMUNITY_DOMAIN}`,
        available: true,
      },
    });
  });

  let signedCreateEvent: Record<string, unknown> | null = null;
  await page.route("**/api/communities", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    requests.push("create");
    const body = route.request().postData() ?? "";
    expect(JSON.parse(body)).toEqual({ name: "north-star" });

    const authorization = route.request().headers().authorization ?? "";
    expect(authorization.startsWith("Nostr ")).toBe(true);
    signedCreateEvent = JSON.parse(
      Buffer.from(authorization.slice("Nostr ".length), "base64").toString(
        "utf8",
      ),
    ) as Record<string, unknown>;
    const tags = signedCreateEvent.tags as string[][];
    expect(signedCreateEvent.kind).toBe(27235);
    expect(signedCreateEvent.pubkey).toBe(TEST_IDENTITIES.tyler.pubkey);
    expect(tags).toContainEqual(["u", `${RELAY_HTTP_BASE}/api/communities`]);
    expect(tags).toContainEqual(["method", "POST"]);
    expect(tags).toContainEqual([
      "payload",
      createHash("sha256").update(body).digest("hex"),
    ]);

    await route.fulfill({
      json: {
        community: {
          id: "9cf2e62a-2bf9-4f76-b502-253a0aa04b01",
          name: "north-star",
          slug: "north-star",
          normalized_host: `north-star.${COMMUNITY_DOMAIN}`,
          owner_pubkey: TEST_IDENTITIES.tyler.pubkey,
        },
      },
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("welcome-setup")).toBeVisible();
  await page.getByTestId("community-choice-create").click();
  await expect(page.getByTestId("self-serve-community-create")).toBeVisible();
  await expect(page.getByText(`.${COMMUNITY_DOMAIN}`)).toBeVisible();

  const nameInput = page.getByTestId("self-serve-community-name");
  await nameInput.fill("a".repeat(63));
  await expect(
    page.getByTestId("self-serve-community-availability"),
  ).toHaveText("That address is available.");
  const longNameInputBox = await nameInput.boundingBox();
  const longNameSuffixBox = await page
    .getByTestId("self-serve-community-domain")
    .boundingBox();
  if (!longNameInputBox || !longNameSuffixBox) {
    throw new Error("Could not measure the maximum length community address");
  }
  expect(longNameInputBox.x).toBeLessThan(longNameSuffixBox.x);
  expect(longNameSuffixBox.x + longNameSuffixBox.width).toBeLessThanOrEqual(
    800,
  );

  await nameInput.fill("north-star");
  await expect(
    page.getByTestId("self-serve-community-availability"),
  ).toHaveText("That address is available.");
  const communityInputBox = await page
    .getByTestId("self-serve-community-name")
    .boundingBox();
  const suffixBox = await page
    .getByTestId("self-serve-community-domain")
    .boundingBox();
  if (!communityInputBox || !suffixBox) {
    throw new Error("Could not measure the community address controls");
  }
  expect(communityInputBox.x).toBeLessThan(suffixBox.x);
  expect(suffixBox.x + suffixBox.width).toBeLessThanOrEqual(800);

  await page.getByTestId("self-serve-community-submit").click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.localStorage.getItem("buzz-community-onboarding-transaction.v1"),
      ),
    )
    .toContain(`"relayUrl":"wss://north-star.${COMMUNITY_DOMAIN}"`);
  await expect.poll(() => requests.includes("create")).toBe(true);
  expect(signedCreateEvent).not.toBeNull();
  expect(requests[0]).toBe("config");
  expect(requests.some((request) => request.includes("name=north-star"))).toBe(
    true,
  );
  await expect(
    page.getByRole("heading", { name: "Build your profile" }),
  ).toBeVisible();
  const commands = await page.evaluate(
    () =>
      (
        window as Window & {
          __BUZZ_E2E_COMMANDS__?: string[];
        }
      ).__BUZZ_E2E_COMMANDS__ ?? [],
  );
  expect(commands).not.toContain("get_builderlab_auth");
});

test("first-run join and already-have community choices remain available", async ({
  page,
}) => {
  await seedActiveIdentity(page, TEST_IDENTITIES.tyler);
  await page.addInitScript((pubkey) => {
    window.localStorage.setItem(
      `buzz-machine-onboarding-complete.v2:${pubkey}`,
      "true",
    );
  }, TEST_IDENTITIES.tyler.pubkey);
  await installMockBridge(
    page,
    {},
    {
      relayWsUrl: "ws://localhost:3000",
      skipOnboardingSeed: true,
      skipCommunitySeed: true,
    },
  );
  await page.goto("/");

  await expect(page.getByTestId("community-choice-join")).toBeVisible();
  await expect(page.getByTestId("community-choice-existing")).toBeVisible();
  await page.getByTestId("community-choice-join").click();
  await expect(
    page.getByRole("heading", { name: "Join a community" }),
  ).toBeVisible();
  await page.getByTestId("welcome-join-back").click();
  await page.getByTestId("community-choice-existing").click();
  await expect(page.getByTestId("existing-choice-owner")).toBeVisible();
  await expect(page.getByTestId("existing-choice-member")).toBeVisible();
});
