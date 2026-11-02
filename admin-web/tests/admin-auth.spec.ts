import { expect, type Page, test } from "@playwright/test";

type SignedEvent = {
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  id: string;
  pubkey: string;
  sig: string;
};

declare global {
  interface Window {
    signedAdminEvents: SignedEvent[];
  }
}

async function seedNip07(page: Page) {
  await page.addInitScript(() => {
    window.signedAdminEvents = [];
    (window as Window & { nostr?: unknown }).nostr = {
      signEvent: async (event: {
        kind: number;
        created_at: number;
        tags: string[][];
        content: string;
      }) => {
        window.signedAdminEvents.push(event as SignedEvent);
        return {
          ...event,
          id: "a".repeat(64),
          pubkey: "b".repeat(64),
          sig: "c".repeat(128),
        };
      },
    };
  });
}

test("anonymous visitors see the Colony sign-in choices", async ({ page }) => {
  await page.route("**/api/admin/v1/probe", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "unauthorized", message: "request is not authorized" },
      }),
    }),
  );
  await page.goto("/overview");
  await expect(
    page.getByRole("heading", { name: "Sign in with your Colony account" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Google" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Use NIP-98 instead" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Overview" })).toHaveCount(0);
});

test("Google OIDC posts the fragment token and stored nonce, then checks the operator role", async ({
  page,
}) => {
  let probeCount = 0;
  let sessionBody: { idToken?: string; nonce?: string } | undefined;
  let sessionAuthorization: string | undefined;
  await page.route("**/api/admin/v1/probe", (route) => {
    probeCount += 1;
    if (probeCount === 1) {
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "unauthorized", message: "sign in" },
        }),
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ role: "operator", source: "config" }),
    });
  });
  await page.route("https://accounts.google.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "Google" }),
  );
  await page.route("**/api/admin/v1/session/google", async (route) => {
    sessionAuthorization = route.request().headers().authorization;
    sessionBody = route.request().postDataJSON() as {
      idToken?: string;
      nonce?: string;
    };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        pubkeyShort: "ab12cd34",
        expiresInSeconds: 28800,
      }),
    });
  });

  await page.goto("/overview");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await expect(page).toHaveURL(/accounts\.google\.com\/o\/oauth2\/v2\/auth/);
  const googleUrl = new URL(page.url());
  expect(googleUrl.searchParams.get("client_id")).toBe("e2e-admin-client");
  expect(googleUrl.searchParams.get("response_type")).toBe("id_token");
  expect(googleUrl.searchParams.get("scope")).toBe("openid email");
  expect(googleUrl.searchParams.get("prompt")).toBe("select_account");
  expect(googleUrl.searchParams.get("redirect_uri")).toMatch(/\/sign-in$/);
  expect(googleUrl.searchParams.get("nonce")).toMatch(/^[a-f0-9]{64}$/);

  await page.goto("/sign-in#id_token=one-time-test-token");
  await expect(page).toHaveURL(/\/overview$/);
  expect(sessionBody).toEqual({
    idToken: "one-time-test-token",
    nonce: googleUrl.searchParams.get("nonce"),
  });
  expect(sessionAuthorization).toBeUndefined();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("colony_admin_oidc_nonce"),
    ),
  ).toBeNull();
});

test("NIP-98 fallback signs the probe and every metrics read", async ({
  page,
}) => {
  await seedNip07(page);
  const requests: { path: string; authorization?: string }[] = [];
  await page.route("**/api/admin/v1/probe", (route) => {
    const authorization = route.request().headers().authorization;
    requests.push({
      path: new URL(route.request().url()).pathname,
      authorization,
    });
    if (!authorization) {
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "unauthorized", message: "sign in" },
        }),
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ role: "operator", source: "config" }),
    });
  });
  await page.route("**/api/admin/v1/metrics/overview?**", (route) => {
    const authorization = route.request().headers().authorization;
    requests.push({
      path: new URL(route.request().url()).pathname,
      authorization,
    });
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: "2026-11-02T05:45:11Z",
        dataThrough: "2026-11-01",
        range: { days: 30, from: "2026-10-04", to: "2026-11-02" },
        kpis: {},
        series: [],
        businesses: {},
        agents: {},
        ai: {},
        discovery: {},
        whatsapp: {},
        needsAttention: [],
        unavailable: [],
      }),
    });
  });

  await page.goto("/overview");
  await page.getByRole("button", { name: "Use NIP-98 instead" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(
    requests.every((request) => request.authorization?.startsWith("Nostr ")),
  ).toBe(true);
  const events = await page.evaluate(() => window.signedAdminEvents);
  expect(events.map((event) => event.tags.map((tag) => tag[0]))).toEqual([
    ["u", "method", "nonce"],
    ["u", "method", "nonce"],
  ]);
});

test("a signed non-operator cannot load operator metrics", async ({ page }) => {
  await seedNip07(page);
  let metricRequests = 0;
  await page.route("**/api/admin/v1/probe", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "forbidden", message: "request is not authorized" },
      }),
    }),
  );
  await page.route("**/api/admin/v1/metrics/**", (route) => {
    metricRequests += 1;
    return route.fulfill({ contentType: "application/json", body: "{}" });
  });
  await page.goto("/overview");
  await page.getByRole("button", { name: "Use NIP-98 instead" }).click();
  await expect(
    page.getByRole("heading", { name: "Access denied" }),
  ).toBeVisible();
  expect(metricRequests).toBe(0);
});
