// Colony fresh-HOME packaged-app brand proof: Gate 1 of the buzz naming plan.
//
// Launches the packaged app (under the same keychain-deny sandbox as the earlier gates) with HOME
// pointing at a THROWAWAY directory that holds no ~/.buzz and no ~/.colony, so the real user's
// folders are never read or written. Signs up a disposable smoke account, creates a business,
// connects Claude Code, then asks Scout seven things that make it use tools and name files and
// commands. A page-side collector records every visible text on the chat, the agent session panel
// and transcript, the activity strip, the Show details popover, the Activity page and a few more
// surfaces; brand-scan.mjs judges them (the old name in any case, pipes, flags, UUIDs) and
// brand-report.mjs writes the HTML report in the format of the earlier gate reports.
//
// Local only, never CI. The scanner, collector, prompts and fresh-HOME helpers are unit tested
// (node --test tests/real-run/brand-*.test.mjs tests/real-run/fresh-home*.test.mjs); this driver
// itself needs a packaged build and a signed-in Claude Code, so it is run by the coordinator.
//
// usage (from desktop/):
//   COLONY_REAL_RUN=1 node tests/real-run/fresh-home-proof.mjs \
//     --app '/path/to/Colony.app' --out /path/to/report-dir \
//     [--relay https://relay.colony.ainative.ventures] [--website https://example.com] \
//     [--prompts 1,2,3] [--deadline-min 45] [--expect-version 1.0.6] \
//     [--claude-config-dir DIR] [--pause-before-launch] [--intro-timeout-ms 120000] [--no-load-gate]
//   env alternatives: AI_APP, AI_OUT, AI_PROGRESS (progress file, default OUT/progress.txt)
//
// The throwaway HOME and the smoke account are never deleted; both are listed in the report.

import { _electron as electron } from "@playwright/test";
import { randomBytes } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  COLLECTOR,
  READ_COLLECTED,
  SET_MODE,
  mergeCollected,
} from "./brand-collector.mjs";
import { buildBrandReport } from "./brand-report.mjs";
import {
  REQUIRED_SURFACES,
  OPT_IN_SURFACES,
  failingFindings,
  homeVerdict,
  nestFolderVerdict,
  promptCoverage,
  scanCapture,
} from "./brand-scan.mjs";
import {
  createFreshHome,
  findNamed,
  freshHomeEnvironment,
  freshHomeSandboxPolicy,
  topLevelNames,
  treeNames,
} from "./fresh-home.mjs";
import { selectPrompts } from "./fresh-home-prompts.mjs";
import { createSmokeInbox } from "./mailbox.mjs";
import { assertSafeDiagnostics, outsideRepo, redact } from "./safety.mjs";

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const APP = String(args.app ?? process.env.AI_APP ?? "");
const OUT = String(args.out ?? process.env.AI_OUT ?? "");
const RELAY = String(args.relay ?? "https://relay.colony.ainative.ventures");
const WEBSITE = String(args.website ?? "https://example.com");
const DEADLINE_MIN = Number(args["deadline-min"] ?? 45);
const EXPECT_VERSION = args["expect-version"]
  ? String(args["expect-version"])
  : null;
const INTRO_TIMEOUT_MS = Number(args["intro-timeout-ms"] ?? 120000);
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI)
  throw new Error("COLONY_REAL_RUN=1 required, local only");
assertSafeDiagnostics(process.env);
if (!APP || !OUT)
  throw new Error(
    "usage: fresh-home-proof.mjs --app <Colony.app> --out <report dir>",
  );
await mkdir(path.join(OUT, "screenshots"), { recursive: true });
outsideRepo(OUT, REPO_ROOT);
const PROGRESS = process.env.AI_PROGRESS ?? path.join(OUT, "progress.txt");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = () => new Date().toTimeString().slice(0, 8);
const progress = async (line) => {
  await appendFile(PROGRESS, `${stamp()} ${line}\n`);
  console.log(`${stamp()} ${line}`);
};
const exists = (file) =>
  stat(file).then(
    () => true,
    () => false,
  );

