// Colony 1.0.5 candidate gate, profile A (owner) relaunched with the SAME user-data dir (items 5, 7 and invites).
// usage: node c105-a2.mjs
//  1. relaunch, version, legacy-name watcher (every 200 ms for the whole run, with context)
//  2. mint invites: default plus single-use
//  3. avatar: labelled "Change photo" in Settings and in the sidebar menu, upload a PNG, see it in the
//     sidebar, Settings and next to an own message, an unsupported file, an oversized file, a failed upload
//     with Retry (network cut), owner role caption
//  4. ask Scout again while watching for legacy names (reproduces the brand-scan hit of the first run)
import { writeFile } from "node:fs/promises";
import { startToggleProxy } from "./netfail.mjs";
import path from "node:path";
import {
  OUT,
  Rec,
  closeApp,
  instrument,
  launch,
  loadState,
  makePng,
  progress,
  redact,
  saveState,
  shot,
  sleep,
  waitForLoad,
} from "./ai-lib.mjs";

if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI)
  throw new Error("COLONY_REAL_RUN=1 required, local only");
const rec = new Rec("A2");
const state = await loadState();
if (!state.A?.userDataDir) throw new Error("no profile A in state");
const only = process.env.ONLY ?? "all";
// NETFAIL=proxy: launch against a local toggleable proxy so the avatar upload can be made to fail for real.
const proxy = process.env.NETFAIL === "proxy" ? await startToggleProxy() : null;
const load = await waitForLoad();
await progress(`[A2] load ${load.toFixed(1)} ok, relaunching profile A`);
const { application, page, version } = await launch({
  privateDir: state.A.privateDir,
  userDataDir: state.A.userDataDir,
  extraEnv: proxy ? proxy.env : {},
});
rec.notes.version = version;
instrument(page, rec, "A");
const lifecycle = [];
const launchedAt = Date.now();
application
  .process()
  .on("exit", (code, signal) =>
    lifecycle.push({ sinceLaunchMs: Date.now() - launchedAt, code, signal }),
  );
