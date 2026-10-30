import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import type {
  CofounderOnboardingStep,
  CofounderPhase2Fixture,
} from "../../src/features/cofounder/cofounderPhase2Model";
import { REFERENCE_CHANNEL_IDS } from "../../src/testing/e2eReferenceWorkspace";
import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
import { installBrowserHostFake } from "./helpers/browserHostFake";

const APPROVAL_SWITCHES = {
  approveEveryHire: true,
  approvePlaybookChanges: true,
  approveEveryDiscoveryCampaign: true,
};

function phase2Fixture(step: CofounderOnboardingStep = "brief") {
  const plan = {
    id: "sales-plan-1",
    title: "Get 5 Horizon Labs clients in November",
    summary: "Goal for Sales. Every message to a lead still waits for your OK.",
    functionName: "Sales",
    decideBy: "Monday 2 Nov",
    steps: [
      {
        id: "sales-find",
        title: "Find 60 guesthouses in Linden, Melville and Parkhurst",
        owner: "Aya with Discovery",
        cost: "Covered by subscription",
        timing: "2 to 4 Nov",
        status: "planned" as const,
      },
      {
        id: "sales-preview",
        title: "Build a site preview for the best 30",
        owner: "Workers under Aya",
        cost: "Free models",
        timing: "3 to 6 Nov",
        status: "planned" as const,
      },
      {
        id: "sales-outreach",
        title: "Send the Built a site for you opener, 30 a day",
        owner: "Aya, you approve each batch",
        cost: "About R0.62 per new chat",
        timing: "From 4 Nov",
        status: "waiting" as const,
      },
      {
        id: "sales-calls",
        title: "Book calls with everyone who replies",
        owner: "Aya, Google Calendar",
        cost: "Free",
        timing: "Ongoing",
        status: "planned" as const,
      },
      {
        id: "sales-agreements",
        title: "Quotes and agreements to sign",
        owner: "Aya drafts, you approve each",
        cost: "E-sign free plan",
        timing: "Ongoing",
        status: "planned" as const,
      },
      {
        id: "sales-deposit",
        title: "Deposit links and kick-off",
        owner: "Scout covers Finance",
        cost: "Fee per payment",
        timing: "On signing",
        status: "blocked" as const,
      },
    ],
    costSummary: "About R37",
    timingSummary: "1 to 30 November",
    targetSummary: "5 won",
    status: "proposed" as const,
  };

  return {
    onboarding: {
      step,
      brief: {
        companyName: "Lerato Social",
        whatYouSell: "Social campaigns and brand work",
        whoBuys: "Local hospitality and retail teams",
        prices: "",
        priceNote: "I could not find a public rate card.",
        howYouTalk: "Warm, direct and never pushy.",
        sources: ["Website", "Colony history"],
      },
      moneyPreference: "cheapest_first" as const,
      approvalSwitches: APPROVAL_SWITCHES,
      accountName: "Pinterest",
      accountUrl: "https://accounts.example.test/pinterest/login",
      accountChannelId: REFERENCE_CHANNEL_IDS.scoutDm,
      accountConnected: false,
    },
    chatPlan: plan,
    needsYou: {
      plans: [{ ...plan }],
      approvals: [
        {
          id: "approve-outreach-1",
          kind: "outreach" as const,
          title: "First message to Olivia",
          summary: "A draft for your review before it leaves Colony.",
          detail:
            "Hi Olivia, I loved the way Linden Guesthouse brings local makers into the guest experience. Would you be open to a short conversation about your next campaign?",
        },
        {
          id: "reply-drafts-1",
          kind: "reply_drafts" as const,
          title: "Two replies are ready",
          summary: "Scout drafted both replies. Nothing has been sent.",
          drafts: [
            {
              id: "reply-olivia",
              recipient: "Olivia at Linden",
              message: "Thursday works well. I will bring a few examples.",
            },
            {
              id: "reply-james",
              recipient: "James at The Fern",
              message:
                "Thanks for the introduction. I would love to hear more.",
            },
          ],
        },
        {
          id: "taste-brand-1",
          kind: "taste" as const,
          title: "Choose a direction for the welcome card",
          summary: "Scout picked the quieter layout based on your brand.",
          options: ["A", "B"],
          recommendedOption: "A",
          recommendation: "More space around the message.",
        },
      ],
      doItems: [
        {
          id: "signup-pinterest",
          title: "Create a Pinterest account for inspiration",
          summary:
            "Scout prepared the sign-up page. You complete the account step.",
          browserUrl: "https://accounts.example.test/pinterest/signup",
          browserChannelId: REFERENCE_CHANNEL_IDS.scoutDm,
          costLabel: "Free",
        },
      ],
      decisions: [
        {
          id: "decide-guesthouse-1",
          title: "Choose the first three guesthouses to contact",
          summary: "The short list is ready for your call.",
          acceptLabel: "Use these three",
          declineLabel: "Pick different ones",
        },
      ],
    },
    access: {
      pendingRequest: {
        id: "request-payment-link",
        title: "Connect a payment link account",
        description:
          "To send deposit links from Colony and see when they are paid. Free to join, a fee per payment. The sign-up page is ready in the browser.",
        costLabel: "Fee per payment",
        browserUrl: "https://accounts.example.test/payment-link/login",
        browserChannelId: REFERENCE_CHANNEL_IDS.scoutDm,
      },
      entries: [
        {
          id: "whatsapp",
          label: "WhatsApp business number",
          usedFor: "Outreach and replies",
          usedBy: "Scout, Aya",
          cost: "About R0.62 per new chat",
        },
        {
          id: "gmail",
          label: "Gmail, in the browser",
          usedFor: "Reading client emails",
          usedBy: "Scout, Aya",
          cost: "Free",
        },
        {
          id: "pinterest",
          label: "Pinterest, in the browser",
          usedFor: "Design ideas",
          usedBy: "Scout",
          cost: "Free",
        },
        {
          id: "google-calendar",
          label: "Google Calendar",
          usedFor: "Booking calls",
          usedBy: "Aya",
          cost: "Free",
        },
        {
          id: "esign",
          label: "E-sign, free plan",
          usedFor: "Agreements to sign",
          usedBy: "Aya",
          cost: "Free, 3 a month",
        },
        {
          id: "discovery",
          label: "Discovery",
          usedFor: "Finding leads",
          usedBy: "Aya",
          cost: "Covered by subscription",
        },
      ],
    },
  } satisfies CofounderPhase2Fixture;
}

