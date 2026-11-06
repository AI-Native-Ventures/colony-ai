import { expect, type Page, test } from "@playwright/test";

interface ObjectUrlLog {
  created: string[];
  revoked: string[];
}

declare global {
  interface Window {
    objectUrlLog: ObjectUrlLog;
  }
}

/// Injects a minimal window.nostr stub that returns a fake signed event, so a
/// test can drive nip98 mode without a real NIP-07 extension. The stub derives
/// the event `id` from the signed fields (tags + created_at + content), so two
/// signings collide iff their signed payloads are byte-identical — exactly the
/// property the relay's replay guard keys on.
async function seedNip98(page: Page) {
  await page.addInitScript(() => {
    (window as Window & { nostr?: unknown }).nostr = {
      signEvent: async (event: {
        kind: number;
        created_at: number;
        tags: string[][];
        content: string;
      }) => {
        const serialized = JSON.stringify([
          event.kind,
          event.created_at,
          event.tags,
          event.content,
        ]);
        // Cheap non-crypto digest of the signed fields, hex-padded to 64 chars.
        let h = 0;
        for (let i = 0; i < serialized.length; i++) {
          h = (Math.imul(31, h) + serialized.charCodeAt(i)) | 0;
        }
        const id = (h >>> 0).toString(16).padStart(8, "0").repeat(8);
        return {
          ...event,
          id,
          pubkey: "b".repeat(64),
          sig: "c".repeat(128),
        };
      },
    };
  });
}

/// Decode an `Authorization: Nostr <base64>` header to the signed event.
function decodeNostrHeader(header: string): { id: string; tags: string[][] } {
  return JSON.parse(atob(header.replace(/^Nostr /, "")));
}

function unauthorizedResponse() {
  return {
    status: 401,
    headers: { "www-authenticate": "Nostr" },
    contentType: "application/json",
    body: JSON.stringify({
      error: { code: "unauthorized", message: "nip98 required" },
    }),
  };
}

function operatorProbeResponse() {
  return {
    contentType: "application/json",
    body: JSON.stringify({ role: "operator", source: "config" }),
  };
}

async function startNip98SignIn(page: Page) {
  await page.getByRole("button", { name: "Use NIP-98 instead" }).click();
}

test("nip98 mode: attachments are fetched with a signed credential and rendered from blob urls", async ({
  page,
}) => {
  const id = "feedback-with-attachments";
  const imageHash = "a".repeat(64);
  const fileHash = "b".repeat(64);
  const imageUrl = `https://design.colony.global/media/${imageHash}.png`;
  const fileUrl = `https://design.colony.global/media/${fileHash}.txt`;
  await seedNip98(page);

  const attachmentRequests: { path: string; authorization?: string }[] = [];
  await page.route("**/api/admin/v1/probe", (route) =>
    route.fulfill(
      route.request().headers().authorization
        ? operatorProbeResponse()
        : unauthorizedResponse(),
    ),
  );
  await page.route(`**/api/admin/v1/feedback/${id}/attachments/**`, (route) => {
    attachmentRequests.push({
      path: new URL(route.request().url()).pathname,
      authorization: route.request().headers().authorization,
    });
    route.fulfill({
      contentType: route.request().url().includes(imageHash)
        ? "image/png"
        : "application/octet-stream",
      body: "bytes",
    });
  });
  await page.route(`**/api/admin/v1/feedback/${id}`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id,
        communityId: "one",
        communityHost: "design.colony.global",
        eventId: "31".repeat(32),
        submitterPubkey: "21".repeat(32),
        category: "bug",
        body: "Composer froze.",
        tags: [
          [
            "imeta",
            `url ${imageUrl}`,
            "m image/png",
            `x ${imageHash}`,
            "filename screenshot.png",
          ],
          [
            "imeta",
            `url ${fileUrl}`,
            "m text/plain",
            `x ${fileHash}`,
            "filename diagnostics.txt",
          ],
        ],
        eventCreatedAt: "2026-07-17T17:25:00Z",
        receivedAt: "2026-07-17T17:30:00Z",
      }),
    }),
  );

  await page.goto(`/feedback/${id}`);
  await startNip98SignIn(page);
  await expect(
    page.getByRole("img", { name: "screenshot.png" }),
  ).toHaveAttribute("src", /^blob:/);
  await expect(
    page.getByRole("link", { name: /diagnostics.txt/ }),
  ).toHaveAttribute("href", /^blob:/);

  expect(attachmentRequests.map((request) => request.path).sort()).toEqual(
    [
      `/api/admin/v1/feedback/${id}/attachments/${imageHash}`,
      `/api/admin/v1/feedback/${id}/attachments/${fileHash}`,
    ].sort(),
  );
  for (const request of attachmentRequests) {
    expect(request.authorization).toMatch(/^Nostr /);
  }
});

