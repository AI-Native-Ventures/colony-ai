// Colony packaged-app gate for the Work and Knowledge tabs, channel notes and pinned messages.
//
// Launches the packaged app under the same keychain-deny sandbox as the other gates, with HOME set
// to a THROWAWAY directory, signs up a disposable smoke account, creates a business, enters the
// app, then drives rows WK0 to WK13 (work-knowledge-rows.mjs): open Work and Knowledge, create a
// note, pin a message, see both in Knowledge and the pin on the Pins screen, reload the app, see
// both still there, unpin, reload, see the pin stay gone.
//
// Local only, never CI. The row sequencing and verdicts are unit tested without an app:
//   node --test tests/real-run/work-knowledge-rows.test.mjs
// This driver needs a packaged build and is run by the coordinator, not by the author.
//
// usage (from desktop/):
//   COLONY_REAL_RUN=1 node tests/real-run/work-knowledge-proof.mjs \
//     --app '/path/to/Colony.app' --out /path/outside/the/repo/report-dir \
//     [--relay https://relay.colony.ainative.ventures] [--website https://example.com] \
//     [--expect-version 1.0.6] [--no-unpin] [--require-ai] [--claude-config-dir DIR] \
//     [--pause-before-launch] [--no-load-gate]
//   env alternatives: AI_APP, AI_OUT, AI_PROGRESS
//
// The rows need no AI reply, so by default the app is entered with "Skip for now" when Claude Code
// is not signed in under the sandbox (the report says so). --require-ai refuses that shortcut.
// The throwaway HOME and the smoke account are never deleted; both are listed in the report.

import { _electron as electron } from "@playwright/test";
import { randomBytes } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
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
  createFreshHome,
  freshHomeEnvironment,
  freshHomeSandboxPolicy,
} from "./fresh-home.mjs";
import { createSmokeInbox } from "./mailbox.mjs";
import { assertSafeDiagnostics, outsideRepo, redact } from "./safety.mjs";
import { pageContext } from "./work-knowledge-page.mjs";
import { buildWorkKnowledgeReport } from "./work-knowledge-report.mjs";
import {
  WK_ROWS,
  overallVerdict,
  runTag,
  runWorkKnowledgeRows,
} from "./work-knowledge-rows.mjs";

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
const EXPECT_VERSION = args["expect-version"]
  ? String(args["expect-version"])
  : null;
const REQUIRE_AI = Boolean(args["require-ai"]);
const WITH_UNPIN = !args["no-unpin"];
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI)
  throw new Error("COLONY_REAL_RUN=1 required, local only");
assertSafeDiagnostics(process.env);
if (!APP || !OUT)
  throw new Error(
    "usage: work-knowledge-proof.mjs --app <Colony.app> --out <report dir>",
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
const rows = [];
const accounts = [];
const notes = [];
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

// Wait for a quiet machine: the packaged app is heavy.
while (!args["no-load-gate"] && os.loadavg()[0] >= 12) {
  if (Date.now() > startedAt + 20 * 60000)
    throw new Error("Load gate not reached");
  await sleep(10000);
}

// ---- throwaway HOME and private profile ----
const realHome = os.homedir();
const { home, before } = await createFreshHome({ realHome });
const privateDir = await realpath(
  await mkdtemp(path.join(os.tmpdir(), "colony-wk-proof-")),
);
await chmod(privateDir, 0o700);
const userDataDir = path.join(privateDir, "user-data");
await mkdir(userDataDir, { mode: 0o700 });
await progress(`fresh HOME ${home}, profile ${privateDir}`);
row(
  "H0",
  "The throwaway HOME holds no ~/.buzz and no ~/.colony before launch",
  "PASS",
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

// ---- launch (copy of the proven fresh-home launch, with the fresh HOME and its sandbox) ----
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

// ---- onboarding (copied recipes from fresh-home-proof.mjs, proven in the 1.0.4 to 1.0.6 gates) ----
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
  if (await name.isVisible()) await name.fill("Gate Proof");
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

/** Enter the app. Returns the screens seen; "skipped-ai" if the Skip for now shortcut was used. */
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
  const started = Date.now();
  const deadline = started + 240000;
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
      // The rows need no AI reply. After a fair wait for a real connection, take the plain way in.
      const skip = page.getByRole("button", {
        name: "Skip for now",
        exact: true,
      });
      if (
        !REQUIRE_AI &&
        Date.now() - started > 45000 &&
        (await skip.isVisible().catch(() => false))
      ) {
        note("skipped-ai");
        await skip.scrollIntoViewIfNeeded().catch(() => undefined);
        await skip.click().catch(() => undefined);
      }
      await sleep(3000);
      continue;
    }
    await sleep(800);
  }
  throw new Error(
    "enterApp deadline: the app sidebar never appeared (Claude Code not connected, and Skip for now unavailable or refused?)",
  );
}

const tag = runTag(randomBytes(4).toString("hex"));
let entered = false;
try {
  await signUp();
  const suffix = accounts[0].email
    .split("@")[0]
    .replace("colony-launch-check-", "");
  await createBusiness(`Gate smoke ${suffix}`);
  const trail = await enterApp();
  entered = true;
  if (trail.includes("skipped-ai"))
    notes.push(
      "Claude Code was not signed in under the keychain-deny sandbox, so the app was entered with Skip for now. These rows need no AI reply, so that does not weaken them, but this run is not proof of a connected first run.",
    );
  row(
    "A3",
    "Sign up, create a business and enter the app",
    "PASS",
    `Screens: ${trail.join(" > ") || "straight in"}`,
  );
} catch (error) {
  row(
    "A3",
    "Sign up, create a business and enter the app",
    "FAIL",
    `${error.name}: ${redact(error.message).split("\n")[0]}`,
    { screenshot: await shot("A3-error") },
  );
}

if (entered) {
  await sleep(3000);
  const ctx = pageContext(page, { shot: (name) => shot(name) });
  await runWorkKnowledgeRows(ctx, row, { tag, withUnpin: WITH_UNPIN });
} else {
  for (const spec of WK_ROWS)
    row(
      spec.id,
      spec.label,
      "BLOCKED",
      "The app was not entered (see A3), so this was not attempted.",
    );
}

const runRows = rows.filter((item) => item.id.startsWith("WK"));
const verdict = overallVerdict(
  // A failed safety row (H1, H2) fails the whole gate even if the WK rows passed.
  [...rows.filter((item) => /^(H|A)\d/u.test(item.id)), ...runRows],
);
await writeFile(
  path.join(OUT, "results.json"),
  JSON.stringify(
    { tag, verdict, info, rows, accounts, home, privateDir },
    null,
    2,
  ),
);
await writeFile(
  path.join(OUT, "index.html"),
  buildWorkKnowledgeReport({
    title: "Work, Knowledge, notes and pins: packaged-app gate",
    verdict,
    version: info.version,
    app: APP,
    relay: RELAY,
    tag,
    rows,
    notes: [
      `Throwaway HOME ${home}. Private profile ${privateDir}. Neither is deleted.`,
      ...notes,
    ],
    accounts,
  }),
);
await progress(
  `DONE ${verdict.status}: ${verdict.headline} Report: ${path.join(OUT, "index.html")}`,
);
await application.close().catch(() => undefined);
process.exit(verdict.status === "PASS" ? 0 : 1);
