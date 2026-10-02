import { expect, type Page } from "@playwright/test";

export async function waitForCompanyWorkThreadContextRead(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = window.__BUZZ_E2E_QUERY_CLIENT__?.getQueryState([
          "channels",
        ]) as
          | {
              dataUpdatedAt?: number;
              fetchStatus: string;
              status: string;
            }
          | undefined;
        return Boolean(
          state &&
            state.status === "success" &&
            state.fetchStatus === "idle" &&
            (state.dataUpdatedAt ?? 0) > 0,
        );
      }),
    )
    .toBe(true);
  await expect(
    page.getByText("Checking linked work", { exact: true }),
  ).toHaveCount(0);
}
