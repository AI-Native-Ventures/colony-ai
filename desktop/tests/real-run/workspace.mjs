import { fileReferenceVerdict, teammateVerdict } from "./safety.mjs";

export async function driveWorkspace({ page, evidence, replyTimeoutMs }) {
  const enteredAt = evidence.metadata.appOpenedAt ?? Date.now();
  if (
    !(await evidence.step("Welcome channel", page, async () => {
      const welcome = page.locator('[data-testid="channel-welcome" i]').first();
      await welcome.waitFor({ timeout: 30000 });
      await welcome.click();
      await page.getByTestId("message-timeline").waitFor();
      return { reason: "Opened the new smoke company's Welcome channel." };
    }))
  )
    return;
  const welcomeUrl = page.url();
  const scoutRows = () =>
    page.getByTestId("message-row").filter({
      has: page.getByTestId("message-author").filter({ hasText: /^Scout$/u }),
    });
  await evidence.step("Scout intro", page, async () => {
    const intro = scoutRows()
      .filter({ hasText: /welcome|chief of staff|I.?m Scout/iu })
      .first();
    await intro.waitFor({
      timeout: Math.max(1000, replyTimeoutMs - (Date.now() - enteredAt)),
    });
    const introMs = Date.now() - enteredAt;
    evidence.metadata.scoutIntroMs = introMs;
    return {
      status: introMs <= replyTimeoutMs ? "PASS" : "FAIL",
      reason: `Scout-authored introduction observed ${introMs} ms after app entry.`,
    };
  });
  let teammateIds = [];
  let scout;
  await evidence.step("Team", page, async () => {
    await page.getByTestId("sidebar-company-team").click();
    const list = page.getByTestId("company-team-list");
    await list.waitFor({ timeout: 25000 });
    teammateIds = await list
      .locator('[data-testid^="company-team-member-"]')
      .evaluateAll((rows) =>
        rows.map((row) =>
          row.dataset.testid.replace("company-team-member-", ""),
        ),
      );
    scout = list
      .locator('[data-testid^="company-team-member-"]')
      .filter({ hasText: /\bScout\b/u })
      .first();
    await scout.waitFor({ timeout: 25000 });
    const hasAvatar = await scout
      .locator("img")
      .evaluateAll((images) =>
        images.some((image) => image.complete && image.naturalWidth > 0),
      );
    const label = await scout.getAttribute("aria-label");
    const hasStatus =
      /, (active|running|idle|paused|offline|error)(?:,|$)/iu.test(label ?? "");
    return {
      status: hasAvatar && hasStatus ? "PASS" : "FAIL",
      reason: `Scout avatar loaded: ${hasAvatar}. Explicit non-unknown roster status: ${hasStatus}.`,
    };
  });
  await evidence.step("Scout pages", page, async () => {
    if (!scout)
      return {
        status: "BLOCKED",
        reason: "No real Scout roster row was available.",
      };
    await scout.click();
    const tabs = [
      "overview",
      "instructions",
      "model-runtime",
      "tools-access",
      "salary",
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
      const suggestions = await menu
        .locator('[data-testid^="mention-suggestion-"]')
        .evaluateAll((rows) =>
          rows.map((row) =>
            row.dataset.testid.replace("mention-suggestion-", ""),
          ),
        );
      const verdict = teammateVerdict(suggestions, teammateIds, "");
      scoutSuggestion = menu.getByRole("button", {
        name: "Mention Scout",
        exact: true,
      });
      return {
        status: verdict.status,
        reason: `Suggestion identities compared with the rendered roster: ${suggestions.length} entries, ${verdict.outsiders?.length ?? 0} outside roster. Unbound persona/team suggestions are not counted as teammates.`,
      };
    }))
  )
    return;
  const before = await scoutRows().evaluateAll((rows) =>
    rows.map((row) => row.dataset.messageId),
  );
  let reply;
  if (
    !(await evidence.step("Business reply", page, async () => {
      const start = Date.now();
      await scoutSuggestion.click();
      await composer.press("End");
      await composer.pressSequentially(" what do you know about our business?");
      await composer.press("Enter");
      await page.waitForFunction(
        (old) =>
          [...document.querySelectorAll('[data-testid="message-row"]')].some(
            (row) =>
              !old.includes(row.dataset.messageId) &&
              row
                .querySelector('[data-testid="message-author"]')
                ?.textContent?.trim() === "Scout",
          ),
        before,
        { timeout: replyTimeoutMs },
      );
      reply = scoutRows()
        .filter({ has: page.getByTestId("message-body") })
        .last();
      const body = (await reply.getByTestId("message-body").innerText()).trim();
      if (!body)
        return { status: "FAIL", reason: "New Scout row has no reply body." };
      evidence.metadata.businessReplyMs = Date.now() - start;
      return {
        reason: `New Scout-authored reply received in ${evidence.metadata.businessReplyMs} ms. Semantic accuracy of business knowledge requires reading the captured response.`,
      };
    }))
  )
    return;
  await evidence.step("Reply file references", page, async () => {
    const body = reply.getByTestId("message-body");
    const text = await body.innerText();
    const paths =
      text.match(
        /(?:\/[A-Za-z0-9_.-]+){2,}|[A-Za-z0-9_.-]+\.(?:md|txt|json|csv|pdf)\b/gu,
      ) ?? [];
    if (!paths.length)
      return {
        status: "BLOCKED",
        reason:
          "Actual reply has no file reference. This gate was not exercised.",
      };
    const links = await body.locator("a,button").evaluateAll(
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
