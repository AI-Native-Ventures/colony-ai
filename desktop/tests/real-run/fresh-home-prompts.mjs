// The seven things the fresh-HOME proof asks Scout. Each makes Scout use tools (the activity row
// and session panel show them) and several make it name files, folders or commands in its reply,
// which is where the old name and the old folder leaked into chat in the 1.0.5 gate.
//
// Every prompt starts with a space so it follows the inserted @Scout mention. No prompt contains a
// flag, a pipe, a UUID or the old name, so the typed text can never be mistaken for a leak (the
// unit test scans them with the same scanner that judges the run).

export const PROMPTS = [
  {
    id: 1,
    name: "business: read what Scout knows",
    text: " what do you know about our business? answer in this thread.",
    maxSeconds: 90,
  },
  {
    id: 2,
    name: "channels: list them",
    text: " please list the channels in our workspace and tell me their names.",
    maxSeconds: 90,
    openPanel: true,
  },
  {
    id: 3,
    name: "post: send a message with a tool",
    text: " please post a one line hello for the team in the general channel using your message tool, then tell me when it is done.",
    maxSeconds: 100,
    openDetails: true,
  },
  {
    id: 4,
    name: "file: write a file and name where it is",
    text: " please create a file called gate-check.md in your workspace with one heading, then read it back to me and tell me where the file is.",
    maxSeconds: 100,
    openPanel: true,
    expandTools: true,
  },
  {
    id: 5,
    name: "search: look through messages",
    text: " please search our messages for the word welcome and tell me what you find.",
    maxSeconds: 90,
  },
  {
    id: 6,
    name: "people: look up the team",
    text: " please look up who is on our team and what their roles are.",
    maxSeconds: 80,
  },
  {
    id: 7,
    name: "commands: say what it ran and where it works",
    text: " what commands and tools did you use for the last steps, and what folder are you working in? answer in plain words.",
    maxSeconds: 90,
    openPanel: true,
    openDetails: true,
  },
];

/** Prompt ids selected by `--prompts 1,2,3`; all seven by default. */
export function selectPrompts(spec) {
  if (!spec) return PROMPTS;
  const wanted = String(spec)
    .split(",")
    .map((value) => Number(value.trim()));
  return PROMPTS.filter((prompt) => wanted.includes(prompt.id));
}