/// Records every object URL the SPA creates and revokes, so a test can prove a
/// blob handed to the DOM is released rather than merely replaced.
async function instrumentObjectUrls(page: Page) {
  await page.addInitScript(() => {
    const log: ObjectUrlLog = { created: [], revoked: [] };
    window.objectUrlLog = log;
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (source: Blob | MediaSource) => {
      const url = create(source);
      log.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      log.revoked.push(url);
      revoke(url);
    };
  });
}

const FEEDBACK_ID = "feedback-with-attachments";
const IMAGE_HASH = "a".repeat(64);
const FILE_HASH = "b".repeat(64);

/// A feedback detail carrying one image and one non-image attachment. The
/// operator probe accepts the cookie mode so these tests exercise object-URL
/// lifecycle, not an authentication method.
async function routeFeedbackDetail(page: Page) {
  const host = "design.colony.global";
  await page.route("**/api/admin/v1/probe", (route) =>
    route.fulfill(operatorProbeResponse()),
  );
  await page.route(`**/api/admin/v1/feedback?**`, (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" }),
  );
  await page.route(`**/api/admin/v1/feedback/${FEEDBACK_ID}`, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        id: FEEDBACK_ID,
        communityId: "one",
        communityHost: host,
        eventId: "31".repeat(32),
        submitterPubkey: "21".repeat(32),
        category: "bug",
        body: "Composer froze.",
        tags: [
          [
            "imeta",
            `url https://${host}/media/${IMAGE_HASH}.png`,
            "m image/png",
            `x ${IMAGE_HASH}`,
            "filename screenshot.png",
          ],
          [
            "imeta",
            `url https://${host}/media/${FILE_HASH}.txt`,
            "m text/plain",
            `x ${FILE_HASH}`,
            "filename diagnostics.txt",
          ],
        ],
        eventCreatedAt: "2026-07-17T17:25:00Z",
        receivedAt: "2026-07-17T17:30:00Z",
      }),
    }),
  );
}

test("attachment object urls are revoked when the view is left", async ({
  page,
}) => {
  await instrumentObjectUrls(page);
  await routeFeedbackDetail(page);
  await page.route(
    `**/api/admin/v1/feedback/${FEEDBACK_ID}/attachments/**`,
    (route) =>
      route.fulfill({
        contentType: route.request().url().includes(IMAGE_HASH)
          ? "image/png"
          : "application/octet-stream",
        body: "bytes",
      }),
  );

  await page.goto(`/feedback/${FEEDBACK_ID}`);
  const imageUrl = await page
    .getByRole("img", { name: "screenshot.png" })
    .getAttribute("src");
  const fileUrl = await page
    .getByRole("link", { name: /diagnostics.txt/ })
    .getAttribute("href");
  expect(imageUrl).toMatch(/^blob:/);
  expect(fileUrl).toMatch(/^blob:/);
  expect(await page.evaluate(() => window.objectUrlLog.revoked)).toEqual([]);

  await page.getByRole("link", { name: "Back to feedback" }).click();
  await expect(page.getByRole("heading", { name: "Feedback" })).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => window.objectUrlLog.revoked))
    .toEqual(expect.arrayContaining([imageUrl, fileUrl]));
});

test("an attachment that arrives after the view is left is revoked immediately", async ({
  page,
}) => {
  await instrumentObjectUrls(page);
  await routeFeedbackDetail(page);
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    `**/api/admin/v1/feedback/${FEEDBACK_ID}/attachments/**`,
    async (route) => {
      await held;
      await route.fulfill({
        contentType: route.request().url().includes(IMAGE_HASH)
          ? "image/png"
          : "application/octet-stream",
        body: "bytes",
      });
    },
  );

  await page.goto(`/feedback/${FEEDBACK_ID}`);
  // Both fetches are held, so no blob exists yet.
  await expect(page.getByText("Loading…")).toBeVisible();
  expect(await page.evaluate(() => window.objectUrlLog.created)).toEqual([]);

  // Leave before either fetch resolves, then let both complete.
  await page.getByRole("link", { name: "Back to feedback" }).click();
  await expect(page.getByRole("heading", { name: "Feedback" })).toBeVisible();
  release();

  await expect
    .poll(() => page.evaluate(() => window.objectUrlLog.revoked.length))
    .toBe(2);
  const log = await page.evaluate(() => window.objectUrlLog);
  expect(log.revoked.sort()).toEqual(log.created.sort());
  // Nothing was ever handed to the DOM: the blobs outlived their view.
  await expect(page.getByRole("img", { name: "screenshot.png" })).toHaveCount(
    0,
  );
});

