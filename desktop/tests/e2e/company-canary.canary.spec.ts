import { expect, test, type Page } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { getPublicKey } from "nostr-tools/pure";
import { nip19 } from "nostr-tools";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import { waitForAnimations } from "../helpers/animations";
import {
  installRelayBridge,
  type RelayBridgeIdentity,
} from "../helpers/bridge";
import { openSettings } from "../helpers/settings";

type CanaryAccount = {
  nsec: string;
  host: string;
  channel: string;
  rootId: string;
  pubkey?: string;
};

type CanaryIdentity = RelayBridgeIdentity & { pubkey: string };

const ACCOUNT_FILE = process.env.BUZZ_E2E_CANARY_ACCOUNT_FILE ?? "";
const MANAGED_AGENT_FILE = process.env.BUZZ_E2E_CANARY_AGENT_FILE ?? "";
const ARTIFACT_DIR = process.env.BUZZ_E2E_CANARY_ARTIFACT_DIR ?? "";
const AUTH_SUCCESS_KEY = "__BUZZ_E2E_NIP42_AUTH_SUCCESS_COUNT__";

let account: CanaryAccount;
let identity: CanaryIdentity;
let managedAgentPubkey = "";
let relayHttpUrl: string;
let relayWsUrl: string;
let relaySelf: string;
let communityId: string;
let goalId = "";
let diagnosticsFileName = "canary-diagnostics";
let diagnostics: string[] = [];
const pendingByPage = new WeakMap<
  Page,
  Map<
    object,
    { startedAt: number; endpoint: string; method: string; reported: boolean }
  >
>();

function redactPath(rawPath: string) {
  return rawPath
    .split("/")
    .map((segment) =>
      /^(?:[0-9a-f]{32,}|[0-9a-f-]{36}|nsec1|npub1)/i.test(segment)
        ? "[redacted]"
        : segment,
    )
    .join("/");
}

function redactDiagnosticText(value: string) {
  return value
    .replace(/\bnsec1[0-9a-z]+/gi, "[REDACTED_NSEC]")
    .replace(/\bnpub1[0-9a-z]+/gi, "[REDACTED_NPUB]")
    .replace(/\b[0-9a-f]{64}\b/gi, "[REDACTED_HEX64]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(
      /([?&](?:token|auth|key|signature|secret|code)=)[^&\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(
      /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{48,}(?![A-Za-z0-9_-])/g,
      "[REDACTED_TOKEN_LIKE_VALUE]",
    )
    .replace(
      /\beyJ[a-zA-Z0-9_-]{16,}\.[a-zA-Z0-9_-]{8,}\.[a-zA-Z0-9_-]{8,}\b/g,
      "[REDACTED_JWT]",
    );
}

function safeEndpoint(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return `${url.origin}${redactPath(url.pathname)}`;
  } catch {
    return "[unparsed endpoint]";
  }
}

function pendingRequestsForPage(page: Page) {
  return pendingByPage.get(page)?.values() ?? [];
}

function redactDiagnosticValue(value: unknown, fieldName = ""): unknown {
  if (
    /private.*key|nsec|secret|password|token|signature|pubkey|challenge/i.test(
      fieldName,
    )
  ) {
    return "[REDACTED]";
  }
  if (fieldName === "content") return "[REDACTED_EVENT_CONTENT]";
  if (Array.isArray(value)) {
    return value.map((item) => redactDiagnosticValue(item));
  }
  if (typeof value === "string") return redactDiagnosticText(value);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        redactDiagnosticValue(child, key),
      ]),
    );
  }
  return value;
}

function captureCanaryDiagnostics(page: Page, label: string) {
  const pendingRequests = new Map<
    object,
    { startedAt: number; endpoint: string; method: string; reported: boolean }
  >();
  pendingByPage.set(page, pendingRequests);
  const record = (entry: Record<string, unknown>) => {
    let route = "unknown";
    try {
      const url = new URL(page.url());
      const routePath = url.hash.startsWith("#/")
        ? redactPath(url.hash.slice(1).split("?")[0])
        : redactPath(url.pathname);
      route = `${url.origin}${routePath}`;
    } catch {
      // Keep the diagnostic useful without writing a full URL.
    }
    diagnostics.push(
      JSON.stringify({ at: new Date().toISOString(), label, route, ...entry }),
    );
  };

  page.on("console", (message) => {
    if (message.type() === "error") {
      record({
        type: "console-error",
        message: redactDiagnosticText(message.text()),
      });
    }
  });
  page.on("pageerror", (error) => {
    record({
      type: "page-error",
      message: redactDiagnosticText(error.message),
    });
  });
  page.on("request", (request) => {
    pendingRequests.set(request, {
      startedAt: Date.now(),
      endpoint: safeEndpoint(request.url()),
      method: request.method(),
      reported: false,
    });
  });
  page.on("requestfinished", (request) => pendingRequests.delete(request));
  page.on("requestfailed", (request) => {
    pendingRequests.delete(request);
    record({
      type: "request-failed",
      method: request.method(),
      endpoint: safeEndpoint(request.url()),
      error: redactDiagnosticText(request.failure()?.errorText ?? "unknown"),
    });
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      record({
        type: "http-error",
        status: response.status(),
        method: response.request().method(),
        endpoint: safeEndpoint(response.url()),
      });
    }
  });
  page.on("websocket", (socket) => {
    let address = "unknown";
    try {
      const url = new URL(socket.url());
      address = `${url.protocol}//${url.host}${url.pathname}`;
    } catch {
      // Keep the diagnostic usable without ever writing an unparsed URL.
    }

    const captureFrame = (direction: "sent" | "received", payload: unknown) => {
      if (typeof payload !== "string") {
        const byteLength =
          payload !== null && typeof payload === "object" && "length" in payload
            ? Number(payload.length)
            : 0;
        record({
          type: "websocket-frame",
          address,
          direction,
          frame: `[binary frame, ${byteLength} bytes]`,
        });
        return;
      }

      let frame: unknown;
      try {
        frame = JSON.parse(payload);
      } catch {
        record({
          type: "websocket-frame",
          address,
          direction,
          frame: redactDiagnosticText(payload),
        });
        return;
      }
      if (Array.isArray(frame) && frame[0] === "AUTH") {
        record({
          type: "websocket-frame",
          address,
          direction,
          frame: ["AUTH", "[REDACTED_AUTH_EVENT_OR_CHALLENGE]"],
        });
        return;
      }
      record({
        type: "websocket-frame",
        address,
        direction,
        frame: redactDiagnosticValue(frame),
      });
    };

    socket.on("framesent", ({ payload }) => captureFrame("sent", payload));
    socket.on("framereceived", ({ payload }) =>
      captureFrame("received", payload),
    );
  });
}

async function assertAskCardsSettle(page: Page) {
  const loadingCards = page.getByTestId("ask-card-loading");
  if ((await loadingCards.count()) > 0) {
    await expect(loadingCards).toHaveCount(0, { timeout: 35_000 });
  }
  const errorCards = page.getByTestId("ask-card-error");
  const errorCount = await errorCards.count();
  const retryCount = await errorCards
    .getByRole("button", { name: "Try again" })
    .count();
  expect(retryCount).toBeGreaterThanOrEqual(errorCount);
  const state = await page.evaluate(() => ({
    cards: document.querySelectorAll(".colony-ask-card").length,
    loadingCards: document.querySelectorAll('[data-testid="ask-card-loading"]')
      .length,
    errorCards: document.querySelectorAll('[data-testid="ask-card-error"]')
      .length,
    loadedCards: document.querySelectorAll('[data-testid="ask-card"]').length,
    latestAskStatusText: [
      ...document.querySelectorAll('[role="status"]'),
    ].filter((element) =>
      (element.textContent ?? "").includes("Loading the latest ask"),
    ).length,
  }));
  console.log("CANARY_THREAD_ASK_CARD_STATE", JSON.stringify(state));
}

