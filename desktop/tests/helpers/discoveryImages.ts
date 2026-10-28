import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

type DiscoveryImageOptions = {
  failLogoDomains?: string[];
};

function fixtureLogo(domain: string): string {
  const mark =
    domain === "the-olive-house.example"
      ? '<path d="M32 9 11 27h5v27h32V27h5L32 9Z" fill="#fff7df"/><path d="M32 19c-9 7-10 15-4 20 8-1 12-8 4-20Z" fill="#718744"/><path d="M31 39c2-6 6-10 11-13" fill="none" stroke="#718744" stroke-width="2.5" stroke-linecap="round"/>'
      : domain === "form-field.example"
        ? '<rect x="13" y="13" width="17" height="17" rx="3" fill="#f8e9dc"/><rect x="34" y="13" width="17" height="17" rx="3" fill="#f8e9dc"/><rect x="13" y="34" width="17" height="17" rx="3" fill="#f8e9dc"/><path d="M36 43h13M42.5 36.5v13" stroke="#6546b8" stroke-width="5" stroke-linecap="round"/>'
        : '<circle cx="32" cy="32" r="20" fill="#f8e9dc"/><path d="M23 40 32 20l9 20M27 32h10" fill="none" stroke="#6546b8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>';
  const background =
    domain === "the-olive-house.example" ? "#8d9852" : "#d9c6e8";
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">' +
    '<rect width="64" height="64" rx="12" fill="' +
    background +
    '"/>' +
    mark +
    "</svg>"
  );
}

function fallbackCover(): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400">' +
    '<defs><linearGradient id="a" x2="1" y2="1"><stop stop-color="#ded4e6"/>' +
    '<stop offset="1" stop-color="#f2eee8"/></linearGradient></defs>' +
    '<rect width="640" height="400" fill="url(#a)"/></svg>'
  );
}

export async function installDiscoveryImageMocks(
  page: Page,
  options: DiscoveryImageOptions = {},
) {
  const failedLogoDomains = new Set(options.failLogoDomains ?? []);
  const fixtureDirectory = process.env.DISCOVERY_COVERS_FIXTURE_DIR
    ? path.resolve(process.env.DISCOVERY_COVERS_FIXTURE_DIR)
    : null;
  const logoRequests = new Set<string>();

  await page.route(
    "https://colony.global/discovery/covers/v1/**",
    async (route) => {
      const filename = path.basename(new URL(route.request().url()).pathname);
      const fixturePath = fixtureDirectory
        ? path.resolve(fixtureDirectory, filename)
        : null;
      if (
        fixturePath &&
        fixtureDirectory &&
        fixturePath.startsWith(fixtureDirectory + path.sep) &&
        /^[a-z0-9-]+-(640|1200)\.webp$/.test(filename) &&
        existsSync(fixturePath)
      ) {
        await route.fulfill({
          status: 200,
          contentType: "image/webp",
          body: readFileSync(fixturePath),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: fallbackCover(),
      });
    },
  );

  await page.route("https://img.logo.dev/**", async (route) => {
    const domain = new URL(route.request().url()).pathname.slice(1);
    logoRequests.add(domain);
    if (failedLogoDomains.has(domain)) {
      await route.fulfill({ status: 404, body: "" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: fixtureLogo(domain),
    });
  });

  return { logoRequests };
}
