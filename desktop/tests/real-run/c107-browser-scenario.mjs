// FAKE-model browser scenarios for the 1.0.7 candidate gate. Each step only names a tool the real
// managed agent session advertised, and every tab id or element reference is read from an actual
// earlier tool result. Nothing here calls the broker or invents a tool result.

const TAB = /"primaryTab"\s*:\s*\{\s*"id"\s*:\s*"([A-Za-z0-9_.:-]{1,80})"/u;
const ANY_TAB = /"id"\s*:\s*"([A-Za-z0-9_.:-]{1,80})"/u;
const URLS = /\b(?:https?|file):\/\/[^\s,]+/gu;

/** Primary tab id from the newest connect or tabs result, else from any earlier result. */
export function tabFrom(results = [], history = []) {
  for (const text of [...results].reverse().concat([...history].reverse())) {
    const match = String(text).match(TAB) ?? String(text).match(ANY_TAB);
    if (match) return match[1];
  }
  return null;
}

/** Reference of the first snapshot line naming the label, for example `- button "Send message" [ref=e5]`. */
export function refFor(snapshot, label) {
  for (const line of String(snapshot ?? "").split("\n"))
    if (line.includes(`"${label}"`)) {
      const match = line.match(/\[ref=(e[0-9]{1,8})\]/u);
      if (match) return match[1];
    }
  return null;
}

/** Browser scenario for the person's message, or null when it is not a browser fixture row. */
export function browserScenarioFor(human, ctx) {
  const history = ctx.history ?? [];
  if (/Fixture control row/u.test(human))
    return {
      name: "browser-control",
      cmds: [
        { tool: "browser_connect", args: {} },
        (res) => ({
          tool: "browser_snapshot",
          args: { tab: tabFrom(res.slice(0, 1), history) ?? "missing-tab" },
        }),
        (res) => ({
          tool: "browser_click",
          args: {
            tab: tabFrom(res.slice(0, 1), history) ?? "missing-tab",
            ref: refFor(res[1], "Send message") ?? "e0",
          },
        }),
      ],
    };
  if (/Fixture ended-control row/u.test(human))
    return {
      name: "browser-ended",
      cmds: [
        (res) => ({
          tool: "browser_snapshot",
          args: { tab: tabFrom([], history) ?? "missing-tab" },
        }),
        { tool: "browser_connect", args: {} },
      ],
    };
  if (/Fixture refusal row/u.test(human)) {
    const urls = [...human.matchAll(URLS)].map((m) =>
      m[0].replace(/[.,]$/u, ""),
    );
    return {
      name: "browser-refusal",
      cmds: [
        { tool: "browser_connect", args: {} },
        ...urls.map((url) => (res) => ({
          tool: "browser_navigate",
          args: { tab: tabFrom(res.slice(0, 1), history) ?? "missing-tab", url },
        })),
      ],
    };
  }
  if (/Fixture unapproved row/u.test(human))
    return {
      name: "browser-unapproved",
      cmds: [{ tool: "browser_connect", args: {} }],
    };
  return null;
}
