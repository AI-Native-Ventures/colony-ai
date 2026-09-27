import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const OLIVE_CLIENT_ID = "1e1a7000-0000-4000-8000-000000000011";
const NORTHLINE_CLIENT_ID = "1e1a7000-0000-4000-8000-000000000013";
const MISSING_CLIENT_ID = "1e1a7000-0000-4000-8000-000000000099";
const OLIVE_WORK_ID = "b1b17000-0000-4000-8000-000000000001";

async function openReferenceWorkspace(
  page: import("@playwright/test").Page,
  route: string,
  role: "owner" | "admin" | "member" = "owner",
  recordStatuses?: { clientStatus?: string; workStatus?: string },
) {
  await installMockBridge(page, {
    referenceWorkspace: true,
    referenceWorkspaceRole: role,
    referenceWorkspaceClientStatus: recordStatuses?.clientStatus,
    referenceWorkspaceWorkStatus: recordStatuses?.workStatus,
  });
  await page.goto(route);
}

test("client directory opens its exact client record and work channel", async ({
  page,
}) => {
  await openReferenceWorkspace(page, "/#/clients");

  const rows = page.getByRole("table").locator("tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(page.getByRole("table")).toContainText("The Olive House");
  await expect(page.getByRole("table")).toContainText("Cedar Café");
  await expect(page.getByRole("table")).toContainText("Northline Interiors");
  await expect(page.getByRole("table")).toContainText("Onboarding");

  await page.getByRole("link", { name: "The Olive House" }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${OLIVE_CLIENT_ID}$`));
  await expect(
    page.getByRole("heading", { name: "The Olive House" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Client channel" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Client channel" }),
  ).toHaveCount(1);
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Archive client" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Restore client" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Produce the spring content campaign"),
  ).toBeVisible();
});

test("an unavailable client route does not fall back to another client", async ({
  page,
}) => {
  await openReferenceWorkspace(page, `/#/clients/${MISSING_CLIENT_ID}`);

  await expect(
    page.getByText(
      "This client is unavailable to the current identity in this business.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "The Olive House" }),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Cedar Café" })).toHaveCount(
    0,
  );
});

test("work list and board open the exact client-scoped work item", async ({
  page,
}) => {
  await openReferenceWorkspace(page, "/#/work");

  await expect(page.getByRole("table")).toContainText(
    "Produce the spring content campaign",
  );
  await expect(page.getByRole("table")).toContainText("The Olive House");
  await expect(page.getByRole("table")).toContainText("Mina");
  await expect(page.getByRole("table")).toContainText("Theo");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Produce the spring content campaign/ }),
  ).toContainText("Mina");
  await page
    .getByRole("button", { name: /Produce the spring content campaign/ })
    .click();

  await expect(page).toHaveURL(
    new RegExp(`/work/${OLIVE_WORK_ID}\\?client=${OLIVE_CLIENT_ID}$`),
  );
  await expect(
    page.getByRole("heading", {
      name: "Produce the spring content campaign",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Make room for slow mornings" }),
  ).toBeVisible();
  await page.locator("details").first().locator("summary").click();
  await expect(page.locator("article").first()).toContainText(
    "Review required",
  );
  await expect(
    page.getByText(
      "Let the first slide breathe. Keep the product detail on slide two.",
    ),
  ).toBeVisible();
  const requestChangesActions = page.getByRole("button", {
    name: "Request changes",
  });
  await expect(requestChangesActions).toHaveCount(4);
  await expect(
    page.locator("article").first().getByRole("button", {
      name: "Request changes",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open client channel" }),
  ).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Archive work" })).toHaveCount(
    0,
  );
});

test("shared work opens the same record from its client conversation", async ({
  page,
}) => {
  await openReferenceWorkspace(
    page,
    `/#/work/${OLIVE_WORK_ID}?client=${OLIVE_CLIENT_ID}`,
  );

  await page.getByRole("button", { name: "Share in client channel" }).click();
  await expect(page).toHaveURL(new RegExp(`/channels/${OLIVE_CLIENT_ID}$`));

  const workReference = page.getByRole("link", {
    name: "Open work item Produce the spring content campaign",
  });
  await expect(workReference).toBeVisible();
  await expect(workReference).toContainText("Mina");
  await expect(workReference).toContainText("4 deliverables");
  await expect(workReference).toContainText("review", { matchCase: true });
  await workReference.click();

  await expect(page).toHaveURL(
    new RegExp(`/work/${OLIVE_WORK_ID}\\?client=${OLIVE_CLIENT_ID}$`),
  );
  await expect(
    page.getByRole("heading", {
      name: "Produce the spring content campaign",
    }),
  ).toBeVisible();
});

test("a work route cannot resolve through a different client", async ({
  page,
}) => {
  await openReferenceWorkspace(
    page,
    `/#/work/${OLIVE_WORK_ID}?client=${NORTHLINE_CLIENT_ID}`,
  );

  await expect(page.getByRole("alert")).toContainText(
    "This work item was not found in the selected client channel.",
  );
  await expect(
    page.getByRole("heading", {
      name: "Produce the spring content campaign",
    }),
  ).toHaveCount(0);
});

test("work creation requires a title and selected client", async ({ page }) => {
  await openReferenceWorkspace(page, "/#/work");

  await page.getByRole("button", { name: "New work" }).click();
  const dialog = page.getByRole("dialog", { name: "Create work" });
  const createButton = dialog.getByRole("button", { name: "Create work" });
  await dialog.getByLabel("Client").selectOption(OLIVE_CLIENT_ID);
  await expect(createButton).toBeDisabled();
  await dialog.getByLabel("Work title").fill("Prepare launch assets");
  await expect(createButton).toBeEnabled();
  await dialog.getByRole("button", { name: "Cancel" }).click();
});

test("a member cannot create client work", async ({ page }) => {
  await openReferenceWorkspace(page, "/#/work", "member");

  await page.getByRole("button", { name: "New work" }).click();
  const dialog = page.getByRole("dialog", { name: "Create work" });
  await dialog.getByLabel("Client").selectOption(OLIVE_CLIENT_ID);
  await expect(
    dialog.getByRole("button", { name: "Create work" }),
  ).toBeDisabled();
  await expect(
    dialog.getByText("Only a client channel admin can create work."),
  ).toBeVisible();
  await dialog.getByLabel("Work title").fill("Member-created work");
  await expect(
    dialog.getByRole("button", { name: "Create work" }),
  ).toBeDisabled();
});

test("an unassigned member cannot edit existing client work", async ({
  page,
}) => {
  await openReferenceWorkspace(
    page,
    `/#/work/${OLIVE_WORK_ID}?client=${OLIVE_CLIENT_ID}`,
    "member",
  );

  await expect(page.getByRole("button", { name: "Edit work" })).toHaveCount(0);
  await expect(
    page.getByText(
      "Only an assigned person or client channel admin can update this work item.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause work" })).toBeDisabled();
});

