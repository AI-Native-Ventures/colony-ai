import { expect, type Locator } from "@playwright/test";

export async function expectUnreadBadgeCount(locator: Locator, count: number) {
  await expect(locator).toBeVisible();
  await expect(locator).toHaveText(
    `${count} unread notification${count === 1 ? "" : "s"}`,
  );
  expect(
    await locator.evaluate((element) =>
      element.firstChild?.textContent?.trim(),
    ),
  ).toBe(String(count));
}
