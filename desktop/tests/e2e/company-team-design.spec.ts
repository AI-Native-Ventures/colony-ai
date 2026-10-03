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
    await expect(row.locator("span").filter({ hasText: /^paused$/ })).toHaveCSS(
      "text-transform",
      "none",
    );
    await expect(
      page.getByTestId(`company-team-member-${owner}`),
    ).toContainText("Founder · Human");
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
    await capture("team-edit-mina");
    await page.goto(`/#/team/pause/${employeePubkey}`);
    await expect(page.getByLabel("Reason")).toBeVisible();
    await capture("team-pause-mina");
    await page.goto(`/#/team/detail/${TEST_IDENTITIES.alice.pubkey}`);
    await expect(page.getByTestId("company-team-member-profile")).toBeVisible();
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
  await expect(row).toContainText("unknown");
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
});
