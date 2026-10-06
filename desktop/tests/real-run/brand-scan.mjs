// Brand scan for the fresh-HOME packaged-app proof (see fresh-home-proof.mjs).
//
// Pure functions only: no browser, no filesystem, no network. The runner collects every visible
// text on the user-facing surfaces and hands it to scanCapture(); unit tests drive the same
// functions with fixtures (brand-scan.test.mjs), so the verdicts are falsifiable without an app.
//
// Rules, from the 1.0.6 naming gate:
//   * The old product name must not appear on ANY surface, in any case, including the opt-in
//     "Show details" popover and an expanded transcript (the raw command there must say colony).
//   * Plain surfaces (chat, transcript, session panel, Activity page, activity strip) must also
//     carry no pipe, no command flag, no UUID and no shell redirect: those are raw-command text.
//   * Opt-in raw surfaces may legitimately show pipes, flags and UUIDs, so only the name is checked.
//   * A surface that was never observed is NOT OBSERVED, never PASS.

/** Surfaces the proof must observe and judge. */
export const REQUIRED_SURFACES = [
  "chat",
  "transcript",
  "session-panel",
  "activity-page",
  "activity-strip",
];

/** Surfaces that hold raw command text only when the person opts in. Only the name is checked. */
export const OPT_IN_SURFACES = ["details-popover", "transcript-expanded"];

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu;

/** Pattern table. `fail` kinds fail a surface; `info` kinds are listed in the report only. */
export const PATTERNS = [
  { kind: "buzz", severity: "fail", appliesToOptIn: true, re: /buzz/giu },
  { kind: "pipe", severity: "fail", appliesToOptIn: false, re: /\|/gu },
  {
    kind: "flag",
    severity: "fail",
    appliesToOptIn: false,
    re: /(?<=^|\s)--?[a-z][\w-]*/giu,
  },
  {
    kind: "uuid",
    severity: "fail",
    appliesToOptIn: false,
    re: new RegExp(UUID.source, "giu"),
  },
  {
    kind: "redirect",
    severity: "fail",
    appliesToOptIn: false,
    re: /\d?>&\d|\s2>/gu,
  },
  {
    // An absolute home path is allowed when the person asked where something is, so it is
    // reported but never fails a surface. A path that names the old folder is also a "buzz" hit.
    kind: "home-path",
    severity: "info",
    appliesToOptIn: false,
    re: /(?:\/Users\/|\/home\/)[^\s/]+[^\s]*/gu,
  },
];

/** The surface group of a recorder key: everything before the first dot ("session-panel.attr.title"). */
export function surfaceGroup(name) {
  return String(name).split(".")[0];
}

/** True for a surface whose raw text is opt-in (details popover, expanded transcript). */
export function isOptIn(name) {
  return OPT_IN_SURFACES.includes(surfaceGroup(name));
}

/** Collapse whitespace so excerpts and de-duplication ignore layout. */
export function clip(text) {
  return String(text ?? "")
    .replace(/\s+/gu, " ")
    .trim();
}

function context(text, index, length) {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + length + 50);
  return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
}

/**
 * Findings for one text on one surface.
 * @param {string} text
 * @param {string} surface recorder key such as "chat" or "session-panel.attr.title"
 * @returns {{surface: string, kind: string, severity: string, match: string, context: string}[]}
 */
export function scanText(text, surface) {
  const value = clip(text);
  if (!value) return [];
  const optIn = isOptIn(surface);
  const findings = [];
  for (const pattern of PATTERNS) {
    if (optIn && !pattern.appliesToOptIn) continue;
    for (const hit of value.matchAll(pattern.re)) {
      findings.push({
        surface,
        kind: pattern.kind,
        severity: pattern.severity,
        match: hit[0].trim(),
        context: context(value, hit.index, hit[0].length),
      });
    }
  }
  return findings;
}

/**
 * Judge a capture.
 * @param {{surfaces: Record<string, string[]>}} capture distinct visible texts per recorder key
 * @returns {{
 *   groups: Record<string, {observed: number, findings: object[], status: string}>,
 *   findings: object[],
 *   status: "PASS"|"FAIL"|"NOT OBSERVED",
 *   missing: string[]
 * }}
 */
export function scanCapture(capture) {
  const surfaces = capture?.surfaces ?? {};
  const groups = {};
  const group = (name) => {
    groups[name] ??= { observed: 0, findings: [], status: "NOT OBSERVED" };
    return groups[name];
  };
  for (const required of REQUIRED_SURFACES) group(required);
  for (const [key, texts] of Object.entries(surfaces)) {
    const entry = group(surfaceGroup(key));
    for (const text of texts ?? []) {
      if (!clip(text)) continue;
      entry.observed += 1;
      entry.findings.push(...scanText(text, key));
    }
  }
  for (const entry of Object.values(groups)) {
    const failing = entry.findings.some((finding) => finding.severity === "fail");
    entry.status = failing
      ? "FAIL"
      : entry.observed === 0
        ? "NOT OBSERVED"
        : "PASS";
  }
  const findings = Object.values(groups).flatMap((entry) => entry.findings);
  const missing = REQUIRED_SURFACES.filter(
    (name) => groups[name].observed === 0,
  );
  const failed = Object.values(groups).some((entry) => entry.status === "FAIL");
  return {
    groups,
    findings,
    missing,
    status: failed ? "FAIL" : missing.length ? "NOT OBSERVED" : "PASS",
  };
}

/** The failing findings only, most useful first: the old name before raw-command symptoms. */
export function failingFindings(scan) {
  const order = ["buzz", "flag", "pipe", "uuid", "redirect"];
  return scan.findings
    .filter((finding) => finding.severity === "fail")
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

/**
 * Judge the throwaway HOME after the run. `names` are the top-level entry names of the fresh HOME.
 * A fresh install must create the Colony folder and must not create the old one.
 */
export function homeVerdict({ before = [], after = [] }) {
  const had = (names, name) => names.includes(name);
  if (had(before, ".buzz") || had(before, ".colony"))
    return {
      status: "BLOCKED",
      detail: `The throwaway HOME was not fresh before launch (${before.join(", ")}). Nothing was proven.`,
    };
  if (had(after, ".buzz"))
    return {
      status: "FAIL",
      detail: `A fresh install created ~/.buzz. Top-level entries after the run: ${after.join(", ")}`,
    };
  if (!had(after, ".colony"))
    return {
      status: "NOT OBSERVED",
      detail: `Neither ~/.colony nor ~/.buzz exists after the run (the agent folder was never created). Entries: ${after.join(", ") || "none"}`,
    };
  return {
    status: "PASS",
    detail: `~/.colony was created and ~/.buzz was not. Top-level entries after the run: ${after.join(", ")}`,
  };
}

/**
 * Judge that the run exercised what it claims: every prompt made Scout use a tool (an activity
 * row appeared), so an empty row scan cannot read as a clean bill of health.
 */
export function promptCoverage(promptLog) {
  const worked = promptLog.filter((log) => log.firstRowMs != null);
  if (!promptLog.length)
    return { status: "NOT OBSERVED", detail: "No prompt was sent." };
  if (worked.length === 0)
    return {
      status: "NOT OBSERVED",
      detail: `${promptLog.length} prompts sent, Scout never showed tool activity, so no tool text was scanned.`,
    };
  return {
    status: worked.length === promptLog.length ? "PASS" : "INCOMPLETE",
    detail: `${worked.length} of ${promptLog.length} prompts made Scout use a tool and show activity.`,
  };
}
