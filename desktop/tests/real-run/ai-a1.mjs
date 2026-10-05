// Phase A1: profile A (new throwaway profile, new smoke account, one business), then QUESTION A
// steps 1 and 2 on the published app: avatar entry points and a real PNG upload through the UI.
// usage: COLONY_REAL_RUN=1 node ai-a1.mjs   (run through heavy.sh)
import path from "node:path";
import { writeFile } from "node:fs/promises";
import {
  OUT,
  Rec,
  closeApp,
  createBusiness,
  instrument,
  inventory,
  launch,
  loadState,
  makePng,
  newProfile,
  progress,
  redact,
  saveState,
  shot,
  signUp,
  enterApp,
  sleep,
  waitForLoad,
} from "./ai-lib.mjs";

if (process.env.COLONY_REAL_RUN !== "1" || process.env.CI)
  throw new Error("COLONY_REAL_RUN=1 required, local only");
const rec = new Rec(process.argv[2] === "resume" ? "A1r" : "A1");
const state = await loadState();
const load = await waitForLoad();
await progress(`[A1] load ${load.toFixed(1)} ok, launching profile A`);
const resume = process.argv[2] === "resume";
const profile = resume
  ? { privateDir: state.A.privateDir, userDataDir: state.A.userDataDir }
  : await newProfile("A");
