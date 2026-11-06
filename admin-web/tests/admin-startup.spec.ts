import { expect, test } from "@playwright/test";

test("shows a reload card when the current admin bundle cannot load", async ({
  page,
}) => {
  await page.route("**/assets/*.js", (route) => route.abort("failed"));

  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "This page is out of date, reload" }),
  ).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole("button", { name: "Reload" })).toBeVisible();
});

test("shows the startup watchdog card when a bundle loads without mounting", async ({
  page,
}) => {
  await page.route("**/assets/*.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: "" }),
  );

  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      name: "Admin could not start. Reload, or open in a private window.",
    }),
  ).toBeVisible({ timeout: 5_000 });
});
