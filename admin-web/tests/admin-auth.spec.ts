import { expect, type Page, test } from "@playwright/test";
import { overviewFixture } from "./helpers/admin-fixtures";

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

const emptyOverviewResponse = {
  generatedAt: "2026-11-06T05:45:11Z",
  dataThrough: null,
  range: { days: 30, from: "2026-10-08", to: "2026-11-06" },
  kpis: {
    people: { value: null, previous: null },
    dau: { value: null, previous: null },
    wau: { value: null, previous: null },
    mau: { value: null, previous: null },
    stickinessPct: { value: null, previous: null },
    newAccounts: { value: 0, previous: 0 },
  },
  series: [],
  businesses: {
    total: 0,
    archived: 0,
    activeThisWeek: 0,
    createdThisWeek: 0,
    cofounderOn: 0,
  },
  agents: {
    total: 0,
    scout: 0,
    activeThisWeek: 0,
    answerWithin5MinPct: null,
    neverStarted: 0,
  },
  ai: {
    month: "2026-11",
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    chargedUsd: "0.000000",
    byModel: [],
  },
  discovery: {
    resultsThisMonth: 0,
    capPerBusiness: 2000,
    repeatsSkipped: null,
  },
  whatsapp: { sentThisMonth: 0, repliedThisMonth: 0 },
  needsAttention: [],
  unavailable: ["discovery.repeatsSkipped"],
};

async function stubEmailSession(page: Page) {
  let probeCount = 0;
  let signedOut = false;
  await page.route("**/api/admin/v1/probe", (route) => {
    probeCount += 1;
    return route.fulfill(
      probeCount === 1 || signedOut
        ? {
            status: 401,
            contentType: "application/json",
            body: JSON.stringify({
              error: { code: "unauthorized", message: "sign in" },
            }),
          }
        : {
            contentType: "application/json",
            body: JSON.stringify({ role: "operator", source: "config" }),
          },
    );
  });
  await page.route("**/api/admin/v1/session/email/start", (route) =>
    route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        status: "email_code_requested",
        retryAfterSeconds: 0,
      }),
    }),
  );
  await page.route("**/api/admin/v1/session/email/verify", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: { "set-cookie": "__Host-colony_admin=test; Path=/; Secure" },
      body: JSON.stringify({
        status: "ok",
        pubkeyShort: "ab12cd34",
        expiresInSeconds: 28800,
      }),
    }),
  );
  await page.route("**/api/admin/v1/session/logout", (route) => {
    signedOut = true;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ status: "signed_out" }),
    });
  });
}

