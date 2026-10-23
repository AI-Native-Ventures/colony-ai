import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import {
  COLONY3_BUSINESS_PEOPLE,
  REFERENCE_AGENTS,
} from "../../src/testing/e2eReferenceWorkspace";
import { KIND_MEMBER_POSITION_HEAD } from "../../src/shared/constants/kinds";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";
import { COLONY3_NOW, seedColony3Activity } from "../helpers/colony3Fixture";

/**
 * Colony 3.0 proof for the clients, money and work boards. Captures the app at
 * each board's size with the Lerato Social fixture so
 * `scripts/colony3-proof-report.mjs` can lay every capture next to the design
 * reference. Not a regression gate: it writes PNGs and checks each state can
 * be reached.
 *
 * COLONY3_PROOF_DIR chooses where the captures land.
 */
const OUT =
  process.env.COLONY3_PROOF_DIR ?? "test-results/colony3-business-proof";

const OLIVE_ID = "1e1a7000-0000-4000-8000-000000000011";
const OLIVE_WORK_ID = "b1b17000-0000-4000-8000-000000000001";
const INVOICE_0027 = "3e3a7000-0000-4000-8000-000000000027";
const INVOICE_0029 = "3e3a7000-0000-4000-8000-000000000029";
const INVOICE_0030 = "3e3a7000-0000-4000-8000-000000000030";

type Rect = [x: number, y: number, width: number, height: number];
type Capture = {
  name: string;
  board: string;
  title: string;
  /** Part of the board the capture covers; the whole board when omitted. */
  refRect?: Rect;
};
const captures: Capture[] = [];

test.describe.configure({ mode: "serial", timeout: 120_000 });

const TITLES: Array<{ pubkey: string; title: string; kind: "employee" }> = [
  {
    pubkey: REFERENCE_AGENTS.mina.pubkey,
    title: "Social Media Manager",
    kind: "employee",
  },
  {
    pubkey: COLONY3_BUSINESS_PEOPLE.noor.pubkey,
    title: "Bookkeeper",
    kind: "employee",
  },
  {
    pubkey: REFERENCE_AGENTS.aya.pubkey,
    title: "Business Development",
    kind: "employee",
  },
  {
    pubkey: REFERENCE_AGENTS.theo.pubkey,
    title: "Software Engineer",
    kind: "employee",
  },
];

async function openBoard(
  page: Page,
  route: string,
  options: { activity?: boolean } = {},
) {
  mkdirSync(OUT, { recursive: true });
  page.on("pageerror", (error) => console.log("PAGEERROR", error.message));
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.clock.setFixedTime(new Date(COLONY3_NOW));
  const relaySecret = generateSecretKey();
  await installMockBridge(page, {
    referenceWorkspace: true,
    colony3Sidebar: true,
    colony3Business: true,
    windowFullscreen: true,
    relaySelf: getPublicKey(relaySecret),
    companyMemberPositionEvents: TITLES.map((person) =>
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
            status: "active",
            sourceActionEventId: "b".repeat(64),
            updatedAt: "2026-10-01T09:00:00.000Z",
          }),
        },
        relaySecret,
      ),
    ),
  });
  await page.goto(route);
  if (options.activity !== false) await seedColony3Activity(page);
  await expect(page.getByTestId("app-sidebar")).toBeVisible();
  await page.waitForTimeout(1200);
  await waitForAnimations(page);
}

async function shot(page: Page, capture: Capture, target?: Locator) {
  await waitForAnimations(page);
  const path = `${OUT}/${capture.name}.png`;
  if (target) {
    const box = await target.boundingBox();
    if (!box) throw new Error(`No box to capture for ${capture.name}`);
    await page.screenshot({
      animations: "disabled",
      clip: {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      },
      path,
    });
  } else {
    await page.screenshot({
      animations: "disabled",
      clip: { x: 0, y: 0, width: 1440, height: 960 },
      path,
    });
  }
  captures.push(capture);
}

test.afterAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/captures.json`, JSON.stringify(captures, null, 2));
});

test("Clients board", async ({ page }) => {
  await openBoard(page, "/#/clients");
  await expect(page.getByRole("table", { name: "Clients" })).toContainText(
    "Northline Interiors",
  );
  await shot(page, { name: "Clients", board: "Clients", title: "Clients" });
});

test("ClientDetail board", async ({ page }) => {
  await openBoard(page, `/#/clients/${OLIVE_ID}`);
  await expect(
    page.getByRole("heading", { name: "The Olive House" }),
  ).toBeVisible();
  await expect(page.getByText("Working on this client")).toBeVisible();
  await expect(page.getByText("Social Media Manager").first()).toBeVisible();
  await shot(page, {
    name: "ClientDetail",
    board: "ClientDetail",
    title: "Client",
  });
});

test("Work board", async ({ page }) => {
  await openBoard(page, "/#/work");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(page.getByText("No work here.").first()).toBeVisible();
  await shot(page, { name: "Work", board: "Work", title: "Work, board" });
});