async function boot(
  page: Page,
  options: {
    enabled?: boolean;
    step?: CofounderOnboardingStep;
    theme?: "light" | "dark";
  } = {},
) {
  const theme = options.theme ?? "light";
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(
    ({ selectedTheme, relayUrl }) => {
      const isDark = selectedTheme === "dark";
      const themeName = isDark ? "buzz-dark" : "buzz";
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith("colony.appearance.v1:")) {
          window.localStorage.removeItem(key);
        }
      }
      window.localStorage.removeItem("buzz-theme-cache");
      window.localStorage.setItem("buzz-theme", themeName);
      window.localStorage.setItem("buzz-follow-system", "false");
      window.localStorage.setItem("buzz-accent-color", "#5B45BE");
      window.localStorage.setItem(
        `buzz-community-theme.v1:${"deadbeef".repeat(8)}:${encodeURIComponent(relayUrl)}`,
        JSON.stringify({
          version: 1,
          theme: themeName,
          accent: "#5B45BE",
          followSystem: false,
        }),
      );
    },
    { selectedTheme: theme, relayUrl: "ws://localhost:3000" },
  );
  const relaySecret = generateSecretKey();
  await installMockBridge(page, {
    relaySelf: getPublicKey(relaySecret),
    companyMemberRelayPrivateKeyHex: bytesToHex(relaySecret),
    referenceWorkspace: true,
    colony3Sidebar: true,
    relayRequiresMembership: true,
    relayRole: "owner",
    cofounderSettings: {
      enabled: options.enabled ?? true,
      moneyPreference: "cheapest_first",
      approvalSwitches: APPROVAL_SWITCHES,
    },
    cofounderPhase2: phase2Fixture(options.step),
  });
}