const startedAt = Date.now();
const deadlineAt = startedAt + DEADLINE_MIN * 60000;
const rows = [];
const accounts = [];
const notes = {};
const row = (id, label, status, detail, extra = {}) => {
  const entry = {
    id,
    label,
    status,
    detail: redact(detail),
    tMs: Date.now() - startedAt,
    ...extra,
  };
  rows.push(entry);
  void progress(`${id} ${status}: ${entry.detail.slice(0, 220)}`);
  return entry;
};

// Wait for a quiet machine: the packaged app plus Claude Code is heavy.
while (!args["no-load-gate"] && os.loadavg()[0] >= 12) {
  if (Date.now() > startedAt + 20 * 60000)
    throw new Error("Load gate not reached");
  await sleep(10000);
}

// ---- throwaway HOME and private profile ----
const realHome = os.homedir();
const { home, before } = await createFreshHome({ realHome });
const privateDir = await realpath(
  await mkdtemp(path.join(os.tmpdir(), "colony-brand-proof-")),
);
await chmod(privateDir, 0o700);
const userDataDir = path.join(privateDir, "user-data");
await mkdir(userDataDir, { mode: 0o700 });
await progress(`fresh HOME ${home}, profile ${privateDir}`);
row(
  "H0",
  "The throwaway HOME holds no ~/.buzz and no ~/.colony before launch",
  homeVerdict({ before, after: [".colony"] }).status === "BLOCKED"
    ? "BLOCKED"
    : "PASS",
  `Top-level entries before launch: ${before.join(", ") || "none"}`,
);

if (args["pause-before-launch"]) {
  const marker = path.join(privateDir, "continue");
  console.log(
    `Throwaway HOME: ${home}\nSeed it now if needed (for example: HOME='${home}' claude, then sign in).\nPress Enter, or create ${marker}, to launch the app.`,
  );
  if (process.stdin.isTTY) {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    await rl.question("");
    rl.close();
  } else while (!(await exists(marker))) await sleep(2000);
}