async function waitForCanaryWriteWindow(page: Page) {
  // The relay's default authenticated WebSocket budget is 50 operations in a
  // fixed five-second window. Let route subscriptions drain before each write
  // so this UI journey measures product behavior rather than quota timing.
  await page.waitForTimeout(6_000);
}

function readAccount(): { account: CanaryAccount; identity: CanaryIdentity } {
  const mode = statSync(ACCOUNT_FILE).mode & 0o777;
  if (mode !== 0o600) {
    throw new Error("The canary account file must have mode 0600.");
  }

  let parsed: CanaryAccount;
  try {
    parsed = JSON.parse(readFileSync(ACCOUNT_FILE, "utf8")) as CanaryAccount;
  } catch {
    throw new Error("The canary account file is not valid JSON.");
  }

  if (
    typeof parsed.nsec !== "string" ||
    typeof parsed.host !== "string" ||
    typeof parsed.channel !== "string" ||
    typeof parsed.rootId !== "string"
  ) {
    throw new Error("The canary account file is missing required fields.");
  }

  const communityUrl = new URL(`https://${parsed.host}`);
  if (
    communityUrl.protocol !== "https:" ||
    !communityUrl.hostname.endsWith(".canary.colony.ainative.ventures") ||
    communityUrl.hostname === "relay-canary.colony.ainative.ventures" ||
    communityUrl.pathname !== "/"
  ) {
    throw new Error("The canary account must target a canary community host.");
  }

  let secretKey: Uint8Array;
  try {
    const decoded = nip19.decode(parsed.nsec);
    if (decoded.type !== "nsec") throw new Error("invalid key type");
    secretKey = decoded.data;
  } catch {
    throw new Error("The canary account signing key is invalid.");
  }

  const pubkey = getPublicKey(secretKey);
  if (parsed.pubkey && parsed.pubkey.toLowerCase() !== pubkey.toLowerCase()) {
    throw new Error("The canary account public key does not match its signer.");
  }

  return {
    account: parsed,
    identity: {
      privateKey: bytesToHex(secretKey),
      pubkey,
      username: "Canary owner",
    },
  };
}

function readManagedAgentPubkey() {
  if (!MANAGED_AGENT_FILE) return "";
  if ((statSync(MANAGED_AGENT_FILE).mode & 0o777) !== 0o600) {
    throw new Error("The managed canary agent file must have mode 0600.");
  }
  let parsed: { agentPubkey?: unknown };
  try {
    parsed = JSON.parse(readFileSync(MANAGED_AGENT_FILE, "utf8")) as {
      agentPubkey?: unknown;
    };
  } catch {
    throw new Error("The managed canary agent file is not valid JSON.");
  }
  if (
    typeof parsed.agentPubkey !== "string" ||
    !/^[0-9a-f]{64}$/i.test(parsed.agentPubkey)
  ) {
    throw new Error("The managed canary agent file has no valid public key.");
  }
  return parsed.agentPubkey.toLowerCase();
}

async function fetchRelaySelf(url: string): Promise<string> {
  const response = await fetch(new URL("/", url), {
    headers: { Accept: "application/nostr+json" },
  });
  if (!response.ok) throw new Error("The canary relay NIP-11 request failed.");
  const info: unknown = await response.json();
  if (
    info === null ||
    typeof info !== "object" ||
    typeof (info as { self?: unknown }).self !== "string"
  ) {
    throw new Error(
      "The canary relay does not advertise its signing identity.",
    );
  }
  return (info as { self: string }).self;
}

