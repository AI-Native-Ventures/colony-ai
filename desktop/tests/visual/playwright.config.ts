import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "visual-compare.spec.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: "off",
    screenshot: "off",
    video: "off",
  },
});