test("an operator probe renders a direct reports link in the Colony shell", async ({
  page,
}) => {
  await page.route("**/api/admin/v1/probe", (route) =>
    route.fulfill(operatorProbeResponse()),
  );
  await page.route("**/api/admin/v1/reports**", (route) =>
    route.fulfill({ contentType: "application/json", body: "[]" }),
  );

  await page.goto("/reports");

  await expect(
    page.getByRole("heading", { name: "Open reports" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sign in with your Colony account" }),
  ).toHaveCount(0);
});

test("an unauthenticated direct reports link shows Colony sign-in choices", async ({
  page,
}) => {
  await page.route("**/api/admin/v1/probe", (route) =>
    route.fulfill(unauthorizedResponse()),
  );

  await page.goto("/reports");

  await expect(
    page.getByRole("heading", { name: "Sign in with your Colony account" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Use NIP-98 instead" }),
  ).toBeDisabled();
  await expect(page.getByRole("heading", { name: "Open reports" })).toHaveCount(
    0,
  );
});

test("a NIP-98 operator can sign in from a direct reports link", async ({
  page,
}) => {
  await seedNip98(page);

  const authorizationHeaders: (string | undefined)[] = [];
  await page.route("**/api/admin/v1/**", async (route) => {
    const headers = route.request().headers();
    authorizationHeaders.push(headers.authorization);
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith("/probe")) {
      await route.fulfill(
        headers.authorization
          ? operatorProbeResponse()
          : unauthorizedResponse(),
      );
      return;
    }
    await route.fulfill(
      headers.authorization
        ? { contentType: "application/json", body: "[]" }
        : unauthorizedResponse(),
    );
  });

  await page.goto("/reports");
  await startNip98SignIn(page);

  await expect(
    page.getByRole("heading", { name: "Open reports" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sign in with your Colony account" }),
  ).toHaveCount(0);
  await expect
    .poll(() => authorizationHeaders.filter(Boolean).length)
    .toBeGreaterThanOrEqual(2);
  const authenticatedHeaders = authorizationHeaders.filter(
    (header): header is string => Boolean(header),
  );
  expect(authenticatedHeaders.length).toBeGreaterThan(0);
  for (const h of authenticatedHeaders) {
    expect(h).toMatch(/^Nostr /);
  }
});

test("nip98 mode: same-second retry re-signs with a distinct event id", async ({
  page,
}) => {
  // Freeze the clock so both signings share created_at (1s resolution). With
  // only u+method+created_at signed, the two events would be byte-identical
  // and collide in the relay's replay guard, so the 401 retry could never
  // recover. The per-signing random nonce tag must make the second event's id
  // distinct despite the frozen clock.
  await page.addInitScript(() => {
    const FROZEN = 1_760_000_000_000;
    const RealDate = Date;
    // biome-ignore lint/suspicious/noExplicitAny: minimal Date shim for the test
    (globalThis as any).Date = class extends RealDate {
      constructor(...args: unknown[]) {
        // biome-ignore lint/suspicious/noExplicitAny: forward constructor args
        super(...(args.length ? (args as any) : [FROZEN]));
      }
      static now() {
        return FROZEN;
      }
    };
  });
  await seedNip98(page);

  const authCalls: string[] = [];
  let reportSignCount = 0;
  await page.route("**/api/admin/v1/**", async (route) => {
    const headers = route.request().headers();
    const pathname = new URL(route.request().url()).pathname;
    if (!headers.authorization) {
      await route.fulfill(unauthorizedResponse());
      return;
    }
    if (pathname.endsWith("/probe")) {
      await route.fulfill(operatorProbeResponse());
      return;
    }
    if (!pathname.endsWith("/reports")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ needsAttention: [] }),
      });
      return;
    }
    authCalls.push(headers.authorization);
    reportSignCount++;
    // First report request rejects, forcing the re-sign + retry.
    await route.fulfill(
      reportSignCount === 1
        ? {
            status: 401,
            headers: { "www-authenticate": "Nostr" },
            contentType: "application/json",
            body: JSON.stringify({
              error: { code: "unauthorized", message: "rejected" },
            }),
          }
        : { contentType: "application/json", body: "[]" },
    );
  });

  await page.goto("/reports");
  await startNip98SignIn(page);
  await expect(
    page.getByRole("heading", { name: "Open reports" }),
  ).toBeVisible();
  await expect.poll(() => authCalls.length).toBe(2);

  expect(authCalls).toHaveLength(2);
  const [first, second] = authCalls.map(decodeNostrHeader);
  // Same frozen created_at, yet distinct ids — the nonce tag did its job.
  expect(first.id).not.toBe(second.id);
  const nonceOf = (tags: string[][]) => tags.find((t) => t[0] === "nonce")?.[1];
  expect(nonceOf(first.tags)).toBeTruthy();
  expect(nonceOf(second.tags)).toBeTruthy();
  expect(nonceOf(first.tags)).not.toBe(nonceOf(second.tags));
});

test("nip98 mode: first-401-then-200 retries once and renders the dashboard", async ({
  page,
}) => {
  // Models a credential that is momentarily rejected (clock skew, key
  // rotation) then accepted on the second attempt.
  let reportSignCount = 0;
  await seedNip98(page);

  const authCalls: string[] = [];
  await page.route("**/api/admin/v1/**", async (route) => {
    const headers = route.request().headers();
    const pathname = new URL(route.request().url()).pathname;
    if (!headers.authorization) {
      await route.fulfill(unauthorizedResponse());
      return;
    }
    if (pathname.endsWith("/probe")) {
      await route.fulfill(operatorProbeResponse());
      return;
    }
    if (!pathname.endsWith("/reports")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ needsAttention: [] }),
      });
      return;
    }
    authCalls.push(headers.authorization);
    reportSignCount++;
    if (reportSignCount === 1) {
      // First authenticated attempt → reject.
      await route.fulfill({
        status: 401,
        headers: { "www-authenticate": "Nostr" },
        contentType: "application/json",
        body: JSON.stringify({
          error: { code: "unauthorized", message: "rejected" },
        }),
      });
    } else {
      // Second attempt → accept.
      await route.fulfill({ contentType: "application/json", body: "[]" });
    }
  });

  await page.goto("/reports");
  await startNip98SignIn(page);

  // The retry should succeed before asserting the report request count.
  await expect.poll(() => authCalls.length).toBe(2);
  // Exactly two distinct Nostr credentials were sent (one per attempt).
  expect(authCalls).toHaveLength(2);
  for (const h of authCalls) {
    expect(h).toMatch(/^Nostr /);
  }
});

