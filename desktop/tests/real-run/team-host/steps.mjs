// Pure helpers for the phase 0 team host gate: the step list, report rows,
// record actions, the role pack sent with a hire, message counting and clock
// maths. Unit tested without a relay or a host (steps.test.mjs).

export const PASS = "PASS";
export const FAIL = "FAIL";
export const NOT_OBSERVED = "NOT OBSERVED";

/** The ten steps, in order. */
export const STEPS = [
  { id: "sign_in", label: "Sign in with an email code (new account)" },
  { id: "create_company", label: "Create the company" },
  { id: "set_profile", label: "Set the business profile" },
  { id: "claim", label: "Start the host and claim the team computer" },
  { id: "hire", label: "Hire the Test Employee" },
  {
    id: "kickoff_answer",
    label: "The employee answers its kickoff within 5 minutes",
  },
  {
    id: "interrupted_hire",
    label: "A hire interrupted by a killed host finishes exactly once",
  },
  { id: "no_interface", label: "The team starts with no interface" },
  {
    id: "missed_routine",
    label: "A routine missed while the host was stopped runs exactly once",
  },
  { id: "second_computer", label: "A second computer runs nothing" },
];

/** One report row. */
export const row = (id, status, detail, ms) => ({
  id,
  label: STEPS.find((step) => step.id === id)?.label ?? id,
  status,
  detail,
  ms,
});

/** Every step gets a row: a step that never ran is NOT OBSERVED, never PASS. */
export function completeRows(rows) {
  return STEPS.map(
    (step) =>
      rows.find((item) => item.id === step.id) ??
      row(step.id, NOT_OBSERVED, "did not run", 0),
  );
}

/** PASS only when every step passed; FAIL when any failed; otherwise INCOMPLETE. */
export function verdictOf(rows) {
  if (rows.some((item) => item.status === FAIL)) return "FAIL";
  const passed = STEPS.every(
    (step) => rows.find((item) => item.id === step.id)?.status === PASS,
  );
  return passed ? "PASS" : "INCOMPLETE";
}

/** The business profile the gate saves (overview JSON). */
export function businessProfile(timeZone) {
  return {
    schemaVersion: 1,
    name: "Gate Test Company",
    whatYouSell:
      "Handmade notebooks, made to check that Colony runs a team by itself.",
    whoBuys: "People who test software.",
    whereYouSell: ["website"],
    city: "Johannesburg",
    country: "South Africa",
    timeZone,
    links: [],
    voiceWords: ["plain"],
    goals: ["Check the team runs"],
    contact: { email: null, phone: null, whatsapp: null, address: null },
    buyLink: null,
    invoice: {
      registeredName: null,
      registrationNumber: null,
      vatNumber: null,
      bankDetails: null,
    },
    socialAccounts: {
      instagram: null,
      facebook: null,
      tiktok: null,
      linkedin: null,
      x: null,
    },
  };
}

/** Business profile action (kind 47046) for a company with no profile yet. */
export const profileAction = (profile) => ({
  kind: 47046,
  tags: [["d", "business-profile"]],
  content: JSON.stringify({ profile, expectedRevision: null }),
});

/** Create a private conversation (kind 9007) the owner belongs to. */
export const createChannel = (channelId, name) => ({
  kind: 9007,
  tags: [
    ["h", channelId],
    ["name", name],
    ["visibility", "private"],
    ["channel_type", "stream"],
  ],
  content: "",
});

/** Hire action (kind 47039), company-wide: one `d` tag, no `h` tag. */
export const hireAction = (action) => ({
  kind: 47039,
  tags: [["d", `company:hire:${action.hireId}`]],
  content: JSON.stringify({ schemaVersion: 1, ...action }),
});

/** The hire role pack, built from the host's persona (`list_personas`). */
export function rolePackFromPersona(persona) {
  const role = persona?.company_role;
  if (!role) throw new Error(`persona ${persona?.id} has no company role`);
  return { ...role, personaId: persona.id, title: persona.display_name };
}

/** A direct hire proposal for the fixture. */
export function hireProposal({
  hireId,
  persona,
  displayName,
  channelId,
  runtimeId,
}) {
  return {
    hireId,
    rolePack: rolePackFromPersona(persona),
    displayName,
    title: persona.display_name,
    introductionChannelId: channelId,
    runtimeId,
  };
}

/** `HH:MM` in `timeZone` at `epochMs`. */
export function clockIn(epochMs, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(epochMs));
  const part = (type) =>
    parts.find((item) => item.type === type)?.value ?? "00";
  return `${part("hour")}:${part("minute")}`;
}

/** The routine time: `delayMinutes` from now, rounded up to a whole minute. */
export function dutyTime(nowMs, delayMinutes, timeZone) {
  const atMs = Math.ceil((nowMs + delayMinutes * 60_000) / 60_000) * 60_000;
  return { atMs, clock: clockIn(atMs, timeZone) };
}

const tagValue = (event, name) =>
  event.tags.find((tag) => tag[0] === name)?.[1];
const marked = (event, marker) =>
  event.tags.some((tag) => tag[0] === "client" && tag[1] === marker);

/** Messages the employee wrote in its channel since `sinceSec`, its hello left out. */
export function employeeMessages(
  events,
  { employee, channelId, sinceSec, helloMarker },
) {
  return (events ?? []).filter(
    (event) =>
      event.kind === 9 &&
      event.pubkey === employee &&
      tagValue(event, "h") === channelId &&
      event.created_at >= sinceSec &&
      !marked(event, helloMarker),
  );
}

/** The hellos posted under a hire's marker. */
export function hellos(events, marker) {
  return (events ?? []).filter(
    (event) => event.kind === 9 && marked(event, marker),
  );
}

/** Relay-signed messages in the channel that tag the employee (wakes), in a time range. */
export function relayWakes(
  events,
  { relaySelf, employee, channelId, fromSec, toSec },
) {
  return (events ?? []).filter(
    (event) =>
      event.kind === 9 &&
      event.pubkey === relaySelf &&
      tagValue(event, "h") === channelId &&
      event.tags.some((tag) => tag[0] === "p" && tag[1] === employee) &&
      event.created_at >= fromSec &&
      event.created_at <= toSec,
  );
}

/** Employee records in a host's agent store made for `hireId`. */
export function employeesForHire(store, hireId) {
  return (Array.isArray(store) ? store : []).filter(
    (record) => record?.pubkey && record?.role_context?.goalId === hireId,
  );
}

/** The hire journal entry for `hireId`. */
export function journalEntry(journal, hireId) {
  return journal?.entries?.find((entry) => entry.hireId === hireId) ?? null;
}

/** Persisted Complete actions for one hire, counted separately from its head. */
export function completes(events, hireId) {
  return (events ?? []).filter((event) => {
    if (
      event.kind !== 47039 ||
      tagValue(event, "d") !== `company:hire:${hireId}`
    )
      return false;
    try {
      const body = JSON.parse(event.content);
      return body.hireId === hireId && body.action === "complete";
    } catch {
      return false;
    }
  });
}
