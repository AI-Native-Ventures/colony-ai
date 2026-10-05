// Shared helpers for the avatar and invite real-app diagnosis (published Colony, production relay).
// Local-only: requires COLONY_REAL_RUN=1. Never touches the keychain: the app tree runs under the
// same securityd-deny policy as run.mjs. URLs are recorded without query strings or invite codes.
import { _electron as electron } from "@playwright/test";
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { deflateSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { createSmokeInbox } from "./mailbox.mjs";
import { realEnvironment, realEnvSandboxPolicy } from "./safety.mjs";

export const OUT =
  "/Users/mac/worktrees/.lanes/phase2/real-run-20261004/avatar-invite";
export const APP = "/Users/mac/Downloads/Colony-1.0.4-published/Colony.app";
export const RELAY = "https://relay.colony.ainative.ventures";
export const PROGRESS =
  "/Users/mac/worktrees/.lanes/phase2/briefs-20261004/progress-avatar-invite.txt";
export const STATE = path.join(OUT, "state.json");

export const stamp = () => new Date().toTimeString().slice(0, 8);
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function progress(line) {
  await appendFile(PROGRESS, `${stamp()} ${line}\n`);
  console.log(`${stamp()} ${line}`);
}

// Redaction: no invite codes, no keys, no query strings in anything written to evidence.
export function redact(value) {
  return String(value ?? "")
    .replace(/(invite|join)([/=])[A-Za-z0-9_-]{6,}/giu, "$1$2XXXX")
    .replace(
      /([?&](code|token|key|sig|auth|authorization)=)[^&\s"']+/giu,
      "$1XXXX",
    )
    .replace(/\b[0-9a-f]{64}\b/giu, "HEX64")
    .replace(/\bnsec1[0-9a-z]+/giu, "NSEC")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/giu, "Bearer XXXX");
}
export function cleanUrl(url) {
  try {
    const parsed = new URL(url);
    return redact(`${parsed.origin}${parsed.pathname}`);
  } catch {
    return redact(String(url).slice(0, 120));
  }
}

export async function loadState() {
  try {
    return JSON.parse(await readFile(STATE, "utf8"));
  } catch {
    return {};
  }
}
export async function saveState(state) {
  await writeFile(STATE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

// Step recorder: PASS / FAIL / NOT OBSERVED, never PASS without an observation.
export class Rec {
  constructor(phase) {
    this.phase = phase;
    this.started = Date.now();
    this.rows = [];
    this.network = [];
    this.console = [];
    this.notes = {};
  }
  row(id, label, status, detail, extra = {}) {
    const row = {
      id,
      label,
      status,
      detail: redact(detail),
      tMs: Date.now() - this.started,
      ...extra,
    };
    this.rows.push(row);
    void progress(
      `[${this.phase}] ${id} ${status}: ${redact(detail).slice(0, 220)}`,
    );
    return row;
  }
  async write() {
    await writeFile(
      path.join(OUT, `phase-${this.phase}.json`),
      JSON.stringify(
        {
          phase: this.phase,
          rows: this.rows,
          notes: this.notes,
          console: this.console,
          network: this.network,
        },
        null,
        2,
      ),
    );
  }
}

export function instrument(page, rec, tag) {
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()))
      rec.console.push({
        tag,
        tMs: Date.now() - rec.started,
        type: message.type(),
        text: redact(message.text()).slice(0, 300),
      });
  });
  page.on("pageerror", (error) =>
    rec.console.push({
      tag,
      tMs: Date.now() - rec.started,
      type: "pageerror",
      text: redact(error.message).slice(0, 300),
    }),
  );
  page.on("requestfailed", (request) =>
    rec.network.push({
      tag,
      tMs: Date.now() - rec.started,
      kind: "requestfailed",
      method: request.method(),
      url: cleanUrl(request.url()),
      failure: request.failure()?.errorText,
    }),
  );
  page.on("response", (response) => {
    const url = response.url();
    const status = response.status();
    const media =
      /upload|media|blossom|avatar|\.(png|jpe?g|webp)|invite|join|member/iu.test(
        url,
      );
    if (status >= 400 || (media && !/^(data|blob):/u.test(url)))
      rec.network.push({
        tag,
        tMs: Date.now() - rec.started,
        kind: status >= 400 ? "http>=400" : "http",
        method: response.request().method(),
        status,
        url: cleanUrl(url),
      });
  });
}

export async function shot(page, rec, name) {
  const file = `${rec.phase}-${name}.png`;
  try {
    await page.screenshot({ path: path.join(OUT, "screenshots", file) });
    return `screenshots/${file}`;
  } catch {
    return null;
  }
}

// ---- launch ----
export async function newProfile(label) {
  const privateDir = await realpath(
    await mkdtemp(path.join(os.tmpdir(), `colony-ai-${label}-`)),
  );
  await chmod(privateDir, 0o700);
  const userDataDir = path.join(privateDir, "user-data");
  await mkdir(userDataDir, { mode: 0o700 });
  return { privateDir, userDataDir };
}

