import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: [
    "**/electron-host-feasibility.spec.ts",
    "**/electron-host-feasibility-normal.spec.ts",
  ],
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  outputDir: process.env.COLONY_STAGE0_PLAYWRIGHT_OUTPUT ?? "test-results",
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder:
          process.env.COLONY_STAGE0_PLAYWRIGHT_REPORT ??
          "playwright-electron-report",
      },
    ],
  ],
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
});