test("nip98 mode: persistent 401 surfaces error after exactly one retry", async ({
  page,
}) => {
  // Every authenticated request returns 401. The SPA must attempt exactly
  // two requests (first attempt + one retry) and then surface the error —
  // never a third attempt.
  await seedNip98(page);

  const authCalls: string[] = [];
  await page.route("**/api/admin/v1/**", async (route) => {
    const headers = route.request().headers();
    const pathname = new URL(route.request().url()).pathname;
    if (!headers.authorization) {
      await route.fulfill(unauthorizedResponse());
      return;
    }
    if (pathname.endsWith("/probe")) {
      await route.fulfill(operatorProbeResponse());
      return;
    }
    if (!pathname.endsWith("/reports")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ needsAttention: [] }),
      });
      return;
    }
    authCalls.push(headers.authorization);
    await route.fulfill({
      status: 401,
      headers: { "www-authenticate": "Nostr" },
      contentType: "application/json",
      body: JSON.stringify({
        error: { code: "unauthorized", message: "rejected" },
      }),
    });
  });

  await page.goto("/reports");
  await startNip98SignIn(page);

  // After the retry fails, the error state renders. The StateView shows
  // "Could not load data" inside a role=alert region.
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Could not load data" }),
  ).toBeVisible();
  // Exactly two Nostr credentials sent — no third attempt.
  await expect.poll(() => authCalls.length).toBe(2);
  expect(authCalls).toHaveLength(2);
});
