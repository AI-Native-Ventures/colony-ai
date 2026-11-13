import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import { TEST_IDENTITIES, installMockBridge } from "../helpers/bridge";
import {
  cedarCafeLeadRecord,
  planeTreeCustomerRecord,
} from "../../src/testing/cofounderCustomerFixtures";
import {
  REFERENCE_CHANNEL_IDS,
  REFERENCE_PROSPECT_IDS,
} from "../../src/testing/e2eReferenceWorkspace";
import {
  deliveryJobs,
  deliveryPlaybook,
} from "../../src/testing/cofounderPlaybookFixtures";
import type {
  MockCompanyFunctionHead,
  MockManagedAgentSeed,
} from "../../src/testing/e2eBridge";
import { waitForAnimations } from "../helpers/animations";

const OWNER_PUBKEY = "deadbeef".repeat(8);
const OLIVE_PARTY_ID = "a1a17000-0000-4000-8000-000000000001";
const MELVILLE_PARTY_ID = REFERENCE_PROSPECT_IDS["the-olive-house"];
const PLANE_TREE_PARTY_ID = REFERENCE_PROSPECT_IDS["form-field"];
const EMPTY_PARTY_ID = "5b2e2e1d-3308-4e4f-958e-9509070626d1";

function localNoonTimestamp(): number {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  return Math.floor(date.getTime() / 1_000);
}

function deliveryPlaybookWithSteps(
  input: Parameters<typeof deliveryPlaybook>[0],
  stepCount: number,
) {
  const playbook = deliveryPlaybook(input);
  const current = playbook.current;
  if (!current) throw new Error("delivery fixture needs a current version");

  const steps = [...current.steps];
  while (steps.length < stepCount) {
    const source = current.steps.at(steps.length % current.steps.length);
    if (!source) throw new Error("delivery fixture needs source steps");
    const stepNumber = steps.length + 1;
    steps.push({
      ...source,
      stepId: `${source.stepId}-${stepNumber}`,
      title: `${source.title} ${stepNumber}`,
    });
  }

  return { ...playbook, current: { ...current, steps } };
}

function customerFixture({
  enabled = true,
  role = "owner",
  whatsappGuesthouses = true,
  companyFunctionHeads,
  managedAgents,
  customerActionErrors,
  manualMelville = false,
  startDelivery = false,
  playbookStepCount = 7,
  clientMelville = false,
  duplicateMelvilleJob = false,
}: {
  enabled?: boolean;
  role?: "owner" | "admin" | "member";
  whatsappGuesthouses?: boolean;
  companyFunctionHeads?: MockCompanyFunctionHead[];
  managedAgents?: MockManagedAgentSeed[];
  customerActionErrors?: string[];
  manualMelville?: boolean;
  startDelivery?: boolean;
  playbookStepCount?: number;
  clientMelville?: boolean;
  duplicateMelvilleJob?: boolean;
} = {}) {
  const relaySecret = generateSecretKey();
  const input = {
    scoutPubkey: TEST_IDENTITIES.alice.pubkey,
    ayaPubkey: TEST_IDENTITIES.bob.pubkey,
    ownerPubkey: OWNER_PUBKEY,
  };
  const planeTree = planeTreeCustomerRecord(input);
  planeTree.partyId = PLANE_TREE_PARTY_ID;
  planeTree.leadId = PLANE_TREE_PARTY_ID;

  const melville = cedarCafeLeadRecord(input);
  melville.partyId = MELVILLE_PARTY_ID;
  melville.leadId = MELVILLE_PARTY_ID;
  melville.displayName = "Melville Manor Guesthouse";
  melville.found = {
    at: 1_793_000_000,
    byPubkey: input.ayaPubkey,
    search: "guesthouses in Melville",
  };
  if (manualMelville) {
    melville.found = null;
    melville.timeline = (melville.timeline as Array<{ kind: string }>).filter(
      (entry) => entry.kind !== "found",
    );
  }

  const olive = structuredClone(planeTree);
  olive.partyId = OLIVE_PARTY_ID;
  olive.displayName = "The Olive House";
  olive.clientId = REFERENCE_CHANNEL_IDS.oliveHouse;
  olive.stage = "client";
  const clientRecordForMelville = clientMelville
    ? {
        ...structuredClone(planeTree),
        partyId: MELVILLE_PARTY_ID,
        leadId: MELVILLE_PARTY_ID,
        displayName: "Melville Manor Guesthouse",
        project: null,
      }
    : melville;
  const startDeliveryInput = {
    scoutPubkey: TEST_IDENTITIES.alice.pubkey,
    ownerPubkey: OWNER_PUBKEY,
  };

  return {
    relaySelf: getPublicKey(relaySecret),
    companyMemberRelayPrivateKeyHex: bytesToHex(relaySecret),
    referenceWorkspace: true,
    referenceWorkspaceRole: role,
    whatsappGuesthouses,
    relayRole: role,
    relayRequiresMembership: true,
    relayMembers: [{ pubkey: OWNER_PUBKEY, role }],
    cofounderSettings: {
      enabled,
      moneyPreference: "cheapest_first" as const,
      approvalSwitches: {
        approveEveryHire: false,
        approvePlaybookChanges: false,
        approveEveryDiscoveryCampaign: false,
      },
    },
    companyFunctionHeads,
    managedAgents:
      managedAgents ??
      (startDelivery
        ? [
            {
              pubkey: TEST_IDENTITIES.alice.pubkey,
              name: "Scout",
              personaId: "builtin:fizz",
              status: "running" as const,
              channelNames: ["general"],
            },
          ]
        : undefined),
    ...(startDelivery
      ? {
          searchProfiles: [
            {
              pubkey: TEST_IDENTITIES.alice.pubkey,
              displayName: "Scout",
              isAgent: true,
            },
          ],
          companyPlaybooks: [
            deliveryPlaybookWithSteps(startDeliveryInput, playbookStepCount),
          ],
          companyPlaybookJobs: [
            ...deliveryJobs(startDeliveryInput),
            ...(duplicateMelvilleJob
              ? [
                  {
                    ...deliveryJobs(startDeliveryInput)[0],
                    jobId: "c72a094c-985d-4f76-a5e5-37a969a9dcf1",
                    title: "  melville manor guesthouse ",
                  },
                ]
              : []),
          ],
        }
      : {}),
    companyCustomerRecords: [planeTree, clientRecordForMelville, olive],
    ...(customerActionErrors ? { customerActionErrors } : {}),
  };
}

