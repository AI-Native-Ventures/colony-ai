import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.COLONY_E2E_PORT ?? 4173);
const dist = process.env.RESTYLE_PROOF_DIST ?? "dist";

/**
 * Local-only proof captures (`restyle-proof.spec.ts`) and the long-channel
 * style cost check (`RESTYLE_SPEC=restyle-perf.spec.ts`) for the office
 * restyle; never run in CI.
 */
export default defineConfig({
  testDir: ".",
  testMatch: process.env.RESTYLE_SPEC ?? "restyle-proof.spec.ts",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../../test-results/restyle-proof-runs",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${port}`,
    launchOptions: {
      args: ["--use-mock-keychain", "--password-store=basic"],
    },
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  webServer: {
    command: `python3 -m http.server ${port} -d ${dist}`,
    cwd: "../..",
    reuseExistingServer: false,
    url: `http://127.0.0.1:${port}`,
  },
});
