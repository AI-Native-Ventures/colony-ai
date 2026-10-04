import {
  brandingFindings,
  businessMentionVerdict,
  fileReferenceVerdict,
  personalConfigFindings,
  SETUP_NOTICE,
  teammateVerdict,
} from "./safety.mjs";

const INTRO_BUDGET_MS = 20000;

const LABELS = {
  1: "No 'connect your AI in Settings' notice after a verified connection",
  2: "Scout intro appears in Welcome within 20 s of it opening",
  3: "No visible Buzz, Fizz, Honey, Pollen or bee emoji on any visited screen",
  4: "Team shows an avatar and a real status for Scout",
  5: "The @ list shows only teammates",
  6: "Scout's business answer mentions the business name or website typed in onboarding",
  7: "First reply is not polluted with unrelated personal config",
};

/** Always produce all seven verdict rows, even when a prerequisite was not reached. */
export async function driveWorkspace({ page, evidence, replyTimeoutMs }) {
  const state = { noticeSeen: false, page };
  try {
    await drive({ page, evidence, replyTimeoutMs }, state);
  } finally {
    await finalize({ page, evidence }, state);
  }
}

async function finalize({ page, evidence }, state) {
  try {
    const body = page.isClosed() ? "" : await page.locator("body").innerText();
    if (SETUP_NOTICE.test(body)) state.noticeSeen = true;
  } catch {
    // The screen is already recorded in screenshots.
  }
  const verified = evidence.metadata.connectionVerified === true;
  evidence.verdict(
    1,
    LABELS[1],
    !verified ? "BLOCKED" : state.noticeSeen ? "FAIL" : "PASS",
    verified
      ? `Connection test returned a real reply. Notice text seen in Welcome or app body: ${state.noticeSeen}.`
      : `Connection was not verified, so the assertion is not meaningful. Notice text seen: ${state.noticeSeen}.`,
  );
  const textual = Object.entries(evidence.observed).flatMap(([key, value]) =>
    typeof value === "string"
      ? brandingFindings(value).map((finding) => `${key}: ${finding}`)
      : [],
  );
  const screens = evidence.scans.filter((scan) => scan.findings.length);
  evidence.verdict(
    3,
    LABELS[3],
    evidence.scans.length === 0
      ? "BLOCKED"
      : screens.length || textual.length
        ? "FAIL"
        : "PASS",
    `Scanned the visible body text and window title of ${evidence.scans.length} captured screens. Screens with findings: ${screens.map((scan) => `${scan.step} (${scan.findings.join(", ")})`).join("; ") || "none"}. Captured Scout texts with findings: ${textual.join("; ") || "none"}. Screens not reached were not scanned.`,
  );
  for (const [id, label] of Object.entries(LABELS)) {
    if (!evidence.verdicts.some((item) => String(item.id) === id))
      evidence.verdict(
        Number(id),
        label,
        "BLOCKED",
        "Prerequisite step was not reached.",
      );
  }
  evidence.verdicts.sort((a, b) => a.id - b.id);
  await evidence.write();
}