const guard = async (id, label, fn) => {
  if (
    only === "106" &&
    ["A5-bad-type", "A5-oversized", "A5-owner-caption", "A2-scout"].includes(id)
  )
    return undefined;
  if (only === "retry" && !["A5-retry", "A2-relaunch"].includes(id))
    return undefined;
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
const body = async (n = 400) =>
  redact(
    (
      await page
        .locator("body")
        .innerText()
        .catch(() => "")
    )
      .replace(/\s+/gu, " ")
      .slice(0, n),
  );

// Legacy-name watcher: visible text, accessible names and the window title, with context.
const legacy = [];
const legacyRe = /(buzz|fizz|honey|pollen|\u{1f41d})/iu;
const watcher = setInterval(async () => {
  try {
    const hit = await page.evaluate(() => {
      const re = /.{0,50}(buzz|fizz|honey|pollen|\u{1f41d}).{0,50}/iu;
      const out = [];
      const text = document.body?.innerText ?? "";
      const m = text.match(re);
      if (m) out.push({ where: "visible text", context: m[0] });
      for (const el of document.querySelectorAll(
        "[aria-label],[title],[alt]",
      )) {
        const v = `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""} ${el.getAttribute("alt") ?? ""}`;
        if (re.test(v))
          out.push({ where: "attribute", context: v.trim().slice(0, 120) });
        if (out.length > 3) break;
      }
      if (re.test(document.title))
        out.push({ where: "window title", context: document.title });
      return out;
    });
    for (const item of hit) {
      const key = `${item.where}|${item.context}`;
      if (!legacy.some((l) => l.key === key))
        legacy.push({ key, ...item, atMs: Date.now() - launchedAt });
    }
  } catch {
    /* page gone */
  }
}, 200);

const openSettings = async () => {
  if (
    await page
      .getByTestId("settings-view")
      .isVisible()
      .catch(() => false)
  )
    return;
  await page.getByTestId("open-settings").click({ timeout: 8000 });
  await page.getByTestId("profile-popover-settings").click({ timeout: 8000 });
  await page.getByTestId("settings-view").waitFor({ timeout: 15000 });
  await sleep(700);
};
const closeSettings = async () => {
  await page.keyboard.press("Escape");
  await sleep(500);
  if (
    await page
      .getByTestId("settings-view")
      .isVisible()
      .catch(() => false)
  )
    await page
      .getByRole("button", { name: /close|back/iu })
      .first()
      .click()
      .catch(() => undefined);
  await sleep(500);
};
const sidebarAvatar = () =>
  page.evaluate(() => {
    const img = document.querySelector(
      '[data-testid="sidebar-profile-avatar-image"]',
    );
    return {
      image: Boolean(img),
      nat: img ? [img.naturalWidth, img.naturalHeight] : null,
      src: img?.currentSrc?.slice(0, 40) ?? null,
    };
  });
const cleanUrlLite = (u) =>
  redact(String(u).replace(/\?.*$/u, "").slice(0, 90));
const png = path.join(state.A.privateDir, "avatar-256.png");
await writeFile(png, makePng(256));
const bad = path.join(state.A.privateDir, "not-an-image.txt");
await writeFile(bad, "this is plain text, not an image\n".repeat(50));
const big = path.join(state.A.privateDir, "oversized.png");
await writeFile(
  big,
  Buffer.concat([makePng(256), Buffer.alloc(21 * 1024 * 1024)]),
);

const openAvatarDialogFrom = async (entry) => {
  if (entry === "settings") {
    await openSettings();
    if (
      !(await page
        .getByTestId("profile-photo-change")
        .isVisible()
        .catch(() => false))
    ) {
      await page
        .getByTestId("settings-group-account")
        .click({ timeout: 5000 })
        .catch(() => undefined);
      await sleep(500);
    }
    if (
      !(await page
        .getByTestId("profile-photo-change")
        .isVisible()
        .catch(() => false))
    )
      await page
        .getByText(/^Profile$/u)
        .first()
        .click({ timeout: 4000 })
        .catch(() => undefined);
    await page.getByTestId("profile-photo-change").click({ timeout: 8000 });
  } else {
    await closeSettings();
    await page
      .getByTestId("sidebar-profile-avatar-button")
      .click({ timeout: 8000 });
    await sleep(500);
    await page
      .getByTestId("profile-popover-change-photo")
      .click({ timeout: 8000 });
  }
  await page.getByTestId("profile-avatar-dialog").waitFor({ timeout: 8000 });
  await sleep(500);
};
const dialogText = async () =>
  redact(
    (
      await page
        .getByTestId("profile-avatar-dialog")
        .innerText()
        .catch(() => "")
    )
      .replace(/\s+/gu, " ")
      .slice(0, 500),
  );
const chooseFile = async (file) => {
  await page.getByTestId("avatar-upload-open").click({ timeout: 6000 });
  await sleep(500);
  await page.getByTestId("avatar-file-input").setInputFiles(file);
  await sleep(1200);
};

try {
  rec.row(
    "A2-version",
    `App reports version ${process.env.EXPECT_VERSION ?? "1.0.5"}`,
    version === (process.env.EXPECT_VERSION ?? "1.0.5") ? "PASS" : "FAIL",
    `app.getVersion() = ${version}`,
  );
  await guard("A2-relaunch", "Relaunch profile A", async () => {
    await page.getByTestId("app-sidebar").waitFor({ timeout: 60000 });
    await sleep(3000);
    rec.row(
      "A2-relaunch",
      "Relaunch with the same profile dir reaches the signed-in app",
      "PASS",
      `Page: ${await body(160)}. Sidebar avatar: ${JSON.stringify(await sidebarAvatar())}`,
      { screenshot: await shot(page, rec, "a2-01-relaunched") },
    );
  });

  // ---- invites ----
  await guard("A2-invites", "Mint invites", async () => {
    await page.getByTestId("open-settings").click({ timeout: 8000 });
    await page.getByTestId("profile-popover-settings").click({ timeout: 8000 });
    await page.getByTestId("settings-view").waitFor({ timeout: 15000 });
    await page.getByTestId("settings-group-business").click();
    await sleep(500);
    await page.getByTestId("settings-inner-people").click();
    await page
      .getByTestId("settings-community-members")
      .waitFor({ timeout: 15000 });
    await sleep(1200);
    await page
      .getByTestId("community-invite-dialog-trigger")
      .click({ timeout: 10000 });
    await page
      .getByTestId("community-invite-dialog")
      .waitFor({ timeout: 8000 });
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
    const invites = {};
    invites.default = await readLink();
    await shot(page, rec, "a2-02-invite-dialog");
    await page.getByTestId("invite-link-max-uses-trigger").click();
    await sleep(400);
    await page.getByTestId("invite-link-max-uses-1").click();
    await sleep(1200);
    invites.single = await readLink();
    state.invites = invites;
    await saveState(state);
    rec.row(
      "A2-invites",
      "Invite links minted: default and single use",
      invites.default !== invites.single ? "PASS" : "FAIL",
      `Shapes: ${redact(invites.default)} and ${redact(invites.single)}. Relay host: ${new URL(invites.default).host}`,
      { screenshot: await shot(page, rec, "a2-03-single-use") },
    );
    await page.keyboard.press("Escape");
    await sleep(500);
  });

  // ---- avatar ----
  if (only === "all" || only === "avatar" || only === "retry") {
    await guard(
      "A5-entry-settings",
      "Settings Profile shows Change photo",
      async () => {
        await openSettings();
        if (
          !(await page
            .getByTestId("profile-photo-change")
            .isVisible()
            .catch(() => false))
        ) {
          await page
            .getByTestId("settings-group-account")
            .click({ timeout: 5000 })
            .catch(() => undefined);
          await sleep(500);
        }
        const btn = page.getByTestId("profile-photo-change");
        const visible = await btn.isVisible().catch(() => false);
        const text = visible ? (await btn.innerText()).trim() : "";
        rec.row(
          "A5-entry-settings",
          'Settings, Account, Profile: labelled "Change photo"',
          visible && /Change photo/u.test(text) ? "PASS" : "FAIL",
          `Visible: ${visible}. Label text: "${text}". Page: ${await body(200)}`,
          { screenshot: await shot(page, rec, "a5-01-settings-profile") },
        );
      },
    );
    await guard(
      "A5-entry-sidebar",
      "Sidebar avatar menu has Change photo",
      async () => {
        await closeSettings();
        await page
          .getByTestId("sidebar-profile-avatar-button")
          .click({ timeout: 8000 });
        await sleep(600);
        const item = page.getByTestId("profile-popover-change-photo");
        const visible = await item.isVisible().catch(() => false);
        const text = visible ? (await item.innerText()).trim() : "";
        rec.row(
          "A5-entry-sidebar",
          'Sidebar avatar menu: labelled "Change photo"',
          visible && /Change photo/u.test(text) ? "PASS" : "FAIL",
          `Visible: ${visible}. Label text: "${text}"`,
          { screenshot: await shot(page, rec, "a5-02-sidebar-menu") },
        );
        await page.keyboard.press("Escape");
        await sleep(400);
      },
    );
    await guard("A5-upload", "Upload a PNG", async () => {
      const before = await sidebarAvatar();
      await openAvatarDialogFrom("sidebar");
      rec.notes.dialogInitial = await dialogText();
      await shot(page, rec, "a5-03-dialog");
      await chooseFile(png);
      const cropText = await dialogText();
      await shot(page, rec, "a5-04-crop");
      const t = Date.now();
      await page.getByTestId("avatar-save").click({ timeout: 8000 });
      await page
        .getByTestId("profile-avatar-dialog")
        .waitFor({ state: "hidden", timeout: 40000 })
        .catch(() => undefined);
      const closedMs = Date.now() - t;
      await sleep(2500);
      const after = await sidebarAvatar();
      rec.row(
        "A5-upload",
        "Upload a PNG: sidebar shows the picture",
        after.image && after.nat?.[0] > 0 ? "PASS" : "FAIL",
        `Before: ${JSON.stringify(before)}. After: ${JSON.stringify(after)}. Dialog closed after ${closedMs} ms. Crop stage text: ${cropText}. Dialog still visible: ${await page
          .getByTestId("profile-avatar-dialog")
          .isVisible()
          .catch(() => false)}`,
        { screenshot: await shot(page, rec, "a5-05-after-upload") },
      );
    });
    await guard("A5-settings-img", "Picture shows in Settings", async () => {
      await openSettings();
      if (
        !(await page
          .getByTestId("settings-account-profile-card")
          .isVisible()
          .catch(() => false))
      )
        await page
          .getByTestId("settings-group-account")
          .click({ timeout: 5000 })
          .catch(() => undefined);
      await sleep(900);
      const info = await page.evaluate(() => {
        const card = document.querySelector(
          '[data-testid="settings-account-profile-card"]',
        );
        const img = card?.querySelector("img");
        return {
          card: Boolean(card),
          img: img ? [img.naturalWidth, img.naturalHeight] : null,
        };
      });
      rec.row(
        "A5-settings-img",
        "Uploaded picture shown in Settings profile card",
        info.img?.[0] > 0 ? "PASS" : "FAIL",
        JSON.stringify(info),
        { screenshot: await shot(page, rec, "a5-06-settings-pic") },
      );
    });
    await guard(
      "A5-message-avatar",
      "Picture next to an own message",
      async () => {
        await closeSettings();
        await page
          .getByText(/^general$/iu)
          .first()
          .click({ timeout: 8000 });
        await page.getByTestId("message-timeline").waitFor({ timeout: 15000 });
        await sleep(1000);
        const msg = `Avatar check message from A ${Date.now() % 100000}`;
        await page
          .locator('[data-testid="message-composer"] [contenteditable="true"]')
          .first()
          .click();
        await page.keyboard.type(msg);
        await page.keyboard.press("Enter");
        await sleep(3000);
        const own = await page.evaluate((m) => {
          const row = [
            ...document.querySelectorAll('[data-testid="message-row"]'),
          ].find((r) => r.textContent.includes(m));
          const img = row?.querySelector("img");
          return {
            found: Boolean(row),
            img: img ? [img.naturalWidth, img.naturalHeight] : null,
          };
        }, msg);
        rec.notes.aMessage = msg;
        rec.row(
          "A5-message-avatar",
          "Own message in #general shows the uploaded picture",
          own.img?.[0] > 0 ? "PASS" : "FAIL",
          JSON.stringify(own),
          { screenshot: await shot(page, rec, "a5-07-own-message") },
        );
      },
    );
    await guard("A5-bad-type", "Unsupported file", async () => {
      await openAvatarDialogFrom("settings");
      await chooseFile(bad);
      const text = await dialogText();
      const buttons = await page
        .locator('[data-testid="profile-avatar-dialog"] button')
        .allInnerTexts();
      rec.row(
        "A5-bad-type",
        "Unsupported file shows an inline error",
        /JPEG|PNG|WebP|image|support|type|format/iu.test(text)
          ? "PASS"
          : "FAIL",
        `Dialog text: ${text}. Buttons: ${buttons.join(" | ")}`,
        { screenshot: await shot(page, rec, "a5-08-unsupported") },
      );
    });
    await guard("A5-oversized", "Oversized file", async () => {
      await page.getByTestId("avatar-file-input").setInputFiles(big);
      await sleep(1500);
      const text = await dialogText();
      const buttons = await page
        .locator('[data-testid="profile-avatar-dialog"] button')
        .allInnerTexts();
      rec.row(
        "A5-oversized",
        "Oversized file (21 MB) shows an inline error",
        /MB|large|size|big/iu.test(text) ? "PASS" : "FAIL",
        `Dialog text: ${text}. Buttons: ${buttons.join(" | ")}`,
        { screenshot: await shot(page, rec, "a5-09-oversized") },
      );
    });
    await guard("A5-retry", "Failed upload offers Retry", async () => {
      // Real failure at the network layer: the renderer's upload request to the app's local media proxy is aborted
      // (page.route -> route.abort). Playwright's setOffline and an HTTPS proxy env never reached the host upload
      // in the earlier runs (zero blocked requests), so those rows stayed NOT OBSERVED.
      if (only === "retry") {
        await openAvatarDialogFrom("sidebar");
        await chooseFile(png);
      } else {
        await page.getByTestId("avatar-file-input").setInputFiles(png);
        await sleep(1500);
      }
      await page.getByTestId("avatar-save").waitFor({ timeout: 6000 });
      let blockMedia = false;
      const aborted = [];
      const routeFn = (route) => {
        const req = route.request();
        if (blockMedia && req.method() !== "GET") {
          aborted.push(`${req.method()} ${cleanUrlLite(req.url())}`);
          return route.abort("failed");
        }
        return route.continue();
      };
      const routePattern = /127\.0\.0\.1:\d+\/media|\/upload|blossom/iu;
      await page.route(routePattern, routeFn);
      const modes = [];
      let retryVisible = false;
      let retryLabel = "";
      let text = "";
      let recovered = false;
      // Attempt 1: break the host to relay hop (reqwest) through the local proxy the app was launched against.
      // Attempt 2 (only if attempt 1 produced no failure): break the renderer to host hop with route.abort.
      for (const mode of proxy
        ? ["host-proxy", "renderer-abort"]
        : ["renderer-abort"]) {
        if (mode === "host-proxy") proxy.block(true);
        else blockMedia = true;
        await page.getByTestId("avatar-save").click();
        await sleep(12000);
        text = await dialogText();
        const retry = page.getByTestId("avatar-retry");
        retryVisible = await retry.isVisible().catch(() => false);
        retryLabel = retryVisible ? (await retry.innerText()).trim() : "";
        await shot(page, rec, `a5-10-failed-upload-${mode}`);
        modes.push({
          mode,
          retryVisible,
          proxy: proxy ? proxy.stats() : null,
          aborted: aborted.slice(0, 4),
          abortedCount: aborted.length,
        });
        if (proxy && mode === "host-proxy") proxy.block(false);
        blockMedia = false;
        if (retryVisible) {
          await sleep(1500);
          await retry.click();
          await page
            .getByTestId("profile-avatar-dialog")
            .waitFor({ state: "hidden", timeout: 40000 })
            .then(() => {
              recovered = true;
            })
            .catch(() => undefined);
          break;
        }
        // No failure seen: the upload went through (dialog closed) or nothing happened. Reopen for the next attempt.
        if (
          !(await page
            .getByTestId("profile-avatar-dialog")
            .isVisible()
            .catch(() => false))
        ) {
          await openAvatarDialogFrom("sidebar");
          await chooseFile(png);
          await page.getByTestId("avatar-save").waitFor({ timeout: 6000 });
        }
      }
      rec.notes.netfail = {
        modes,
        abortedCount: aborted.length,
        aborted: aborted.slice(0, 6),
      };
      await page
        .unroute(/127\.0\.0\.1:\d+\/media|\/upload|blossom/iu, routeFn)
        .catch(() => undefined);
      rec.row(
        "A5-retry",
        "Failed upload shows an inline error with Retry, and Retry works once online",
        retryVisible && recovered
          ? "PASS"
          : retryVisible
            ? "FAIL"
            : "NOT OBSERVED",
        `Attempts: ${JSON.stringify(rec.notes.netfail.modes)}. Retry control visible: ${retryVisible} ("${retryLabel}"). Dialog text while failed: ${text}. Retry succeeded after going back online: ${recovered}.`,
        { screenshot: await shot(page, rec, "a5-11-after-retry") },
      );
      if (!recovered)
        await page
          .getByTestId("avatar-cancel")
          .click()
          .catch(() => undefined);
    });
    await guard("A5-owner-caption", "Owner role caption", async () => {
      await openSettings();
      const caption = redact(
        (
          await page
            .getByTestId("settings-profile-avatar-context")
            .innerText()
            .catch(() => "")
        ).replace(/\s+/gu, " "),
      );
      rec.row(
        "A5-owner-caption",
        'Owner footer caption reads "Owner" or "Workspace owner"',
        /Owner|Workspace owner/u.test(caption) ? "PASS" : "FAIL",
        `Settings footer text: "${caption}"`,
        { screenshot: await shot(page, rec, "a5-12-owner-caption") },
      );
      await closeSettings();
    });
  }

  // ---- legacy names: ask Scout once more while the watcher runs ----
  if (only === "all" || only === "brand") {
    await guard(
      "A7-brand-repro",
      "Legacy-name watcher while Scout works",
      async () => {
        await page
          .getByTestId("channel-welcome")
          .first()
          .click({ timeout: 8000 })
          .catch(() => undefined);
        await page.getByTestId("message-timeline").waitFor({ timeout: 15000 });
        const composer = page
          .getByTestId("message-composer")
          .locator('[contenteditable="true"]')
          .first();
        await composer.click();
        await composer.fill("@");
        const menu = page.getByTestId("mention-autocomplete");
        await menu.waitFor({ timeout: 15000 });
        await menu
          .locator("[data-mention-suggestion-index]")
          .filter({ hasText: /Scout/u })
          .first()
          .click();
        await composer.press("End");
        await composer.pressSequentially(
          " what do you know about our business?",
        );
        await composer.press("Enter");
        const t = Date.now();
        await sleep(70000);
        rec.row(
          "A7-brand-repro",
          "No visible Buzz, Fizz, Honey, Pollen or bee text while Scout answers a second question",
          legacy.length ? "FAIL" : "PASS",
          `Watched every 200 ms for ${Date.now() - t} ms after sending (and the whole run). Hits: ${JSON.stringify(legacy.map(({ key: _k, ...rest }) => rest))}`,
          { screenshot: await shot(page, rec, "a7-01-after-second-question") },
        );
      },
    );
  }
  rec.notes.legacyHits = legacy.map(({ key: _k, ...rest }) => rest);
} finally {
  clearInterval(watcher);
  rec.notes.lifecycle = lifecycle;
  rec.notes.endedAt = new Date().toISOString();
  await rec.write();
  await closeApp(application);
  if (proxy) await proxy.close();
  await progress(`[A2] done, ${rec.rows.length} rows`);
  void OUT;
  void legacyRe;
}
