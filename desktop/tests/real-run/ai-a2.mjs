// Phase A2: relaunch profile A with the SAME user-data dir. Avatar persistence (QA3), members-list entry
// point (QA1), then mint invites (QB1) and curl the landing page (QB2). Local only (COLONY_REAL_RUN=1).
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  OUT,
  Rec,
  closeApp,
  instrument,
  inventory,
  launch,
  loadState,
  progress,
  redact,
  saveState,
  shot,
  sleep,
  waitForLoad,
} from "./ai-lib.mjs";

const run = promisify(execFile);
if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI)
  throw new Error("COLONY_REAL_RUN=1 required, local only");
const rec = new Rec("A2");
const state = await loadState();
if (!state.A?.userDataDir) throw new Error("run A1 first");
const load = await waitForLoad();
await progress(
  `[A2] load ${load.toFixed(1)} ok, relaunching profile A (same dir)`,
);
const { application, page, version } = await launch({
  privateDir: state.A.privateDir,
  userDataDir: state.A.userDataDir,
});
rec.notes.version = version;
instrument(page, rec, "A");
const guard = async (id, label, fn) => {
  try {
    return await fn();
  } catch (error) {
    rec.row(
      id,
      label,
      "FAIL",
      `Step threw ${error.name}: ${redact(error.message).split("\n")[0]}`,
      { screenshot: await shot(page, rec, `${id}-error`) },
    );
    return undefined;
  }
};
const sidebarAvatar = () =>
  page.evaluate(() => {
    const img = document.querySelector(
      '[data-testid="sidebar-profile-avatar-image"]',
    );
    const fb = document.querySelector(
      '[data-testid="sidebar-profile-avatar-fallback"]',
    );
    return {
      image: Boolean(img),
      fallback: Boolean(fb),
      src: img?.currentSrc?.slice(0, 110) ?? null,
      nat: img ? [img.naturalWidth, img.naturalHeight] : null,
    };
  });
