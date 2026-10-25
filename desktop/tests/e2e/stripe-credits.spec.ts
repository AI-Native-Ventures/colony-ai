import { expect, test } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";

test("Power offers no checkout or billing history and shows Coming soon", async ({
  page,
}) => {
  await installMockBridge(page, {
    referenceWorkspace: true,
    accountLinked: true,
  });
  await page.route("**/api/payments/**", (route) =>
    route.fulfill({ status: 404, json: { error: "not_found" } }),
  );

  // Billing history and checkout are not in the lean app: their old links
  // land on Connections & billing with nothing to buy.
  for (const section of ["history", "checkout", "connections"]) {
    await page.goto(`/#/power?section=${section}`);
    const connections = page.getByTestId("power-connections");
    await expect(connections).toBeVisible();
    await expect(connections).toContainText("Colony credits");
    await expect(connections).toContainText("Coming soon");
    await expect(page.getByTestId("power-history")).toHaveCount(0);
    await expect(page.getByTestId("power-checkout")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add credits" })).toHaveCount(
      0,
    );
    await expect(page.getByRole("link", { name: "Add credits" })).toHaveCount(
      0,
    );
  }
});