async function installCanaryPage(page: Page) {
  await page.addInitScript(
    ({ host, relayUrl, pubkey, activeCommunityId }) => {
      window.localStorage.setItem(
        "buzz-communities",
        JSON.stringify([
          {
            id: activeCommunityId,
            name: host.split(".")[0],
            relayUrl,
            pubkey,
            addedAt: new Date().toISOString(),
          },
        ]),
      );
      window.localStorage.setItem(
        "buzz-active-community-id",
        activeCommunityId,
      );
    },
    {
      host: account.host,
      relayUrl: relayWsUrl,
      pubkey: identity.pubkey,
      activeCommunityId: communityId,
    },
  );
  await installRelayBridge(page, "tyler", {
    relayHttpUrl,
    relaySelf,
    relayRequiresMembership: true,
    skipCommunitySeed: true,
    identity,
    relayAuthMode: "nip42",
  });
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function capture(page: Page, name: string) {
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.waitForFunction(
      (shouldBeDark) =>
        document.documentElement.classList.contains("dark") === shouldBeDark,
      theme === "dark",
    );
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1728, height: 1117 },
    ]) {
      await page.setViewportSize(viewport);
      await waitForAnimations(page);
      const pageMetrics = await page.evaluate(() => {
        const visibleControls = Array.from(
          document.querySelectorAll<HTMLElement>(
            'a[href], button, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])',
          ),
        ).filter(
          (element) =>
            element.getClientRects().length > 0 &&
            !element.hasAttribute("disabled") &&
            element.getAttribute("aria-hidden") !== "true",
        );
        const unnamedCount = visibleControls.filter((element) => {
          const labelledBy = element.getAttribute("aria-labelledby");
          const labelledText = labelledBy
            ? labelledBy
                .split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent ?? "")
                .join(" ")
            : "";
          const labelText =
            element.getAttribute("aria-label") ||
            labelledText ||
            element.getAttribute("title") ||
            (element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement
              ? element.labels?.[0]?.textContent
              : "") ||
            element.textContent ||
            "";
          return !labelText.trim();
        }).length;
        return {
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          focusableCount: visibleControls.length,
          unnamedCount,
        };
      });
      if (pageMetrics.documentWidth > pageMetrics.viewportWidth + 1) {
        diagnostics.push(
          JSON.stringify({
            at: new Date().toISOString(),
            label: name,
            type: "horizontal-overflow",
            viewport: `${viewport.width}x${viewport.height}`,
            documentWidth: pageMetrics.documentWidth,
          }),
        );
      }
      if (pageMetrics.unnamedCount > 0) {
        diagnostics.push(
          JSON.stringify({
            at: new Date().toISOString(),
            label: name,
            type: "interactive-without-accessible-name",
            viewport: `${viewport.width}x${viewport.height}`,
            count: pageMetrics.unnamedCount,
          }),
        );
      }
      for (const pending of pendingRequestsForPage(page)) {
        const elapsedMs = Date.now() - pending.startedAt;
        if (elapsedMs >= 15_000 && !pending.reported) {
          pending.reported = true;
          diagnostics.push(
            JSON.stringify({
              at: new Date().toISOString(),
              label: name,
              type: "request-pending-over-15s",
              method: pending.method,
              endpoint: pending.endpoint,
              elapsedMs,
            }),
          );
        }
      }
      await page.screenshot({
        path: resolve(
          ARTIFACT_DIR,
          `${name}-${viewport.width}x${viewport.height}-${theme}.png`,
        ),
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function waitForNeedsMeSettled(
  page: Page,
): Promise<"empty" | "list" | "error" | "loading"> {
  try {
    let state: "empty" | "list" | "error" | "loading" = "loading";
    await expect
      .poll(
        async () => {
          if (
            (await page
              .getByText("Loading open decisions…", { exact: true })
              .count()) > 0
          ) {
            return "loading";
          }
          if ((await page.locator(".colony-today-query-error").count()) > 0) {
            return "error";
          }
          if ((await page.locator(".colony-today-needs-me-list").count()) > 0) {
            return "list";
          }
          if (
            (await page.locator(".colony-today-needs-me-empty").count()) > 0
          ) {
            return "empty";
          }
          return "loading";
        },
        { timeout: 12_000 },
      )
      .toMatch(/^(empty|list|error)$/);
    state = await page.evaluate(() => {
      if (document.querySelector(".colony-today-query-error")) return "error";
      if (document.querySelector(".colony-today-needs-me-list")) return "list";
      if (document.querySelector(".colony-today-needs-me-empty"))
        return "empty";
      return "loading";
    });
    return state;
  } catch {
    return "loading";
  }
}

async function captureReadOnlyRoute(
  page: Page,
  findings: string[],
  label: string,
  run: () => Promise<void>,
  screenshotName: string,
) {
  try {
    await run();
  } catch (error) {
    findings.push(
      `${label}: ${error instanceof Error ? error.message : "route check failed"}`,
    );
  }
  try {
    await capture(page, screenshotName);
  } catch (error) {
    findings.push(
      `${label} screenshot: ${error instanceof Error ? error.message : "capture failed"}`,
    );
  }
}

async function inspectManagedAgent(page: Page, needsApi: string[]) {
  if (!managedAgentPubkey) {
    needsApi.push(
      "Managed agent profile, duties, and lessons require a real authorized employee record; no managed agent fixture was supplied.",
    );
    return;
  }
  await page.goto("/#/team");
  await expect(page.getByTestId("company-team-screen")).toBeVisible();
  const managedAgentRow = page.getByTestId(
    `company-team-member-${managedAgentPubkey}`,
  );
  if ((await managedAgentRow.count()) === 0) {
    needsApi.push(
      "The managed agent identity has no real employee or position record on canary, so its profile, duties, and lessons are not reachable.",
    );
    await capture(page, "08-team-managed-agent-unavailable-no-employee-record");
    return;
  }
  await page.goto(`/#/team/detail/${managedAgentPubkey}`);
  await expect(page.getByTestId("company-team-member-profile")).toBeVisible();
  await expect(
    page.getByText("Canary QA agent", { exact: true }),
  ).toBeVisible();
  for (const tabName of [
    "Overview",
    "Instructions",
    "Model & runtime",
    "Tools & access",
    "Activity",
    "Salary",
    "Workers",
    "Duties",
    "Lessons",
    "History",
  ]) {
    await expect(page.getByRole("tab", { name: tabName })).toBeVisible();
  }
  await capture(page, "08-team-managed-agent-overview");
  for (const tabName of ["Duties", "Lessons"]) {
    const tab = page.getByRole("tab", { name: tabName });
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await capture(page, `08-team-managed-agent-${tabName.toLowerCase()}`);
  }
}

async function createGoal(page: Page, title: string) {
  await page.goto("/#/goals/new");
  await expect(page.getByTestId("goal-form-screen")).toBeVisible();
  await page.getByLabel("Goal title").fill(title);
  await page
    .getByLabel("Done condition")
    .fill("Canary review evidence is recorded and accepted.");
  await page.locator("#goal-owner").selectOption(identity.pubkey);
  await page.locator("details summary").click();
  await page.getByLabel("Target", { exact: true }).fill("1");
  await page.getByLabel("Unit", { exact: true }).fill("review");
  await page.getByRole("button", { name: "Create goal" }).click();
  await expect(page.getByTestId("goal-detail")).toContainText(title);
  const createdId = page.url().match(/#\/goals\/([0-9a-f-]{36})$/)?.[1];
  if (!createdId) throw new Error("The canary goal route omitted its id.");
  return createdId;
}

async function createMessage(
  page: Page,
  content: string,
  visibleText = content,
) {
  await page.goto(`/#/channels/${account.channel}`);
  await page.getByTestId("message-input").fill(content);
  await page.getByTestId("send-message").click();
  const relayBackedRow = page
    .locator('[data-message-id]:not([data-message-id^="optimistic-"])')
    .filter({ hasText: visibleText });
  await expect(relayBackedRow).toHaveCount(1);
  await expect(relayBackedRow).toHaveAttribute(
    "data-message-id",
    /^[0-9a-f]{64}$/,
  );
  const id = await relayBackedRow.getAttribute("data-message-id");
  if (!id) throw new Error("The canary relay message omitted its event id.");
  await page.reload();
  const persistedRow = page
    .getByTestId("message-timeline")
    .locator(`[data-message-id="${id}"]`)
    .first();
  await expect(persistedRow).toBeVisible();
  await expect(persistedRow).toContainText(visibleText);
  return id;
}

test.describe("signed-in canary company UI", () => {
  test.beforeEach(({ page }, testInfo) => {
    diagnostics = [];
    diagnosticsFileName = testInfo.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    captureCanaryDiagnostics(page, "primary");
  });

  test.beforeAll(async () => {
    test.setTimeout(45_000);
    const loaded = readAccount();
    account = loaded.account;
    identity = loaded.identity;
    managedAgentPubkey = readManagedAgentPubkey();
    relayHttpUrl = `https://${account.host}`;
    relayWsUrl = relayHttpUrl.replace(/^http/, "ws");
    relaySelf = await fetchRelaySelf(relayHttpUrl);
    communityId = `canary-${account.host.split(".")[0]}`;
    const artifactPath = resolve(ARTIFACT_DIR);
    const artifactRelativePath = relative(process.cwd(), artifactPath);
    if (
      !ARTIFACT_DIR ||
      artifactRelativePath === "" ||
      (!artifactRelativePath.startsWith("..") &&
        !isAbsolute(artifactRelativePath))
    ) {
      throw new Error(
        "Canary artifacts must be configured outside the repository.",
      );
    }
    mkdirSync(ARTIFACT_DIR, { recursive: true, mode: 0o700 });
  });

  test.afterEach(() => {
    if (!ARTIFACT_DIR) return;
    writeFileSync(
      resolve(ARTIFACT_DIR, `${diagnosticsFileName}-diagnostics.jsonl`),
      diagnostics.length > 0 ? `${diagnostics.join("\n")}\n` : "",
      { mode: 0o600 },
    );
  });

  test("checks the full app shell and company journeys on the canary relay", async ({
    page,
  }) => {
    test.setTimeout(900_000);
    const authEventIds = new Set<string>();
    const relayFrameCounts = new Map<string, number>();
    const canaryFindings: string[] = [];
    const unproven: string[] = [];
    const needsApi: string[] = [];
    let acceptedAuthCount = 0;
    const observeRelaySockets = (targetPage: Page, label: string) => {
      targetPage.on("websocket", (socket) => {
        let url: URL;
        try {
          url = new URL(socket.url());
        } catch {
          return;
        }
        if (url.hostname !== account.host || url.protocol !== "wss:") return;
        const countRelayFrame = (
          direction: "sent" | "received",
          payload: unknown,
        ) => {
          if (typeof payload !== "string") return;
          try {
            const frame: unknown = JSON.parse(payload);
            if (!Array.isArray(frame) || typeof frame[0] !== "string") return;
            const type = frame[0];
            const detail =
              type === "OK" && typeof frame[2] === "boolean"
                ? `${type}:${frame[2]}`
                : type;
            const key = `${label}:${direction}:${detail}`;
            relayFrameCounts.set(key, (relayFrameCounts.get(key) ?? 0) + 1);
          } catch {
            return;
          }
        };
        socket.on("framesent", ({ payload }) => {
          countRelayFrame("sent", payload);
          if (typeof payload !== "string") return;
          try {
            const frame: unknown = JSON.parse(payload);
            if (
              Array.isArray(frame) &&
              frame[0] === "AUTH" &&
              typeof frame[1] === "object" &&
              frame[1] !== null &&
              "kind" in frame[1] &&
              frame[1].kind === 22242 &&
              frame[1].pubkey === identity.pubkey
            ) {
              authEventIds.add(String(frame[1].id));
            }
          } catch {
            return;
          }
        });
        socket.on("framereceived", ({ payload }) => {
          countRelayFrame("received", payload);
          if (typeof payload !== "string") return;
          try {
            const frame: unknown = JSON.parse(payload);
            if (
              Array.isArray(frame) &&
              frame[0] === "OK" &&
              typeof frame[1] === "string" &&
              authEventIds.has(frame[1]) &&
              frame[2] === true
            ) {
              acceptedAuthCount += 1;
            }
          } catch {
            return;
          }
        });
      });
    };
    observeRelaySockets(page, "primary");

    await installCanaryPage(page);
    await page.goto("/#/today");
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
    await expect(page.getByRole("region", { name: "Needs me" })).toBeVisible();
    await expect(page.getByTestId("channel-general")).toBeVisible();
    const needsMeState = await waitForNeedsMeSettled(page);
    if (needsMeState === "loading" || needsMeState === "error") {
      canaryFindings.push(
        `Today Needs me did not settle successfully; observed state: ${needsMeState}.`,
      );
    }
    await capture(page, "01-today-needs-me");

    const goalTitle = `Canary UI goal ${randomUUID().slice(0, 8)}`;
    await waitForCanaryWriteWindow(page);
    goalId = await createGoal(page, goalTitle);
    await page.reload();
    await expect(page.getByTestId("goal-detail")).toContainText(goalTitle);
    await page.getByRole("button", { name: "Update progress" }).click();
    await page.getByLabel("Current value").fill("1");
    const progress = page.getByTestId("goal-progress-screen");
    await progress.getByLabel("Status").selectOption("off_pace");
    await progress
      .getByLabel("Evidence or update")
      .fill("Canary review evidence was attached to the active goal.");
    await waitForCanaryWriteWindow(page);
    await page.getByRole("button", { name: "Record update" }).click();
    await expect(page.getByTestId("goal-detail")).toContainText("off pace");
    await expect(page.getByTestId("goal-detail")).toContainText(
      "Canary review evidence was attached to the active goal.",
    );
    await page.reload();
    await expect(page.getByTestId("goal-detail")).toContainText("off pace");
    await expect(page.getByTestId("goal-detail")).toContainText("active");
    await capture(page, "02-goals-active-with-evidence");

    await page.goto(
      `/#/channels/${account.channel}?messageId=${account.rootId}&threadRootId=${account.rootId}`,
    );
    const askSourceRow = page
      .getByTestId("message-timeline")
      .locator(`[data-message-id="${account.rootId}"]`)
      .first();
    await expect(askSourceRow).toBeVisible();
    await askSourceRow.hover();
    await askSourceRow.getByTestId(`more-actions-${account.rootId}`).click();
    await page.getByTestId(`raise-ask-message-${account.rootId}`).click();
    await expect(
      page.getByRole("heading", { name: "Raise an ask" }),
    ).toBeVisible();
    const askRecipient = page.locator("#ask-addressee");
    await expect
      .poll(async () => {
        if (
          (await page
            .getByText("You’re the only member here", { exact: true })
            .count()) > 0
        ) {
          return "empty";
        }
        if (
          (await askRecipient.count()) > 0 &&
          (await askRecipient.isEnabled())
        ) {
          return "ready";
        }
        return "loading";
      })
      .toMatch(/^(empty|ready)$/);
    if (
      (await page
        .getByText("You’re the only member here", { exact: true })
        .count()) > 0
    ) {
      await expect(
        page.getByRole("button", { name: "Send ask" }),
      ).toBeDisabled();
      unproven.push(
        "The live #general channel currently has no other ask recipient, so the multi-member draft state was not available.",
      );
      await capture(page, "03-asks-no-other-recipient");
    } else {
      const recipientValues = await askRecipient
        .locator("option")
        .evaluateAll((options) =>
          options
            .map((option) => (option as HTMLOptionElement).value)
            .filter(Boolean),
        );
      const eligibleRecipients = recipientValues.filter(
        (pubkey) => pubkey.toLowerCase() !== identity.pubkey.toLowerCase(),
      );
      expect(eligibleRecipients.length).toBeGreaterThan(0);
      await askRecipient.selectOption(eligibleRecipients[0]);
      await expect(askRecipient).not.toHaveValue(identity.pubkey);
      await page
        .getByLabel("What needs a response?")
        .fill("Canary ask draft, not sent");
      await page
        .getByLabel("Context")
        .fill("Reviewing the recipient and draft state only.");
      await capture(page, "03-asks-recipient-draft-not-sent");
    }

    needsApi.push(
      "Ask decision reasons need a real eligible human recipient. The canary fixture cannot verify one, and the relay rejects Approval asks addressed to agents.",
    );

    const sourceLabel = `Canary work source ${randomUUID().slice(0, 8)}`;
    const sourceText = `${sourceLabel} buzz://goal/${goalId}`;
    await waitForCanaryWriteWindow(page);
    const sourceId = await createMessage(page, sourceText, sourceLabel);
    const sourceRow = page
      .getByTestId("message-timeline")
      .locator(`[data-message-id="${sourceId}"]`)
      .first();
    await expect(sourceRow).toBeVisible();
    await expect(
      sourceRow.getByTestId(`create-company-work-from-message-${sourceId}`),
    ).toBeVisible();
    await sourceRow
      .getByTestId(`create-company-work-from-message-${sourceId}`)
      .click();
    await expect(page.getByTestId("company-work-form")).toBeVisible();
    await expect(page.getByTestId("company-work-goal")).toHaveValue(goalId);
    const workTitle = `Canary work ${randomUUID().slice(0, 8)}`;
    await page.getByTestId("company-work-title").fill(workTitle);
    await page
      .getByTestId("company-work-done-condition")
      .fill("Canary work evidence is reviewed.");
    await page.getByTestId("company-work-owner").selectOption(identity.pubkey);
    await page
      .getByTestId("company-work-requester")
      .selectOption(identity.pubkey);
    await page
      .getByTestId("company-work-evidence")
      .fill("The relay accepted this synthetic evidence.");
    await waitForCanaryWriteWindow(page);
    await page.getByRole("button", { name: "Create commitment" }).click();
    await expect(page.getByTestId("company-work-detail")).toContainText(
      workTitle,
    );
    const workId = page.url().match(/#\/work\/detail\/([0-9a-f-]{36})$/)?.[1];
    if (!workId) throw new Error("The canary work route omitted its id.");
    await page.reload();
    await expect(page.getByTestId("company-work-detail")).toContainText(
      workTitle,
    );

    await page.goto(`/#/work/edit/${workId}`);
    await expect(page.getByTestId("company-work-form")).toBeVisible();
    await expect(page.getByTestId("company-work-title")).toHaveValue(workTitle);
    await page
      .getByTestId("company-work-title")
      .fill("Canary work edit draft, not saved");
    await capture(page, "04-work-edit-draft-not-saved");

    await page.goto(`/#/work/tracking/watchdog/${workId}`);
    if (
      (await page
        .getByText("Watchdog settings unavailable", { exact: true })
        .count()) > 0
    ) {
      needsApi.push(
        "Work watchdog configuration is unreachable because the live canary returned no work tracking records.",
      );
    } else {
      await expect(
        page.getByText("Off until configured", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("No interval selected", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByLabel("Quiet time before a review, minutes"),
      ).toHaveValue("");
      await expect(
        page.getByRole("button", { name: "Review configuration" }),
      ).toBeDisabled();
    }
    await capture(page, "04-work-watchdog-off-no-interval");

    await page.goto(`/#/work/tracking/due/${workId}`);
    await expect(page.getByTestId("company-work-detail")).toBeVisible();
    needsApi.push(
      "Work due-date editing is unreachable until the server exposes the configured workspace timezone.",
    );
    await capture(page, "04-work-due-date-unavailable-without-timezone");

    await page.goto("/#/company-work");
    const ownerFilter = page.getByTestId("company-work-owner-filter");
    const goalFilter = page.getByTestId("company-work-goal-filter");
    await ownerFilter.click();
    await page
      .getByRole("textbox", { name: "Search owners" })
      .fill(identity.pubkey.slice(0, 8));
    const ownerOption = page.getByTestId(
      `company-work-owner-filter-option-${identity.pubkey.toLowerCase()}`,
    );
    await expect(ownerOption).toBeVisible();
    await ownerOption.click();
    await goalFilter.click();
    await page.getByRole("textbox", { name: "Search goals" }).fill(goalTitle);
    const goalOption = page.getByTestId(
      `company-work-goal-filter-option-${goalId}`,
    );
    await expect(goalOption).toBeVisible();
    await goalOption.click();
    await expect(page.getByTestId(`company-work-row-${workId}`)).toBeVisible();
    await expect(page.getByTestId("company-work-filter-chips")).toContainText(
      "Owner:",
    );
    await expect(page.getByTestId("company-work-filter-chips")).toContainText(
      "Goal:",
    );

    const destinationText = `Canary destination ${randomUUID().slice(0, 8)}`;
    await waitForCanaryWriteWindow(page);
    const destinationRootId = await createMessage(page, destinationText);
    await page.goto(`/#/work/detail/${workId}`);
    await page.getByRole("button", { name: "Move to another thread" }).click();
    await expect(page.getByTestId("company-work-move")).toBeVisible();
    const destinationRoot = page.getByTestId(
      `company-work-move-root-${destinationRootId}`,
    );
    await expect(destinationRoot).toBeEnabled();
    await destinationRoot.click();
    await page.getByRole("button", { name: "Review move" }).click();
    await waitForCanaryWriteWindow(page);
    await page.getByRole("button", { name: "Move work item" }).click();
    await expect(page.getByTestId("company-work-detail")).toContainText(
      workTitle,
    );
    await page.reload();
    await expect(page.getByTestId("company-work-detail")).toContainText(
      workTitle,
    );
    await page.goto(
      `/#/channels/${account.channel}?messageId=${destinationRootId}&threadRootId=${destinationRootId}`,
    );
    await expect(
      page.getByTestId(`company-work-current-card-${workId}`),
    ).toBeVisible();
    await capture(page, "04-work-moved-with-evidence");

    await page.goto(`/#/team/detail/${identity.pubkey}`);
    await expect(page.getByTestId("company-team-member-profile")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "History" })).toBeVisible();
    await capture(page, "05-team-human-owner-profile");

    await page.goto("/#/team/org");
    await expect(
      page.getByRole("tree", { name: "Reporting lines" }),
    ).toBeVisible();
    await expect(
      page.getByTestId(`company-team-member-${identity.pubkey}`),
    ).toBeVisible();
    await capture(page, "05-team-org-chart");

    await page.goto(`/#/team/detail/${identity.pubkey}`);
    await expect(page.getByTestId("company-team-member-profile")).toBeVisible();
    await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "History" })).toBeVisible();
    await capture(page, "08-owner-profile-overview-and-history");

    await inspectManagedAgent(page, needsApi);

    needsApi.push(
      "Secret binding and revocation need a real pending request authored by the managed agent. No such server-side record is available on canary, so the suite does not synthesize one.",
    );
    await page.goto("/#/secrets?state=empty");
    await expect(page.getByTestId("secret-bindings-screen")).toBeVisible();
    await expect(page.getByText("No secrets bound")).toBeVisible();
    await capture(page, "06-secrets-empty-no-pending-request");

    await page.goto("/#/today");
    await openSettings(page, "compute");
    await expect(page.getByTestId("settings-mesh-share-compute")).toBeVisible();
    await capture(page, "07-settings-mesh-compute");

    await page.goto("/#/money/invoices");
    await expect(page.getByTestId("money-invoices-page")).toBeVisible();
    await expect(page.getByTestId("money-invoice-list")).toBeVisible();
    await capture(page, "09-money-invoice-list");
    if (
      (await page
        .getByRole("button", { name: "Create invoice", exact: true })
        .count()) === 0
    ) {
      unproven.push(
        "Invoice entry and configured tax behavior remain unproven because the canary has no invoice record or draft entry action.",
      );
    }

    const authState = await page.evaluate((successKey) => {
      const testWindow = window as Window & Record<string, unknown>;
      return Number(testWindow[successKey] ?? 0);
    }, AUTH_SUCCESS_KEY);
    expect(authEventIds.size).toBeGreaterThan(0);
    expect(acceptedAuthCount).toBeGreaterThan(0);
    expect(authState).toBeGreaterThan(0);
    console.log("CANARY_NEEDS_API", JSON.stringify(needsApi));
    console.log("CANARY_UNPROVEN", JSON.stringify(unproven));
    expect(canaryFindings, canaryFindings.join("\n")).toEqual([]);
  });

  test("walks ask destination, type, allowance, and zoom states without submitting", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    page.setDefaultTimeout(12_000);
    await installCanaryPage(page);

    await page.goto("/#/asks/new");
    await expect(
      page.getByRole("heading", { name: "Raise an ask" }),
    ).toBeVisible();
    const channel = page.getByLabel("Channel", { exact: true });
    await expect(channel).toBeVisible();
    await expect
      .poll(async () => channel.locator("option").count(), { timeout: 15_000 })
      .toBeGreaterThan(1);
    const chooseThread = page.getByRole("button", {
      name: "Choose a thread",
    });
    await expect(chooseThread).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Cancel", exact: true }),
    ).toBeVisible();
    await capture(page, "03-asks-channel-step");
    await channel.selectOption(account.channel);

    await expect(chooseThread).toBeEnabled();
    await channel.focus();
    await page.keyboard.press("Tab");
    await expect(chooseThread).toBeFocused();
    await page.keyboard.press("Enter");
    const threadSelect = page.getByLabel("Thread", { exact: true });
    const emptyThreadsHeading = page.getByRole("heading", {
      name: "No threads in this channel yet",
    });
    await expect
      .poll(
        async () => {
          if (await emptyThreadsHeading.isVisible()) return "empty";
          return (await threadSelect.isEnabled()) ? "ready" : "loading";
        },
        { timeout: 15_000 },
      )
      .not.toBe("loading");
    const hasEmptyThreadState = await emptyThreadsHeading.isVisible();
    const startNewThread = hasEmptyThreadState
      ? page.getByRole("button", { name: "Start a thread", exact: true })
      : page.getByRole("button", {
          name: "Start a new thread",
          exact: true,
        });
    if (!hasEmptyThreadState) {
      await expect(
        page.getByRole("button", { name: "Cancel", exact: true }),
      ).toHaveCount(0);
    }
    await capture(
      page,
      hasEmptyThreadState ? "03-asks-empty-threads" : "03-asks-threads-step",
    );
    await startNewThread.focus();
    await page.keyboard.press("Space");
    await expect(page.getByLabel("New thread title")).toBeVisible();
    const cancelNewThread = page.getByRole("button", {
      name: "Cancel",
      exact: true,
    });
    await expect(cancelNewThread).toBeVisible();
    await page
      .getByLabel("New thread title")
      .fill("Canary draft discussion, not sent");
    const openingContext = page.getByLabel("Opening context, optional");
    await openingContext.fill(
      "Checking the thread destination and keyboard flow only.",
    );
    await capture(page, "03-asks-new-thread-destination-not-sent");
    await page.setViewportSize({ width: 1728, height: 1117 });
    const askStep = await page
      .locator(".colony-ask-context-step")
      .boundingBox();
    expect(askStep?.width).toBe(1140);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openingContext.press("Tab");
    const continueButton = page.getByRole("button", {
      name: "Continue to ask",
    });
    await expect(continueButton).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(cancelNewThread).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(continueButton).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("region", { name: "Ask details" }),
    ).toBeVisible();
    await expect(page.getByLabel("What needs a response?")).toBeVisible();

    const rootBefore = await page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
    );
    const modifier = await page.evaluate(() =>
      /mac|iphone|ipad|ipod/i.test(navigator.platform) ? "Meta" : "Control",
    );
    await page.keyboard.press(`${modifier}+Equal`);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Number.parseFloat(
            getComputedStyle(document.documentElement).fontSize,
          ),
        ),
      )
      .toBeGreaterThan(rootBefore);
    await capture(page, "03-asks-text-zoom-in");
    await page.keyboard.press(`${modifier}+Minus`);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Number.parseFloat(
            getComputedStyle(document.documentElement).fontSize,
          ),
        ),
      )
      .toBeCloseTo(rootBefore, 0);

    for (const label of [
      "Approval",
      "Question",
      "Choice",
      "Checklist",
      "Verdict",
      "Hire proposal",
    ]) {
      const askType = page.getByRole("button", { name: label, exact: true });
      await askType.click();
      if (label === "Hire proposal") {
        await expect(
          page.getByRole("heading", { name: "Propose a hire" }),
        ).toBeVisible();
        await capture(page, "03-asks-type-hire-proposal-not-sent");
        continue;
      }
      await expect(askType).toHaveAttribute("aria-pressed", "true");
      if (label === "Choice") {
        await expect(page.getByLabel("Choices, one per line")).toBeVisible();
      }
      if (label === "Checklist") {
        await expect(
          page.getByLabel("Items to confirm, one per line"),
        ).toBeVisible();
      }
      await capture(
        page,
        `03-asks-type-${label.toLowerCase().replaceAll(" ", "-")}-not-sent`,
      );
    }

    await page.goto("/#/asks/new?type=money");
    await expect(
      page.getByRole("heading", {
        name: "Request an allowance or cost approval",
      }),
    ).toBeVisible();
    await capture(page, "10-money-allowance-choice");
    await page.getByRole("button", { name: /Adjust an allowance/ }).click();
    await expect(
      page.getByRole("heading", { name: "Allowance change" }),
    ).toBeVisible();
    for (const label of [
      "Employee or budget",
      "Change duration",
      "Temporary end date, if applicable",
      "Requested amount, USD",
      "Reason",
    ]) {
      await expect(page.getByLabel(label)).toHaveValue("");
    }
    await capture(page, "10-money-allowance-empty-fields-not-submitted");
  });

  test("inspects company, AI spend, hiring, permissions, factory, and settings surfaces", async ({
    page,
  }) => {
    test.setTimeout(900_000);
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(15_000);
    const findings: string[] = [];
    const unproven: string[] = [];
    const needsApi: string[] = [];
    await installCanaryPage(page);

    const inspectRoute = async (
      label: string,
      route: string,
      marker: string,
      screenshotName: string,
    ) => {
      await captureReadOnlyRoute(
        page,
        findings,
        label,
        async () => {
          await page.goto(route);
          await expect(page.getByTestId(marker)).toBeVisible();
        },
        screenshotName,
      );
    };

    await inspectRoute(
      "Goals list",
      "/#/goals",
      "goals-screen",
      "02-goals-list-read-only",
    );
    await inspectRoute(
      "Company work list",
      "/#/company-work",
      "company-work-list",
      "04-work-list-read-only",
    );
    const workRows = page.locator('[data-testid^="company-work-row-"]');
    await expect
      .poll(
        async () => {
          if ((await workRows.count()) > 0) return "rows";
          if (
            (await page.getByTestId("company-work-empty-filtered").count()) > 0
          )
            return "empty";
          if (
            (await page
              .getByRole("heading", { name: "Work unavailable" })
              .count()) > 0
          ) {
            return "unavailable";
          }
          return "loading";
        },
        { timeout: 15_000 },
      )
      .not.toBe("loading");
    if ((await workRows.count()) === 0) {
      needsApi.push(
        "No real canary work item is available to open its watchdog settings, so the off-by-default work-item state is unreachable.",
      );
      await capture(page, "04-work-watchdog-no-real-work-item");
    } else {
      await workRows.first().focus();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("company-work-detail")).toBeVisible();
      await page.getByRole("button", { name: "Full timeline" }).click();
      await expect(
        page.getByTestId("company-work-full-timeline"),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Watchdog settings", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Work watchdog" }),
      ).toBeVisible();
      const isUnconfigured = await page
        .getByText("Off until configured", { exact: true })
        .isVisible();
      if (isUnconfigured) {
        await expect(
          page.getByText("No interval selected", { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByLabel("Quiet time before a review, minutes"),
        ).toHaveValue("");
        await expect(page.getByLabel("Reviewer")).toHaveValue("");
        await expect(
          page.getByRole("button", { name: "Review configuration" }),
        ).toBeDisabled();
      } else {
        needsApi.push(
          "The real canary work item already has watchdog configuration, so the unconfigured state cannot be checked on that record without changing its authority state.",
        );
      }
      await capture(
        page,
        isUnconfigured
          ? "04-work-watchdog-live-off-no-interval"
          : "04-work-watchdog-live-configured-record-read-only",
      );
      await page.setViewportSize({ width: 1728, height: 1117 });
      const watchdogPanel = await page.locator("main > section").boundingBox();
      expect(watchdogPanel?.width).toBe(1140);
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    await inspectRoute(
      "Team list",
      "/#/team",
      "company-team-screen",
      "05-team-list-read-only",
    );
    await inspectRoute(
      "Workflow list",
      "/#/workflows",
      "workflows-view",
      "11-workflows-list-read-only",
    );

    for (const section of ["overview", "usage", "connections", "history"]) {
      await inspectRoute(
        `Power ${section}`,
        `/#/power${section === "overview" ? "" : `?section=${section}`}`,
        "power-screen",
        `12-power-${section}-read-only`,
      );
    }
    if (managedAgentPubkey) {
      await page.goto(`/#/power?panel=employee&employee=${managedAgentPubkey}`);
      await expect(page.getByTestId("power-screen")).toBeVisible();
      if ((await page.getByTestId("power-employee-spend").count()) === 0) {
        needsApi.push(
          "The managed agent has no AI spend or allowance record on canary, so employee spend details are unavailable.",
        );
      }
      await capture(page, "12-power-managed-agent-spend-read-only");
    } else {
      unproven.push(
        "Managed agent AI spend needs BUZZ_E2E_CANARY_AGENT_FILE and a real canary employee record.",
      );
    }

    await inspectRoute(
      "Money overview",
      "/#/money",
      "money-overview",
      "09-money-overview-read-only",
    );
    await inspectRoute(
      "Money invoices",
      "/#/money/invoices",
      "money-invoice-list",
      "09-money-invoices-read-only",
    );
    const createInvoice = page.getByRole("button", {
      name: "Create invoice",
      exact: true,
    });
    if ((await createInvoice.count()) === 0) {
      needsApi.push(
        "Canary exposes no invoice draft entry action or invoice record, so invoice creation and the configured zero-tax state cannot be inspected safely.",
      );
    }

    await captureReadOnlyRoute(
      page,
      findings,
      "Role catalog",
      async () => {
        await page.goto("/#/hire/roles");
        await expect(
          page.getByRole("heading", { name: "Role catalog", exact: true }),
        ).toBeVisible();
      },
      "13-hire-role-catalog-read-only",
    );
    await captureReadOnlyRoute(
      page,
      findings,
      "Role-pack draft",
      async () => {
        await page.goto("/#/hire/roles");
        await page
          .getByRole("button", { name: "Create role pack", exact: true })
          .click();
        await expect
          .poll(async () => {
            if ((await page.getByTestId("company-role-editor").count()) > 0) {
              return "editor";
            }
            for (const kind of ["runtime", "provider", "model"]) {
              if (
                (await page
                  .getByTestId(`company-role-${kind}-recovery`)
                  .count()) > 0
              ) {
                return kind;
              }
            }
            return "loading";
          })
          .not.toBe("loading");

        const editor = page.getByTestId("company-role-editor");
        if ((await editor.count()) > 0) {
          await expect(page.locator("#company-role-title")).toHaveValue("");
          await expect(page.locator("#company-role-job")).toHaveValue("");
          await expect(page.locator("#company-role-skills")).toHaveValue("");
          await expect(
            editor.locator('input[type="checkbox"]:checked'),
          ).toHaveCount(0);
          await expect(
            editor.locator('input[id^="company-role-tool-"]'),
          ).toHaveCount(0);
          await expect(
            editor.locator('select[id^="company-role-risk-"]'),
          ).toHaveCount(0);
          await expect(
            editor.getByText(
              "No model, tool or allowance is preselected. The real picker is populated by configured runtimes.",
              { exact: true },
            ),
          ).toBeVisible();
          return;
        }

        needsApi.push(
          "The role-pack editor is in runtime recovery on canary, so its configured worker choices are unavailable. No role pack was saved.",
        );
      },
      "13-hire-role-pack-draft-or-runtime-recovery",
    );
    needsApi.push(
      "Founder handoff requires a real canary hire proposal and authorized founder-review record; none was available for this run, and no proposal was submitted to create one.",
    );

    for (const [label, route] of [
      ["Factory desk", "/#/factory"],
      ["Factory projects", "/#/factory/projects"],
      ["Factory plans", "/#/factory/plans"],
      ["Factory sessions", "/#/factory/sessions"],
      ["Factory states", "/#/factory/states"],
    ] as const) {
      await captureReadOnlyRoute(
        page,
        findings,
        label,
        async () => {
          await page.goto(route);
          await expect(page.getByTestId("factory-workspace")).toBeVisible();
          if (label === "Factory desk") {
            await expect(page.getByTestId("factory-desk-layout")).toBeVisible();
          }
        },
        `14-${label.toLowerCase().replaceAll(" ", "-")}-read-only`,
      );
    }

    if (managedAgentPubkey) {
      await page.goto(`/#/permission/new?agent=${managedAgentPubkey}`);
      await expect(page.getByTestId("permission-screen")).toBeVisible();
      const permissionForm = page.getByTestId("permission-form");
      const authorityMessage = page.getByText(
        "Only company owners and admins can manage standing permissions.",
        { exact: true },
      );
      const unavailableMessage = page.getByText(
        "Permission details or authority could not be verified. Try again after the relay is available.",
        { exact: true },
      );
      await expect
        .poll(
          async () => {
            if (await permissionForm.isVisible().catch(() => false)) {
              return "form";
            }
            if (await authorityMessage.isVisible().catch(() => false)) {
              return "authority";
            }
            if (await unavailableMessage.isVisible().catch(() => false)) {
              return "unavailable";
            }
            return "loading";
          },
          { timeout: 15_000 },
        )
        .not.toBe("loading");
      if ((await permissionForm.count()) > 0) {
        await expect(page.locator("#permission-action")).toHaveValue("");
        await expect(page.locator("#permission-scope")).toHaveValue("");
        await expect(page.locator("#permission-expires")).toHaveValue("");
        await expect(page.locator("#permission-confirm")).not.toBeChecked();
        await expect(
          permissionForm.getByRole("button", { name: "Confirm permission" }),
        ).toBeDisabled();
      } else {
        needsApi.push(
          `The managed-agent permission route settled in the ${await authorityMessage.isVisible().then((visible) => (visible ? "unauthorized" : "unavailable"))} state, so the empty-scope and empty-expiry guard could not be checked.`,
        );
      }
      await capture(page, "15-existing-standing-grant-explicit-fields");
      needsApi.push(
        "The canary has no real pending tool-consent request for the frozen B2 scope-and-expiry flow. The existing Tools & access grant page is a separate standing-grant entry and cannot stand in for that context-bound request.",
      );
    } else {
      unproven.push(
        "Permission grant scope and expiry checks need BUZZ_E2E_CANARY_AGENT_FILE.",
      );
    }

    for (const section of [
      "privacy",
      "appearance",
      "compute",
      "profile",
      "security",
    ] as const) {
      await page.goto("/#/today");
      await openSettings(page, section);
      const marker =
        section === "privacy"
          ? "settings-privacy"
          : section === "appearance"
            ? "settings-appearance"
            : section === "compute"
              ? "settings-mesh-share-compute"
              : section === "profile"
                ? "settings-profile"
                : "settings-account-security";
      await expect(page.getByTestId(marker)).toBeVisible();
      await capture(page, `16-settings-${section}-read-only`);
      if (section === "appearance") {
        await page.getByRole("button", { name: "Browse named themes" }).click();
        const themeCatalog = page.getByTestId("settings-theme-catalog");
        await expect(themeCatalog).toHaveAttribute(
          "data-theme-catalog-ready",
          "true",
        );
        await capture(page, "16-settings-appearance-named-theme-catalog");
        await page.getByTestId("theme-catalog-buzz").click();
        const themePreview = page.getByTestId("settings-theme-preview");
        await expect(themePreview).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Apply appearance" }),
        ).toBeEnabled();
        await expect(
          page.getByRole("button", { name: "Cancel preview" }),
        ).toBeEnabled();
        await capture(page, "16-settings-appearance-buzz-preview-not-applied");
        await page.getByRole("button", { name: "Cancel preview" }).click();
      }
    }

    unproven.push(
      "Fresh-account onboarding is unreachable with the already-onboarded canary owner fixture; the live onboarding flow was not reset or replaced.",
      "Batch 2 Flutter screens were not exercised in the signed-in desktop canary browser; no Flutter canary runtime was available in this suite.",
      "A global Settings watchdog route is not present. The available watchdog configuration is scoped to a real work item and is checked in the work flow.",
    );
    console.log(`CANARY_SURFACE_FINDINGS ${JSON.stringify(findings)}`);
    console.log(`CANARY_SURFACE_NEEDS_API ${JSON.stringify(needsApi)}`);
    console.log(`CANARY_SURFACE_UNPROVEN ${JSON.stringify(unproven)}`);
    expect(findings, findings.join("\n")).toEqual([]);
  });

  test("captures read-only canary routes after any write quota limit", async ({
    page,
  }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(10_000);
    page.setDefaultNavigationTimeout(10_000);
    const findings: string[] = [];
    const unproven: string[] = [];
    await installCanaryPage(page);

    await captureReadOnlyRoute(
      page,
      findings,
      "Today",
      async () => {
        await page.goto("/#/today");
        await expect(page.getByTestId("app-sidebar")).toBeVisible();
        await expect(
          page.getByRole("region", { name: "Needs me" }),
        ).toBeVisible();
        await expect(page.getByTestId("channel-general")).toBeVisible();
        const state = await waitForNeedsMeSettled(page);
        if (state === "loading" || state === "error") {
          throw new Error(`Needs me query ended in ${state}.`);
        }
      },
      "01-today-needs-me-read-only",
    );

    await captureReadOnlyRoute(
      page,
      findings,
      "Work source thread",
      async () => {
        await page.goto(
          `/#/channels/${account.channel}?messageId=${account.rootId}&threadRootId=${account.rootId}`,
        );
        const sourceRow = page
          .getByTestId("message-timeline")
          .locator(`[data-message-id="${account.rootId}"]`)
          .first();
        await expect(sourceRow).toBeVisible({ timeout: 30_000 });
        await expect
          .poll(() => page.locator(".colony-ask-card").count(), {
            timeout: 15_000,
          })
          .toBeGreaterThan(0);
        await assertAskCardsSettle(page);
        await sourceRow.hover();
        const createWorkButton = sourceRow.getByTestId(
          `create-company-work-from-message-${account.rootId}`,
        );
        if ((await createWorkButton.count()) === 0) {
          unproven.push(
            "Work from a message: the existing root has no goal reference, so the message-origin work form is unavailable without a relay write.",
          );
          return;
        }
        await createWorkButton.click();
        await expect(page.getByTestId("company-work-form")).toBeVisible();
        await page
          .getByTestId("company-work-title")
          .fill("Canary work form, not submitted");
        await page
          .getByTestId("company-work-done-condition")
          .fill("A synthetic canary commitment should be reviewed.");
        await page
          .getByTestId("company-work-owner")
          .selectOption(identity.pubkey);
        await page
          .getByTestId("company-work-requester")
          .selectOption(identity.pubkey);
      },
      "04-work-source-thread-read-only",
    );

    await captureReadOnlyRoute(
      page,
      findings,
      "Work create form",
      async () => {
        await page.goto("/#/company-work");
        await expect(page.getByTestId("company-work-list")).toBeVisible();
        await page.getByRole("button", { name: "Create work item" }).click();
        await expect(page.getByTestId("company-work-form")).toBeVisible();
        await page
          .getByTestId("company-work-title")
          .fill("Canary work form, not submitted");
        await page
          .getByTestId("company-work-done-condition")
          .fill("A synthetic canary commitment should be reviewed.");
        await page
          .getByTestId("company-work-owner")
          .selectOption(identity.pubkey);
        await page
          .getByTestId("company-work-requester")
          .selectOption(identity.pubkey);
      },
      "04-work-create-form-not-submitted-read-only",
    );

    await captureReadOnlyRoute(
      page,
      findings,
      "Work filters",
      async () => {
        await page.goto("/#/company-work");
        await expect(page.getByTestId("company-work-list")).toBeVisible();
        await page.getByTestId("company-work-owner-filter").click();
        const ownerSearch = page.getByRole("textbox", {
          name: "Search owners",
        });
        await ownerSearch.fill("Canary");
        await expect(page.getByText("No owners found.")).toBeVisible();
        unproven.push(
          "Filtering work by person: no work records exist, so the owner selector has no person options.",
        );

        await page.getByTestId("company-work-goal-filter").click();
        const goalSearch = page.getByRole("textbox", { name: "Search goals" });
        await goalSearch.fill("Canary UI goal");
        const goalOption = page
          .getByRole("option")
          .filter({ hasText: "Canary UI goal" })
          .first();
        if ((await goalOption.count()) === 0) {
          unproven.push(
            "Filtering work by goal: the canary goal was not returned by the goal selector.",
          );
        } else {
          await goalOption.click();
          await expect(
            page.getByTestId("company-work-filter-chips"),
          ).toContainText("Goal:");
        }
      },
      "04-work-filters-read-only",
    );

    await captureReadOnlyRoute(
      page,
      findings,
      "Team human owner profile",
      async () => {
        await page.goto(`/#/team/detail/${identity.pubkey}`);
        await expect(
          page.getByTestId("company-team-member-profile"),
        ).toBeVisible();
        await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
        await expect(page.getByRole("tab", { name: "History" })).toBeVisible();
        for (const tabName of [
          "Instructions",
          "Model & runtime",
          "Tools & access",
          "Salary",
          "Workers",
          "Duties",
          "Lessons",
        ]) {
          await expect(page.getByRole("tab", { name: tabName })).toHaveCount(0);
        }
      },
      "05-team-human-owner-profile-read-only",
    );

    await captureReadOnlyRoute(
      page,
      findings,
      "Team org chart",
      async () => {
        await page.goto("/#/team/org");
        await expect(
          page.getByRole("tree", { name: "Reporting lines" }),
        ).toBeVisible();
        await expect(
          page.getByTestId(`company-team-member-${identity.pubkey}`),
        ).toBeVisible();
      },
      "05-team-org-chart-read-only",
    );

    await captureReadOnlyRoute(
      page,
      findings,
      "Secrets list",
      async () => {
        await page.goto("/#/secrets?state=empty");
        await expect(page.getByTestId("secret-bindings-screen")).toBeVisible();
      },
      "06-secrets-list-read-only",
    );

    await captureReadOnlyRoute(
      page,
      findings,
      "Settings Mesh compute",
      async () => {
        await page.goto("/#/today");
        await openSettings(page, "compute");
        await expect(
          page.getByTestId("settings-mesh-share-compute"),
        ).toBeVisible();
      },
      "07-settings-mesh-compute-read-only",
    );

    await captureReadOnlyRoute(
      page,
      findings,
      "Money invoice list",
      async () => {
        await page.goto("/#/money/invoices");
        await expect(page.getByTestId("money-invoices-page")).toBeVisible();
        await expect(page.getByTestId("money-invoice-list")).toBeVisible();
      },
      "09-money-invoice-list-read-only",
    );

    await captureReadOnlyRoute(
      page,
      findings,
      "Money tax route",
      async () => {
        await page.goto(
          "/#/money/tax/settings?invoiceId=00000000-0000-4000-8000-000000000001",
        );
        await expect(
          page.getByTestId("money-tax-unavailable-page"),
        ).toBeVisible();
      },
      "09-money-tax-no-invoice-record-read-only",
    );

    console.log(`CANARY_READ_ONLY_FINDINGS ${JSON.stringify(findings)}`);
    console.log(`CANARY_READ_ONLY_UNPROVEN ${JSON.stringify(unproven)}`);
    expect(findings, findings.join("\n")).toEqual([]);
  });
});