const entries = {};
const invites = {};
try {
  await guard("QA3-relaunch", "Relaunch profile A", async () => {
    await page.getByTestId("app-sidebar").waitFor({ timeout: 60000 });
    await sleep(5000);
    rec.row(
      "QA3-relaunch",
      "Relaunch with same profile dir reaches the signed-in app",
      "PASS",
      "app-sidebar visible after relaunch",
      { screenshot: await shot(page, rec, "qa3-relaunched") },
    );
    const info = await sidebarAvatar();
    rec.notes.sidebarAvatarAfterRelaunch = JSON.parse(
      redact(JSON.stringify(info)),
    );
    const src = info.src ?? "";
    rec.notes.avatarSrcKind = src.startsWith("data:")
      ? "data URL"
      : src.startsWith("buzz-media:")
        ? "buzz-media:// (relay media via app proxy)"
        : src.startsWith("http://127.0.0.1")
          ? "local media proxy"
          : src
            ? "other"
            : "none";
    rec.row(
      "QA3-persist",
      "Uploaded avatar still shown in sidebar after relaunch (same profile dir)",
      info.image && info.nat?.[0] > 0 ? "PASS" : "FAIL",
      JSON.stringify(info),
      { screenshot: await shot(page, rec, "qa3-sidebar") },
    );
  });

  // #general: send a message so avatar-next-to-message can be checked here and by B.
  await guard("QA3-general", "Open #general and post a message", async () => {
    await page
      .getByText(/^general$/iu)
      .first()
      .click({ timeout: 8000 });
    await page.getByTestId("message-timeline").waitFor({ timeout: 15000 });
    await sleep(1200);
    const msg = `Avatar check message from A ${Date.now() % 100000}`;
    await page
      .locator(
        '[data-testid="message-composer"] [contenteditable="true"], [data-testid="message-composer"] textarea',
      )
      .first()
      .click();
    await page.keyboard.type(msg);
    await page.keyboard.press("Enter");
    await sleep(2500);
    const own = await page.evaluate((m) => {
      const row = [
        ...document.querySelectorAll('[data-testid="message-row"]'),
      ].find((r) => r.textContent.includes(m));
      const img = row?.querySelector("img");
      return {
        found: Boolean(row),
        avatarImg: img
          ? {
              nat: [img.naturalWidth, img.naturalHeight],
              kind: img.currentSrc.startsWith("data:") ? "data" : "url",
            }
          : null,
      };
    }, msg);
    rec.notes.aMessage = msg;
    rec.row(
      "QA3-own-message-avatar",
      "A's own message in #general shows A's uploaded avatar",
      own.avatarImg && own.avatarImg.nat[0] > 0 ? "PASS" : "FAIL",
      `message visible: ${own.found}; avatar: ${JSON.stringify(own)}`,
      { screenshot: await shot(page, rec, "qa3-own-message") },
    );
  });

  // Settings > Business > People & access
  await guard("QB1-people", "Open Settings > People & access", async () => {
    await page.getByTestId("open-settings").click({ timeout: 8000 });
    await page.getByTestId("profile-popover-settings").click({ timeout: 8000 });
    await page.getByTestId("settings-view").waitFor({ timeout: 15000 });
    rec.notes.settingsGroups = await page
      .locator('[data-testid^="settings-group-"]')
      .evaluateAll((els) => els.map((e) => e.innerText.trim()));
    await page.getByTestId("settings-group-business").click();
    await sleep(600);
    rec.notes.businessTabs = await page
      .locator('[data-testid^="settings-inner-"]')
      .evaluateAll((els) => els.map((e) => e.innerText.trim()));
    await page.getByTestId("settings-inner-people").click();
    await page
      .getByTestId("settings-community-members")
      .waitFor({ timeout: 15000 });
    await sleep(1500);
    const trigger = page.getByTestId("community-invite-dialog-trigger");
    rec.row(
      "QB1-people",
      "Invite entry point: Settings > Business > People & access shows Invite to community",
      (await trigger.count()) ? "PASS" : "FAIL",
      `tabs: ${rec.notes.businessTabs.join(", ")}; heading text: ${(await page.getByTestId("settings-community-members").innerText()).replace(/\s+/gu, " ").slice(0, 160)}; trigger: "${(await trigger.innerText().catch(() => "")).trim()}"`,
      { screenshot: await shot(page, rec, "qb1-members") },
    );
    // Members list: click own row avatar for the entry-point inventory.
    const own = page
      .locator('[data-testid^="relay-member-row-"]')
      .filter({ hasText: /\bYou\b/u })
      .first();
    if (await own.count()) {
      await own
        .locator('button[aria-label^="Open profile for"]')
        .first()
        .click({ timeout: 5000 })
        .catch(() => undefined);
      await sleep(900);
      const inv = await inventory(
        page,
        "[data-radix-popper-content-wrapper]",
        80,
      );
      entries.memberListOwn = inv;
      const upload = inv.filter((i) =>
        /avatar|photo|upload|picture/iu.test(
          `${i.testid ?? ""} ${i.aria ?? ""} ${i.text ?? ""}`,
        ),
      );
      rec.row(
        "QA1-memberlist",
        "Entry point: click own row in the members list",
        upload.length ? "PASS" : "FAIL",
        upload.length
          ? `Avatar controls: ${JSON.stringify(upload)}`
          : `Own profile popover has no avatar upload control. Controls: ${inv
              .map((i) => i.testid ?? i.text ?? i.aria)
              .filter(Boolean)
              .slice(0, 25)
              .join(" | ")}`,
        { screenshot: await shot(page, rec, "qa1-memberlist-own") },
      );
      await sleep(300);
    } else
      rec.row(
        "QA1-memberlist",
        "Entry point: click own row in the members list",
        "NOT OBSERVED",
        "No own row with a You badge",
        { screenshot: await shot(page, rec, "qa1-memberlist-missing") },
      );
  });

  const gotoPeople = async () => {
    if (
      !(await page
        .getByTestId("settings-view")
        .isVisible()
        .catch(() => false))
    ) {
      await page.getByTestId("open-settings").click({ timeout: 8000 });
      await page
        .getByTestId("profile-popover-settings")
        .click({ timeout: 8000 });
      await page.getByTestId("settings-view").waitFor({ timeout: 15000 });
    }
    await page.getByTestId("settings-group-business").click();
    await sleep(500);
    await page.getByTestId("settings-inner-people").click();
    await page
      .getByTestId("settings-community-members")
      .waitFor({ timeout: 15000 });
    await sleep(1000);
  };
  const readLink = async () => {
    await page.waitForFunction(
      () =>
        /\/invite\/v2\./u.test(
          document.querySelector('[data-testid="invite-link-url"]')?.value ??
            "",
        ),
      null,
      { timeout: 30000 },
    );
    return (await page.getByTestId("invite-link-url").inputValue()).trim();
  };
  await guard("QB1-link", "Invite dialog and link", async () => {
    const t = Date.now();
    if (
      !(await page
        .getByTestId("community-invite-dialog-trigger")
        .isVisible()
        .catch(() => false))
    )
      await gotoPeople();
    await page
      .getByTestId("community-invite-dialog-trigger")
      .click({ timeout: 10000 });
    await page
      .getByTestId("community-invite-dialog")
      .waitFor({ timeout: 8000 });
    invites.default = await readLink();
    rec.notes.inviteShape = redact(invites.default);
    rec.notes.inviteDialogText = (
      await page.getByTestId("community-invite-dialog").innerText()
    )
      .replace(/\s+/gu, " ")
      .slice(0, 500);
    rec.row(
      "QB1-link",
      "Invite link generates",
      "PASS",
      `Generated in ${Date.now() - t} ms. Shape: ${rec.notes.inviteShape}. Dialog text: ${rec.notes.inviteDialogText}`,
      { screenshot: await shot(page, rec, "qb1-invite-dialog") },
    );
    await page.getByTestId("invite-link-ttl-trigger").click();
    await sleep(400);
    const ttl = await page
      .locator('[data-testid^="invite-link-ttl-"]')
      .evaluateAll((els) =>
        els
          .filter((e) => !e.getAttribute("data-testid").endsWith("trigger"))
          .map((e) => e.innerText.trim()),
      );
    await shot(page, rec, "qb1-ttl-options");
    await page.keyboard.press("Escape");
    await sleep(500);
    await page.getByTestId("invite-link-max-uses-trigger").click();
    await sleep(400);
    const uses = await page
      .locator('[data-testid^="invite-link-max-uses-"]')
      .evaluateAll((els) =>
        els
          .filter((e) => !e.getAttribute("data-testid").endsWith("trigger"))
          .map((e) => e.innerText.trim()),
      );
    await shot(page, rec, "qb1-uses-options");
    rec.notes.ttlOptions = ttl;
    rec.notes.maxUsesOptions = uses;
    rec.row(
      "QB1-options",
      "Expiry and max-uses options",
      ttl.length && uses.length ? "PASS" : "FAIL",
      `Expiry: ${ttl.join(", ")}. Max uses: ${uses.join(", ")}. Default expiry shown: ${(await page.getByTestId("invite-link-ttl-trigger").innerText()).trim()}`,
      {},
    );
    // 1 use invite (this mints a NEW invite).
    await page.getByTestId("invite-link-max-uses-1").click();
    await sleep(1000);
    invites.single = await readLink();
    rec.row(
      "QB1-single",
      "Single-use invite minted ('1 use')",
      invites.single !== invites.default ? "PASS" : "FAIL",
      `Distinct from default: ${invites.single !== invites.default}. Shape: ${redact(invites.single)}`,
      { screenshot: await shot(page, rec, "qb1-single-use") },
    );
  });
  state.invites = invites;
  await saveState(state);
  await guard("QB1-direct", "Direct add option", async () => {
    const direct = page.getByTestId("direct-add-member-form");
    rec.row(
      "QB1-direct",
      "Invite dialog also has a direct add form; email invite?",
      (await direct.count()) ? "PASS" : "FAIL",
      `Direct add input placeholder: "${await page
        .getByTestId("member-pubkey-input")
        .getAttribute("placeholder")
        .catch(
          () => "n/a",
        )}" (name search or npub, no email field). Confirm button: "${(
        await page
          .getByTestId("confirm-add-member")
          .innerText()
          .catch(() => "")
      ).trim()}"`,
      {},
    );
  });

  // QB2: curl the REAL minted URL (read only GET). Body saved with the code replaced by XXXX.
  await guard("QB2-curl", "GET invite URL", async () => {
    const url = invites.default;
    const file = path.join(OUT, "invite-landing.raw");
    const { stdout } = await run(
      "curl",
      ["-sS", "-m", "20", "-D", "-", "-o", file, url],
      { maxBuffer: 1 << 20 },
    );
    const status = stdout
      .split("\n")
      .find((l) => /^HTTP\//u.test(l))
      ?.trim();
    const ctype = stdout
      .split("\n")
      .find((l) => /^content-type:/iu.test(l))
      ?.trim();
    const body = await readFile(file, "utf8");
    const title = body.match(/<title>([^<]*)<\/title>/iu)?.[1];
    const assets = [...body.matchAll(/(?:src|href)="([^"]+)"/gu)]
      .map((m) => m[1])
      .slice(0, 12);
    rec.notes.landing = { status, ctype, title, bytes: body.length, assets };
    await writeFile(
      path.join(OUT, "invite-landing.html"),
      redact(body.replaceAll(url.split("/").pop(), "XXXX")),
    );
    rec.row(
      "QB2-curl",
      "curl GET of the real invite URL",
      status?.includes("200") ? "PASS" : "FAIL",
      `${status}; ${ctype}; <title>${title}</title>; ${body.length} bytes (SPA shell; text is rendered by JavaScript). Assets: ${assets.join(", ")}`,
      {},
    );
  });
} finally {
  await writeFile(
    path.join(OUT, "entries-A2.json"),
    JSON.stringify(entries, null, 2),
  );
  rec.notes.endedAt = new Date().toISOString();
  await rec.write();
  await closeApp(application);
  await progress(`[A2] done, ${rec.rows.length} rows`);
}
