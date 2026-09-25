import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { installMockBridge } from "./bridge";

export const E2E_IDENTITY_OVERRIDE_STORAGE_KEY =
  "buzz:e2e-identity-override.v1";
export const R17_BUSINESS_ID = "c27e6bf6-9794-49e0-91f0-e398cb343013";
export const R17_BUSINESS_PROFILE_KEY = `colony-business-profile.v1:${R17_BUSINESS_ID}`;

const BUSINESS_DOMAIN = "accounts-test.colony.ainative.ventures";
const MOCK_ACCOUNT_PUBKEY = "deadbeef".repeat(8);

export type R17RuntimeId = "claude" | "codex" | "goose" | "buzz-agent";
export type R17ConnectionSetupOptions = {
  runtimes?: Array<Record<string, unknown>>;
  discoveryDelayMs?: number;
  discoveryError?: boolean;
  identityLost?: boolean;
};

export function r17Runtime(
  id: R17RuntimeId,
  availability: string,
  authStatus: Record<string, unknown>,
) {
  return {
    id,
    label:
      id === "buzz-agent"
        ? "Buzz Agent"
        : id === "goose"
          ? "Goose"
          : id === "codex"
            ? "Codex"
            : "Claude Code",
    avatar_url: "",
    availability,
    command: availability === "available" ? id : null,
    binary_path: availability === "available" ? `/usr/local/bin/${id}` : null,
    default_args: [],
    mcp_command: null,
    install_hint: `Install ${id}`,
    install_instructions_url: "https://example.com",
    can_auto_install: true,
    underlying_cli_path: null,
    node_required: false,
    auth_status: authStatus,
    login_hint: `Sign in to ${id}`,
  };
}

export async function startR17AccountAuth(
  page: Page,
  options: R17ConnectionSetupOptions = {},
) {
  await installMockBridge(
    page,
    {
      accountLinked: true,
      identityLost: options.identityLost,
      acpRuntimesCatalog: options.runtimes ?? [],
      acpRuntimesDelayMs: options.discoveryDelayMs,
      acpRuntimesError: options.discoveryError,
    },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.route("**/api/communities/config", (route) =>
    route.fulfill({
      json: {
        self_serve: true,
        domain: BUSINESS_DOMAIN,
        public: true,
        max_per_owner: 3,
      },
    }),
  );
  await page.route("**/api/communities/mine", (route) =>
    route.fulfill({
      json: { owner_pubkey: MOCK_ACCOUNT_PUBKEY, communities: [] },
    }),
  );
  await page.route("**/api/communities/availability?**", async (route) => {
    const slug = new URL(route.request().url()).searchParams.get("name") ?? "";
    await route.fulfill({
      json: {
        name: slug,
        normalized_host: `${slug}.${BUSINESS_DOMAIN}`,
        available: true,
      },
    });
  });
  await page.route("**/api/communities", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const body = JSON.parse(route.request().postData() ?? "{}") as {
      name?: string;
    };
    const slug = body.name ?? "";
    await route.fulfill({
      json: {
        community: {
          id: R17_BUSINESS_ID,
          name: slug,
          slug,
          normalized_host: `${slug}.${BUSINESS_DOMAIN}`,
          owner_pubkey: MOCK_ACCOUNT_PUBKEY,
        },
      },
    });
  });

  await page.goto("/");
  await expect(page.getByTestId("google-account-scene")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
}

export async function openR17BusinessSetup(
  page: Page,
  options: R17ConnectionSetupOptions = {},
) {
  await startR17AccountAuth(page, options);
  await page.getByLabel("Email address").fill("setup@example.com");
  await page
    .getByRole("textbox", { name: "Password" })
    .fill("correct-horse-12");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page.getByTestId("onboarding-scene-business")).toBeVisible();
}

export async function completeR17BusinessSetup(page: Page) {
  await page.getByLabel("Business name").fill("North Star");
  await page.getByLabel("Website").fill("northstar.example");
  await page.locator("#business-logo").setInputFiles({
    name: "north-star.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8" fill="#6f56a8"/></svg>',
    ),
  });
  await page
    .getByLabel("What does your business do?")
    .fill("An independent design studio.");
  const continueButton = page.getByRole("button", { name: "Continue" });
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await expect(page.getByTestId("onboarding-scene-connect")).toBeVisible();
}

export async function openR17ConnectionSetup(
  page: Page,
  options: R17ConnectionSetupOptions = {},
) {
  await openR17BusinessSetup(page, options);
  await completeR17BusinessSetup(page);
}

export async function seedActiveIdentity(
  page: Page,
  identity: { privateKey: string; pubkey: string; username: string },
) {
  await page.addInitScript(
    ({ identity: nextIdentity, storageKey }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(nextIdentity));
    },
    { identity, storageKey: E2E_IDENTITY_OVERRIDE_STORAGE_KEY },
  );
}