async function openCustomerRecord(
  page: import("@playwright/test").Page,
  partyId: string,
  fixture = customerFixture(),
  theme?: "light" | "dark",
) {
  if (theme) {
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript(
      ({ selectedTheme, ownerPubkey }) => {
        const themeName = selectedTheme === "dark" ? "buzz-dark" : "buzz";
        const appearancePrefixes = [
          "colony.appearance.v1:",
          "buzz-community-theme.v1:",
          "buzz-community-theme-outbox.v1:",
        ];
        for (const key of Object.keys(window.localStorage)) {
          if (appearancePrefixes.some((prefix) => key.startsWith(prefix))) {
            window.localStorage.removeItem(key);
          }
        }
        window.localStorage.removeItem(
          `buzz-community-theme-migrated.v1:${ownerPubkey}`,
        );
        window.localStorage.removeItem("buzz-theme-cache");
        window.localStorage.setItem("buzz-theme", themeName);
        window.localStorage.setItem("buzz-follow-system", "false");
        window.localStorage.setItem("buzz-accent-color", "#5B45BE");
        window.localStorage.setItem(
          `buzz-community-theme.v1:${ownerPubkey}:${encodeURIComponent("ws://localhost:3000")}`,
          JSON.stringify({
            version: 1,
            theme: themeName,
            accent: "#5B45BE",
            followSystem: false,
          }),
        );
      },
      { selectedTheme: theme, ownerPubkey: OWNER_PUBKEY },
    );
  }
  await installMockBridge(page, fixture);
  await page.addInitScript((outreachChannelId) => {
    const testWindow = window as Window & {
      __BUZZ_E2E_WHATSAPP__?: (request: {
        action: "post" | "command";
        path?: string;
        body?: Record<string, unknown>;
      }) => Promise<unknown>;
    };
    testWindow.__BUZZ_E2E_WHATSAPP__ = async (request) => {
      if (
        request.action === "post" &&
        request.path === "/api/whatsapp/query" &&
        request.body?.what === "status"
      ) {
        return {
          connected: true,
          connectionId: "cof4-whatsapp-connection",
          displayPhoneNumber: "+27 61 534 0627",
          verifiedName: "Horizon Labs",
          quality: "GREEN",
          phoneStatus: "CONNECTED",
          dailyNewChatCap: 30,
          newChatsSentToday: 0,
          sendingPaused: false,
          pauseReason: null,
          issues: [],
          outreachChannelId,
          templatesSyncedAt: null,
          templates: [],
          webhookUrl: null,
        };
      }
      return {};
    };
  }, REFERENCE_CHANNEL_IDS.sales);
  await page.goto(`/#/clients/record/${partyId}`);
  await expect(page.getByTestId("customer-record-screen")).toBeVisible();
  if (theme) {
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.classList.contains("dark"),
        ),
      )
      .toBe(theme === "dark");
  }
}