async function capture(
  page: Page,
  testInfo: TestInfo,
  name: string,
  fullPage = true,
) {
  await waitForAnimations(page);
  const themeName = name.includes("-dark") ? "buzz-dark" : "buzz";
  await expect
    .poll(() =>
      page.evaluate(() => {
        const root = document.documentElement;
        return {
          storedTheme: window.localStorage.getItem("buzz-theme"),
          dark: root.classList.contains("dark"),
          buzzTheme: root.getAttribute("data-buzz-theme"),
        };
      }),
    )
    .toEqual({
      storedTheme: themeName,
      dark: themeName === "buzz-dark",
      buzzTheme: themeName,
    });
  const file = testInfo.outputPath(name);
  await mkdir(dirname(file), { recursive: true });
  await page.screenshot({ fullPage, path: file });
}

test.describe("Co-founder mode Phase 2", () => {
  test("enabled co-founder mode opens the Scout direct message from settings", async ({
    page,
  }) => {
    await boot(page, { step: "map" });
    await page.goto("/#/settings?section=experimental");
    const openScout = page.getByTestId("cofounder-open-scout");
    await expect(openScout).toBeVisible();
    await expect(openScout).toBeEnabled();
    await openScout.click();
    await expect(page).toHaveURL(
      new RegExp(`#\\/channels\\/${REFERENCE_CHANNEL_IDS.scoutDm}$`, "u"),
    );
    await expect(page.getByTestId("cofounder-chat-surface")).toBeVisible();
  });

  test("Scout guides onboarding one step at a time and then shows a plan in chat", async ({
    page,
  }) => {
    await boot(page);
    await page.goto(`/#/channels/${REFERENCE_CHANNEL_IDS.scoutDm}`);
    await expect(page.getByTestId("cofounder-chat-surface")).toBeVisible();
    await expect(page.getByTestId("cofounder-onboarding")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /what I know about Lerato Social/iu }),
    ).toBeVisible();
    await page.getByTestId("cofounder-brief-confirm").click();
    await expect(page.getByTestId("cofounder-money-best")).toBeVisible();
    await expect(page.getByTestId("cofounder-approval-save")).toHaveCount(0);

    await page.getByTestId("cofounder-money-best").click();
    await expect(page.getByTestId("cofounder-approval-save")).toBeVisible();
    await page
      .getByTestId("cofounder-approval-approveEveryDiscoveryCampaign")
      .uncheck();
    await page.getByTestId("cofounder-approval-save").click();
    await expect(page.getByTestId("cofounder-account-connected")).toBeVisible();
    await page.getByTestId("cofounder-account-connected").click();
    await expect(page.getByTestId("cofounder-map-approve")).toBeVisible();
    await page.getByTestId("cofounder-map-approve").click();

    const plan = page.getByTestId("cofounder-plan-sales-plan-1");
    await expect(plan).toBeVisible();
    await expect(plan).toContainText("5 won");
    await plan.getByTestId("cofounder-plan-edit-sales-plan-1").click();
    await page
      .getByTestId("cofounder-plan-title-sales-plan-1")
      .fill("A revised guesthouse plan");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(plan).toContainText("A revised guesthouse plan");
    await plan.getByTestId("cofounder-plan-approve-sales-plan-1").click();
    await expect(plan).toContainText("Approved");
  });

  test("Scout plan can be rejected", async ({ page }) => {
    await boot(page, { step: "complete" });
    await page.goto(`/#/channels/${REFERENCE_CHANNEL_IDS.scoutDm}`);
    const plan = page.getByTestId("cofounder-plan-sales-plan-1");
    await expect(plan).toBeVisible();
    await plan.getByTestId("cofounder-plan-reject-sales-plan-1").click();
    await expect(plan).toContainText("Rejected");
  });

  test("primary plan actions keep readable contrast in light and dark themes", async ({
    page,
  }) => {
    for (const theme of ["light", "dark"] as const) {
      await boot(page, { step: "complete", theme });
      await page.goto(`/#/channels/${REFERENCE_CHANNEL_IDS.scoutDm}`);
      const approve = page.getByTestId("cofounder-plan-approve-sales-plan-1");
      await expect(approve).toBeVisible();
      const ratio = await approve.evaluate((button) => {
        const parse = (value: string) =>
          value.match(/[\d.]+/gu)?.map(Number) ?? [];
        const toLinear = (channel: number) => {
          const normalized = channel / 255;
          return normalized <= 0.04045
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        };
        const luminance = (color: string) => {
          const [red, green, blue] = parse(color);
          return (
            0.2126 * toLinear(red ?? 0) +
            0.7152 * toLinear(green ?? 0) +
            0.0722 * toLinear(blue ?? 0)
          );
        };
        const style = window.getComputedStyle(button);
        const foreground = luminance(style.color);
        const background = luminance(style.backgroundColor);
        return (
          (Math.max(foreground, background) + 0.05) /
          (Math.min(foreground, background) + 0.05)
        );
      });
      expect(ratio, `${theme} primary action contrast`).toBeGreaterThanOrEqual(
        4.5,
      );
    }

    await page.setViewportSize({ width: 390, height: 844 });
    const tableWrap = page.locator(".cf2-plan-table-wrap");
    await expect
      .poll(() =>
        tableWrap.evaluate(
          (element) => element.scrollWidth - element.clientWidth,
        ),
      )
      .toBeLessThanOrEqual(0);
    await expect(page.locator(".cf2-step-mobile-meta").first()).toBeVisible();
  });

  test("Needs you approves or rejects items and opens the exact prepared page", async ({
    page,
  }) => {
    await installBrowserHostFake(page);
    await boot(page);
    await page.goto("/#/today/needs-you");
    await expect(page.getByTestId("cofounder-needs-you-screen")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Needs you", exact: true }),
    ).toBeVisible();

    await page.getByTestId("cofounder-plan-approve-sales-plan-1").click();
    await expect(page.getByTestId("cofounder-plan-sales-plan-1")).toHaveCount(
      0,
    );
    await page.getByTestId("cofounder-reject-approve-outreach-1").click();
    await expect(
      page.getByTestId("cofounder-reject-approve-outreach-1"),
    ).toHaveCount(0);

    const replyDraft = page.getByTestId("cofounder-draft-reply-olivia");
    await replyDraft
      .getByRole("button", { name: "Edit draft to Olivia at Linden" })
      .click();
    const editedMessage = page.getByRole("textbox", {
      name: "Message to Olivia at Linden",
    });
    await editedMessage.fill("Updated draft after review.");
    const saveChanges = replyDraft.getByTestId(
      "cofounder-save-draft-reply-olivia",
    );
    await saveChanges.focus();
    await saveChanges.press("Enter");
    await expect(replyDraft).toContainText("Updated draft after review.");

    await page.getByRole("button", { name: "Ask for changes" }).click();
    await expect(
      page.getByText("You asked Scout for a different direction."),
    ).toBeVisible();

    await page.getByTestId("cofounder-open-gap-signup-pinterest").click();
    await expect(page.getByTestId("work-area-browser")).toBeVisible();
    await expect(page.getByTestId("browser-address")).toHaveValue(
      "https://accounts.example.test/pinterest/signup",
    );
  });

  test("Needs you completes human steps and decisions", async ({ page }) => {
    await boot(page);
    await page.goto("/#/today/needs-you");
    await page.getByTestId("cofounder-done-signup-pinterest").click();
    await expect(
      page.getByTestId("cofounder-done-signup-pinterest"),
    ).toHaveCount(0);
    await page
      .getByTestId("cofounder-decision-accept-decide-guesthouse-1")
      .click();
    await expect(
      page.getByTestId("cofounder-decision-accept-decide-guesthouse-1"),
    ).toHaveCount(0);
  });

  test("Access shows pending requests and revoke removes only the selected account", async ({
    page,
  }) => {
    await installBrowserHostFake(page);
    await boot(page);
    await page.goto("/#/company/access");
    await expect(page.getByTestId("cofounder-access-screen")).toBeVisible();
    await expect(page.getByTestId("sidebar-nav-company-content")).toBeHidden();
    await expect(
      page.getByTestId("sidebar-nav-company-toggle"),
    ).toHaveAttribute("data-current", "true");
    await expect(page.getByTestId("sidebar-activity-button")).toHaveAttribute(
      "data-active",
      "false",
    );
    await page.getByTestId("sidebar-nav-company-toggle").click();
    await expect(page.getByTestId("sidebar-company-access")).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByTestId("cofounder-access-pending")).toContainText(
      "Connect a payment link account",
    );

    await page.getByTestId("cofounder-access-revoke-whatsapp").click();
    await expect(page.getByTestId("cofounder-access-whatsapp")).toHaveCount(0);
    await expect(page.getByTestId("cofounder-access-gmail")).toBeVisible();

    await page.goto("/#/company/access");
    await page
      .getByTestId("cofounder-access-approve-request-payment-link")
      .click();
    await expect(page.getByTestId("work-area-browser")).toBeVisible();
    await expect(page.getByTestId("browser-address")).toHaveValue(
      "https://accounts.example.test/payment-link/login",
    );
  });

  test("Phase 2 surfaces disappear when co-founder mode is off", async ({
    page,
  }) => {
    await boot(page, { enabled: false });
    await page.goto("/#/company/access");
    await expect(page.getByTestId("cofounder-access-screen")).toHaveCount(0);
    await expect(page).toHaveURL(/#\/today$/u);
    await expect(page.getByTestId("today-screen")).toBeVisible();
  });

  test("captures each approved surface at desktop and mobile sizes in light and dark", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    const cases = [
      {
        surface: "onboarding",
        route: `/#/channels/${REFERENCE_CHANNEL_IDS.scoutDm}`,
        step: "map" as const,
      },
      {
        surface: "settings",
        route: "/#/settings?section=experimental",
        step: "complete" as const,
      },
      {
        surface: "plan",
        route: `/#/channels/${REFERENCE_CHANNEL_IDS.scoutDm}`,
        step: "complete" as const,
      },
      {
        surface: "needs-you",
        route: "/#/today/needs-you",
        step: "brief" as const,
      },
      { surface: "access", route: "/#/company/access", step: "brief" as const },
    ];

    for (const theme of ["light", "dark"] as const) {
      for (const viewport of [
        { name: "1440", width: 1440, height: 900 },
        { name: "390", width: 390, height: 844 },
      ]) {
        for (const item of cases) {
          const screenshotContext = await browser.newContext();
          try {
            const page = await screenshotContext.newPage();
            const captureHeight =
              item.surface === "onboarding"
                ? 2400
                : item.surface === "plan"
                  ? 1600
                  : item.surface === "needs-you"
                    ? viewport.width === 390
                      ? 3500
                      : 2500
                    : item.surface === "access"
                      ? viewport.width === 390
                        ? 2100
                        : 1300
                      : viewport.height;
            await page.setViewportSize({
              width: viewport.width,
              height: captureHeight,
            });
            await boot(page, { theme, step: item.step });
            await page.goto(item.route);
            const expected =
              item.surface === "onboarding"
                ? page.getByTestId("cofounder-onboarding")
                : item.surface === "plan"
                  ? page.getByTestId("cofounder-plan-sales-plan-1")
                  : item.surface === "needs-you"
                    ? page.getByTestId("cofounder-needs-you-screen")
                    : item.surface === "access"
                      ? page.getByTestId("cofounder-access-screen")
                      : page.getByTestId("cofounder-open-scout");
            await expect(expected).toBeVisible();
            await capture(
              page,
              testInfo,
              `cofounder-phase2-${item.surface}-${viewport.name}-${theme}.png`,
            );
            if (viewport.name === "390" && item.surface !== "settings") {
              await page.setViewportSize({ width: 390, height: 844 });
              await page.evaluate(() => {
                window.scrollTo(0, 0);
                for (const element of document.querySelectorAll<HTMLElement>(
                  "*",
                )) {
                  if (element.scrollTop > 0) element.scrollTop = 0;
                }
              });
              await capture(
                page,
                testInfo,
                `cofounder-phase2-${item.surface}-390-${theme}-viewport.png`,
                false,
              );
            }
          } finally {
            await screenshotContext.close();
          }
        }
      }
    }
  });
});
