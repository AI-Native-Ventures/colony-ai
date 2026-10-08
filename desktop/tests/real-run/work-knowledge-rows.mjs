// Work, Knowledge, channel notes and pinned messages: the packaged-app gate rows (Colony 1.0.6).
//
// The mock-bridge specs (work-area-work, work-area-knowledge, work-area-pins) prove the screens
// against a fake relay. These rows prove the same promise on the real thing: a packaged build,
// the real renderer and native host, the live relay, a fresh smoke account. One story, in order:
//
//   open Work and Knowledge, create a note, pin a message, see both in Knowledge, see the pin on
//   the Pins screen, reload the app, see both still there, unpin, reload, see the pin stay gone.
//
// This file is pure orchestration and judging. Everything that touches the page lives behind the
// `ctx` object (work-knowledge-page.mjs implements it for Playwright), so the sequencing, the
// prerequisite blocking and the verdicts are unit tested with a scripted ctx and no app.
//
// A row is PASS only for something the driver observed in the running app. A row whose
// prerequisite did not PASS is BLOCKED, never PASS and never silently skipped.

/** Row ids in run order. `needs` are rows that must PASS first. */
export const WK_ROWS = [
  {
    id: "WK0",
    label:
      "A signed-in app sits in a stream channel with its header tabs and composer",
    needs: [],
  },
  {
    id: "WK1",
    label:
      "Work opens from the channel header and shows rows or an honest empty state",
    needs: ["WK0"],
  },
  {
    id: "WK2",
    label:
      "Knowledge opens with its Channel notes and Pinned sections, no raw error text",
    needs: ["WK0"],
  },
  {
    id: "WK3",
    label:
      "A channel note is created (canvas saved) and shown back from the relay",
    needs: ["WK0"],
  },
  {
    id: "WK4",
    label: "The new note is listed in the Knowledge tab's Channel notes",
    needs: ["WK2", "WK3"],
  },
  {
    id: "WK5",
    label:
      "A message is sent and pinned to the channel, and its menu then offers Unpin",
    needs: ["WK0"],
  },
  {
    id: "WK6",
    label:
      "The pinned message is listed in Knowledge with its text and who pinned it",
    needs: ["WK2", "WK5"],
  },
  {
    id: "WK7",
    label: "The Pins screen (header Pins button) lists the same pin",
    needs: ["WK5"],
  },
  {
    id: "WK8",
    label: "After an app reload the signed-in channel is back",
    needs: ["WK0"],
  },
  {
    id: "WK9",
    label: "After the reload the note is still in Knowledge",
    needs: ["WK4", "WK8"],
  },
  {
    id: "WK10",
    label: "After the reload the pin is still in Knowledge",
    needs: ["WK6", "WK8"],
  },
  {
    id: "WK11",
    label: "After the reload Work still opens to an honest state",
    needs: ["WK1", "WK8"],
  },
  {
    id: "WK12",
    label: "Unpin from the Knowledge list removes the pin",
    needs: ["WK10"],
  },
  {
    id: "WK13",
    label: "After a second reload the pin stays gone and the note stays",
    needs: ["WK9", "WK12"],
  },
];