async function drive({ page, evidence, replyTimeoutMs }, state) {
  const enteredAt = evidence.metadata.appOpenedAt ?? Date.now();
  evidence.metadata.anchors ??= {};
  const anchors = evidence.metadata.anchors;
  anchors.appOpenedAt = enteredAt;
  let welcomeOpenedAt = enteredAt;
  if (
    !(await evidence.step("Welcome channel", page, async () => {
      const welcome = page.locator('[data-testid="channel-welcome" i]').first();
      await welcome.waitFor({ timeout: 30000 });
      // When the app already landed in Welcome the clock starts at app entry.
      const alreadyOpen =
        (await welcome.getAttribute("data-active")) === "true";
      if (!alreadyOpen) {
        welcomeOpenedAt = Date.now();
        await welcome.click();
      }
      await page.getByTestId("message-timeline").waitFor();
      evidence.metadata.welcomeAlreadyOpenOnEntry = alreadyOpen;
      return {
        reason: `Opened the new smoke company's Welcome channel (already open on entry: ${alreadyOpen}).`,
      };
    }))
  )
    return;
  const welcomeUrl = page.url();
  const timelineText = async () =>
    page
      .getByTestId("message-timeline")
      .innerText()
      .catch(() => "");
  const scoutRowsData = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="message-row"]')]
        .filter(
          (row) =>
            row
              .querySelector('[data-testid="message-author"]')
              ?.textContent?.trim() === "Scout",
        )
        .map((row) => ({
          id: row.dataset.messageId,
          text:
            row.querySelector('[data-testid="message-body"]')?.innerText ??
            row.innerText,
        })),
    );
  const scoutRows = () =>
    page.getByTestId("message-row").filter({
      has: page.getByTestId("message-author").filter({ hasText: /^Scout$/u }),
    });

  await evidence.step("Scout intro", page, async () => {
    const seen = new Map();
    const deadline = Date.now() + replyTimeoutMs;
    let intro = null;
    while (Date.now() < deadline && !intro) {
      for (const row of await scoutRowsData()) {
        if (!seen.has(row.id))
          seen.set(row.id, { text: row.text, at: Date.now() });
      }
      for (const entry of seen.values()) {
        if (SETUP_NOTICE.test(entry.text)) state.noticeSeen = true;
      }
      intro = [...seen.values()].find(
        (entry) => entry.text.trim() && !SETUP_NOTICE.test(entry.text),
      );
      if (!intro) await page.waitForTimeout(200);
    }
    evidence.observed["Welcome timeline text (after intro wait)"] =
      await timelineText();
    if (SETUP_NOTICE.test(await timelineText())) state.noticeSeen = true;
    if (!intro)
      return {
        status: "FAIL",
        reason: `No Scout-authored introduction within ${replyTimeoutMs} ms of app entry (setup notice seen: ${state.noticeSeen}).`,
      };
    anchors.welcomeOpenedAt = welcomeOpenedAt;
    anchors.introAt = intro.at;
    const sinceWelcome = intro.at - welcomeOpenedAt;
    const sinceEntry = intro.at - enteredAt;
    evidence.metadata.scoutIntroMs = sinceWelcome;
    evidence.metadata.scoutIntroSinceAppEntryMs = sinceEntry;
    evidence.observed["Scout intro (verbatim)"] = intro.text;
    const leaks = personalConfigFindings(intro.text);
    evidence.verdict(
      2,
      "Scout intro appears in Welcome within 20 s of it opening",
      sinceWelcome <= INTRO_BUDGET_MS ? "PASS" : "FAIL",
      `Intro seen ${sinceWelcome} ms after Welcome opened and ${sinceEntry} ms after Open my Colony (poll granularity about 0.25 s).`,
    );
    evidence.metadata.introPersonalConfigFindings = leaks;
    return {
      status: sinceWelcome <= INTRO_BUDGET_MS ? "PASS" : "FAIL",
      reason: `Scout-authored introduction observed ${sinceWelcome} ms after Welcome opened, ${sinceEntry} ms after app entry.`,
    };
  });
  if (!evidence.verdicts.some((item) => item.id === 2))
    evidence.verdict(
      2,
      "Scout intro appears in Welcome within 20 s of it opening",
      "FAIL",
      "No Scout-authored introduction was observed.",
    );

  let teammates = [];
  let scout;
  let scoutPubkey = "";
  const dumpTestIds = async (label) => {
    try {
      evidence.observed[label] = await page.evaluate(() =>
        [
          ...new Set(
            [...document.querySelectorAll("[data-testid]")].map((node) =>
              node
                .getAttribute("data-testid")
                .replace(/[0-9a-f]{64}/gu, "<id>"),
            ),
          ),
        ].join("\n"),
      );
    } catch {
      // Page unavailable.
    }
  };
  await evidence.step("Team", page, async () => {
    await page.getByTestId("sidebar-company-team").click();
    // Rows are matched at page level: the list wrapper test id is not required.
    const rows = page.locator('[data-testid^="company-team-member-"]');
    try {
      await rows.first().waitFor({ timeout: 25000 });
    } catch (error) {
      await dumpTestIds("DOM test ids when the Team roster was not found");
      throw error;
    }
    teammates = await rows.evaluateAll((items) =>
      items.map((row) => ({
        pubkey: row.dataset.testid.replace("company-team-member-", ""),
        label: row.getAttribute("aria-label") ?? "",
        text: row.innerText,
      })),
    );
    evidence.observed["Team roster rows (verbatim)"] = teammates
      .map(
        (member) => `${member.label} | ${member.text.replace(/\n+/gu, " / ")}`,
      )
      .join("\n");
    // The Scout row can arrive after the owner row, so poll the roster by text.
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline && !scoutPubkey) {
      const roster = await rows.evaluateAll((items) =>
        items.map((row) => ({
          pubkey: row.dataset.testid.replace("company-team-member-", ""),
          text: row.innerText,
        })),
      );
      scoutPubkey =
        roster.find((member) => /(^|\n)Scout(\n|$)/u.test(member.text))
          ?.pubkey ?? "";
      if (!scoutPubkey) await page.waitForTimeout(500);
    }
    if (!scoutPubkey) throw new Error("Scout row not found");
    scout = page.getByTestId(`company-team-member-${scoutPubkey}`);
    const avatar = await page
      .getByTestId(`team-avatar-${scoutPubkey}`)
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const image = node.querySelector("img") ?? node;
          const loaded =
            image.tagName === "IMG" && image.complete && image.naturalWidth > 0;
          return {
            loadedImage: loaded,
            hasSvg: Boolean(node.querySelector("svg")),
            text: node.textContent?.trim().slice(0, 8) ?? "",
            width: node.getBoundingClientRect().width,
          };
        }),
      );
    const statusText = (await scout.innerText())
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .pop();
    const hasAvatar =
      avatar.length > 0 &&
      avatar[0].width > 0 &&
      (avatar[0].loadedImage || avatar[0].hasSvg || avatar[0].text.length > 0);
    const hasStatus =
      Boolean(statusText) && !/^(loading|unknown|n\/a|-|—)$/iu.test(statusText);
    evidence.metadata.scoutAvatar = avatar[0] ?? "no team-avatar element";
    evidence.metadata.scoutStatusText = statusText;
    evidence.metadata.scoutStatusTimeline ??= [];
    evidence.metadata.scoutStatusTimeline.push({
      at: Date.now(),
      status: statusText,
      where: "Team step, after the Scout intro",
    });
    evidence.verdict(
      4,
      "Team shows an avatar and a real status for Scout",
      hasAvatar && hasStatus ? "PASS" : "FAIL",
      `Avatar element: ${JSON.stringify(avatar[0] ?? null)}. Status badge text: "${statusText}".`,
    );
    return {
      status: hasAvatar && hasStatus ? "PASS" : "FAIL",
      reason: `Scout avatar present: ${hasAvatar}. Status badge: "${statusText}" (real, not Loading/unknown: ${hasStatus}).`,
    };
  });
  if (!evidence.verdicts.some((item) => item.id === 4))
    evidence.verdict(
      4,
      "Team shows an avatar and a real status for Scout",
      "BLOCKED",
      "Team roster or Scout row not reached.",
    );

  await evidence.step("Scout pages", page, async () => {
    if (!scout)
      return {
        status: "BLOCKED",
        reason: "No real Scout roster row was available.",
      };
    await scout.click();
    // Instructions, Model & runtime and Salary were requested explicitly.
    const tabs = [
      "overview",
      "instructions",
      "model-runtime",
      "salary",
      "tools-access",
      "workers",
      "duties",
      "lessons",
      "history",
    ];
    const pages = [];
    for (const tab of tabs) {
      const started = Date.now();
      const button = page.getByTestId(`employee-tab-${tab}`);
      await button.waitFor({ timeout: 15000 });
      await button.click();
      await page.getByTestId("employee-profile-tabpanel").waitFor();
      const row = {
        name: `Scout ${tab}`,
        status: "PASS",
        reason: "Real employee tab opened.",
        durationMs: Date.now() - started,
        sinceStartMs: Date.now() - evidence.started,
      };
      evidence.rows.push(row);
      await evidence.capture(row.name, page, row);
      await evidence.write();
      pages.push(tab);
    }
    return {
      reason: `Opened Scout pages: ${pages.join(", ")}. Editing and persistence not exercised.`,
    };
  });
  await page.goto(welcomeUrl, { waitUntil: "domcontentloaded" });
  const composer = page
    .getByTestId("message-composer")
    .locator('[contenteditable="true"]')
    .first();
  let scoutSuggestion;
  if (
    !(await evidence.step("Teammate mentions", page, async () => {
      await composer.waitFor();
      await composer.fill("@");
      const menu = page.getByTestId("mention-autocomplete");
      await menu.waitFor({ timeout: 15000 });
      const entries = await menu
        .locator("[data-mention-suggestion-index]")
        .evaluateAll((rows) =>
          rows.map((row) => ({
            key: row.dataset.testid.replace("mention-suggestion-", ""),
            text: row.innerText.replace(/\n+/gu, " / "),
            label:
              row.querySelector("button")?.getAttribute("aria-label") ?? "",
          })),
        );
      evidence.observed["@ menu entries (verbatim)"] = entries
        .map((entry) => `${entry.label} | ${entry.text} | ${entry.key}`)
        .join("\n");
      const rosterNames = teammates.map((member) =>
        member.text.split("\n")[0].trim(),
      );
      const byKey = new Set(teammates.map((member) => member.pubkey));
      const outsiders = entries.filter(
        (entry) =>
          !byKey.has(entry.key) &&
          !rosterNames.some(
            (name) =>
              name &&
              entry.label.toLowerCase() === `mention ${name}`.toLowerCase(),
          ),
      );
      const verdict = teammateVerdict(
        entries.map((entry) => entry.label.replace(/^Mention /u, "")),
        rosterNames,
        "",
      );
      scoutSuggestion = menu.getByRole("button", {
        name: "Mention Scout",
        exact: true,
      });
      const status = entries.length
        ? outsiders.length
          ? "FAIL"
          : "PASS"
        : "BLOCKED";
      evidence.verdict(
        5,
        "The @ list shows only teammates",
        status,
        `${entries.length} entries, ${outsiders.length} not matched to a Team roster row (${outsiders.map((entry) => entry.label).join(", ") || "none"}). Name-only verdict: ${verdict.status}.`,
      );
      return {
        status,
        reason: `Suggestion identities compared with the rendered roster: ${entries.length} entries, ${outsiders.length} outside roster.`,
      };
    }))
  ) {
    if (!evidence.verdicts.some((item) => item.id === 5))
      evidence.verdict(
        5,
        "The @ list shows only teammates",
        "BLOCKED",
        "The @ menu did not open.",
      );
    return;
  }
  const before = await scoutRows().evaluateAll((rows) =>
    rows.map((row) => row.dataset.messageId),
  );
  const QUESTION = "what do you know about our business?";
  const PANEL =
    '[data-testid="message-thread-panel"], [data-testid="focus-thread-drawer"]';
  const readThread = async () =>
    page.evaluate((panelSelector) => {
      const panel =
        document.querySelector(panelSelector) ??
        document.querySelector('[data-testid="message-thread-body"]');
      if (!panel) return null;
      return {
        panelText: panel.innerText,
        bodies: [...panel.querySelectorAll('[data-testid="message-row"]')].map(
          (item) => ({
            author:
              item
                .querySelector('[data-testid="message-author"]')
                ?.textContent?.trim() ?? "",
            text:
              item.querySelector('[data-testid="message-body"]')?.innerText ??
              "",
          }),
        ),
      };
    }, PANEL);
  const openThread = async (row) => {
    if (!(await readThread()))
      await row.getByTestId("message-thread-summary").first().click();
    let thread = null;
    for (let attempt = 0; attempt < 30 && !thread; attempt++) {
      await page.waitForTimeout(500);
      thread = await readThread();
    }
    if (!thread) throw new Error("Thread panel did not open");
    return thread;
  };
  const mainRow = (id) =>
    page
      .getByTestId("message-timeline")
      .locator(`[data-testid="message-row"][data-message-id="${id}"]`)
      .first();
  const scoutStatusNow = async () => {
    await page.getByTestId("sidebar-company-team").click();
    const row = page.getByTestId(`company-team-member-${scoutPubkey}`);
    await row.waitFor({ timeout: 8000 });
    const status = (await row.innerText())
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .pop();
    await page.locator('[data-testid="channel-welcome" i]').click();
    await page.getByTestId("message-timeline").waitFor({ timeout: 8000 });
    return status;
  };
  let replyText = "";
  let replyWhere = "";
  if (
    !(await evidence.step("Business reply", page, async () => {
      const start = Date.now();
      await scoutSuggestion.click();
      await composer.press("End");
      await composer.pressSequentially(` ${QUESTION}`);
      const sendAt = Date.now();
      anchors.sendAt = sendAt;
      await composer.press("Enter");
      const sent = page
        .getByTestId("message-row")
        .filter({ hasText: QUESTION })
        .last();
      await sent.waitFor({ timeout: 15000 });
      anchors.questionVisibleAt = Date.now();
      const sentId = await sent.getAttribute("data-message-id");
      const question = mainRow(sentId);
      const shots = [4000, 20000, 60000, 120000, 240000];
      let nextShot = 0;
      let nextSample = Date.now() + 6000;
      let typingFirst = null;
      const deadline = sendAt + replyTimeoutMs;
      let found = null;
      while (Date.now() < deadline && !found) {
        const elapsed = Date.now() - sendAt;
        if (nextShot < shots.length && elapsed >= shots[nextShot]) {
          const seconds = shots[nextShot++] / 1000;
          const tail = (await timelineText())
            .split("\n")
            .filter(Boolean)
            .slice(-6);
          const row = {
            name: `Waiting for Scout, ${seconds} s after send`,
            status: "PASS",
            reason: `Observed state ${seconds} s after the question was sent. Last visible timeline lines: ${tail.join(" / ")}. Typing indicator seen so far: ${typingFirst === null ? "never" : `first at ${typingFirst} ms`}.`,
            sinceStartMs: Date.now() - evidence.started,
          };
          evidence.rows.push(row);
          await evidence.capture(row.name, page, row);
          await evidence.write();
        }
        if (
          typingFirst === null &&
          (await page.getByTestId("message-typing-indicator").count()) > 0
        ) {
          typingFirst = Date.now() - sendAt;
          anchors.typingIndicatorAt = Date.now();
        }
        // Top-level Scout reply, or a reply in the thread under the question.
        const topLevel = (await scoutRowsData()).find(
          (row) => !before.includes(row.id) && row.text.trim(),
        );
        if (topLevel) {
          anchors.replyVisibleAt = Date.now();
          found = { where: "top-level channel message", text: topLevel.text };
        } else if (
          (await question.getByTestId("message-thread-summary").count()) > 0
        ) {
          anchors.threadSummaryAt ??= Date.now();
          const thread = await openThread(question);
          const scoutReply = thread.bodies
            .filter((item) => item.author === "Scout" && item.text.trim())
            .pop();
          if (scoutReply) {
            anchors.replyVisibleAt = anchors.threadSummaryAt;
            anchors.replyReadAt = Date.now();
            found = {
              where: "reply in the thread under the question",
              text: scoutReply.text,
              panel: thread.panelText,
            };
          }
        }
        if (!found && Date.now() >= nextSample) {
          try {
            const status = await scoutStatusNow();
            evidence.metadata.scoutStatusTimeline ??= [];
            const timeline = evidence.metadata.scoutStatusTimeline;
            timeline.push({
              at: Date.now(),
              status,
              where: `Team page, ${Math.round((Date.now() - sendAt) / 1000)} s after send`,
            });
          } catch {
            // A missed sample is recorded by its absence.
          }
          nextSample = Date.now() + 8000;
        }
        if (!found) await page.waitForTimeout(400);
      }
      evidence.metadata.businessReplyMs = Date.now() - start;
      evidence.metadata.replyLatencyMs = found
        ? (anchors.replyVisibleAt ?? Date.now()) - sendAt
        : null;
      evidence.metadata.typingIndicatorFirstMs = typingFirst;
      if (!found)
        return {
          status: "FAIL",
          reason: `No Scout reply, top-level or in a thread, within ${replyTimeoutMs} ms of sending.`,
        };
      replyText = found.text.trim();
      replyWhere = found.where;
      evidence.metadata.businessReplyWhere = found.where;
      evidence.observed["Scout business reply (verbatim)"] = replyText;
      if (found.panel) evidence.observed["Thread panel text"] = found.panel;
      const mention = businessMentionVerdict(
        replyText,
        evidence.metadata.smokeBusinessName,
        evidence.metadata.website,
      );
      evidence.verdict(
        6,
        LABELS[6],
        mention.status,
        `Looked for "${evidence.metadata.smokeBusinessName}" and the website host of ${evidence.metadata.website}. Hits: ${mention.hits.join(", ") || "none"}. Reply of ${replyText.length} characters, visible ${evidence.metadata.replyLatencyMs} ms after send, as a ${replyWhere}.`,
      );
      const leaks = [
        ...new Set([
          ...personalConfigFindings(replyText),
          ...(evidence.metadata.introPersonalConfigFindings ?? []),
        ]),
      ];
      evidence.verdict(
        7,
        LABELS[7],
        leaks.length ? "FAIL" : "PASS",
        `Keyword scan of the intro and the business reply for the owner's personal configuration terms: ${leaks.join(", ") || "none found"}. Keyword scan only, read the verbatim text for a human judgement.`,
      );
      return {
        reason: `Scout reply visible ${evidence.metadata.replyLatencyMs} ms after send, as a ${replyWhere}.`,
      };
    }))
  ) {
    // Verdicts 6 and 7 are filled as BLOCKED by finalize.
  }
  // What the first thread under the introduction contains, verbatim.
  try {
    const introRow = scoutRows().first();
    if ((await introRow.getByTestId("message-thread-summary").count()) > 0) {
      const thread = await openThread(introRow);
      evidence.observed["Thread under the Scout intro (verbatim)"] =
        thread.bodies
          .map((item) => `${item.author}: ${item.text}`)
          .join("\n---\n");
    }
  } catch {
    // The thread under the introduction is optional evidence.
  }
  evidence.observed["Welcome timeline text (final)"] = await timelineText();
  // Scout's status can still be settling on first sight, so look again after a reply.
  if (replyText) {
    const recheck = {
      name: "Team status after reply",
      status: "BLOCKED",
      reason: "Team page not reopened.",
      sinceStartMs: Date.now() - evidence.started,
    };
    evidence.rows.push(recheck);
    try {
      const started = Date.now();
      await page.getByTestId("sidebar-company-team").click();
      const row = page.locator('[data-testid^="company-team-member-"]').filter({
        hasText: /\bScout\b/u,
      });
      await row.first().waitFor({ timeout: 15000 });
      const text = (await row.first().innerText()).replace(/\n+/gu, " / ");
      evidence.observed["Scout Team row after the business reply"] = text;
      evidence.metadata.scoutStatusTimeline ??= [];
      evidence.metadata.scoutStatusTimeline.push({
        at: Date.now(),
        status: text.split(" / ").filter(Boolean).pop(),
        where: "Team page, after the reply",
      });
      Object.assign(recheck, {
        status: "PASS",
        reason: `Scout Team row after a real reply: ${text}`,
        durationMs: Date.now() - started,
      });
    } catch {
      recheck.status = "FAIL";
      recheck.reason = "Scout Team row not found on the second look.";
    }
    await evidence.capture(recheck.name, page, recheck);
    await evidence.write();
    // Idle sampling: stay on the Team page and re-read Scout's status for 75 s. A healthy
    // idle agent showing "Needs attention" is a finding in itself.
    if (recheck.status === "PASS") {
      const idleStart = Date.now();
      for (let sample = 1; sample <= 5; sample++) {
        await page.waitForTimeout(15000);
        try {
          const idle = page
            .locator('[data-testid^="company-team-member-"]')
            .filter({ hasText: /\bScout\b/u })
            .first();
          const idleText = (await idle.innerText()).replace(/\n+/gu, " / ");
          evidence.metadata.scoutStatusTimeline.push({
            at: Date.now(),
            status: idleText.split(" / ").filter(Boolean).pop(),
            where: `Team page idle, ${Math.round((Date.now() - idleStart) / 1000)} s after the reply was read`,
          });
        } catch {
          // A missed sample is recorded by its absence.
        }
      }
      const idleRow = {
        name: "Team status idle 75 s",
        status: "PASS",
        reason: `Scout status sampled every 15 s while idle: ${evidence.metadata.scoutStatusTimeline
          .filter((item) => item.where.startsWith("Team page idle"))
          .map((item) => item.status)
          .join(" | ")}`,
        sinceStartMs: Date.now() - evidence.started,
      };
      evidence.rows.push(idleRow);
      await evidence.capture(idleRow.name, page, idleRow);
      await evidence.write();
    }
  }
  // The thread panel is still open from reading the reply, so its links are inspected.
  await evidence.step("Reply file references", page, async () => {
    if (!replyText)
      return { status: "BLOCKED", reason: "No reply text to inspect." };
    const paths =
      replyText.match(
        /(?:\/[A-Za-z0-9_.-]+){2,}|[A-Za-z0-9_.-]+\.(?:md|txt|json|csv|pdf)\b/gu,
      ) ?? [];
    if (!paths.length)
      return {
        status: "BLOCKED",
        reason:
          "Actual reply has no file reference. This gate was not exercised.",
      };
    const links = await page
      .locator(
        '[data-testid="message-body"] a, [data-testid="message-body"] button',
      )
      .evaluateAll(
        (elements, references) =>
          elements
            .filter((element) =>
              references.some((reference) =>
                element.textContent?.includes(reference),
              ),
            )
            .map((element) => ({
              tag: element.tagName.toLowerCase(),
              href: element.getAttribute("href"),
            })),
        paths,
      );
    return fileReferenceVerdict(paths, links);
  });
}