test.describe("co-founder customer records", () => {
  test("owner is offered to start delivery after making a client", async ({
    page,
  }) => {
    await openCustomerRecord(
      page,
      MELVILLE_PARTY_ID,
      customerFixture({ startDelivery: true }),
      "light",
    );

    await page.getByTestId("customer-record-make-client").click();
    await expect(page.getByTestId("customer-record-make-client")).toHaveCount(
      0,
    );
    await expect(page.getByRole("dialog")).toBeVisible();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toHaveAccessibleName("Start Delivery?");
    await expect(dialog).toContainText(
      "Melville Manor Guesthouse is a client now.",
    );
    await expect(dialog.locator(".start-delivery-rail-step")).toHaveCount(7);
    await expect(dialog).toContainText(
      "Scout starts step 1 today. You are needed at 2, 4 and 7.",
    );
    await dialog
      .getByRole("button", { name: "Start Delivery", exact: true })
      .click();

    await expect(page).toHaveURL(/\/company\/function\/operations$/);
    await expect(page.getByTestId("cofounder-playbook-screen")).toBeVisible();
    const startedJob = page
      .locator('[data-testid^="playbook-job-"]')
      .filter({ hasText: "Melville Manor Guesthouse" });
    const firstJob = page.locator('[data-testid^="playbook-job-"]').first();
    await expect(firstJob).toContainText("Melville Manor Guesthouse");
    await expect(firstJob).toContainText("1 of 7");
    await expect(startedJob).toContainText("1 of 7");
    await expect(startedJob).toContainText("Client brief and assets");
    await expect(startedJob).toContainText("New");
    await expect(startedJob).toContainText("Started today");
  });

  test("an approval made today still displays its UTC date", async ({
    page,
  }) => {
    const fixture = customerFixture({ startDelivery: true });
    const approvalTimestamp = localNoonTimestamp();
    const approvedRecord = fixture.companyPlaybooks?.[0]?.records?.find(
      (record) => record.version === 2,
    );
    if (!approvedRecord)
      throw new Error("delivery approval fixture is missing");
    approvedRecord.at = approvalTimestamp;
    const approvalDate = new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(approvalTimestamp * 1_000));

    await page.setViewportSize({ width: 1440, height: 900 });
    await installMockBridge(page, fixture);
    await page.goto("/#/company/function/operations");

    const screen = page.getByTestId("cofounder-playbook-screen");
    await expect(screen).toBeVisible();
    const metadata = screen.locator(".cf3-playbook-meta");
    await expect(metadata).toContainText(
      `Last change approved by you on ${approvalDate}`,
    );
    await expect(metadata).not.toContainText(/on today/i);

    const history = screen.getByTestId("playbook-version-history");
    await history.locator("summary").click();
    const approvedVersion = history.locator("li").filter({
      hasText: "Version 2",
    });
    await expect(approvedVersion).toContainText(
      `Approved by you on ${approvalDate}`,
    );
    await expect(approvedVersion).not.toContainText(/on today/i);
  });

  test("new owner-started job uses list typography and keeps both pills clear on phone", async ({
    page,
  }) => {
    const fixture = customerFixture({ startDelivery: true });
    const referenceJobs = fixture.companyPlaybookJobs;
    const sourceJob = referenceJobs?.[0];
    if (!sourceJob) throw new Error("delivery job fixture is missing");
    const startedAt = localNoonTimestamp();
    const ownerFirstStepJob = {
      ...sourceJob,
      jobId: "10000000-0000-4000-8000-000000000001",
      title: "Melville Manor Guesthouse",
      startedAt,
      updatedAt: startedAt,
      approvals: [],
      steps: sourceJob.steps.map((step, index) => ({
        ...step,
        status: "pending" as const,
        statusAt: startedAt + index,
        ...(index === 0
          ? {
              owner: { kind: "owner" as const },
              approvalPoint: {
                kind: "other" as const,
                prompt: "Owner approval required",
              },
            }
          : {}),
      })),
    };
    const skippedTodayJob = {
      ...sourceJob,
      jobId: "10000000-0000-4000-8000-000000000002",
      title: "Skipped Step Guesthouse",
      startedAt,
      updatedAt: startedAt - 1,
      approvals: [],
      steps: sourceJob.steps.map((step, index) => ({
        ...step,
        status: index === 0 ? ("skipped" as const) : ("pending" as const),
        statusAt: startedAt + index,
      })),
    };
    fixture.companyPlaybookJobs = [
      ownerFirstStepJob,
      skippedTodayJob,
      ...(referenceJobs ?? []),
    ];

    await page.setViewportSize({ width: 390, height: 844 });
    await installMockBridge(page, fixture);
    await page.goto("/#/company/function/operations");

    const screen = page.getByTestId("cofounder-playbook-screen");
    await expect(screen).toBeVisible();
    const rows = page.locator('[data-testid^="playbook-job-"]');
    const firstRow = rows.nth(0);
    const secondRow = rows.nth(1);
    await expect(firstRow).toContainText("Melville Manor Guesthouse");
    await expect(firstRow).toContainText("Client brief and assets");
    await expect(firstRow).toContainText("New");
    await expect(firstRow).toContainText("Needs you");
    await expect(firstRow).toContainText("Started today");
    await expect(
      firstRow.locator(".cf3-job-current .cf3-need-pill"),
    ).toHaveCount(2);
    await expect(secondRow).toContainText("Skipped Step Guesthouse");
    await expect(secondRow).not.toContainText("New");

    for (const selector of [
      ".cf3-job-client strong",
      ".cf3-job-current",
      ".cf3-job-started",
    ]) {
      const weights = await Promise.all(
        [firstRow, secondRow].map((row) =>
          row.locator(selector).evaluate((element) => {
            const style = getComputedStyle(element);
            return { fontSize: style.fontSize, fontWeight: style.fontWeight };
          }),
        ),
      );
      expect(weights[0]).toEqual(weights[1]);
    }

    const pillLine = await firstRow.locator(".cf3-job-current").boundingBox();
    const startedLine = await firstRow
      .locator(".cf3-job-started")
      .boundingBox();
    if (!pillLine || !startedLine) throw new Error("job row text is missing");
    expect(startedLine.y).toBeGreaterThanOrEqual(pillLine.y + pillLine.height);
  });

  test("start delivery dialog matches the sketch at desktop and phone sizes", async ({
    page,
  }) => {
    await openCustomerRecord(
      page,
      MELVILLE_PARTY_ID,
      customerFixture({ startDelivery: true }),
      "light",
    );
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByTestId("customer-record-make-client").click();

    const desktopDialog = page.getByTestId("start-delivery-dialog");
    await expect(desktopDialog).toBeVisible();
    await waitForAnimations(page);
    await expect(desktopDialog.getByRole("heading")).toHaveText(
      "Start Delivery?",
    );
    await expect(desktopDialog).toContainText(
      "Melville Manor Guesthouse is a client now.",
    );
    await expect(desktopDialog).not.toContainText(/Proposal/i);
    await expect(
      desktopDialog.getByRole("button", { name: "Close" }),
    ).toHaveCount(0);
    await expect(
      desktopDialog.getByRole("button", {
        name: "Start Delivery",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      desktopDialog.getByRole("button", { name: "Not yet", exact: true }),
    ).toBeVisible();

    const desktopMetrics = await desktopDialog.evaluate((dialog) => {
      const style = getComputedStyle(dialog);
      const rect = dialog.getBoundingClientRect();
      const scout = dialog.querySelector<HTMLElement>(
        '[data-testid="start-delivery-scout-avatar"]',
      );
      const scoutArt = dialog.querySelector<HTMLElement>(
        ".start-delivery-scout-art",
      );
      const rail = dialog.querySelector<HTMLElement>(
        '[data-testid="start-delivery-rail-panel"]',
      );
      const railRow = dialog.querySelector<HTMLElement>(
        ".start-delivery-rail-row",
      );
      const doers = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          '[data-testid^="start-delivery-doer-"]',
        ),
      );
      const stepNumbers = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          '[data-testid^="start-delivery-step-number-"]',
        ),
      );
      const start = dialog.querySelector<HTMLElement>(
        '[data-testid="start-delivery-start"]',
      );
      const notYet = dialog.querySelector<HTMLElement>(
        '[data-testid="start-delivery-not-yet"]',
      );
      const tokenColor = (token: string) => {
        const sample = document.createElement("span");
        sample.style.color = `hsl(var(${token}))`;
        dialog.append(sample);
        const color = getComputedStyle(sample).color;
        sample.remove();
        return color;
      };
      const box = (element: HTMLElement | null) => {
        if (!element) return null;
        const itemRect = element.getBoundingClientRect();
        const itemStyle = getComputedStyle(element);
        return {
          width: itemRect.width,
          height: itemRect.height,
          top: itemRect.top,
          left: itemRect.left,
          right: itemRect.right,
          borderRadius: itemStyle.borderRadius,
        };
      };
      return {
        width: rect.width,
        padding: [
          style.paddingTop,
          style.paddingRight,
          style.paddingBottom,
          style.paddingLeft,
        ],
        borderRadius: style.borderRadius,
        scout: box(scout),
        scoutArt: box(scoutArt),
        scoutBackground: scout ? getComputedStyle(scout).backgroundColor : null,
        railLine: railRow
          ? getComputedStyle(railRow, "::before").backgroundColor
          : null,
        railRadius: rail ? getComputedStyle(rail).borderRadius : null,
        doers: doers.map((doer) => ({
          ...box(doer),
          kind: doer.dataset.doerKind,
          background: getComputedStyle(doer).backgroundColor,
          color: getComputedStyle(doer).color,
        })),
        stepNumberColors: stepNumbers.map(
          (number) => getComputedStyle(number).color,
        ),
        fg: tokenColor("--colony-fg"),
        muted: tokenColor("--colony-muted"),
        approvalDotCount: dialog.querySelectorAll(
          '[data-testid="start-delivery-approval-dot"]',
        ).length,
        launchApprovalDotCount: dialog.querySelectorAll(
          '[data-testid="start-delivery-step-launch"] [data-testid="start-delivery-approval-dot"]',
        ).length,
        start: box(start),
        notYet: box(notYet),
      };
    });

    expect(desktopMetrics.width).toBe(560);
    expect(desktopMetrics.padding).toEqual(["28px", "28px", "28px", "28px"]);
    expect(desktopMetrics.borderRadius).toBe("24px");
    expect(desktopMetrics.scout).toMatchObject({ width: 44, height: 44 });
    expect(desktopMetrics.scoutBackground).toBe("rgb(240, 244, 236)");
    expect(desktopMetrics.scoutArt?.width).toBeCloseTo(44 * 0.72, 1);
    expect(desktopMetrics.scoutArt?.height).toBeCloseTo(44 * 0.72, 1);
    expect(desktopMetrics.railLine).toBe("rgb(217, 207, 245)");
    expect(desktopMetrics.railRadius).toBe("16px");
    expect(desktopMetrics.doers.map((doer) => doer.kind)).toEqual([
      "agent",
      "owner",
      "worker",
      "owner",
      "function",
      "worker",
      "agent",
    ]);
    expect(
      desktopMetrics.doers.every(
        (doer) =>
          doer.width === 40 &&
          doer.height === 40 &&
          doer.borderRadius === "50%",
      ),
    ).toBe(true);
    expect(desktopMetrics.approvalDotCount).toBe(1);
    expect(desktopMetrics.launchApprovalDotCount).toBe(1);
    expect(
      desktopMetrics.doers
        .filter((doer) => doer.kind === "worker")
        .map((doer) => [doer.background, doer.color]),
    ).toEqual([
      ["rgb(224, 216, 229)", "rgb(54, 37, 127)"],
      ["rgb(224, 216, 229)", "rgb(54, 37, 127)"],
    ]);
    expect(desktopMetrics.doers[0]?.background).toBe("rgb(240, 244, 236)");
    expect(desktopMetrics.doers[0]?.width).toBe(40);
    const firstAgentArt = await desktopDialog
      .locator(".start-delivery-avatar")
      .first()
      .evaluate((avatar) => avatar.getBoundingClientRect().width);
    expect(firstAgentArt).toBeCloseTo(40 * 0.72, 1);
    expect(desktopMetrics.stepNumberColors).toEqual([
      desktopMetrics.muted,
      desktopMetrics.fg,
      desktopMetrics.muted,
      desktopMetrics.fg,
      desktopMetrics.muted,
      desktopMetrics.muted,
      desktopMetrics.muted,
    ]);
    await expect(desktopDialog.locator(".start-delivery-sentence")).toHaveText(
      "Scout starts step 1 today. You are needed at 2, 4 and 7.",
    );
    expect(desktopMetrics.start?.height).toBe(48);
    expect(desktopMetrics.notYet?.height).toBe(48);
    expect(desktopMetrics.start?.right).toBeLessThanOrEqual(
      desktopMetrics.notYet?.left ?? 0,
    );
    expect(desktopMetrics.start?.width).toBeGreaterThan(
      desktopMetrics.notYet?.width ?? Number.POSITIVE_INFINITY,
    );

    await desktopDialog.getByRole("button", { name: "Not yet" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const phonePage = await page.context().newPage();
    await phonePage.setViewportSize({ width: 390, height: 844 });
    await openCustomerRecord(
      phonePage,
      MELVILLE_PARTY_ID,
      customerFixture({ startDelivery: true }),
    );
    await phonePage.getByTestId("customer-record-make-client").click();
    const phoneDialog = phonePage.getByTestId("start-delivery-dialog");
    await expect(phoneDialog).toBeVisible();
    await waitForAnimations(phonePage);
    const phoneMetrics = await phoneDialog.evaluate((dialog) => {
      const rect = dialog.getBoundingClientRect();
      const circles = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          '[data-testid^="start-delivery-doer-"]',
        ),
      ).map((circle) => {
        const circleRect = circle.getBoundingClientRect();
        return {
          width: circleRect.width,
          height: circleRect.height,
          top: circleRect.top,
          left: circleRect.left,
          right: circleRect.right,
          bottom: circleRect.bottom,
        };
      });
      const start = dialog.querySelector<HTMLElement>(
        '[data-testid="start-delivery-start"]',
      );
      const notYet = dialog.querySelector<HTMLElement>(
        '[data-testid="start-delivery-not-yet"]',
      );
      return {
        scrollWidth: dialog.scrollWidth,
        clientWidth: dialog.clientWidth,
        bounds: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        },
        rows: dialog.querySelectorAll(".start-delivery-rail-row").length,
        circles,
        startTop: start?.getBoundingClientRect().top,
        notYetTop: notYet?.getBoundingClientRect().top,
      };
    });
    expect(phoneMetrics.scrollWidth).toBe(phoneMetrics.clientWidth);
    expect(phoneMetrics.rows).toBe(1);
    expect(phoneMetrics.circles).toHaveLength(7);
    expect(new Set(phoneMetrics.circles.map((circle) => circle.top)).size).toBe(
      1,
    );
    expect(phoneMetrics.circles.every((circle) => circle.width === 32)).toBe(
      true,
    );
    expect(
      phoneMetrics.circles.every(
        (circle) =>
          circle.left >= phoneMetrics.bounds.left &&
          circle.right <= phoneMetrics.bounds.right &&
          circle.top >= phoneMetrics.bounds.top &&
          circle.bottom <= phoneMetrics.bounds.bottom,
      ),
    ).toBe(true);
    expect(phoneMetrics.startTop).toBe(phoneMetrics.notYetTop);
    await phoneDialog.getByRole("button", { name: "Not yet" }).click();
    await expect(phonePage.getByRole("dialog")).toHaveCount(0);
    await phonePage.close();
  });

  test("agent photos fill the Scout circles", async ({ page }) => {
    const photoUrl = `data:image/svg+xml,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="#ff0000"/></svg>',
    )}`;
    await page.setViewportSize({ width: 1440, height: 900 });
    await openCustomerRecord(
      page,
      MELVILLE_PARTY_ID,
      customerFixture({
        startDelivery: true,
        managedAgents: [
          {
            pubkey: TEST_IDENTITIES.alice.pubkey,
            name: "Scout",
            personaId: "builtin:fizz",
            avatarUrl: photoUrl,
            status: "running",
            channelNames: ["general"],
          },
        ],
      }),
      "light",
    );
    await page.getByTestId("customer-record-make-client").click();
    const dialog = page.getByTestId("start-delivery-dialog");
    await expect(dialog).toBeVisible();
    await waitForAnimations(page);
    const headerAvatar = dialog.locator(".start-delivery-scout-art");
    await expect(headerAvatar).toHaveClass(/is-photo/u);
    const headerSize = await headerAvatar.evaluate((avatar) => {
      const { width, height } = avatar.getBoundingClientRect();
      return { width, height };
    });
    expect(headerSize).toEqual({ width: 44, height: 44 });
    const stepAvatars = dialog.locator(".start-delivery-avatar");
    await expect(stepAvatars).toHaveCount(2);
    await expect(stepAvatars.first()).toHaveClass(/is-photo/u);
    const stepSizes = await stepAvatars.evaluateAll((avatars) =>
      avatars.map((avatar) => {
        const { width, height } = avatar.getBoundingClientRect();
        return { width, height };
      }),
    );
    expect(stepSizes).toEqual([
      { width: 40, height: 40 },
      { width: 40, height: 40 },
    ]);
  });

  test("a 12-step delivery dialog wraps within desktop and phone widths", async ({
    page,
  }) => {
    const viewports = [
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ];

    for (const viewport of viewports) {
      const responsivePage = await page.context().newPage();
      await responsivePage.setViewportSize(viewport);
      await openCustomerRecord(
        responsivePage,
        MELVILLE_PARTY_ID,
        customerFixture({ startDelivery: true, playbookStepCount: 12 }),
      );

      await responsivePage.getByTestId("customer-record-make-client").click();
      const dialog = responsivePage.getByTestId("start-delivery-dialog");
      await expect(dialog).toBeVisible();
      await waitForAnimations(responsivePage);
      await expect(dialog.getByRole("heading")).toHaveText("Start Delivery?");
      const steps = dialog.locator("li.start-delivery-rail-step");
      await expect(steps).toHaveCount(12);
      const accessibleSteps = await steps.evaluateAll((items) =>
        items.map((item) => ({
          label: item.getAttribute("aria-label"),
          title: item.getAttribute("title"),
        })),
      );
      expect(accessibleSteps.every(({ label, title }) => label === title)).toBe(
        true,
      );
      expect(
        accessibleSteps.every(({ label }) => label?.startsWith("Step ")),
      ).toBe(true);
      await expect(dialog.locator(".start-delivery-rail-row")).toHaveCount(2);
      await expect(
        dialog.locator(".start-delivery-rail-row").nth(0).locator("li"),
      ).toHaveCount(7);
      await expect(
        dialog.locator(".start-delivery-rail-row").nth(1).locator("li"),
      ).toHaveCount(5);

      const geometry = await dialog.evaluate((element) => {
        const dialogRect = element.getBoundingClientRect();
        const circles = element.querySelectorAll<HTMLElement>(
          '[data-testid^="start-delivery-doer-"]',
        );
        return {
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          dialog: {
            left: dialogRect.left,
            top: dialogRect.top,
            right: dialogRect.right,
            bottom: dialogRect.bottom,
          },
          circles: Array.from(circles, (circle) => {
            const rect = circle.getBoundingClientRect();
            return {
              width: rect.width,
              height: rect.height,
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
            };
          }),
        };
      });

      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
      expect(geometry.circles).toHaveLength(12);
      expect(
        geometry.circles.every(
          (circle) =>
            circle.width === (viewport.width <= 480 ? 32 : 40) &&
            circle.height === (viewport.width <= 480 ? 32 : 40) &&
            circle.top >= geometry.dialog.top &&
            circle.bottom <= geometry.dialog.bottom,
        ),
      ).toBe(true);
      expect(
        new Set(geometry.circles.map((circle) => circle.top)).size,
      ).toBeGreaterThan(1);
      for (const circle of geometry.circles) {
        expect(circle.left).toBeGreaterThanOrEqual(geometry.dialog.left);
        expect(circle.top).toBeGreaterThanOrEqual(geometry.dialog.top);
        expect(circle.right).toBeLessThanOrEqual(geometry.dialog.right);
        expect(circle.bottom).toBeLessThanOrEqual(geometry.dialog.bottom);
      }

      await dialog.getByRole("button", { name: "Not yet" }).click();
      await expect(responsivePage.getByRole("dialog")).toHaveCount(0);
      await responsivePage.close();
    }
  });

  test("Not yet leaves a way to start delivery from the client record", async ({
    page,
  }) => {
    await openCustomerRecord(
      page,
      MELVILLE_PARTY_ID,
      customerFixture({ startDelivery: true }),
    );

    await page.getByTestId("customer-record-make-client").click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Not yet" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await expect(
      page.locator(".cf-customer-status-row .b3-pill-status"),
    ).toContainText("Client");
    const startDelivery = page.getByTestId("customer-record-start-delivery");
    await expect(startDelivery).toBeVisible();
    await startDelivery.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("heading")).toHaveText("Start Delivery?");
  });

  test("a member sales lead can convert without a delivery prompt or button", async ({
    page,
  }) => {
    await installMockBridge(
      page,
      customerFixture({
        role: "member",
        startDelivery: true,
        companyFunctionHeads: [
          {
            function: "sales",
            state: "filled",
            leadPubkey: OWNER_PUBKEY,
          },
        ],
      }),
    );
    await page.goto("/#/leads");

    const row = page
      .getByRole("table", { name: "Leads" })
      .getByRole("row")
      .filter({ hasText: "Melville Manor Guesthouse" });
    await row.getByRole("link", { name: "Review lead" }).click();
    const detail = page.getByTestId("w10-prospect-page");
    const convert = detail.getByTestId(`lead-make-client-${MELVILLE_PARTY_ID}`);
    await convert.click();
    await expect(convert).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await detail.getByRole("link", { name: "Customer record" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/clients/record/${MELVILLE_PARTY_ID}$`),
    );
    await expect(
      page.getByTestId("customer-record-start-delivery"),
    ).toHaveCount(0);
  });

  test("a client with a running delivery job has no start delivery button", async ({
    page,
  }) => {
    await openCustomerRecord(
      page,
      MELVILLE_PARTY_ID,
      customerFixture({
        startDelivery: true,
        clientMelville: true,
        duplicateMelvilleJob: true,
      }),
    );

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByTestId("customer-record-start-delivery"),
    ).toHaveCount(0);
  });

  test("lead detail offers to start delivery after making a client", async ({
    page,
  }) => {
    await installMockBridge(page, customerFixture({ startDelivery: true }));
    await page.goto("/#/leads");

    const row = page
      .getByRole("table", { name: "Leads" })
      .getByRole("row")
      .filter({ hasText: "Melville Manor Guesthouse" });
    await row.getByRole("link", { name: "Review lead" }).click();
    const detail = page.getByTestId("w10-prospect-page");
    await detail.getByTestId(`lead-make-client-${MELVILLE_PARTY_ID}`).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "Start Delivery", exact: true })
      .click();
    await expect(page).toHaveURL(/\/company\/function\/operations$/);
    const startedJob = page
      .locator('[data-testid^="playbook-job-"]')
      .filter({ hasText: "Melville Manor Guesthouse" });
    await expect(startedJob).toContainText("1 of 7");
  });

  test("captures start delivery states at desktop and phone sizes in light and dark", async ({
    page,
  }) => {
    test.skip(
      process.env.COLONY_START_DELIVERY_CAPTURE !== "1",
      "capture is requested for proof delivery",
    );
    const output = resolve("/private/tmp/colony-start-delivery/screenshots");
    const compareOutput = resolve("/private/tmp/colony-start-delivery/compare");
    mkdirSync(output, { recursive: true });
    mkdirSync(compareOutput, { recursive: true });
    const themes = ["light", "dark"] as const;
    const viewports = [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ];

    for (const theme of themes) {
      for (const viewport of viewports) {
        const size = `${viewport.width}x${viewport.height}`;
        const clientPage = await page.context().newPage();
        await clientPage.setViewportSize(viewport);
        await openCustomerRecord(
          clientPage,
          MELVILLE_PARTY_ID,
          customerFixture({ startDelivery: true, clientMelville: true }),
          theme,
        );
        await expect(
          clientPage.getByTestId("customer-record-start-delivery"),
        ).toBeVisible();
        await waitForAnimations(clientPage);
        await clientPage.screenshot({
          path: resolve(output, `client-record-${theme}-${size}.png`),
        });
        await clientPage.close();

        const flowPage = await page.context().newPage();
        await flowPage.setViewportSize(viewport);
        await openCustomerRecord(
          flowPage,
          MELVILLE_PARTY_ID,
          customerFixture({ startDelivery: true }),
          theme,
        );
        await flowPage.getByTestId("customer-record-make-client").click();
        const startDialog = flowPage.getByRole("dialog");
        await expect(startDialog).toBeVisible();
        await expect(startDialog.getByRole("heading")).toHaveText(
          "Start Delivery?",
        );
        await expect(
          startDialog.locator("li.start-delivery-rail-step"),
        ).toHaveCount(7);
        await waitForAnimations(flowPage);
        await flowPage.screenshot({
          path: resolve(output, `start-dialog-${theme}-${size}.png`),
        });
        if (theme === "light" && viewport.width === 1440) {
          const dialogBox = await startDialog.boundingBox();
          if (!dialogBox) throw new Error("start delivery dialog is missing");
          await flowPage.screenshot({
            path: resolve(compareOutput, "dialog-built-crop.png"),
            clip: dialogBox,
          });
        }
        await startDialog
          .getByRole("button", { name: "Start Delivery", exact: true })
          .click();
        await expect(flowPage).toHaveURL(/\/company\/function\/operations$/);
        const jobsHeading = flowPage.getByRole("heading", {
          name: "Jobs on this playbook",
        });
        await jobsHeading.scrollIntoViewIfNeeded();
        const startedJob = flowPage
          .locator('[data-testid^="playbook-job-"]')
          .filter({ hasText: "Melville Manor Guesthouse" });
        const firstJob = flowPage
          .locator('[data-testid^="playbook-job-"]')
          .first();
        await expect(firstJob).toContainText("Melville Manor Guesthouse");
        await expect(startedJob).toContainText("1 of 7");
        await expect(startedJob).toContainText("New");
        await expect(startedJob).toContainText("Started today");
        await waitForAnimations(flowPage);
        await flowPage.screenshot({
          path: resolve(output, `playbook-after-start-${theme}-${size}.png`),
        });
        if (theme === "light" && viewport.width === 1440) {
          const jobsCard = jobsHeading.locator("xpath=ancestor::section[1]");
          const jobsCardBox = await jobsCard.boundingBox();
          if (!jobsCardBox) throw new Error("playbook jobs card is missing");
          const visibleHeight = viewport.height - jobsCardBox.y;
          if (visibleHeight <= 0) {
            throw new Error("playbook jobs card is outside the viewport");
          }
          await flowPage.screenshot({
            path: resolve(compareOutput, "jobs-built-crop.png"),
            clip: {
              x: jobsCardBox.x,
              y: jobsCardBox.y,
              width: jobsCardBox.width,
              height: Math.min(382, visibleHeight),
            },
          });
        }
        await flowPage.close();
      }
    }
  });

  test("owner opens a client record from Today and returns to Clients", async ({
    page,
  }) => {
    await installMockBridge(
      page,
      customerFixture({ whatsappGuesthouses: false }),
    );
    await page.goto("/#/today");

    await page.getByTestId("sidebar-nav-business").click();
    await page.getByTestId("sidebar-business-clients").click();
    await expect(page.getByRole("table", { name: "Clients" })).toContainText(
      "The Olive House",
    );
    await page.getByRole("link", { name: "The Olive House" }).click();

    await expect(page).toHaveURL(
      new RegExp(`/clients/record/${OLIVE_PARTY_ID}$`),
    );
    await expect(
      page.getByRole("heading", { name: "The Olive House", exact: true }),
    ).toBeVisible();
    await page
      .getByTestId("app-top-chrome")
      .getByRole("button", { name: "Clients", exact: true })
      .click();
    await expect(page).toHaveURL(/\/clients$/);
  });

  test("Make client keeps every lead timeline entry", async ({ page }) => {
    await installMockBridge(page, customerFixture());
    await page.goto("/#/leads");

    const row = page
      .getByRole("table", { name: "Leads" })
      .getByRole("row")
      .filter({ hasText: "Melville Manor Guesthouse" });
    await row.getByRole("link", { name: "Review lead" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/sales/lead/${MELVILLE_PARTY_ID}$`),
    );
    const detail = page.getByTestId("w10-prospect-page");
    const convert = detail.getByTestId(`lead-make-client-${MELVILLE_PARTY_ID}`);
    await expect(convert).toBeVisible();
    await convert.click();
    await expect(convert).toHaveCount(0);
    await detail.getByRole("link", { name: "Customer record" }).click();

    const customerTrail = page.locator(
      "nav.b3-trail[data-testid='top-bar-breadcrumb']",
    );
    await expect(customerTrail).toContainText(
      "Business/Sales/Leads/Melville Manor Guesthouse/Customer record",
    );
    await customerTrail
      .getByRole("button", { name: "Melville Manor Guesthouse", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/sales/lead/${MELVILLE_PARTY_ID}$`),
    );
    await detail.getByRole("link", { name: "Customer record" }).click();
    await expect(page.getByTestId("customer-record-screen")).toBeVisible();

    const timeline = page
      .getByTestId("customer-record-screen")
      .locator("ol li");
    await expect(timeline).toHaveCount(3);
    await expect(timeline.nth(0)).toContainText("Found in Discovery");
    await expect(timeline.nth(1)).toContainText("WhatsApp opener approved");
    await expect(timeline.nth(2)).toContainText("Became a client");
  });

  test("a manually added lead keeps truthful history and appears as one client after conversion", async ({
    page,
  }) => {
    await installMockBridge(page, customerFixture({ manualMelville: true }));
    await page.goto("/#/leads");

    const leads = page.getByRole("table", { name: "Leads" });
    const lead = leads.getByRole("row").filter({
      hasText: "Melville Manor Guesthouse",
    });
    const reviewLeadLink = lead.getByRole("link", {
      name: "Review lead",
    });
    await expect(reviewLeadLink).toBeVisible();
    await reviewLeadLink.click();
    await expect(page).toHaveURL(
      new RegExp(`/sales/lead/${MELVILLE_PARTY_ID}$`),
    );

    const customerRecordLink = page
      .getByTestId("w10-prospect-page")
      .getByRole("link", {
        name: "Customer record",
      });
    await expect(customerRecordLink).toBeVisible();
    await customerRecordLink.click();
    await expect(page).toHaveURL(
      new RegExp(`/clients/record/${MELVILLE_PARTY_ID}$`),
    );

    const timeline = page
      .getByTestId("customer-record-screen")
      .locator("ol li");
    await expect(timeline).not.toContainText("Found in Discovery");

    await page.goto("/#/leads");
    const leadToConvert = page
      .getByRole("table", { name: "Leads" })
      .getByRole("row")
      .filter({ hasText: "Melville Manor Guesthouse" });
    await leadToConvert.getByRole("link", { name: "Review lead" }).click();
    const leadDetail = page.getByTestId("w10-prospect-page");
    const convert = leadDetail.getByTestId(
      `lead-make-client-${MELVILLE_PARTY_ID}`,
    );
    await convert.click();
    await expect(convert).toHaveCount(0);

    await page.goto("/#/leads");
    const leadsPage = page.getByTestId("w10-leads-page");
    await leadsPage
      .getByRole("button", { name: "Remove phone number filter" })
      .click();
    await leadsPage
      .getByRole("button", { name: "Remove WhatsApp filter" })
      .click();
    await leadsPage
      .getByRole("button", { name: "Remove stage filter: New" })
      .click();
    const convertedLead = leadsPage
      .getByRole("table", { name: "Leads" })
      .getByRole("row")
      .filter({ hasText: "Melville Manor Guesthouse" });
    await expect.soft(convertedLead).toContainText("Client");

    await page.goto("/#/clients");
    const client = page.getByTestId(`client-row-${MELVILLE_PARTY_ID}`);
    await expect.soft(client).toContainText("Melville Manor Guesthouse");
    await expect
      .soft(page.getByRole("table", { name: "Clients" }).locator("tbody tr"))
      .toHaveCount(3);
    if ((await client.count()) > 0) {
      await client
        .getByRole("link", { name: "Melville Manor Guesthouse" })
        .click();
      await expect(page).toHaveURL(
        new RegExp(`/clients/record/${MELVILLE_PARTY_ID}$`),
      );
      await expect(
        page
          .getByTestId("customer-record-screen")
          .locator("ol li")
          .filter({ hasText: "Became a client" }),
      ).toContainText("Became a client");
    }
  });

  test("a Sales lead can convert a lead while still a plain member", async ({
    page,
  }) => {
    await installMockBridge(
      page,
      customerFixture({
        role: "member",
        companyFunctionHeads: [
          {
            function: "sales",
            state: "filled",
            leadPubkey: OWNER_PUBKEY,
          },
        ],
      }),
    );
    await page.goto("/#/leads");

    const row = page
      .getByRole("table", { name: "Leads" })
      .getByRole("row")
      .filter({ hasText: "Melville Manor Guesthouse" });
    await row.getByRole("link", { name: "Review lead" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/sales/lead/${MELVILLE_PARTY_ID}$`),
    );
    const detail = page.getByTestId("w10-prospect-page");
    const convert = detail.getByTestId(`lead-make-client-${MELVILLE_PARTY_ID}`);
    await expect(convert).toBeVisible();
    await convert.click();
    await expect(convert).toHaveCount(0);
    await detail.getByRole("link", { name: "Customer record" }).click();
    await expect(
      page.getByTestId("customer-record-screen").locator("ol li"),
    ).toHaveCount(3);
  });

  test("unknown money is shown as a dash", async ({ page }) => {
    await openCustomerRecord(page, MELVILLE_PARTY_ID);
    const money = page.locator('[aria-labelledby="customer-money-title"]');
    await expect(money.getByRole("heading", { name: "Money" })).toBeVisible();
    await expect(money.locator("dd")).toHaveText(["-", "-", "-"]);
  });

  test("a plain member sees the record without write actions", async ({
    page,
  }) => {
    await openCustomerRecord(
      page,
      MELVILLE_PARTY_ID,
      customerFixture({ role: "member" }),
    );

    await expect(
      page.getByRole("heading", { name: "Melville Manor Guesthouse" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Make client" })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Record milestone" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Attach file" })).toHaveCount(
      0,
    );
  });

  test("a Customer Success lead can edit but cannot convert a lead", async ({
    page,
  }) => {
    await openCustomerRecord(
      page,
      MELVILLE_PARTY_ID,
      customerFixture({
        role: "member",
        companyFunctionHeads: [
          {
            function: "customer_success",
            state: "filled",
            leadPubkey: OWNER_PUBKEY,
          },
        ],
      }),
    );

    await expect(
      page.getByRole("button", { name: "Record milestone" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Make client" })).toHaveCount(
      0,
    );
    const timeline = page
      .getByTestId("customer-record-screen")
      .locator("ol li");
    await expect(timeline).toHaveCount(2);
    await page.getByRole("button", { name: "Record milestone" }).click();
    await page.getByRole("button", { name: "Save milestone" }).click();
    await expect(timeline).toHaveCount(3);
  });

  test("Scout can edit a record without conversion authority", async ({
    page,
  }) => {
    await openCustomerRecord(
      page,
      MELVILLE_PARTY_ID,
      customerFixture({
        role: "member",
        managedAgents: [
          {
            pubkey: OWNER_PUBKEY,
            name: "Scout",
            personaId: "builtin:fizz",
          },
        ],
      }),
    );

    await expect(
      page.getByRole("button", { name: "Record milestone" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Make client" })).toHaveCount(
      0,
    );
    const timeline = page
      .getByTestId("customer-record-screen")
      .locator("ol li");
    await expect(timeline).toHaveCount(2);
    await page.getByRole("button", { name: "Record milestone" }).click();
    await page.getByRole("button", { name: "Save milestone" }).click();
    await expect(timeline).toHaveCount(3);
  });

  test("co-founder customer entry points stay hidden when mode is off", async ({
    page,
  }) => {
    await installMockBridge(page, customerFixture({ enabled: false }));
    await page.goto("/#/leads");
    await expect(
      page.getByRole("link", { name: "Customer record" }),
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Make client" })).toHaveCount(
      0,
    );

    await page.goto(`/#/clients/record/${PLANE_TREE_PARTY_ID}`);
    await expect(page).toHaveURL(/\/clients$/);
    await expect(page.getByTestId("customer-record-screen")).toHaveCount(0);
  });

  test("missing customer records have an empty state", async ({ page }) => {
    await installMockBridge(page, customerFixture());
    await page.goto(`/#/clients/record/${EMPTY_PARTY_ID}`);
    await expect(page.getByTestId("customer-record-empty")).toContainText(
      "No customer record yet",
    );
    await expect(
      page.getByRole("button", { name: "Create record" }),
    ).toBeVisible();
  });

  test("stale head conflicts show the relay error and a retry", async ({
    page,
  }) => {
    const conflict = `conflict: customer record changed; current head is ${"c".repeat(64)}`;
    await openCustomerRecord(
      page,
      PLANE_TREE_PARTY_ID,
      customerFixture({ customerActionErrors: [conflict] }),
    );
    await page.getByRole("button", { name: "Record milestone" }).click();
    await page.getByRole("button", { name: "Save milestone" }).click();

    const alert = page.getByRole("alert").filter({ hasText: conflict });
    await expect(alert).toContainText(conflict);
    await alert.getByRole("button", { name: "Try again" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: conflict }),
    ).toHaveCount(0);
  });

  test("a refused file action is shown as a plain message", async ({
    page,
  }) => {
    const refusal = "restricted: only the record owner can attach this file";
    await openCustomerRecord(
      page,
      PLANE_TREE_PARTY_ID,
      customerFixture({ customerActionErrors: [refusal] }),
    );
    await page.getByRole("button", { name: "Attach file" }).first().click();
    await page.getByLabel("File name").fill("Launch assets");
    await page
      .getByLabel("Blossom file reference")
      .fill("blossom:sha256:launch-assets");
    await page.getByRole("button", { name: "Attach file" }).last().click();

    await expect(
      page.getByRole("alert").filter({ hasText: refusal }),
    ).toContainText(refusal);
  });

  test("an authorized owner can record a milestone and attach a file", async ({
    page,
  }) => {
    await openCustomerRecord(page, PLANE_TREE_PARTY_ID);
    const timeline = page
      .getByTestId("customer-record-screen")
      .locator("ol li");
    await expect(timeline).toHaveCount(18);

    await page.getByRole("button", { name: "Record milestone" }).click();
    await page.getByRole("button", { name: "Save milestone" }).click();
    await expect(timeline).toHaveCount(19);

    await page.getByRole("button", { name: "Attach file" }).first().click();
    await page.getByLabel("File name").fill("Launch assets");
    await page
      .getByLabel("Blossom file reference")
      .fill("blossom:sha256:launch-assets");
    await page.getByRole("button", { name: "Attach file" }).last().click();
    await expect(
      page.locator(".cf-customer-file-row").getByText("Launch assets"),
    ).toBeVisible();
  });

  test("Open chat selects the WhatsApp work area for this contact", async ({
    page,
  }) => {
    await openCustomerRecord(page, PLANE_TREE_PARTY_ID);
    await page.getByRole("button", { name: "Open chat" }).click();

    await expect(page).toHaveURL(/whatsappContactWaId=%2227825557135%22/);
    await expect(
      page.getByRole("tab", { name: "WhatsApp chats" }),
    ).toHaveAttribute("aria-selected", "true");
  });

  test("captures the record at desktop and phone widths", async ({ page }) => {
    test.skip(
      process.env.COF4_CAPTURE !== "1",
      "capture is requested for proof delivery",
    );
    const theme = process.env.COLONY3_PROOF_THEME === "dark" ? "dark" : "light";
    const output = resolve("/private/tmp/cof-ui-defects-proof/screenshots");
    mkdirSync(output, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 960 });
    await openCustomerRecord(
      page,
      MELVILLE_PARTY_ID,
      customerFixture({ manualMelville: true }),
      theme,
    );
    await expect(
      page.getByRole("heading", { name: "Melville Manor Guesthouse" }),
    ).toBeVisible();
    await expect(
      page.getByTestId("customer-record-screen").locator("ol li"),
    ).not.toContainText("Found in Discovery");
    await waitForAnimations(page);
    await page.screenshot({
      path: resolve(output, `c9-manual-record-1440-${theme}.png`),
      fullPage: true,
    });

    await page.goto("/#/leads");
    const lead = page
      .getByRole("table", { name: "Leads" })
      .getByRole("row")
      .filter({ hasText: "Melville Manor Guesthouse" });
    await lead.getByTestId(`lead-make-client-${MELVILLE_PARTY_ID}`).click();
    await expect(lead).toContainText("Client");
    await page.getByRole("combobox", { name: "Stage" }).selectOption("client");
    await expect(lead).toBeVisible();
    await lead.scrollIntoViewIfNeeded();
    await waitForAnimations(page);
    await page.screenshot({
      path: resolve(output, `c9-leads-client-1440-${theme}.png`),
      fullPage: true,
    });

    await page.goto("/#/clients");
    const client = page.getByTestId(`client-row-${MELVILLE_PARTY_ID}`);
    await expect(client).toContainText("Melville Manor Guesthouse");
    await client.scrollIntoViewIfNeeded();
    await waitForAnimations(page);
    await page.screenshot({
      path: resolve(output, `c9-clients-row-1440-${theme}.png`),
      fullPage: true,
    });
    await client
      .getByRole("link", { name: "Melville Manor Guesthouse" })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/clients/record/${MELVILLE_PARTY_ID}$`),
    );
    await expect(
      page
        .getByTestId("customer-record-screen")
        .locator("ol li")
        .filter({ hasText: "Became a client" }),
    ).toBeVisible();
    await waitForAnimations(page);
    await page.screenshot({
      path: resolve(output, `c9-converted-record-1440-${theme}.png`),
      fullPage: true,
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await waitForAnimations(page);
    await page.screenshot({
      path: resolve(output, `c9-converted-record-390-${theme}.png`),
      fullPage: true,
    });
    await page.goto("/#/leads");
    await page.getByRole("combobox", { name: "Stage" }).selectOption("client");
    await expect(
      page
        .getByRole("table", { name: "Leads" })
        .getByRole("row")
        .filter({ hasText: "Melville Manor Guesthouse" }),
    ).toContainText("Client");
    await waitForAnimations(page);
    await page.screenshot({
      path: resolve(output, `c9-leads-client-390-${theme}.png`),
      fullPage: true,
    });
    await page.goto("/#/clients");
    await expect(
      page.getByTestId(`client-row-${MELVILLE_PARTY_ID}`),
    ).toContainText("Melville Manor Guesthouse");
    await waitForAnimations(page);
    await page.screenshot({
      path: resolve(output, `c9-clients-row-390-${theme}.png`),
      fullPage: true,
    });
  });
});
