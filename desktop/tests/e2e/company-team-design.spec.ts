import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import { KIND_MEMBER_POSITION_HEAD } from "../../src/shared/constants/kinds";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";

for (const viewport of [
  { width: 1728, height: 1117 },
  { width: 1440, height: 900 },
]) {
  test(`Team reference layout and status at ${viewport.width}`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const relaySecret = generateSecretKey();
    const employeePubkey = getPublicKey(generateSecretKey());
    const owner = TEST_IDENTITIES.tyler.pubkey;
    const employee = {
      pubkey: employeePubkey,
      name: "Mina",
      title: "Social Media Manager",
    };
    const people = [
      { pubkey: owner, name: "Lerato Molefe", title: "Founder", kind: "human" },
      { ...employee, kind: "employee", managerPubkey: owner },
      {
        pubkey: TEST_IDENTITIES.alice.pubkey,
        name: "Noluthando Khumalo",
        title: "Account Manager",
        kind: "human",
        managerPubkey: employeePubkey,
      },
      {
        pubkey: getPublicKey(generateSecretKey()),
        name: "Noor",
        title: "Bookkeeper",
        kind: "employee",
        managerPubkey: owner,
      },
      {
        pubkey: getPublicKey(generateSecretKey()),
        name: "Aya",
        title: "Business Development",
        kind: "employee",
        managerPubkey: owner,
      },
      {
        pubkey: getPublicKey(generateSecretKey()),
        name: "Theo",
        title: "Software Engineer",
        kind: "employee",
        managerPubkey: owner,
      },
      {
        pubkey: TEST_IDENTITIES.bob.pubkey,
        name: "Sam Patel",
        title: "Designer",
        kind: "human",
        managerPubkey: employeePubkey,
      },
      {
        pubkey: TEST_IDENTITIES.charlie.pubkey,
        name: "Jules Adams",
        title: "Client Partner",
        kind: "human",
        managerPubkey: owner,
      },
    ] as const;
    await page.addInitScript((identity) => {
      localStorage.setItem(
        "buzz:e2e-identity-override.v1",
        JSON.stringify(identity),
      );
    }, TEST_IDENTITIES.tyler);
    await installMockBridge(page, {
      relaySelf: getPublicKey(relaySecret),
      searchProfiles: people.map((person) => ({
        pubkey: person.pubkey,
        displayName: person.name,
      })),
      relayMembers: people
        .filter((person) => person.kind === "human")
        .map((person) => ({
          pubkey: person.pubkey,
          role: person.pubkey === owner ? "owner" : "member",
        })),
      relayAgents: people
        .filter((person) => person.kind === "employee")
        .map((person) => ({
          pubkey: person.pubkey,
          ownerPubkey: owner,
          name: person.name,
          agentType: "agent",
        })),
      managedAgents: [
        {
          pubkey: employeePubkey,
          name: employee.name,
          status: "running",
          channelNames: ["general"],
        },
      ],
      companyMemberPositionEvents: people.map((person) =>
        finalizeEvent(
          {
            kind: KIND_MEMBER_POSITION_HEAD,
            created_at: Math.floor(Date.now() / 1000),
            tags: [["d", `company:member:${person.pubkey}`]],
            content: JSON.stringify({
              schemaVersion: 1,
              pubkey: person.pubkey,
              title: person.title,
              kind: person.kind,
              status: person.pubkey === employeePubkey ? "paused" : "active",
              ...(person.pubkey === employeePubkey
                ? { reason: "Reviewing the workload." }
                : {}),
              ...("managerPubkey" in person
                ? { managerPubkey: person.managerPubkey }
                : {}),
              sourceActionEventId: "b".repeat(64),
              updatedAt: new Date().toISOString(),
            }),
          },
          relaySecret,
        ),
      ),
    });
    const dir = "output/playwright/company-design";
    mkdirSync(dir, { recursive: true });
    async function capture(name: string) {
      await waitForAnimations(page);
      await page.screenshot({
        path: `${dir}/app-${name}-${viewport.width}-${testInfo.project.name}.png`,
      });
    }
    await page.goto("/#/team");
    const team = page.getByTestId("company-team-screen");
    await expect(team).toBeVisible();
    await expect(team.locator("header")).toHaveText("Company / Team");
    await expect(
      team.getByRole("button", { name: "Hire employee" }),
    ).toBeVisible();
    const row = page.getByTestId(`company-team-member-${employeePubkey}`);
    await expect(row).toContainText("Social Media Manager · Employee");
    await expect(row).toContainText("Reports to Lerato Molefe");
    await expect(row.locator("span").filter({ hasText: /^Ready$/ })).toHaveCSS(
      "text-transform",
      "none",
    );
    await expect(
      page.getByTestId(`company-team-member-${owner}`),
    ).toContainText("Founder · Human");
    const bounds = await row.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(70);
    expect(bounds?.height).toBeLessThanOrEqual(80);
    expect(bounds?.width).toBeGreaterThan(850);
    await capture("team");
    await team.getByRole("tab", { name: "Reporting lines" }).click();
    const items = page.getByRole("treeitem");
    await expect(items).toHaveCount(8);
    await items.first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(items.nth(1)).toBeFocused();
    await team.getByRole("heading", { name: "Team", exact: true }).click();
    await capture("team-org");
    await page.goto(`/#/team/detail/${employeePubkey}`);
    await expect(page.getByTestId("company-employee-profile")).toBeVisible();
    await expect(
      page.getByTestId("employee-salary-overview-unavailable"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("company-employee-direct-reports"),
    ).toContainText("Noluthando");
    await expect(page.getByTestId("company-paused-banner")).toBeVisible();
    await page.getByRole("tab", { name: "Instructions", exact: true }).click();
    await expect(page.getByTestId("company-paused-banner")).toHaveCount(0);
    await page.getByRole("tab", { name: "Overview", exact: true }).click();
    await capture("team-detail-mina");
    await page.goto(`/#/team/edit/${employeePubkey}`);
    await expect(page.getByLabel("Title")).toHaveValue(employee.title);
    await expect(
      page
        .getByLabel("Reports to")
        .locator(`option[value="${TEST_IDENTITIES.alice.pubkey}"]`),
    ).toHaveCount(0);
    await capture("team-edit-mina");
    await page.goto(`/#/team/edit/${TEST_IDENTITIES.alice.pubkey}`);
    await expect(page.getByLabel("Reports to")).toHaveValue(employeePubkey);
    await expect(
      page.getByLabel("Reports to").locator("option:checked"),
    ).toHaveText("Mina · Employee, paused");
    await expect(
      page.getByLabel("Reports to").locator("option:checked"),
    ).toBeDisabled();
    await capture("team-edit-paused-manager");
    await page.goto(`/#/team/archive/${employeePubkey}`);
    await expect(page.getByLabel("Reason")).toBeVisible();
    await expect(
      page.getByText("This cannot be undone from this screen.", {
        exact: false,
      }),
    ).toBeVisible();
    await capture("team-terminate-mina");
    await page.goto(`/#/team/pause/${employeePubkey}`);
    await expect(
      page.getByText("Pausing employees is unavailable."),
    ).toBeVisible();
    await expect(page.getByLabel("Reason")).toHaveCount(0);
    await capture("team-pause-unavailable-mina");
    await page.goto(`/#/team/detail/${TEST_IDENTITIES.alice.pubkey}`);
    await expect(page.getByTestId("company-team-member-profile")).toBeVisible();
    const overview = page.getByRole("tab", { name: "Overview", exact: true });
    await overview.focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("tab", { name: "History", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(overview).toBeFocused();
    await capture("team-detail-noluthando");
  });
}

test("Team does not infer an employee position from its running runtime", async ({
  page,
}) => {
  const employeePubkey = getPublicKey(generateSecretKey());
  await installMockBridge(page, {
    relaySelf: getPublicKey(generateSecretKey()),
    companyMemberPositionEvents: [],
    relayAgents: [
      {
        pubkey: employeePubkey,
        ownerPubkey: TEST_IDENTITIES.tyler.pubkey,
        name: "Unconfigured employee",
        agentType: "agent",
      },
    ],
    managedAgents: [
      {
        pubkey: employeePubkey,
        name: "Unconfigured employee",
        status: "running",
        channelNames: ["general"],
      },
    ],
  });
  await page.goto("/#/team");
  const row = page.getByTestId(`company-team-member-${employeePubkey}`);
  await expect(row).toBeVisible();
  await expect(row).toContainText("Ready");
  await expect(row).not.toContainText("active");
  for (const viewport of [
    { width: 1728, height: 1117 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await waitForAnimations(page);
    await page.screenshot({
      path: `output/playwright/company-design/app-team-unknown-${viewport.width}-${test.info().project.name}.png`,
    });
  }
  await row.click();
  const profile = page.getByTestId("company-employee-profile");
  await expect(profile).toBeVisible();
  await expect(page.getByTestId("company-position-header")).toContainText(
    "Employee · Ready",
  );
  await expect(page.getByTestId("company-terminated-banner")).toHaveCount(0);
  await expect(
    profile.getByRole("button", { name: "Pause employee", exact: true }),
  ).toHaveCount(0);
  await expect(
    profile.getByRole("button", { name: "Terminate employee", exact: true }),
  ).toHaveCount(0);
  await expect(
    profile.getByRole("button", {
      name: "Edit role and reporting",
      exact: true,
    }),
  ).toBeVisible();
  await expect(profile).toContainText("Reporting line not set");
  for (const viewport of [
    { width: 1728, height: 1117 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await waitForAnimations(page);
    await page.screenshot({
      path: `output/playwright/company-design/app-team-profile-unknown-${viewport.width}-${test.info().project.name}.png`,
    });
  }
});

for (const state of [
  "loading",
  "failed",
  "denied",
  "missing-position",
] as const) {
  test(`Team frames ${state} records and keeps recovery visible`, async ({
    page,
  }, testInfo) => {
    const { setup } = await import("../helpers/companyTeamFixture");
    const { minaPk } = await setup(page, {
      ...(state === "loading" ? { relaySelf: "delay" as const } : {}),
      ...(state === "failed" ? { relaySelf: "null" as const } : {}),
      ...(state === "denied" ? { identity: "alice" as const } : {}),
      ...(state === "missing-position" ? { noPositions: true } : {}),
    });
    if (state === "missing-position") {
      await page.goto(`/#/team/detail/${TEST_IDENTITIES.bob.pubkey}`);
      await expect(page.getByTestId("company-human-role")).toContainText(
        "Reporting line not set",
      );
      await expect(page.getByTestId("company-human-role")).not.toContainText(
        "Company founder",
      );
      return;
    }
    await page.goto(state === "denied" ? `/#/team/edit/${minaPk}` : "/#/team");
    await expect(
      page.getByRole("navigation", { name: "Breadcrumb" }),
    ).toHaveText("Company / Team");
    if (state === "loading")
      await expect(
        page.getByText("Loading Team", { exact: true }),
      ).toBeVisible();
    if (state === "failed") {
      await expect(
        page.getByRole("button", { name: "Try again" }),
      ).toBeVisible();
      await expect(page.getByRole("alert")).not.toContainText(
        "signing identity",
      );
    }
    for (const width of [1728, 1440]) {
      await page.setViewportSize({
        width,
        height: width === 1728 ? 1117 : 900,
      });
      await waitForAnimations(page);
      await page.screenshot({
        path: `output/playwright/company-design/app-team-${state}-${width}-${testInfo.project.name}.png`,
      });
    }
    if (state === "denied") {
      await expect(
        page.getByText(
          "Only a community owner or admin can make this change directly.",
        ),
      ).toBeVisible();
      await page.getByRole("button", { name: "Back", exact: true }).click();
      await expect(page).toHaveURL(/\/team$/);
    }
  });
}

for (const width of [1728, 1440]) {
  test(`Team terminated review and rehire at ${width}`, async ({
    page,
  }, testInfo) => {
    const { setup } = await import("../helpers/companyTeamFixture");
    await page.setViewportSize({ width, height: width === 1728 ? 1117 : 900 });
    const { minaPk } = await setup(page, { minaStatus: "terminated" });
    await page.goto(`/#/team/detail/${minaPk}`);
    await expect(page.getByTestId("company-terminated-banner")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Pause employee" }),
    ).toHaveCount(0);
    await waitForAnimations(page);
    await page.screenshot({
      path: `output/playwright/company-design/app-team-terminated-${width}-${testInfo.project.name}.png`,
    });
    await page.getByRole("button", { name: "Review rehire" }).click();
    await expect(
      page.getByRole("button", { name: "Approve and rehire" }),
    ).toBeDisabled();
    await waitForAnimations(page);
    await page.screenshot({
      path: `output/playwright/company-design/app-team-rehire-review-${width}-${testInfo.project.name}.png`,
    });
    await page.getByRole("checkbox").check();
    await page.evaluate(() => {
      if (window.__BUZZ_E2E__?.mock)
        window.__BUZZ_E2E__.mock.companyMemberActionErrors = [
          "restricted: review retry test",
        ];
    });
    await page.getByRole("button", { name: "Approve and rehire" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "The review is kept. Try again.",
    );
    await expect(page.getByRole("checkbox")).toBeChecked();
    await page.getByRole("button", { name: "Approve and rehire" }).click();
    await expect(page.getByTestId("company-rehire-review")).toHaveCount(0);
    await expect(page.getByTestId("company-position-header")).toContainText(
      "Employee · Offline",
    );
    await expect
      .poll(() =>
        page.evaluate((pubkey) => {
          const events = JSON.parse(
            localStorage.getItem(
              "buzz-e2e-company-member-position-events-v1",
            ) ?? "[]",
          );
          return events
            .map((event: { content: string }) => JSON.parse(event.content))
            .find((head: { pubkey: string }) => head.pubkey === pubkey)?.status;
        }, minaPk),
      )
      .toBe("active");
    await expect(page.getByTestId("company-terminated-banner")).toHaveCount(0);
  });
}

test("Team retries runtime stop after a committed termination and a reload", async ({
  page,
}) => {
  const { setup } = await import("../helpers/companyTeamFixture");
  const { minaPk } = await setup(page);
  await page.goto(`/#/team/archive/${minaPk}`);
  await page.getByLabel("Reason").fill("Reviewed role closure");
  await page.evaluate(() => {
    const bridge = (
      window as unknown as {
        __TAURI_INTERNALS__: {
          invoke: (command: string, payload?: unknown) => Promise<unknown>;
        };
      }
    ).__TAURI_INTERNALS__;
    const invoke = bridge.invoke;
    bridge.invoke = (command, payload) =>
      command === "stop_managed_agent"
        ? Promise.reject(new Error("Runtime stop retry test"))
        : invoke(command, payload);
  });
  await page
    .getByRole("button", { name: "Terminate employee", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Runtime stop retry test",
  );
  await expect(
    page.getByRole("button", { name: "Retry stopping runtime" }),
  ).toBeVisible();
  await page.goto(`/#/team/detail/${minaPk}`);
  await expect(page.getByTestId("company-terminated-banner")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Retry stopping runtime" }).click();
  await page.getByRole("button", { name: "Retry stopping runtime" }).click();
  await expect(page.getByTestId("company-terminated-banner")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry stopping runtime" }),
  ).toHaveCount(0);
});