const { application, page, version } = await launch(profile);
rec.notes.version = version;
instrument(page, rec, "A");
const guard = async (id, label, fn) => {
  try {
    return await fn();
  } catch (error) {
    const png = await shot(page, rec, `${id}-error`);
    rec.row(
      id,
      label,
      "FAIL",
      `Step threw ${error.name}: ${redact(error.message).split("\n")[0]}`,
      { screenshot: png },
    );
    return undefined;
  }
};
try {
  // ---- account and business (setup, not under test) ----
  const t0 = Date.now();
  if (!resume) {
    const inbox = await guard("A-setup-account", "Create account A", () =>
      signUp(page, rec, "Smoke Avatar A"),
    );
    if (!inbox) throw new Error("no account");
    state.A = {
      email: inbox.email,
      password: inbox.password,
      userDataDir: profile.userDataDir,
      privateDir: profile.privateDir,
      name: "Smoke Avatar A",
    };
    await saveState(state);
    rec.row(
      "A-setup-account",
      "Create account A (real signup, mail.tm code)",
      "PASS",
      `Account ${inbox.email} verified in ${Date.now() - t0} ms`,
      { screenshot: await shot(page, rec, "setup-account") },
    );
    const suffix = inbox.email
      .split("@")[0]
      .replace("colony-launch-check-", "");
    const bizName = `Avatar invite ${suffix}`;
    const t1 = Date.now();
    await createBusiness(page, bizName).catch(async (error) => {
      const text = (
        await page
          .locator("body")
          .innerText()
          .catch(() => "")
      ).slice(0, 400);
      rec.row(
        "A-setup-business",
        "Create business A",
        "FAIL",
        `Create business failed (${error.name}). Page text: ${text}`,
        { screenshot: await shot(page, rec, "business-fail") },
      );
      throw error;
    });
    state.A.business = bizName;
    await saveState(state);
    rec.row(
      "A-setup-business",
      "Create business A (real onboarding, Connect screen reached)",
      "PASS",
      `Business created in ${Date.now() - t1} ms`,
      { screenshot: await shot(page, rec, "business-created") },
    );
  }
  // The Connect step has no skip when Claude Code is ready: connect for real, then open the app.
  const tEnter = Date.now();
  const trail = await enterApp(
    page,
    (name) => shot(page, rec, `enter-${name}`),
    resume ? state.A : undefined,
  ).catch(async (error) => {
    rec.row(
      "A-enter-app",
      "Reach the app after Connect",
      "FAIL",
      `${error.message}. Page: ${redact(
        (
          await page
            .locator("body")
            .innerText()
            .catch(() => "")
        )
          .replace(/\s+/gu, " ")
          .slice(0, 400),
      )}`,
      { screenshot: await shot(page, rec, "enter-fail") },
    );
    throw error;
  });
  rec.row(
    "A-enter-app",
    "Connect Claude Code and open the app",
    "PASS",
    `Screens passed: ${trail.join(" > ")} in ${Date.now() - tEnter} ms`,
    { screenshot: await shot(page, rec, "app-open") },
  );
  await sleep(3000);
  rec.notes.communityHost = await page.evaluate(() => {
    try {
      const list = JSON.parse(localStorage.getItem("buzz-communities") ?? "[]");
      return list.map((c) => ({ name: c.name, relayUrl: c.relayUrl }));
    } catch {
      return null;
    }
  });
  state.A.communities = rec.notes.communityHost;
  await saveState(state);

  // ---- Q-A1 entry points ----
  const entries = {};
  const hasAvatarControl = (inv) =>
    inv.some(
      (i) =>
        /avatar|photo|upload|picture/iu.test(
          `${i.testid ?? ""} ${i.aria ?? ""} ${i.text ?? ""}`,
        ) && !/^sidebar-profile-avatar/u.test(i.testid ?? ""),
    );
  // 1) sidebar avatar button (aria "Open profile menu for ...") and name button
  await guard("QA1-sidebar", "Entry point: sidebar avatar", async () => {
    await page
      .getByTestId("sidebar-profile-avatar-button")
      .click({ timeout: 10000 });
    await sleep(900);
    const inv = await inventory(page, '[data-testid="profile-popover"]');
    entries.sidebarAvatarButton = inv;
    const has = hasAvatarControl(inv);
    rec.row(
      "QA1-sidebar",
      "Entry point: click sidebar avatar",
      has ? "PASS" : "FAIL",
      has
        ? "Popover has an avatar-related control"
        : `Popover controls: ${inv
            .map((i) => i.testid ?? i.text ?? i.aria)
            .filter(Boolean)
            .join(" | ")}. No avatar upload control.`,
      { screenshot: await shot(page, rec, "qa1-sidebar-popover") },
    );
    await page.keyboard.press("Escape");
    await sleep(500);
  });
  // 2) Settings: default Profile panel, then footer button, then Edit avatar
  await guard("QA1-settings", "Entry point: Settings", async () => {
    await page.getByTestId("open-settings").click({ timeout: 10000 });
    await sleep(600);
    await page.getByTestId("profile-popover-settings").click({ timeout: 8000 });
    await page.getByTestId("settings-view").waitFor({ timeout: 15000 });
    await sleep(1000);
    const groups = await page
      .locator('[data-testid^="settings-group-"]')
      .evaluateAll((els) =>
        els.map((e) => ({
          id: e.getAttribute("data-testid"),
          text: e.innerText.trim(),
        })),
      );
    rec.notes.settingsGroups = groups;
    const editVisible0 = await page
      .getByTestId("profile-avatar-edit")
      .isVisible()
      .catch(() => false);
    rec.row(
      "QA1-settings-default",
      "Settings opens: avatar control visible in the default panel?",
      editVisible0 ? "PASS" : "FAIL",
      `${editVisible0 ? "Edit avatar visible" : "No Edit avatar control in the default panel"}. Groups: ${groups.map((g) => g.text).join(", ")}. Panel text: ${(await page.locator('[data-testid="settings-view"]').innerText()).replace(/\s+/gu, " ").slice(0, 260)}`,
      { screenshot: await shot(page, rec, "qa1-settings-default") },
    );
    // Profile / Account group
    const prof = groups.find((g) =>
      /profile|account/iu.test(`${g.id} ${g.text}`),
    );
    if (prof) {
      await page.getByTestId(prof.id).click();
      await sleep(1000);
      const v = await page
        .getByTestId("profile-avatar-edit")
        .isVisible()
        .catch(() => false);
      entries.settingsProfileGroup = await inventory(
        page,
        '[data-testid="settings-view"]',
        60,
      );
      rec.row(
        "QA1-settings-profile",
        `Settings > ${prof.text}: avatar control visible?`,
        v ? "PASS" : "FAIL",
        v
          ? "Edit avatar visible"
          : `No Edit avatar control. Controls: ${entries.settingsProfileGroup
              .filter((i) => i.tag !== "a")
              .map((i) => i.testid ?? i.text ?? i.aria)
              .filter(Boolean)
              .slice(0, 25)
              .join(" | ")}`,
        { screenshot: await shot(page, rec, "qa1-settings-profile-group") },
      );
    } else
      rec.row(
        "QA1-settings-profile",
        "Settings > Profile group",
        "NOT OBSERVED",
        "No profile or account group in the nav",
        {},
      );
    const footer = await inventory(
      page,
      '[data-testid="settings-profile-avatar-context"]',
    );
    entries.settingsFooter = footer;
    rec.row(
      "QA1-settings-footer",
      "Entry point: Settings nav footer avatar button (aria: Open profile avatar settings)",
      footer.length ? "PASS" : "FAIL",
      footer.length
        ? `Footer button visible, text: ${footer
            .map((i) => i.text ?? i.aria)
            .filter(Boolean)
            .join(" ")}. No visible label says it edits the avatar`
        : "Footer avatar button not found",
      { screenshot: await shot(page, rec, "qa1-settings-footer") },
    );
    await page
      .getByTestId("settings-profile-avatar-context")
      .click({ timeout: 8000 });
    await sleep(1000);
    const edit = page.getByTestId("profile-avatar-edit");
    const visible = await edit.isVisible().catch(() => false);
    entries.settingsAvatarContext = await inventory(
      page,
      '[data-testid="settings-profile"]',
      40,
    );
    rec.row(
      "QA1-settings-edit",
      "Footer button reveals Profile photo > Edit avatar",
      visible ? "PASS" : "FAIL",
      visible
        ? `Button labelled "${(await edit.innerText()).trim()}" visible`
        : "No Edit avatar button after footer click",
      { screenshot: await shot(page, rec, "qa1-settings-avatar-context") },
    );
  });
  await writeFile(
    path.join(OUT, "entries-A1.json"),
    JSON.stringify(entries, null, 2),
  );
  await rec.write();

  // ---- Q-A2 upload ----
  const png = makePng(256);
  const pngPath = path.join(profile.privateDir, "avatar-256.png");
  await writeFile(pngPath, png);
  rec.notes.png = { bytes: png.length, size: "256x256" };
  await guard("QA2-upload", "Upload 256x256 PNG through the UI", async () => {
    await page.getByTestId("profile-avatar-edit").click({ timeout: 8000 });
    await page.getByTestId("profile-avatar-dialog").waitFor({ timeout: 8000 });
    rec.row(
      "QA2-dialog",
      "Edit avatar dialog opens",
      "PASS",
      `Dialog buttons: ${(
        await inventory(page, '[data-testid="profile-avatar-dialog"]')
      )
        .map((i) => i.text ?? i.testid)
        .filter(Boolean)
        .join(" | ")}`,
      { screenshot: await shot(page, rec, "qa2-dialog-choose") },
    );
    await page.getByTestId("avatar-upload-open").click();
    await page.getByTestId("avatar-file-drop-zone").waitFor({ timeout: 5000 });
    const states = [];
    const mark = (s) => states.push({ tMs: Date.now() - rec.started, s });
    const net = [];
    const onReq = (r) => {
      if (/upload|media|blossom|profile|events|api\//iu.test(r.url()))
        net.push({ t: Date.now(), m: r.method(), u: r.url() });
    };
    page.on("request", onReq);
    let method = "filechooser";
    try {
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 6000 }),
        page.getByTestId("avatar-file-drop-zone").locator("strong").click(),
      ]);
      await chooser.setFiles(pngPath);
    } catch {
      method = "setInputFiles fallback (filechooser event not seen)";
      await page.getByTestId("avatar-file-input").setInputFiles(pngPath);
    }
    rec.notes.pickerMethod = method;
    await page.getByTestId("avatar-save").waitFor({ timeout: 8000 });
    mark("crop stage");
    rec.row(
      "QA2-crop",
      "Crop stage shown after choosing the PNG",
      "PASS",
      `Picked via ${method}. Buttons: ${(
        await inventory(page, '[data-testid="profile-avatar-dialog"]')
      )
        .map((i) => i.text)
        .filter(Boolean)
        .join(" | ")}`,
      { screenshot: await shot(page, rec, "qa2-crop") },
    );
    const saveAt = Date.now();
    await page.getByTestId("avatar-save").click();
    // Poll the visible states for up to 45 s.
    let outcome = "timeout";
    let lastText = "";
    let savingShot = false;
    while (Date.now() - saveAt < 45000) {
      const dialogOpen = await page
        .getByTestId("profile-avatar-dialog")
        .isVisible()
        .catch(() => false);
      const text = dialogOpen
        ? (
            await page
              .getByTestId("profile-avatar-dialog")
              .innerText()
              .catch(() => "")
          )
            .replace(/\s+/gu, " ")
            .slice(0, 200)
        : "(dialog closed)";
      if (text !== lastText) {
        mark(text);
        lastText = text;
      }
      if (!savingShot && /Saving your avatar/u.test(text)) {
        savingShot = true;
        await shot(page, rec, "qa2-saving");
      }
      if (!dialogOpen) {
        outcome = "dialog closed";
        break;
      }
      if (/wasn.t saved/u.test(text)) {
        outcome = "failed stage";
        break;
      }
      await sleep(150);
    }
    rec.notes.uploadStates = states;
    rec.notes.uploadMs = Date.now() - saveAt;
    rec.notes.uploadRequests = net.map((n) => ({
      dtMs: n.t - saveAt,
      method: n.m,
      url: redact(n.u).split("?")[0],
    }));
    page.off("request", onReq);
    const toasts = await page
      .locator("[data-sonner-toast]")
      .allInnerTexts()
      .catch(() => []);
    rec.notes.toasts = toasts;
    await sleep(1500);
    const png2 = await shot(page, rec, "qa2-after-save");
    rec.row(
      "QA2-save",
      "Save avatar outcome",
      outcome === "dialog closed" ? "PASS" : "FAIL",
      `Outcome: ${outcome} after ${Date.now() - saveAt} ms. States: ${states.map((s) => s.s).join(" => ")}. Toasts: ${toasts.join(" | ") || "none"}`,
      { screenshot: png2 },
    );
    if (outcome === "failed stage") {
      const dialogText = (
        await page
          .getByTestId("profile-avatar-dialog")
          .innerText()
          .catch(() => "")
      ).replace(/\s+/gu, " ");
      rec.row(
        "QA2-failure-text",
        "Failure text shown to the user",
        "FAIL",
        `Dialog text: ${dialogText.slice(0, 300)}`,
      );
      await page
        .getByTestId("avatar-cancel")
        .click()
        .catch(() => undefined);
    }
  });
  await sleep(1500);
  // Where the avatar renders now.
  await guard("QA2-render", "Avatar rendered after save", async () => {
    const saved = await page
      .getByTestId("profile-avatar-saved")
      .innerText()
      .catch(() => null);
    rec.row(
      "QA2-saved-banner",
      "Settings shows 'Profile photo updated' after save",
      saved ? "PASS" : "FAIL",
      saved ? `Banner text: ${saved.trim()}` : "No profile-avatar-saved banner",
      {},
    );
    const info = await page.evaluate(() => {
      const probe = (id) => {
        const img = document.querySelector(`[data-testid="${id}-image"]`);
        const fb = document.querySelector(`[data-testid="${id}-fallback"]`);
        return {
          id,
          image: Boolean(img),
          fallback: Boolean(fb),
          src: img?.currentSrc?.slice(0, 120),
          nat: img ? [img.naturalWidth, img.naturalHeight] : null,
        };
      };
      return [
        "account-profile-avatar",
        "settings-profile-avatar",
        "sidebar-profile-avatar",
      ].map(probe);
    });
    rec.notes.renderAfterSave = JSON.parse(redact(JSON.stringify(info)));
    for (const item of info) {
      rec.row(
        `QA2-render-${item.id}`,
        `${item.id} shows the uploaded image`,
        item.image && item.nat?.[0] > 0 ? "PASS" : "FAIL",
        JSON.stringify(item),
        {},
      );
    }
    await shot(page, rec, "qa2-settings-after");
    // Stored picture URL (from the app's own persisted self profile), then curl status only.
    const stored = await page.evaluate(() => {
      const found = [];
      for (const key of Object.keys(localStorage)) {
        if (!/profile|avatar|self/iu.test(key)) continue;
        const raw = localStorage.getItem(key) ?? "";
        const m = raw.match(
          /https?:\/\/[^"\s\\]*\/media\/[0-9a-f]{64}\.[a-z0-9]+/iu,
        );
        found.push({
          key,
          url: m?.[0] ?? null,
          hasData: /data:image/u.test(raw),
        });
      }
      return found;
    });
    rec.notes.storedProfileKeys = stored;
    const url = stored.find((x) => x.url)?.url;
    if (url) {
      const { execFile } = await import("node:child_process");
      const curl = await new Promise((resolve) =>
        execFile(
          "curl",
          [
            "-s",
            "-m",
            "15",
            "-o",
            "/dev/null",
            "-w",
            "%{http_code} %{content_type}",
            url,
          ],
          (e, out) => resolve(e ? `curl error ${e.code}` : out),
        ),
      );
      rec.notes.pictureUrl = redact(url);
      rec.notes.pictureCurl = curl;
      rec.row(
        "QA4-curl",
        "Anonymous curl of the stored picture URL: HTTP 200 and an image content type",
        /^200 image\//u.test(curl) ? "PASS" : "FAIL",
        `URL ${redact(url)} => ${curl}. (relay GET /media needs a signed Blossom header plus membership, api/media.rs:527-552)`,
        {},
      );
      // The app's own authed path: fetch what the renderer actually loaded, from the main process (no Origin).
      const src = info.find((i) => i.image)?.src;
      const full = await page.evaluate(
        () =>
          document.querySelector('[data-testid="sidebar-profile-avatar-image"]')
            ?.currentSrc ?? null,
      );
      if (full) {
        const res = await application.evaluate(async ({ net }, u) => {
          try {
            const r = await net.fetch(u);
            return {
              status: r.status,
              type: r.headers.get("content-type"),
              len: (await r.arrayBuffer()).byteLength,
            };
          } catch (e) {
            return { error: String(e.message).slice(0, 120) };
          }
        }, full);
        rec.notes.appPathFetch = res;
        rec.row(
          "QA4-app-path",
          "App's own authed media path serves the avatar (status, content type)",
          res.status === 200 && /^image\//u.test(res.type ?? "")
            ? "PASS"
            : "FAIL",
          JSON.stringify(res),
          {},
        );
      }
    } else {
      rec.row(
        "QA4-curl",
        "Stored picture URL available for curl",
        "NOT OBSERVED",
        `No relay media URL found in localStorage keys: ${JSON.stringify(stored)}`,
        {},
      );
    }
  });
  // Reset trap: Profile tab inside the avatar panel.
  await guard(
    "QA1-trap",
    "Clicking Profile tab hides the avatar control",
    async () => {
      const tab = page.getByTestId("settings-inner-profile");
      if (!(await tab.isVisible().catch(() => false))) {
        rec.row(
          "QA1-trap",
          "Profile tab inside avatar panel resets to panel without avatar control",
          "NOT OBSERVED",
          "settings-inner-profile tab not visible",
          {},
        );
        return;
      }
      const before = await page
        .getByTestId("profile-avatar-edit")
        .isVisible()
        .catch(() => false);
      await tab.click();
      await sleep(900);
      const after = await page
        .getByTestId("profile-avatar-edit")
        .isVisible()
        .catch(() => false);
      rec.row(
        "QA1-trap",
        "Profile tab inside avatar panel resets to panel without avatar control",
        before && !after ? "FAIL" : "PASS",
        `Edit avatar visible before tab click: ${before}, after: ${after}`,
        { screenshot: await shot(page, rec, "qa1-trap") },
      );
    },
  );
  // Leave settings, check sidebar avatar.
  await guard("QA2-sidebar", "Avatar in sidebar", async () => {
    await page.keyboard.press("Escape");
    await sleep(500);
    const closeBtn = page
      .getByTestId("settings-close")
      .or(page.getByRole("button", { name: /^(Close|Back)/iu }))
      .first();
    if (await closeBtn.isVisible().catch(() => false))
      await closeBtn.click().catch(() => undefined);
    await sleep(1200);
    const info = await page.evaluate(() => {
      const img = document.querySelector(
        '[data-testid="sidebar-profile-avatar-image"]',
      );
      const fb = document.querySelector(
        '[data-testid="sidebar-profile-avatar-fallback"]',
      );
      return {
        image: Boolean(img),
        fallback: Boolean(fb),
        img: img
          ? {
              src: img.currentSrc.slice(0, 110),
              nat: [img.naturalWidth, img.naturalHeight],
            }
          : null,
      };
    });
    rec.notes.sidebarAvatar = JSON.parse(redact(JSON.stringify(info)));
    rec.row(
      "QA2-sidebar-avatar",
      "Sidebar avatar shows the uploaded image",
      info.img && info.img.nat[0] > 0 ? "PASS" : "FAIL",
      JSON.stringify(info),
      { screenshot: await shot(page, rec, "qa2-sidebar-after") },
    );
  });
  state.A.avatarUploadAttempted = true;
  await saveState(state);
} finally {
  rec.notes.endedAt = new Date().toISOString();
  await rec.write();
  await closeApp(application);
  await progress(
    `[A1] done, ${rec.rows.length} rows, profile A dir kept for relaunch`,
  );
}