async function signInWithEmailCode(page: Page) {
  await page.goto("/");
  await page.getByLabel("Operator email address").fill("operator@example.test");
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("Eight-digit code").fill("12345678");
  await page.getByRole("button", { name: "Verify code" }).click();
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

test("an operator can request, enter, and verify an emailed code without a NIP credential", async ({
  page,
}) => {
  let probeCount = 0;
  let startBody: { email?: string } | undefined;
  let verifyBody: { email?: string; code?: string } | undefined;
  let startHeaders: Record<string, string> | undefined;
  let verifyHeaders: Record<string, string> | undefined;

  await page.route("**/api/admin/v1/probe", (route) => {
    probeCount += 1;
    return route.fulfill(
      probeCount === 1
        ? {
            status: 401,
            contentType: "application/json",
            body: JSON.stringify({
              error: { code: "unauthorized", message: "sign in" },
            }),
          }
        : {
            contentType: "application/json",
            body: JSON.stringify({ role: "operator", source: "config" }),
          },
    );
  });
  await page.route("**/api/admin/v1/session/email/start", async (route) => {
    startHeaders = route.request().headers();
    startBody = route.request().postDataJSON() as { email?: string };
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        status: "email_code_requested",
        retryAfterSeconds: 30,
      }),
    });
  });
  await page.route("**/api/admin/v1/session/email/verify", async (route) => {
    verifyHeaders = route.request().headers();
    verifyBody = route.request().postDataJSON() as {
      email?: string;
      code?: string;
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
  await page.getByLabel("Operator email address").fill("operator@example.test");
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect(
    page.getByText("Check your inbox for an eight-digit code."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Resend code in 30s" }),
  ).toBeDisabled();
  await page.getByLabel("Eight-digit code").fill("12345678");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

  expect(startBody).toEqual({ email: "operator@example.test" });
  expect(verifyBody).toEqual({
    email: "operator@example.test",
    code: "12345678",
  });
  expect(startHeaders?.authorization).toBeUndefined();
  expect(verifyHeaders?.authorization).toBeUndefined();
  expect(startHeaders?.["x-colony-admin"]).toBeUndefined();
  expect(verifyHeaders?.["x-colony-admin"]).toBeUndefined();
});

test("an email session renders the overview when the metrics tables are empty", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await stubEmailSession(page);
  await page.route("**/api/admin/v1/metrics/overview?**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(emptyOverviewResponse),
    }),
  );

  await signInWithEmailCode(page);

  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("No current alerts.")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("a partial overview response keeps an email session usable", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await stubEmailSession(page);
  await page.route("**/api/admin/v1/metrics/overview?**", (route) => {
    const { needsAttention: _needsAttention, ...partialOverview } =
      emptyOverviewResponse;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(partialOverview),
    });
  });

  await signInWithEmailCode(page);

  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("No current alerts.")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("a malformed overview response shows recovery instead of a blank page", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => undefined },
    });
  });
  await stubEmailSession(page);
  await page.route("**/api/admin/v1/metrics/overview?**", (route) => {
    const { kpis: _kpis, ...malformedOverview } = emptyOverviewResponse;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(malformedOverview),
    });
  });

  await signInWithEmailCode(page);

  await expect(
    page.getByRole("heading", { name: "Something went wrong" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy details" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Copy details" }).click();
  await expect(page.getByText("Details copied.")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(
    page.getByRole("heading", { name: "Sign in with your Colony account" }),
  ).toBeVisible();
});

test("email-code failures stay clear and generic, with an available resend path", async ({
  page,
}) => {
  await page.route("**/api/admin/v1/probe", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "unauthorized", message: "sign in" },
      }),
    }),
  );
  await page.route("**/api/admin/v1/session/email/start", (route) =>
    route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({
        status: "email_code_requested",
        retryAfterSeconds: 0,
      }),
    }),
  );
  await page.route("**/api/admin/v1/session/email/verify", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "invalid_email_code",
          message: "The code is invalid or has expired.",
        },
      }),
    }),
  );

  await page.goto("/overview");
  await page.getByLabel("Operator email address").fill("operator@example.test");
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.getByLabel("Eight-digit code").fill("00000000");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(
    page.getByText(
      "That code did not work. Enter the latest code or send another one.",
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Resend code" })).toBeEnabled();
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
    if (authorization) {
      requests.push({
        path: new URL(route.request().url()).pathname,
        authorization,
      });
    }
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
      body: JSON.stringify(overviewFixture),
    });
  });

  await page.goto("/overview");
  await page.getByRole("button", { name: "Use NIP-98 instead" }).click();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("214", { exact: true })).toBeVisible();
  expect(requests.length).toBeGreaterThanOrEqual(4);
  expect(
    requests.every((request) => request.authorization?.startsWith("Nostr ")),
  ).toBe(true);
  const events = await page.evaluate(() => window.signedAdminEvents);
  // The page reload resets this in-memory log; the request log above spans
  // both documents and proves the persisted NIP-98 choice was reused.
  expect(events.length).toBeGreaterThanOrEqual(2);
  expect(
    events.every((event) =>
      event.tags.some((tag) => tag[0] === "nonce" && tag[1].length === 32),
    ),
  ).toBe(true);
});

test("a signed non-operator cannot load operator metrics", async ({ page }) => {
  await seedNip07(page);
  let metricRequests = 0;
  await page.route("**/api/admin/v1/probe", (route) => {
    const authorization = route.request().headers().authorization;
    return route.fulfill({
      status: authorization ? 403 : 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: authorization
          ? { code: "forbidden", message: "request is not authorized" }
          : { code: "unauthorized", message: "sign in" },
      }),
    });
  });
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