export async function waitForLoad(max = 12, timeoutMs = 20 * 60 * 1000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const load = os.loadavg()[0];
    if (load < max) return load;
    await sleep(10000);
  }
  throw new Error("Load gate not reached");
}

// Launch the published app under the keychain-deny policy with a given user-data dir.
export async function launch({ privateDir, userDataDir, extraEnv = {} }) {
  const exe = path.join(APP, "Contents", "MacOS", "Colony");
  const q = (value) => `'${value.replace(/'/gu, `'\\''`)}'`;
  const sandbox = path.join(privateDir, "sandbox.sb");
  await writeFile(sandbox, realEnvSandboxPolicy(undefined, ""), {
    mode: 0o600,
  });
  const launcher = path.join(privateDir, "launch.sh");
  await writeFile(
    launcher,
    `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${q(sandbox)} ${q(exe)} "$@"\n`,
    { mode: 0o700 },
  );
  const application = await electron.launch({
    executablePath: launcher,
    args: ["--no-sandbox", `--user-data-dir=${userDataDir}`],
    env: {
      ...realEnvironment(process.env, userDataDir, RELAY),
      COLONY_NATIVE_HOST_LOG: path.join(privateDir, "native-host.log"),
      ...extraEnv,
    },
    timeout: 60000,
  });
  const version = await application.evaluate(({ app }) => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    userData: app.getPath("userData"),
  }));
  if (!version.packaged || version.userData !== userDataDir)
    throw new Error("Profile isolation assertion failed");
  const first = await application.firstWindow({ timeout: 30000 });
  await first.setViewportSize({ width: 1440, height: 960 });
  await first.waitForLoadState("domcontentloaded", { timeout: 20000 });
  const current = () => {
    if (!first.isClosed()) return first;
    const open = application.windows().filter((item) => !item.isClosed());
    return open[open.length - 1] ?? first;
  };
  const page = new Proxy(first, {
    get(_t, property) {
      const active = current();
      const value = active[property];
      return typeof value === "function" ? value.bind(active) : value;
    },
  });
  return { application, page, version: version.version };
}

export async function closeApp(application) {
  try {
    await Promise.race([
      application.close(),
      sleep(10000).then(() => Promise.reject(new Error("close deadline"))),
    ]);
  } catch {
    application.process().kill("SIGTERM");
  }
}

// ---- onboarding ----
export async function signUp(page, rec, label) {
  const inbox = await createSmokeInbox();
  await page.getByTestId("machine-onboarding-gate").waitFor({ timeout: 30000 });
  const name = page.getByLabel("Your name", { exact: true });
  if (!(await name.isVisible()))
    await page.getByRole("button", { name: /Create an account/iu }).click();
  if (await name.isVisible()) await name.fill(label);
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
  return inbox;
}

export async function createBusiness(
  page,
  name,
  website = "https://example.com",
) {
  await page
    .getByLabel("Business name", { exact: true })
    .waitFor({ timeout: 25000 });
  await page.getByLabel("Business name", { exact: true }).fill(name);
  await page.getByLabel("Website", { exact: false }).fill(website);
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

export async function skipConnect(page) {
  const skip = page.getByRole("button", { name: "Skip for now", exact: true });
  await skip.scrollIntoViewIfNeeded();
  await skip.click();
  await page.getByTestId("app-sidebar").waitFor({ timeout: 45000 });
}

// ---- png ----
function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++)
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return ~crc >>> 0;
}
// 256x256 truecolor PNG: diagonal gradient with a bold ring, recognisable on screen.
export function makePng(size = 256) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2,
        dy = y - size / 2;
      const r = Math.sqrt(dx * dx + dy * dy);
      const ring = r > 70 && r < 100;
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = ring ? 255 : Math.round((x / size) * 200);
      raw[o + 1] = ring ? 200 : Math.round((y / size) * 120);
      raw[o + 2] = ring ? 0 : 180;
    }
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Visible control inventory for a root: buttons, links, inputs, testids. Text only.
export async function inventory(page, rootSelector = "body", limit = 80) {
  return page.evaluate(
    ({ rootSelector, limit }) => {
      const root = document.querySelector(rootSelector) ?? document.body;
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return (
          r.width > 0 &&
          r.height > 0 &&
          s.visibility !== "hidden" &&
          s.display !== "none"
        );
      };
      const out = [];
      for (const el of root.querySelectorAll(
        "button,a,input,[role=button],[role=menuitem],[role=tab],[data-testid],textarea,select",
      )) {
        if (!visible(el) && el.type !== "file") continue;
        out.push({
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute("type") || undefined,
          testid: el.getAttribute("data-testid") || undefined,
          aria: el.getAttribute("aria-label") || undefined,
          text:
            (el.innerText || el.value || "").trim().slice(0, 60) || undefined,
          accept: el.getAttribute("accept") || undefined,
          disabled:
            el.disabled ||
            el.getAttribute("aria-disabled") === "true" ||
            undefined,
        });
        if (out.length >= limit) break;
      }
      return out;
    },
    { rootSelector, limit },
  );
}