test("WorkList board", async ({ page }) => {
  await openBoard(page, "/#/work");
  await expect(page.getByRole("table")).toContainText("Mina");
  await shot(page, {
    name: "WorkList",
    board: "WorkList",
    title: "Work, list",
  });
});

test("WorkDetail board", async ({ page }) => {
  await openBoard(page, `/#/work/${OLIVE_WORK_ID}?client=${OLIVE_ID}`);
  await expect(
    page.getByRole("heading", { name: "Produce the spring content campaign" }),
  ).toBeVisible();
  await expect(page.getByText("Move the work forward")).toBeVisible();
  await expect(
    page.getByText("October carousel concepts").first(),
  ).toBeVisible();
  await shot(page, {
    name: "WorkDetail",
    board: "WorkDetail",
    title: "Work, detail",
  });
});

test("Money board", async ({ page }) => {
  await openBoard(page, "/#/money");
  await page.getByLabel("Money period").selectOption("2026-09");
  await expect(page.getByTestId("money-overview")).toContainText(
    /R\s*14\s*200/,
  );
  await shot(page, { name: "Money", board: "Money", title: "Money, overview" });
});

test("Invoices board", async ({ page }) => {
  await openBoard(page, "/#/money/invoices");
  await expect(page.getByTestId("money-invoice-list")).toContainText(
    "Invoice 0030",
  );
  await shot(page, {
    name: "Invoices",
    board: "Invoices",
    title: "Invoices",
  });
});

test("Invoice board", async ({ page }) => {
  await openBoard(page, `/#/money/invoice/${INVOICE_0027}`);
  await expect(page.getByTestId("money-invoice-detail")).toContainText(
    "Recorded by Noor",
  );
  await shot(page, {
    name: "Invoice",
    board: "Invoice",
    title: "Invoice 0027",
  });
});

test("Issue and record payment dialogs", async ({ page }) => {
  await openBoard(page, `/#/money/invoice/${INVOICE_0030}`);
  await page.getByRole("button", { name: "Review & issue" }).click();
  const issue = page.getByRole("dialog", { name: /Issue Invoice 0030/ });
  await expect(issue).toBeVisible();
  await shot(
    page,
    {
      name: "InvoiceDialogs-issue",
      board: "InvoiceDialogs",
      refRect: [66, 280, 420, 400],
      title: "Issue Invoice 0030?",
    },
    issue,
  );
  await page.keyboard.press("Escape");
  await page.goto(`/#/money/invoice/${INVOICE_0027}`);
  await page.getByRole("button", { name: "Record payment" }).click();
  const payment = page.getByRole("dialog", { name: /Record payment/ });
  await expect(payment).toBeVisible();
  await shot(
    page,
    {
      name: "InvoiceDialogs-payment",
      board: "InvoiceDialogs",
      refRect: [510, 195, 420, 570],
      title: "Record payment · Invoice 0027",
    },
    payment,
  );
});

test("Edit and void dialogs", async ({ page }) => {
  await openBoard(page, `/#/money/invoice/${INVOICE_0030}`);
  await page.getByRole("button", { name: "Edit invoice" }).click();
  const edit = page.getByRole("dialog", { name: /Edit Invoice 0030/ });
  await expect(edit).toBeVisible();
  await shot(
    page,
    {
      name: "MoneyDialogs-edit",
      board: "MoneyDialogs",
      refRect: [63, 40, 430, 651],
      title: "Edit Invoice 0030",
    },
    edit,
  );
  await page.keyboard.press("Escape");
  await page.goto(`/#/money/invoice/${INVOICE_0029}`);
  await page.getByRole("button", { name: "Void invoice" }).click();
  const voidDialog = page.getByRole("dialog", { name: /Void invoice 0029/ });
  await expect(voidDialog).toBeVisible();
  await voidDialog
    .getByLabel("Reason")
    .fill(
      "The extra creative was folded into the October retainer, so this invoice is no longer owed.",
    );
  await shot(
    page,
    {
      name: "MoneyDialogs-void",
      board: "MoneyDialogs",
      refRect: [515, 40, 410, 523],
      title: "Void invoice 0029",
    },
    voidDialog,
  );
});

test("BusinessStates board", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 960 });
  await installMockBridge(page, {});
  await page.addInitScript(() => {
    const config = (window as unknown as { __BUZZ_E2E__?: object })
      .__BUZZ_E2E__;
    (window as unknown as { __BUZZ_E2E__: object }).__BUZZ_E2E__ = {
      ...config,
      showcase: "colony3-business-states",
    };
  });
  await page.goto("/");
  const board = page.getByTestId("colony3-business-states");
  await expect(board).toBeVisible();
  await shot(
    page,
    {
      name: "BusinessStates",
      board: "BusinessStates",
      refRect: [280, 65, 1160, 895],
      title: "Business records states (the page area)",
    },
    board,
  );
});