// ---- launch (copy of the proven ai-lib launch, with the fresh HOME and its sandbox) ----
const exeName = (await readdir(path.join(APP, "Contents", "MacOS")))[0];
const exe = path.join(APP, "Contents", "MacOS", exeName);
const quote = (value) => `'${value.replace(/'/gu, `'\\''`)}'`;
const sandbox = path.join(privateDir, "sandbox.sb");
await writeFile(sandbox, freshHomeSandboxPolicy(realHome), { mode: 0o600 });
const launcher = path.join(privateDir, "launch.sh");
await writeFile(
  launcher,
  `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(sandbox)} ${quote(exe)} "$@"\n`,
  { mode: 0o700 },
);
const hostLog = path.join(privateDir, "native-host.log");
const application = await electron.launch({
  executablePath: launcher,
  args: ["--no-sandbox", `--user-data-dir=${userDataDir}`],
  env: {
    ...freshHomeEnvironment(process.env, {
      home,
      userDataDir,
      relayUrl: RELAY,
      claudeConfigDir: args["claude-config-dir"]
        ? String(args["claude-config-dir"])
        : undefined,
    }),
    COLONY_NATIVE_HOST_LOG: hostLog,
  },
  timeout: 60000,
});
const info = await application.evaluate(({ app }) => ({
  version: app.getVersion(),
  packaged: app.isPackaged,
  userData: app.getPath("userData"),
  home: app.getPath("home"),
  envHome: process.env.HOME,
}));
const same = async (a, b) =>
  (await realpath(a).catch(() => a)) === (await realpath(b).catch(() => b));
const onFreshHome =
  (await same(String(info.envHome), home)) && (await same(info.home, home));
row(
  "H1",
  "The packaged app and everything it starts run with HOME set to the throwaway directory",
  info.packaged && onFreshHome && info.userData === userDataDir
    ? "PASS"
    : "FAIL",
  `packaged=${info.packaged}, process HOME=${info.envHome}, app home=${info.home}, userData=${info.userData}`,
);
if (EXPECT_VERSION)
  row(
    "H2",
    `The app reports version ${EXPECT_VERSION}`,
    info.version === EXPECT_VERSION ? "PASS" : "FAIL",
    `app.getVersion() = ${info.version}`,
  );

const first = await application.firstWindow({ timeout: 30000 });
await first.setViewportSize({ width: 1440, height: 960 });
await first.waitForLoadState("domcontentloaded", { timeout: 20000 });
const current = () => {
  if (!first.isClosed()) return first;
  const open = application.windows().filter((item) => !item.isClosed());
  return open[open.length - 1] ?? first;
};
const page = new Proxy(first, {
  get(_target, property) {
    const active = current();
    const value = active[property];
    return typeof value === "function" ? value.bind(active) : value;
  },
});
const shot = async (name) => {
  try {
    await page.screenshot({
      path: path.join(OUT, "screenshots", `${name}.png`),
    });
    return `screenshots/${name}.png`;
  } catch {
    return null;
  }
};
const guard = async (id, label, fn) => {
  try {
    return await fn();
  } catch (error) {
    row(
      id,
      label,
      "FAIL",
      `Step threw ${error.name}: ${redact(error.message).split("\n")[0]}`,
      {
        screenshot: await shot(`${id}-error`),
      },
    );
    return undefined;
  }
};

// Main-process native notifications, best effort: title and body of every shown notification.
const nativeHook = await application
  .evaluate(({ Notification }) => {
    globalThis.__brandNotifications = [];
    const original = Notification.prototype.show;
    Notification.prototype.show = function show(...rest) {
      globalThis.__brandNotifications.push({
        title: String(this.title ?? ""),
        body: String(this.body ?? ""),
      });
      return original.apply(this, rest);
    };
    return "hooked";
  })
  .catch((error) => `not hooked: ${error.message}`);
notes.nativeNotificationHook = nativeHook;

// ---- onboarding (copied recipes from ai-lib.mjs, proven in the 1.0.4 and 1.0.5 gates) ----
async function signUp() {
  const inbox = await createSmokeInbox();
  accounts.push({
    email: inbox.email,
    role: "smoke owner, disposable inbox, not deleted",
  });
  await page.getByTestId("machine-onboarding-gate").waitFor({ timeout: 30000 });
  const name = page.getByLabel("Your name", { exact: true });
  if (!(await name.isVisible()))
    await page.getByRole("button", { name: /Create an account/iu }).click();
  if (await name.isVisible()) await name.fill("Brand Proof");
  await page.getByLabel(/Email/iu).first().fill(inbox.email);
  await page
    .getByLabel(/Password/iu)
    .first()
    .fill(inbox.password);
  await page.getByRole("button", { name: /^Create account$/iu }).click();
  await page
    .getByTestId("account-auth-screen-verify")
    .waitFor({ timeout: 25000 });
  const code = await inbox.verificationCode();
  const digits = page.locator('input[maxlength="1"]');
  if ((await digits.count()) === 6)
    for (let i = 0; i < 6; i++) await digits.nth(i).fill(code[i]);
  else await page.getByLabel(/Verification code|6-digit code/iu).fill(code);
  await page
    .getByRole("button", { name: /Continue|Verify/iu })
    .first()
    .click();
}

async function createBusiness(businessName) {
  await page
    .getByLabel("Business name", { exact: true })
    .waitFor({ timeout: 25000 });
  await page.getByLabel("Business name", { exact: true }).fill(businessName);
  await page.getByLabel("Website", { exact: false }).fill(WEBSITE);
  await page.getByRole("button", { name: "Read website", exact: true }).click();
  const description = page.getByLabel("What does your business do?");
  const end = Date.now() + 40000;
  while (Date.now() < end && !(await description.inputValue()).trim())
    await sleep(500);
  const cont = page.getByRole("button", { name: /^Continue$/iu });
  await cont.waitFor({ timeout: 30000 });
  await cont.click();
  await page
    .getByTestId("onboarding-connect-runtime-claude")
    .waitFor({ timeout: 45000 });
}

async function enterApp() {
  const sidebar = page.getByTestId("app-sidebar");
  const trail = [];
  const seen = new Set();
  const note = (name) => {
    if (!seen.has(name)) {
      seen.add(name);
      trail.push(name);
    }
  };
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    if (await sidebar.isVisible().catch(() => false)) return trail;
    const open = page.getByRole("button", {
      name: "Open my Colony",
      exact: true,
    });
    if (await open.isVisible().catch(() => false)) {
      note("connected");
      await open.click().catch(() => undefined);
      await sleep(2000);
      continue;
    }
    const list = page.getByTestId("onboarding-business-list");
    if (await list.isVisible().catch(() => false)) {
      note("businesses");
      await list
        .getByRole("button")
        .first()
        .click()
        .catch(() => undefined);
      await sleep(2500);
      continue;
    }
    const runtime = page.getByTestId("onboarding-connect-runtime-claude");
    if (await runtime.isVisible().catch(() => false)) {
      note("connect");
      const pick = runtime.getByRole("button", { name: /Claude Code/iu });
      if (await pick.isVisible().catch(() => false))
        await pick.click().catch(() => undefined);
      const test = page.getByRole("button", {
        name: /^(Connect Claude Code|Test connection)$/iu,
      });
      if (await test.isVisible().catch(() => false)) {
        await test.scrollIntoViewIfNeeded().catch(() => undefined);
        await test.click().catch(() => undefined);
        note("connecting");
      }
      await sleep(3000);
      continue;
    }
    await sleep(800);
  }
  throw new Error(
    "enterApp deadline: the app sidebar never appeared (Claude Code not connected?)",
  );
}

// ---- collector plumbing ----
let collected = { ticks: 0, surfaces: {} };
let reading = false;
const snapshot = async () => {
  if (reading) return;
  reading = true;
  try {
    const read = await page.evaluate(READ_COLLECTED);
    if (read) collected = mergeCollected(collected, read);
  } catch {
    /* page busy or reloading */
  } finally {
    reading = false;
  }
};
const setMode = (mode) => page.evaluate(SET_MODE, mode).catch(() => undefined);

// ---- driving Scout (copied recipes from c105b-activity.mjs) ----
const composer = () =>
  page
    .getByTestId("message-composer")
    .locator('[contenteditable="true"]')
    .first();
const closePanel = async () => {
  const back = page.getByTestId("agent-session-back");
  if (await back.isVisible().catch(() => false))
    await back.click().catch(() => undefined);
  else if (
    await page
      .getByTestId("agent-session-thread-panel")
      .isVisible()
      .catch(() => false)
  )
    await page.keyboard.press("Escape");
  await sleep(500);
};
const openPanel = async () => {
  // The trigger shimmers at the window edge, so dispatch the DOM click directly.
  await page
    .getByTestId("bot-activity-composer-trigger")
    .evaluate((el) => el.click());
  const item = page
    .locator('[data-testid^="bot-activity-composer-item-"]')
    .first();
  await item.waitFor({ timeout: 4000 });
  await item.evaluate((el) => el.click());
  await page
    .getByTestId("agent-session-thread-panel")
    .waitFor({ state: "visible", timeout: 6000 });
};
const rowState = () =>
  page.evaluate(() => {
    const vis = (el) => !!el && el.getClientRects().length > 0;
    const activity = document.querySelector(
      '[data-testid="channel-composer-activity-row"]',
    );
    return {
      row: vis(activity)
        ? (activity.innerText ?? "").replace(/\s+/gu, " ").trim()
        : "",
      trigger: vis(
        document.querySelector('[data-testid="bot-activity-composer-trigger"]'),
      ),
      details: vis(
        document.querySelector('[data-testid="bot-activity-details-trigger"]'),
      ),
    };
  });

const ask = async (prompt) => {
  await closePanel();
  const box = composer();
  await box.click();
  await box.fill("@");
  const menu = page.getByTestId("mention-autocomplete");
  await menu.waitFor({ timeout: 15000 });
  await menu
    .locator("[data-mention-suggestion-index]")
    .filter({ hasText: /Scout/u })
    .first()
    .click();
  await box.press("End");
  await box.pressSequentially(prompt.text);
  await box.press("Enter");
  // Seen once: Enter left the text in the composer. Retry with the send shortcut so the ask is never lost.
  await sleep(1200);
  if ((await box.innerText().catch(() => "")).trim().length > 20)
    await box.press("Meta+Enter");
};

const openDetailsPopover = async () => {
  const trigger = page.getByTestId("bot-activity-details-trigger");
  await trigger.click({ timeout: 4000 });
  await page
    .getByTestId("bot-activity-details")
    .waitFor({ state: "visible", timeout: 4000 });
  await sleep(700);
  await shot(`details-open-${Date.now()}`);
  await trigger.click({ timeout: 4000 });
  await page
    .getByTestId("bot-activity-details")
    .waitFor({ state: "detached", timeout: 4000 });
};

const panelProbe = async (prompt, log) => {
  await setMode("channel");
  await openPanel();
  await sleep(2500);
  log.panelShot = await shot(`p${prompt.id}-session-panel`);
  if (prompt.expandTools) {
    // Opt-in raw view: expand a tool group, let the collector record it, collapse again.
    const summary = page
      .locator('[data-testid="agent-session-thread-panel"] summary')
      .filter({ hasText: /tool call/iu })
      .first();
    if (await summary.isVisible().catch(() => false)) {
      await setMode("panel-expanded");
      await summary.evaluate((el) => el.click());
      await sleep(1200);
      log.expandedShot = await shot(`p${prompt.id}-panel-expanded`);
      await summary.evaluate((el) => el.click());
      await sleep(600);
      await setMode("channel");
      log.expanded = true;
    }
  }
  await closePanel();
};

const runPrompt = async (prompt) => {
  const sentAt = Date.now();
  await setMode("channel");
  await ask(prompt);
  const log = {
    id: prompt.id,
    name: prompt.name,
    firstRowMs: null,
    lastRowMs: null,
    endedBecause: null,
    rowTextsSeen: [],
    panel: false,
    details: false,
  };
  let idleSince = null;
  let shots = 0;
  while (Date.now() - sentAt < prompt.maxSeconds * 1000) {
    if (Date.now() > deadlineAt) {
      log.endedBecause = "global deadline";
      break;
    }
    await sleep(400);
    const state = await rowState();
    if (state.row) {
      log.firstRowMs ??= Date.now() - sentAt;
      log.lastRowMs = Date.now() - sentAt;
      idleSince = null;
      if (!log.rowTextsSeen.includes(state.row)) {
        log.rowTextsSeen.push(state.row);
        if (shots < 2) {
          shots += 1;
          await shot(`p${prompt.id}-row-${shots}`);
        }
      }
      if (prompt.openPanel && !log.panel && state.trigger) {
        log.panel = true;
        await guard(
          `P${prompt.id}-panel`,
          `Prompt ${prompt.id}: open the agent session panel`,
          () => panelProbe(prompt, log),
        );
      }
      if (prompt.openDetails && !log.details && state.details) {
        log.details = true;
        await guard(
          `P${prompt.id}-details`,
          `Prompt ${prompt.id}: open Show details`,
          openDetailsPopover,
        );
      }
    } else if (log.firstRowMs !== null) {
      idleSince ??= Date.now();
      if (Date.now() - idleSince > 7000) {
        log.endedBecause = "Scout idle 7 s after working";
        break;
      }
    } else if (Date.now() - sentAt > 50000) {
      log.endedBecause = "no activity row within 50 s";
      break;
    }
  }
  log.endedBecause ??= "time cap";
  // Let the final reply land in the timeline so the chat surface records it.
  await page
    .getByTestId("message-typing-indicator")
    .waitFor({ state: "hidden", timeout: 20000 })
    .catch(() => undefined);
  await sleep(1500);
  log.elapsedMs = Date.now() - sentAt;
  await snapshot();
  await shot(`p${prompt.id}-end`);
  return log;
};

// ---- the run ----
const promptLog = [];
async function drive() {
  const step = async (id, label, fn, detail) => {
    const done = await guard(id, label, async () => {
      await fn();
      return true;
    });
    if (done) row(id, label, "PASS", detail);
    return done;
  };
  await step(
    "A1",
    "Sign up a disposable smoke account and verify the email",
    signUp,
    `Account ${accounts[0]?.email ?? "?"} verified`,
  );
  const businessName = `Brand Proof ${randomBytes(3).toString("hex")}`;
  await step(
    "A2",
    "Create a business and read its website",
    () => createBusiness(businessName),
    `Business "${businessName}" created from ${WEBSITE}`,
  );
  const trail = await guard(
    "A3",
    "Connect Claude Code and enter the app",
    enterApp,
  );
  if (trail)
    row(
      "A3",
      "Connect Claude Code and enter the app",
      "PASS",
      `Screens: ${trail.join(" > ")}`,
    );

  if (
    await page
      .getByTestId("app-sidebar")
      .isVisible()
      .catch(() => false)
  ) {
    await sleep(3000);
    await page.evaluate(COLLECTOR);
    await setMode("channel");
    const poller = setInterval(() => void snapshot(), 2000);
    try {
      await page
        .locator('[data-testid="channel-welcome" i]')
        .first()
        .click({ timeout: 8000 })
        .catch(() => undefined);
      await page.getByTestId("message-timeline").waitFor({ timeout: 15000 });

      // Scout's introduction: wait until a message authored by Scout shows up.
      const introEnd = Date.now() + INTRO_TIMEOUT_MS;
      let intro = false;
      while (Date.now() < introEnd && !intro) {
        intro =
          (await page
            .locator('[data-testid="message-author"]')
            .filter({ hasText: /Scout/u })
            .count()
            .catch(() => 0)) > 0;
        if (!intro) await sleep(2000);
      }
      row(
        "C1",
        "Scout introduces itself in the welcome channel",
        intro ? "PASS" : "NOT OBSERVED",
        intro
          ? `Seen ${((Date.now() - startedAt) / 1000).toFixed(0)} s after launch`
          : `No message by Scout within ${INTRO_TIMEOUT_MS} ms; prompts are still sent`,
        { screenshot: await shot("welcome") },
      );
      await page
        .getByTestId("message-typing-indicator")
        .waitFor({ state: "hidden", timeout: 30000 })
        .catch(() => undefined);
      await sleep(2000);

      for (const prompt of selectPrompts(args.prompts)) {
        if (Date.now() > deadlineAt) {
          row(
            `P${prompt.id}`,
            `Prompt ${prompt.id} (${prompt.name})`,
            "NOT OBSERVED",
            "Global deadline reached first",
          );
          continue;
        }
        const log = await guard(
          `P${prompt.id}`,
          `Prompt ${prompt.id} (${prompt.name})`,
          () => runPrompt(prompt),
        );
        if (!log) continue;
        promptLog.push(log);
        row(
          `P${prompt.id}`,
          `Prompt ${prompt.id} (${prompt.name}): Scout worked`,
          log.firstRowMs === null ? "NOT OBSERVED" : "PASS",
          log.firstRowMs === null
            ? `No activity row within ${log.elapsedMs} ms (${log.endedBecause})`
            : `Activity first seen ${log.firstRowMs} ms after send, ended: ${log.endedBecause}. Panel opened: ${log.panel}, details opened: ${log.details}, tools expanded: ${Boolean(log.expanded)}`,
        );
      }
      await closePanel();

      // Team page, Scout's profile activity and the Activity page.
      await guard(
        "T1",
        "Visit the Team page, Scout's profile activity and the Activity page",
        async () => {
          await setMode("team");
          await page
            .getByTestId("sidebar-company-team")
            .click({ timeout: 8000 });
          await sleep(3500);
          await shot("team-page");
          const scout = page.getByText(/^Scout$/u).first();
          if (await scout.isVisible().catch(() => false)) {
            await setMode("scout-profile");
            await scout.click({ timeout: 5000 }).catch(() => undefined);
            await sleep(3500);
            if (
              !(await page
                .getByTestId("agent-activity")
                .isVisible()
                .catch(() => false))
            )
              await page
                .getByRole("tab", { name: /activity|history/iu })
                .first()
                .click({ timeout: 3000 })
                .catch(() => undefined);
            await sleep(2000);
            await shot("scout-profile");
          }
          await setMode("activity");
          await page
            .getByTestId("sidebar-activity-button")
            .click({ timeout: 5000 });
          await sleep(3500);
          await shot("activity-page");
          await setMode("channel");
          await snapshot();
        },
      );
    } finally {
      clearInterval(poller);
      await snapshot();
    }
  }
}

async function judgeAndWrite() {
  // ---- judge ----
  const nativeNotes = await application
    .evaluate(() => globalThis.__brandNotifications ?? [])
    .catch(() => []);
  const titles = await application
    .evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) => w.getTitle()),
    )
    .catch(() => []);
  const surfaces = { ...collected.surfaces };
  const add = (key, text) => {
    if (String(text ?? "").trim())
      surfaces[key] = [...(surfaces[key] ?? []), String(text)];
  };
  for (const n of nativeNotes) {
    add("notification.native.title", n.title);
    add("notification.native.body", n.body);
  }
  for (const title of titles) add("window-title", title);
  const scan = scanCapture({ surfaces });

  const LABELS = {
    chat: "Chat timeline",
    transcript: "Agent session transcript, default view",
    "session-panel": "Agent session panel",
    "activity-page": "Activity page",
    "activity-strip": "Activity strip above the composer",
  };
  const detailFor = (group) => {
    const failing = group.findings.filter((f) => f.severity === "fail");
    return group.status === "PASS"
      ? `${group.observed} distinct texts recorded, 0 failing findings`
      : group.status === "NOT OBSERVED"
        ? "No text was recorded on this surface, so nothing is proven"
        : `${failing.length} failing: ${failing
            .slice(0, 6)
            .map((f) => `${f.kind} "${f.match}" in "${f.context}"`)
            .join(" | ")}`;
  };
  for (const name of REQUIRED_SURFACES)
    row(
      `S-${name}`,
      `${LABELS[name]}: no old name, pipe, flag or UUID`,
      scan.groups[name].status,
      detailFor(scan.groups[name]),
    );
  for (const name of OPT_IN_SURFACES)
    row(
      `S-${name}`,
      `${name === "details-popover" ? "Show details popover" : "Expanded transcript"} (opt-in raw text): no old name`,
      scan.groups[name]?.status ?? "NOT OBSERVED",
      scan.groups[name]
        ? detailFor(scan.groups[name])
        : "The surface was never opened",
    );
  const otherGroups = Object.entries(scan.groups).filter(
    ([name]) =>
      !REQUIRED_SURFACES.includes(name) && !OPT_IN_SURFACES.includes(name),
  );
  const otherFailing = otherGroups.flatMap(([, g]) =>
    g.findings.filter((f) => f.severity === "fail"),
  );
  row(
    "S-other",
    "Team page, Scout profile, overlays, toasts, notifications and window titles: no old name, pipe, flag or UUID",
    otherFailing.length ? "FAIL" : "PASS",
    otherFailing.length
      ? otherFailing
          .slice(0, 6)
          .map((f) => `${f.surface}: ${f.kind} "${f.match}"`)
          .join(" | ")
      : `Groups scanned: ${otherGroups.map(([n, g]) => `${n} (${g.observed})`).join(", ") || "none"}. Native notifications: ${nativeNotes.length}. Window titles: ${JSON.stringify(titles)}`,
  );

  // Deterministic evidence from the throwaway HOME and the host log.
  const after = await topLevelNames(home);
  const hv = homeVerdict({ before, after });
  row(
    "H3",
    "A fresh install created ~/.colony and did not create ~/.buzz",
    hv.status,
    hv.detail,
  );
  const colonyTree = after.includes(".colony")
    ? await treeNames(path.join(home, ".colony"))
    : [];
  const logText = await readFile(hostLog, "utf8").catch(() => "");
  const nv = nestFolderVerdict(logText, home);
  row(
    "H4",
    "The host logged the folder choice chosen=.colony reason=fresh-install under the throwaway HOME",
    nv.status,
    nv.detail,
  );
  const links = await findNamed([home, userDataDir], ["colony", "buzz"]);
  row(
    "L1",
    "The colony command link exists in an app-private folder (the legacy buzz name may sit beside it)",
    links.some((l) => l.rel.endsWith("colony")) ? "PASS" : "NOT OBSERVED",
    links.length
      ? links
          .map(
            (l) => `${l.rel} (${l.kind}${l.target ? ` -> ${l.target}` : ""})`,
          )
          .join("; ")
      : "No entry named colony or buzz under the throwaway HOME or the app profile (the link may live elsewhere: check the agent PATH directory by hand)",
  );
  const pc = promptCoverage(promptLog);
  row(
    "P-cov",
    "Every prompt made Scout use a tool and show activity",
    pc.status,
    pc.detail,
  );

  const folderTalk = (surfaces.chat ?? []).filter((text) =>
    /\.colony|\.buzz|folder/iu.test(text),
  );
  row(
    "E1",
    "What Scout said about its folder and files (information only, not part of the verdict)",
    "INFO",
    folderTalk.length
      ? folderTalk.slice(-4).join(" || ")
      : "No chat text mentioned a folder",
  );

  // ---- verdict ----
  const judged = rows.filter((r) => /^(S-|H[01234]|P-cov|RUN)/u.test(r.id));
  const anyFail = judged.some((r) => r.status === "FAIL");
  const anyOpen = judged.some((r) =>
    /NOT OBSERVED|BLOCKED|INCOMPLETE/u.test(r.status),
  );
  const verdict = anyFail ? "FAIL" : anyOpen ? "NOT OBSERVED" : "PASS";
  const failingCount = failingFindings(scan).length;
  const model = {
    title: "Colony fresh-HOME brand proof",
    verdict: {
      status: verdict,
      headline: anyFail
        ? `${failingCount} failing findings across the surfaces, or the fresh install folder was wrong. See Findings and Checks.`
        : anyOpen
          ? "No failing finding, but at least one surface or check was never observed, so the gate is not proven."
          : "No old name, pipe, flag or UUID on any surface, and the fresh install used ~/.colony.",
    },
    version: info.version,
    app: APP,
    relay: RELAY,
    window: `${new Date(startedAt).toISOString()} to ${new Date().toISOString()}`,
    rows,
    scan,
    surfaces,
    prompts: promptLog,
    method: [
      `HOME was a throwaway directory (${home}) with no ~/.buzz and no ~/.colony; the real user's folders were denied by sandbox policy and never touched.`,
      "The packaged app ran under the keychain-deny sandbox used by the earlier gates. No keychain was created, unlocked or modified.",
      "A page-side collector recorded every distinct visible text and the title, aria-label, aria-description and alt attributes every 150 ms plus on every DOM mutation.",
      "Plain surfaces fail on the old name in any case, pipes, command flags, UUIDs and redirects. The Show details popover and the expanded transcript are opt-in raw text and fail only on the old name.",
      "A surface with no recorded text is NOT OBSERVED, never PASS.",
      args["claude-config-dir"]
        ? "Claude Code used the supplied config directory, not a fresh one."
        : "Claude Code ran with the throwaway HOME, so it saw no personal configuration.",
    ],
    knownRemainder: [
      "The <buzz-event> turn tags and BUZZ_* variable names are still sent to agents. They are structural machine contracts and are not rendered in chat.",
      "Machines that already have ~/.buzz keep using it until the migration change. This run used a fresh HOME, so it says nothing about legacy installs (Gate 2).",
    ],
    accounts,
    home: { path: home, before, after, tree: colonyTree },
  };
  await writeFile(path.join(OUT, "index.html"), buildBrandReport(model));
  await writeFile(
    path.join(OUT, "results.json"),
    redact(
      JSON.stringify(
        {
          verdict,
          rows,
          groups: scan.groups,
          surfaces,
          prompts: promptLog,
          home: model.home,
          notes,
          accounts,
        },
        null,
        2,
      ),
    ),
  );
  await progress(
    `report written to ${path.join(OUT, "index.html")}: ${verdict}`,
  );
  process.exitCode = verdict === "PASS" ? 0 : 1;
}

try {
  await drive();
} catch (error) {
  row(
    "RUN",
    "The run was aborted",
    "FAIL",
    `${error.name}: ${redact(error.message).split("\n")[0]}`,
    {
      screenshot: await shot("aborted"),
    },
  );
}
try {
  await judgeAndWrite();
} finally {
  try {
    await Promise.race([
      application.close(),
      sleep(10000).then(() => Promise.reject(new Error("close deadline"))),
    ]);
  } catch {
    application.process().kill("SIGTERM");
  }
}