/** Text that should never reach a person: transport and stack-trace words from the relay or the app. */
const RAW_TEXT = [
  /\b(?:HTTP\s?[45]\d\d|status\s?[45]\d\d|relay returned|query failed|internal server error|TypeError|ReferenceError|undefined)\b/iu,
  /\[object\b/u,
  /\bNaN\b/u,
  /\bat\s+\S+\s+\(.*:\d+:\d+\)/u,
];

/** Findings are short labels of what matched; empty means clean. */
export function rawTextFindings(text) {
  const body = String(text ?? "");
  for (const pattern of RAW_TEXT) {
    const found = pattern.exec(body);
    if (found) return [found[0].slice(0, 60)];
  }
  return [];
}

/** A short unique tag so a re-run on the same account never mistakes an old note or pin for its own. */
export function runTag(hex) {
  if (!/^[0-9a-f]{4,12}$/u.test(String(hex)))
    throw new Error("runTag needs 4 to 12 hex characters");
  return `wk-${hex}`;
}

/** Canvas Markdown for the smoke note: a heading line, then one more line. */
export function noteMarkdown(tag) {
  return `# Gate note ${tag}\n\nStanding note written by the real-run gate ${tag}.`;
}

/** What the Knowledge tab shows for that canvas: first non-empty line, heading marks stripped. */
export function notePreview(tag) {
  return `Gate note ${tag}`;
}

/** The message pinned by the gate. No mention, so no employee is asked to answer it. */
export function pinMessageText(tag) {
  return `Gate pin check ${tag}`;
}

const WORK_EMPTY = /No work in this channel yet|No work is listed here/u;
const WORK_FAILED = /Work could not be loaded/u;
const NOT_A_MEMBER = /You are not in this channel/u;

/**
 * Verdict for the Work tab body. Rows or the plain empty state are both honest. A failed read, a
 * channel-gate notice for a channel the smoke owner just created, raw error text, or an unselected
 * tab are not.
 */
export function judgeWorkBody({ selected, text, hasRows }) {
  const body = String(text ?? "");
  if (!selected)
    return {
      status: "FAIL",
      detail: "The Work tab did not become the selected tab.",
    };
  const raw = rawTextFindings(body);
  if (raw.length)
    return {
      status: "FAIL",
      detail: `Raw error text in the Work tab: ${raw[0]}`,
    };
  if (NOT_A_MEMBER.test(body))
    return {
      status: "FAIL",
      detail:
        "The Work tab says the person is not in their own welcome channel.",
    };
  if (WORK_FAILED.test(body))
    return {
      status: "FAIL",
      detail: "The Work tab says it could not be loaded.",
    };
  if (hasRows)
    return { status: "PASS", detail: "Work shows this channel's rows." };
  if (WORK_EMPTY.test(body))
    return {
      status: "PASS",
      detail: `Work shows an honest empty state: ${body.replace(/\s+/gu, " ").trim().slice(0, 120)}`,
    };
  return {
    status: "FAIL",
    detail: `The Work tab is neither rows nor a known state: ${body.replace(/\s+/gu, " ").trim().slice(0, 160)}`,
  };
}

/**
 * Verdict for the Knowledge tab's structure. Both sections must be present and the pinned section
 * must not be in its failed or loading state. Memory is not judged: it depends on which employees
 * the smoke account manages.
 */
export function judgeKnowledgeSections({
  selected,
  hasNotes,
  hasPins,
  pinsText,
  text,
}) {
  if (!selected)
    return {
      status: "FAIL",
      detail: "The Knowledge tab did not become the selected tab.",
    };
  const raw = rawTextFindings(text);
  if (raw.length)
    return {
      status: "FAIL",
      detail: `Raw error text in the Knowledge tab: ${raw[0]}`,
    };
  if (NOT_A_MEMBER.test(String(text ?? "")))
    return {
      status: "FAIL",
      detail:
        "The Knowledge tab says the person is not in their own welcome channel.",
    };
  if (!hasNotes)
    return { status: "FAIL", detail: "The Channel notes section is missing." };
  if (!hasPins)
    return { status: "FAIL", detail: "The Pinned section is missing." };
  if (/could not be loaded/iu.test(String(pinsText ?? "")))
    return {
      status: "FAIL",
      detail: "The Pinned section says it could not be loaded.",
    };
  if (/^\s*Loading pinned messages/iu.test(String(pinsText ?? "")))
    return { status: "FAIL", detail: "The Pinned section never left Loading." };
  return {
    status: "PASS",
    detail: "Channel notes and Pinned sections are present and loaded.",
  };
}

/** A list text holds every needle (case sensitive: these are unique run strings). */
export function containsAll(text, needles) {
  const body = String(text ?? "");
  const missing = needles.filter((needle) => !body.includes(needle));
  return { ok: missing.length === 0, missing };
}

const firstLine = (error) =>
  `${error?.name ?? "Error"}: ${String(error?.message ?? error).split("\n")[0]}`;

/**
 * Run every row in order.
 *
 * `ctx` (all methods async):
 *   channelState()              -> {inChannel, headerTabs, composer}
 *   openDockTab("work"|"knowledge") -> {selected}
 *   dockText()                  -> inner text of the open dock after loading settles
 *   dockHas(testId)             -> boolean
 *   sectionText(testId)         -> inner text of a dock section, or null
 *   createCanvasNote(markdown)  -> {saved, shown}
 *   sendMessage(text)           -> {sent}
 *   pinMessage(text)            -> {toastSeen, errorToast, menuAfter}
 *   openPinsScreen()            -> screen text
 *   reload()                    -> {sidebar, channel}
 *   unpinFromKnowledge(text)    -> {gone, toastSeen}
 *   shot(name)                  -> relative screenshot path or null
 *
 * `record(id, label, status, detail, extra)` stores the row (the driver's `row`).
 * Returns a map id -> status.
 */
export async function runWorkKnowledgeRows(
  ctx,
  record,
  { tag, withUnpin = true } = {},
) {
  if (!tag) throw new Error("runWorkKnowledgeRows needs a run tag");
  const preview = notePreview(tag);
  const message = pinMessageText(tag);
  const outcome = new Map();

  const run = async (id, work) => {
    const spec = WK_ROWS.find((item) => item.id === id);
    const unmet = spec.needs.filter((need) => outcome.get(need) !== "PASS");
    if (unmet.length) {
      outcome.set(id, "BLOCKED");
      record(
        id,
        spec.label,
        "BLOCKED",
        `Prerequisite ${unmet.join(", ")} did not PASS, so this was not attempted.`,
      );
      return;
    }
    let result;
    try {
      result = await work();
    } catch (error) {
      result = { status: "FAIL", detail: `Step threw ${firstLine(error)}` };
    }
    const screenshot = await ctx
      .shot(`${id}-${result.status.toLowerCase()}`)
      .catch(() => null);
    outcome.set(id, result.status);
    record(id, spec.label, result.status, result.detail, { screenshot });
  };

  const knowledge = async () => {
    const opened = await ctx.openDockTab("knowledge");
    const text = await ctx.dockText();
    return {
      selected: opened.selected,
      text,
      notesText: await ctx.sectionText("work-area-knowledge-notes"),
      pinsText: await ctx.sectionText("work-area-knowledge-pins"),
    };
  };

  await run("WK0", async () => {
    const state = await ctx.channelState();
    if (!state.inChannel)
      return {
        status: "FAIL",
        detail: "No channel is open in the signed-in app.",
      };
    if (!state.headerTabs || !state.composer)
      return {
        status: "FAIL",
        detail: `The open channel lacks ${[!state.headerTabs && "the Work and Knowledge header tabs", !state.composer && "a composer"].filter(Boolean).join(" and ")}.`,
      };
    return {
      status: "PASS",
      detail: "A stream channel is open with header tabs and a composer.",
    };
  });

  const work = async () => {
    const opened = await ctx.openDockTab("work");
    return judgeWorkBody({
      selected: opened.selected,
      text: await ctx.dockText(),
      hasRows: await ctx.dockHas("work-area-work-rows"),
    });
  };
  await run("WK1", work);

  await run("WK2", async () => {
    const view = await knowledge();
    return judgeKnowledgeSections({
      selected: view.selected,
      hasNotes: view.notesText != null,
      hasPins: view.pinsText != null,
      pinsText: view.pinsText,
      text: view.text,
    });
  });

  await run("WK3", async () => {
    const result = await ctx.createCanvasNote(noteMarkdown(tag));
    if (!result.saved)
      return {
        status: "FAIL",
        detail:
          "The canvas could not be saved: no edit control, or the save did not finish.",
      };
    const found = containsAll(result.shown, [preview]);
    return found.ok
      ? {
          status: "PASS",
          detail: `The canvas shows "${preview}" after the save.`,
        }
      : {
          status: "FAIL",
          detail: `The canvas was saved but does not show "${preview}" back.`,
        };
  });

  await run("WK4", async () => {
    const view = await knowledge();
    const found = containsAll(view.notesText, [preview]);
    return found.ok
      ? { status: "PASS", detail: `Channel notes lists "${preview}".` }
      : {
          status: "FAIL",
          detail: `Channel notes does not list "${preview}". It shows: ${String(
            view.notesText ?? "(section missing)",
          )
            .replace(/\s+/gu, " ")
            .trim()
            .slice(0, 160)}`,
        };
  });

  await run("WK5", async () => {
    const sent = await ctx.sendMessage(message);
    if (!sent.sent)
      return {
        status: "FAIL",
        detail: "The message never appeared in the timeline.",
      };
    const pinned = await ctx.pinMessage(message);
    if (pinned.errorToast)
      return {
        status: "FAIL",
        detail: `Pin was refused: "${pinned.errorToast}". Plain text shown to the person; check the relay accepts kind 40004.`,
      };
    if (pinned.menuAfter !== "Unpin from channel")
      return {
        status: "FAIL",
        detail: `After pinning, the message menu offers "${pinned.menuAfter ?? "nothing"}", not "Unpin from channel".`,
      };
    return {
      status: "PASS",
      detail: `Pinned. Toast seen: ${pinned.toastSeen ? "yes" : "no (menu state confirms)"}. The menu now offers Unpin.`,
    };
  });

  await run("WK6", async () => {
    const view = await knowledge();
    const found = containsAll(view.pinsText, [message, "Pinned by"]);
    return found.ok
      ? {
          status: "PASS",
          detail:
            "The Pinned list shows the message text and a Pinned by line.",
        }
      : {
          status: "FAIL",
          detail: `The Pinned list is missing ${found.missing.map((item) => `"${item}"`).join(" and ")}. It shows: ${String(
            view.pinsText ?? "(section missing)",
          )
            .replace(/\s+/gu, " ")
            .trim()
            .slice(0, 160)}`,
        };
  });

  await run("WK7", async () => {
    const screen = await ctx.openPinsScreen();
    const found = containsAll(screen, [message]);
    return found.ok
      ? { status: "PASS", detail: "The Pins screen lists the pinned message." }
      : {
          status: "FAIL",
          detail: `The Pins screen does not list the message. It shows: ${String(
            screen ?? "",
          )
            .replace(/\s+/gu, " ")
            .trim()
            .slice(0, 160)}`,
        };
  });

  const reloaded = async () => {
    const back = await ctx.reload();
    if (!back.sidebar)
      return {
        status: "FAIL",
        detail: "The app sidebar did not return after the reload.",
      };
    if (!back.channel)
      return {
        status: "FAIL",
        detail: "The channel could not be reopened after the reload.",
      };
    return {
      status: "PASS",
      detail: "Reloaded; the sidebar and the channel are back.",
    };
  };
  await run("WK8", reloaded);

  await run("WK9", async () => {
    const view = await knowledge();
    const found = containsAll(view.notesText, [preview]);
    return found.ok
      ? {
          status: "PASS",
          detail: `After the reload, Channel notes still lists "${preview}".`,
        }
      : {
          status: "FAIL",
          detail: `After the reload, "${preview}" is gone from Channel notes.`,
        };
  });

  await run("WK10", async () => {
    const view = await knowledge();
    const found = containsAll(view.pinsText, [message]);
    return found.ok
      ? {
          status: "PASS",
          detail: "After the reload, the Pinned list still shows the message.",
        }
      : {
          status: "FAIL",
          detail: "After the reload, the pin is gone from the Pinned list.",
        };
  });

  await run("WK11", work);

  if (!withUnpin) return Object.fromEntries(outcome);

  await run("WK12", async () => {
    const result = await ctx.unpinFromKnowledge(message);
    return result.gone
      ? {
          status: "PASS",
          detail: `Unpin removed the row. Toast seen: ${result.toastSeen ? "yes" : "no"}.`,
        }
      : { status: "FAIL", detail: "The pin row is still listed after Unpin." };
  });

  await run("WK13", async () => {
    const back = await reloaded();
    if (back.status !== "PASS") return back;
    const view = await knowledge();
    if (
      !view.pinsText?.trim() ||
      /Loading pinned messages/iu.test(view.pinsText)
    )
      return {
        status: "BLOCKED",
        detail:
          "The Pinned section has not loaded, so absence of the unpinned message is not proven.",
      };
    const stillPinned = containsAll(view.pinsText, [message]).ok;
    const noteKept = containsAll(view.notesText, [preview]).ok;
    if (stillPinned)
      return {
        status: "FAIL",
        detail:
          "After the second reload the unpinned message is listed again: the delete did not reach the relay.",
      };
    if (!noteKept)
      return {
        status: "FAIL",
        detail: `After the second reload the note "${preview}" is gone.`,
      };
    return {
      status: "PASS",
      detail: "The pin stays gone and the note stays after a second reload.",
    };
  });

  return Object.fromEntries(outcome);
}

/** Overall verdict: PASS only if every run row is PASS. */
export function overallVerdict(rows) {
  if (!rows.length)
    return { status: "INCOMPLETE", headline: "No rows were recorded." };
  const bad = rows.filter((item) => item.status === "FAIL");
  const blocked = rows.filter((item) => item.status === "BLOCKED");
  if (bad.length)
    return {
      status: "FAIL",
      headline: `${bad.length} row(s) failed: ${bad.map((item) => item.id).join(", ")}.`,
    };
  if (blocked.length)
    return {
      status: "INCOMPLETE",
      headline: `${blocked.length} row(s) were blocked: ${blocked.map((item) => item.id).join(", ")}.`,
    };
  return {
    status: "PASS",
    headline: "Every row was observed in the packaged app.",
  };
}