test("archived client work stays visible and read only", async ({ page }) => {
  await openReferenceWorkspace(
    page,
    `/#/work/${OLIVE_WORK_ID}?client=${OLIVE_CLIENT_ID}`,
    "owner",
    { clientStatus: "archived" },
  );

  await expect(
    page.getByRole("heading", {
      name: "Produce the spring content campaign",
    }),
  ).toBeVisible();
  await expect(page.getByText(/This client is archived/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit work" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add deliverable" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Request changes" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pause work" })).toBeDisabled();
});

test("archived work remains visible without mutation controls", async ({
  page,
}) => {
  await openReferenceWorkspace(
    page,
    `/#/work/${OLIVE_WORK_ID}?client=${OLIVE_CLIENT_ID}`,
    "owner",
    { workStatus: "archived" },
  );

  await expect(
    page.getByRole("heading", {
      name: "Produce the spring content campaign",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("This work item is archived and read-only."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit work" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add deliverable" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Request changes" }),
  ).toHaveCount(0);
});

test("a stale work update keeps retry and reload recovery available", async ({
  page,
}) => {
  await openReferenceWorkspace(
    page,
    `/#/work/${OLIVE_WORK_ID}?client=${OLIVE_CLIENT_ID}`,
  );
  await page.evaluate(() => {
    const testWindow = window as Window & {
      __BUZZ_E2E_REJECT_BUSINESS_RECORD_EVENTS__?: Array<{
        kind: number;
        reason: string;
      }>;
    };
    testWindow.__BUZZ_E2E_REJECT_BUSINESS_RECORD_EVENTS__ = [
      {
        kind: 47006,
        reason: "conflict: work item head changed since it was loaded",
      },
    ];
  });

  await page.getByRole("button", { name: "Edit work" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit work" });
  await dialog.getByLabel("Work title").fill("Stale title update");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  await expect(dialog.getByRole("button", { name: "Retry" })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByRole("alert")).toContainText(
    "conflict: work item head changed since it was loaded",
  );
  await expect(
    page.getByRole("button", { name: "Retry same update" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reload latest" }),
  ).toBeVisible();
});
