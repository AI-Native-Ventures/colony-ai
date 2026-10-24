import { expect, test } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";

test("launch flag OFF: AI spend shows Colony credits as Coming soon with nothing to buy", async ({
  page,
}) => {
  await installMockBridge(page, {
    referenceWorkspace: true,
    accountLinked: true,
  });
  await page.route("**/api/payments/**", (route) =>
    route.fulfill({ status: 404, json: { error: "not_found" } }),
  );
  await page.goto("/#/power?section=credits");
  const credits = page.getByTestId("power-credits");
  await expect(credits).toContainText("Colony credits");
  await expect(credits).toContainText("Coming soon");
  await expect(page.getByRole("button", { name: "Add credits" })).toHaveCount(
    0,
  );

  // Old billing and checkout links land on usage, with nothing to buy.
  await page.goto("/#/power?section=checkout");
  await expect(page.getByTestId("power-usage")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add credits" })).toHaveCount(
    0,
  );
});
