import { defineConfig } from "@playwright/test";

const requestedPort = process.env.ADMIN_WEB_TEST_PORT ?? "4174";
const previewPort = /^\d{4,5}$/.test(requestedPort) ? requestedPort : "4174";
const previewUrl = `http://127.0.0.1:${previewPort}`;

export default defineConfig({
  testDir: "./tests",
  webServer: {
    command: `pnpm exec vite preview --host 127.0.0.1 --port ${previewPort} --strictPort`,
    url: previewUrl,
    reuseExistingServer: false,
  },
  use: { baseURL: previewUrl, headless: true },
});
