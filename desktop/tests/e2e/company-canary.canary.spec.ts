import { expect, test, type Page } from "@playwright/test";
import { bytesToHex } from "@noble/hashes/utils.js";
import { getPublicKey } from "nostr-tools/pure";
import { nip19 } from "nostr-tools";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { RelayEvent } from "../../src/shared/api/types";
import {
  KIND_ASK_ACTION,
  KIND_ASK_RESPONSE,
} from "../../src/shared/constants/kinds";
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
const ARTIFACT_DIR = process.env.BUZZ_E2E_CANARY_ARTIFACT_DIR ?? "";
const AUTH_SUCCESS_KEY = "__BUZZ_E2E_NIP42_AUTH_SUCCESS_COUNT__";
const SECRET_SENTINEL = `canary-credential-${randomUUID()}`;

let account: CanaryAccount;
let identity: CanaryIdentity;
let relayHttpUrl: string;
let relayWsUrl: string;
let relaySelf: string;
let communityId: string;
let goalId = "";
let diagnosticsFileName = "canary-diagnostics";
let diagnostics: string[] = [];

function redactDiagnosticText(value: string) {
  return value
    .replaceAll(SECRET_SENTINEL, "[REDACTED_SECRET_SENTINEL]")
    .replace(/\bnsec1[0-9a-z]+/gi, "[REDACTED_NSEC]")
    .replace(/\bnpub1[0-9a-z]+/gi, "[REDACTED_NPUB]")
    .replace(/\b[0-9a-f]{64}\b/gi, "[REDACTED_HEX64]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]");
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
  const record = (entry: Record<string, unknown>) => {
    let route = "unknown";
    try {
      const url = new URL(page.url());
      route = url.hash.split("?")[0] || url.pathname;
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
    await waitForAnimations(page);
    await page.screenshot({
      path: resolve(ARTIFACT_DIR, `${name}-1440x900-${theme}.png`),
    });
  }
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

async function publishRelayEvent(
  page: Page,
  event: { kind: number; content: string; tags: string[][] },
) {
  const result = await page.evaluate(async (template) => {
    const testWindow = window as Window & {
      __BUZZ_E2E_PUBLISH_RELAY_EVENT__?: (
        value: typeof template,
      ) => Promise<{ accepted: boolean; event_id: string; message: string }>;
    };
    const publish = testWindow.__BUZZ_E2E_PUBLISH_RELAY_EVENT__;
    if (!publish) throw new Error("The signed canary publish seam is missing.");
    return publish(template);
  }, event);
  expect(result.accepted).toBe(true);
  expect(result.event_id).toMatch(/^[0-9a-f]{64}$/);
  return result.event_id;
}

async function publishExpectedRelayRejection(
  page: Page,
  event: { kind: number; content: string; tags: string[][] },
) {
  const result = await page.evaluate(async (template) => {
    const testWindow = window as Window & {
      __BUZZ_E2E_PUBLISH_RELAY_EVENT__?: (
        value: typeof template,
      ) => Promise<{ accepted: boolean; event_id: string; message: string }>;
    };
    const publish = testWindow.__BUZZ_E2E_PUBLISH_RELAY_EVENT__;
    if (!publish) throw new Error("The signed canary publish seam is missing.");
    try {
      const result = await publish(template);
      return { accepted: result.accepted, message: result.message };
    } catch (cause) {
      return {
        accepted: false,
        message: cause instanceof Error ? cause.message : "",
      };
    }
  }, event);
  expect(result.accepted).toBe(false);
  return result.message;
}

async function queryRelay(page: Page, filters: Array<Record<string, unknown>>) {
  return page.evaluate(async (relayFilters) => {
    const testWindow = window as Window & {
      __BUZZ_E2E_QUERY_RELAY__?: (
        value: Array<Record<string, unknown>>,
      ) => Promise<RelayEvent[]>;
    };
    const query = testWindow.__BUZZ_E2E_QUERY_RELAY__;
    if (!query) throw new Error("The signed canary query seam is missing.");
    return query(relayFilters);
  }, filters);
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
  const row = page
    .locator("[data-message-id]")
    .filter({ hasText: visibleText });
  await expect(row).toHaveCount(1);
  await expect
    .poll(() => row.getAttribute("data-message-id"), { timeout: 30_000 })
    .toMatch(/^[0-9a-f]{64}$/);
  const id = await row.getAttribute("data-message-id");
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

async function createAsk(page: Page, input: { askId: string; title: string }) {
  const now = Math.floor(Date.now() / 1000);
  const ask = {
    schemaVersion: 1,
    askId: input.askId,
    type: "approval",
    category: "general",
    title: input.title,
    body: "Confirm the synthetic canary checklist is complete.",
    threadRootEventId: account.rootId,
    addresseePubkey: identity.pubkey,
    decideBy: new Date((now + 3600) * 1000).toISOString(),
  };
  const createAction = {
    schemaVersion: 1,
    askId: input.askId,
    action: "create",
    ask,
  };
  await publishRelayEvent(page, {
    kind: KIND_ASK_ACTION,
    content: JSON.stringify(createAction),
    tags: [
      ["h", account.channel],
      ["d", `channel:${account.channel}:ask:${input.askId}`],
      ["e", account.rootId, "", "root"],
      ["e", account.rootId, "", "reply"],
    ],
  });
}

async function openCanaryAsk(page: Page, askId: string, title: string) {
  await page.goto(`/#/asks/${account.channel}/${askId}`);
  await expect(page.getByTestId("ask-detail-screen")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible({ timeout: 30_000 });
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
    relayHttpUrl = `https://${account.host}`;
    relayWsUrl = relayHttpUrl.replace(/^http/, "ws");
    relaySelf = await fetchRelaySelf(relayHttpUrl);
    communityId = `canary-${account.host.split(".")[0]}`;
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
    const designNeeds: string[] = [];
    let acceptedAuthCount = 0;
    let relayWritesRateLimited = false;
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
    await expect(
      page.getByText(
        "No people or AI employees are available in this conversation.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Send ask" })).toBeDisabled();
    await capture(page, "03-asks-no-other-recipient");

    const askId = randomUUID();
    const askTitle = `Canary approval ${askId.slice(0, 8)}`;
    await waitForCanaryWriteWindow(page);
    await createAsk(page, { askId, title: askTitle });
    const seededAskHeads = await queryRelay(page, [
      {
        kinds: [30643],
        authors: [relaySelf],
        "#h": [account.channel],
        "#d": [`channel:${account.channel}:ask:${askId}`],
        limit: 10,
      },
    ]);
    expect(seededAskHeads.length).toBeGreaterThan(0);
    const initialAskHeadId = seededAskHeads[0]?.id;
    if (!initialAskHeadId) {
      throw new Error("The new canary ask did not produce a head event.");
    }
    try {
      await openCanaryAsk(page, askId, askTitle);
    } catch (error) {
      const trace = Object.fromEntries(relayFrameCounts);
      throw new Error(
        `Ask detail did not load. Canary relay frames: ${JSON.stringify(trace)}. ${error instanceof Error ? error.message : ""}`,
      );
    }
    await page
      .getByLabel("Reason or requested changes")
      .fill("Approved for canary review.");
    await waitForCanaryWriteWindow(page);
    await page.getByRole("button", { name: "Record response" }).click();
    await expect(page.getByTestId("ask-resolved")).toContainText(
      "Approved by You",
      { timeout: 30_000 },
    );
    await page.reload();
    await expect(page.getByTestId("ask-resolved")).toContainText(
      "Approved by You",
      { timeout: 30_000 },
    );
    await capture(page, "03-asks-approved");

    await waitForCanaryWriteWindow(page);
    const staleDecisionMessage = await publishExpectedRelayRejection(page, {
      kind: KIND_ASK_RESPONSE,
      content: JSON.stringify({
        schemaVersion: 1,
        askId,
        expectedHeadEventId: initialAskHeadId,
        outcome: "approved",
        reason: "A stale decision must fail.",
      }),
      tags: [
        ["h", account.channel],
        ["d", `channel:${account.channel}:ask:${askId}`],
      ],
    });
    if (/current ask|ask is resolved/i.test(staleDecisionMessage)) {
      console.log("CANARY_STALE_ASK_REJECTION", "stale head rejected");
    } else if (/rate-limited/i.test(staleDecisionMessage)) {
      relayWritesRateLimited = true;
      canaryFindings.push(
        "Asks stale decision: relay quota blocked the stale-head rejection check.",
      );
    } else {
      throw new Error(
        "The stale decision was rejected for a reason other than the current ask or relay quota.",
      );
    }
    await expect(page.getByTestId("ask-resolved")).toContainText(
      "Approved by You",
      { timeout: 30_000 },
    );
    await expect(
      page.getByRole("button", { name: "Record response" }),
    ).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId("ask-resolved")).toContainText(
      "Approved by You",
      { timeout: 30_000 },
    );
    await capture(
      page,
      relayWritesRateLimited
        ? "03-asks-current-head-after-rate-limit"
        : "03-asks-stale-decision-refused",
    );

    if (relayWritesRateLimited) {
      canaryFindings.push(
        "Work creation, person and goal result filtering, and thread moves were not run after the relay rejected writes for quota.",
      );
      await page.goto(
        `/#/channels/${account.channel}?messageId=${account.rootId}&threadRootId=${account.rootId}`,
      );
      await expect(
        page.getByTestId(`create-company-work-from-message-${account.rootId}`),
      ).toBeVisible();
      await page
        .getByTestId(`create-company-work-from-message-${account.rootId}`)
        .click();
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
      await page.getByTestId("company-work-goal").selectOption(goalId);
      await page
        .getByTestId("company-work-evidence")
        .fill("The relay write was intentionally skipped after quota refusal.");
      await capture(page, "04-work-from-message-form-not-submitted");

      await page.goto("/#/company-work");
      await expect(page.getByTestId("company-work-list")).toBeVisible();
      const ownerFilter = page.getByTestId("company-work-owner-filter");
      const goalFilter = page.getByTestId("company-work-goal-filter");
      await ownerFilter.click();
      const ownerSearch = page.getByRole("textbox", { name: "Search owners" });
      await ownerSearch.fill("You");
      await ownerSearch.press("ArrowDown");
      await page.keyboard.press("Enter");
      await goalFilter.click();
      const goalSearch = page.getByRole("textbox", { name: "Search goals" });
      await goalSearch.fill(goalTitle);
      await goalSearch.press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("company-work-filter-chips")).toContainText(
        "Owner:",
      );
      await expect(page.getByTestId("company-work-filter-chips")).toContainText(
        "Goal:",
      );
      await capture(page, "04-work-filters-no-canary-record");
      await page.goto("/#/team");
      await expect(page.getByTestId("company-team-screen")).toBeVisible();
      const ownerRow = page.getByTestId(
        `company-team-member-${identity.pubkey}`,
      );
      await expect(ownerRow).toBeVisible();
      await ownerRow.click();
      await expect(
        page.getByTestId("company-team-member-profile"),
      ).toBeVisible();
      await capture(page, "05-team-owner-profile");

      await page
        .getByRole("button", { name: "Edit role and reporting" })
        .click();
      await page.getByLabel("Title").fill("Canary owner title, not saved");
      await capture(page, "05-team-owner-title-edit-not-saved");
      canaryFindings.push(
        "The owner title form opened, but saving and reloading it was not attempted after the relay quota refusal.",
      );

      await page.goto("/#/team/org");
      await expect(
        page.getByRole("tree", { name: "Reporting lines" }),
      ).toBeVisible();
      await expect(
        page.getByTestId(`company-team-member-${identity.pubkey}`),
      ).toBeVisible();
      await capture(page, "05-team-org-chart");

      await page.goto(`/#/team/detail/${identity.pubkey}`);
      await expect(
        page.getByTestId("company-team-member-profile"),
      ).toBeVisible();
      await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "History" })).toBeVisible();
      await capture(page, "08-owner-profile-overview-and-history");
      designNeeds.push(
        "The frozen company-v8 owner profile has Overview and History only. It has no employee-specific tab designs or honest not-available states for Instructions, Model & runtime, Tools & access, Salary, Workers, Duties, and Lessons.",
      );

      canaryFindings.push(
        "Secret binding and revocation were not attempted after the relay quota refusal.",
      );
      await page.goto("/#/secrets?state=empty");
      await expect(page.getByTestId("secret-bindings-screen")).toBeVisible();
      await expect(page.getByText("No secrets bound")).toBeVisible();
      await capture(page, "06-secrets-empty-after-quota");
    } else {
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
      await page
        .getByTestId("company-work-owner")
        .selectOption(identity.pubkey);
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

      await page.goto("/#/company-work");
      const ownerFilter = page.getByTestId("company-work-owner-filter");
      const goalFilter = page.getByTestId("company-work-goal-filter");
      await ownerFilter.click();
      await page.getByRole("textbox", { name: "Search owners" }).fill("You");
      await page
        .getByRole("textbox", { name: "Search owners" })
        .press("ArrowDown");
      await page.keyboard.press("Enter");
      await goalFilter.click();
      await page.getByRole("textbox", { name: "Search goals" }).fill(goalTitle);
      await page
        .getByRole("textbox", { name: "Search goals" })
        .press("ArrowDown");
      await page.keyboard.press("Enter");
      await expect(
        page.getByTestId(`company-work-row-${workId}`),
      ).toBeVisible();
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
      await page
        .getByRole("button", { name: "Move to another thread" })
        .click();
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

      await page.goto("/#/team");
      await expect(page.getByTestId("company-team-screen")).toBeVisible();
      const ownerRow = page.getByTestId(
        `company-team-member-${identity.pubkey}`,
      );
      await expect(ownerRow).toBeVisible();
      await ownerRow.click();
      await expect(
        page.getByTestId("company-team-member-profile"),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Edit role and reporting" })
        .click();
      const ownerTitle = `Canary owner ${randomUUID().slice(0, 8)}`;
      await page.getByLabel("Title").fill(ownerTitle);
      await waitForCanaryWriteWindow(page);
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(
        page.getByTestId("company-team-member-profile"),
      ).toContainText(ownerTitle);
      await page.reload();
      await expect(
        page.getByTestId("company-team-member-profile"),
      ).toContainText(ownerTitle);
      await capture(page, "05-team-owner-profile");

      await page.goto("/#/team/org");
      await expect(
        page.getByRole("tree", { name: "Reporting lines" }),
      ).toBeVisible();
      await expect(
        page.getByTestId(`company-team-member-${identity.pubkey}`),
      ).toBeVisible();
      await capture(page, "05-team-org-chart");

      await page.goto(`/#/team/detail/${identity.pubkey}`);
      await expect(
        page.getByTestId("company-team-member-profile"),
      ).toBeVisible();
      await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
      await expect(page.getByRole("tab", { name: "History" })).toBeVisible();
      await capture(page, "08-owner-profile-overview-and-history");
      designNeeds.push(
        "The frozen company-v8 owner profile has Overview and History only. It has no employee-specific tab designs or honest not-available states for Instructions, Model & runtime, Tools & access, Salary, Workers, Duties, and Lessons.",
      );

      const secretAskId = randomUUID();
      const secretAsk = {
        schemaVersion: 1,
        askId: secretAskId,
        action: "create",
        ask: {
          schemaVersion: 1,
          askId: secretAskId,
          type: "question",
          category: "secret",
          title: "Canary secure connection",
          body: "Bind a synthetic canary credential for this UI check.",
          threadRootEventId: account.rootId,
          addresseePubkey: identity.pubkey,
          secretRequest: {
            toolName: "Canary publishing",
            allowedUse: "Synthetic canary UI check only",
          },
        },
      };
      await waitForCanaryWriteWindow(page);
      await publishRelayEvent(page, {
        kind: KIND_ASK_ACTION,
        content: JSON.stringify(secretAsk),
        tags: [
          ["h", account.channel],
          ["d", `channel:${account.channel}:ask:${secretAskId}`],
          ["e", account.rootId, "", "root"],
          ["e", account.rootId, "", "reply"],
        ],
      });
      await page.goto(
        `/#/secrets?state=request&channelId=${account.channel}&askId=${secretAskId}`,
      );
      await expect(
        page.getByText("Bind a synthetic canary credential for this UI check."),
      ).toBeVisible();
      await page.getByRole("button", { name: "Enter securely" }).click();
      await expect(page.getByTestId("secret-credential-input")).toBeVisible();
      await page.getByLabel("Connection name").fill("Canary publishing");
      await page.getByLabel("Credential").fill(SECRET_SENTINEL);
      await waitForCanaryWriteWindow(page);
      await page.getByRole("button", { name: "Bind securely" }).click();
      await expect(page.getByText("Binding created")).toBeVisible();
      await expect(page.getByTestId("secret-credential-input")).toHaveCount(0);
      await page.reload();
      await expect(page.getByText("Binding created")).toBeVisible();
      await expect(page.getByTestId("secret-credential-input")).toHaveCount(0);
      const secretHeads = await queryRelay(page, [
        { kinds: [30647], authors: [relaySelf], limit: 100 },
      ]);
      expect(secretHeads.length).toBeGreaterThan(0);
      expect(
        secretHeads.some((event) => event.content.includes(SECRET_SENTINEL)),
      ).toBe(false);
      await capture(page, "06-secrets-bound-metadata-only");
      await waitForCanaryWriteWindow(page);
      await page
        .getByRole("button", {
          name: "Review and revoke binding Canary publishing",
        })
        .click();
      await expect(
        page.getByRole("heading", { name: "Revoke this binding?" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Revoke binding" }).click();
      await expect(page.getByText("Binding revoked")).toBeVisible();
      await page.reload();
      await expect(page.getByText("Binding revoked")).toBeVisible();
      await expect(page.getByTestId("secret-credential-input")).toHaveCount(0);
      const revokedSecretHeads = await queryRelay(page, [
        { kinds: [30647], authors: [relaySelf], limit: 100 },
      ]);
      expect(
        revokedSecretHeads.some((event) =>
          event.content.includes(SECRET_SENTINEL),
        ),
      ).toBe(false);
      await capture(page, "06-secrets-revoked");
    }

    await page.goto("/#/today");
    await openSettings(page, "compute");
    await expect(page.getByTestId("settings-mesh-share-compute")).toBeVisible();
    await capture(page, "07-settings-mesh-compute");

    await page.goto("/#/money/invoices");
    await expect(page.getByTestId("money-invoices-page")).toBeVisible();
    await expect(page.getByTestId("money-invoice-list")).toBeVisible();
    await capture(page, "09-money-invoice-list");
    await page.goto(
      "/#/money/tax/settings?invoiceId=00000000-0000-4000-8000-000000000001",
    );
    await expect(page.getByTestId("money-tax-unavailable-page")).toBeVisible();
    await capture(page, "09-money-tax-no-invoice-record");
    canaryFindings.push(
      "Money tax settings: expected the optional editor with a zero rate; actual route was Invoice unavailable because the fresh canary community has no invoice record. The zero-tax default remains unproven.",
    );

    const authState = await page.evaluate((successKey) => {
      const testWindow = window as Window & Record<string, unknown>;
      return Number(testWindow[successKey] ?? 0);
    }, AUTH_SUCCESS_KEY);
    expect(authEventIds.size).toBeGreaterThan(0);
    expect(acceptedAuthCount).toBeGreaterThan(0);
    expect(authState).toBeGreaterThan(0);
    expect(canaryFindings, canaryFindings.join("\n")).toEqual([]);
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
      "Team owner title editor",
      async () => {
        await page.goto("/#/team");
        await expect(page.getByTestId("company-team-screen")).toBeVisible();
        const ownerRow = page.getByTestId(
          `company-team-member-${identity.pubkey}`,
        );
        await expect(ownerRow).toBeVisible();
        await ownerRow.click();
        await expect(
          page.getByTestId("company-team-member-profile"),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Edit role and reporting" })
          .click();
        await expect(page.getByLabel("Title")).toBeVisible();
        await page.getByLabel("Title").fill("Canary owner title, not saved");
      },
      "05-team-owner-title-edit-not-saved-read-only",
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
      "Owner profile",
      async () => {
        await page.goto(`/#/team/detail/${identity.pubkey}`);
        await expect(
          page.getByTestId("company-team-member-profile"),
        ).toBeVisible();
        await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
        await expect(page.getByRole("tab", { name: "History" })).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Instructions" }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "Model & runtime" }),
        ).toHaveCount(0);
      },
      "08-owner-profile-overview-and-history-read-only",
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
