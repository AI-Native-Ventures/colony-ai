export type WhatsAppQuality = "green" | "yellow" | "red";
export type WhatsAppStage =
  | "none"
  | "contacted"
  | "replied"
  | "wants_call"
  | "call_booked"
  | "quote_sent"
  | "client"
  | "no_thanks"
  | "stopped"
  | "not_on_whatsapp";
export type WhatsAppLeadStatus =
  | "not-contacted"
  | "in-batch"
  | "sent"
  | "replied"
  | "opted-out";
export type WhatsAppDirection = "in" | "out";
export type WhatsAppOutboundState = "sent" | "delivered" | "read" | "failed";
export type WhatsAppMessageKind = "text" | "template" | "media" | "button";
export type WhatsAppMessageState =
  | "draft"
  | "rejected"
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "unconfirmed";
export type WhatsAppBatchStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "completed";

export type WhatsAppIssue = Readonly<{
  code: string;
  message: string;
  at: string;
}>;

export type WhatsAppTemplateButton = Readonly<{
  type: string;
  text: string;
}>;

export type WhatsAppTemplate = Readonly<{
  title: string;
  name: string;
  proposedTitle: string | null;
  titleCustom: boolean;
  language: string;
  category: string;
  status: string;
  body: string;
  slots: number;
  buttons: readonly WhatsAppTemplateButton[];
}>;

/** This view model intentionally contains no credential fields. */
export type WhatsAppStatus = Readonly<{
  connected: boolean;
  connectionId: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  quality: WhatsAppQuality | null;
  phoneStatus: string | null;
  dailyNewChatCap: number;
  newChatsSentToday: number;
  sendingPaused: boolean;
  pauseReason: string | null;
  issues: readonly WhatsAppIssue[];
  outreachChannelId: string | null;
  templatesSyncedAt: string | null;
  templates: readonly WhatsAppTemplate[];
  webhookUrl: string | null;
}>;

export type WhatsAppContact = Readonly<{
  waId: string;
  e164: string;
  displayName: string | null;
  profileName: string | null;
  businessName: string | null;
  website: string | null;
  label: string | null;
  leadId: string | null;
  ownerPubkey: string | null;
  threadRootEventId: string | null;
  lastInboundAt: string | null;
  lastContactedAt: string | null;
  lastOutboundState: WhatsAppOutboundState | null;
  lastReplyAt: string | null;
  stage: WhatsAppStage;
  stageSetBy: "auto" | string | null;
  stageChangedAt: string | null;
  windowOpen: boolean;
  windowClosesAt: string | null;
  optedOut: boolean;
  paused: boolean;
  pauseReason: string | null;
  unanswered: boolean;
  awaitingApproval: boolean;
}>;

export type WhatsAppMessage = Readonly<{
  id: string;
  waId: string;
  direction: WhatsAppDirection;
  kind: WhatsAppMessageKind;
  text: string;
  templateName: string | null;
  state: WhatsAppMessageState | null;
  errorCode: string | null;
  errorText: string | null;
  eventId: string | null;
  senderPubkey: string | null;
  createdAt: string;
  sendsAt?: string | null;
}>;

export type WhatsAppThread = Readonly<{
  contact: WhatsAppContact;
  messages: readonly WhatsAppMessage[];
}>;

export type WhatsAppBatchCounts = Readonly<{
  total: number;
  ready: number;
  sent: number;
  failed: number;
  dropped: number;
}>;

export type WhatsAppBatchSummary = Readonly<{
  batchId: string;
  status: WhatsAppBatchStatus;
  createdBy: string;
  template: string;
  language: string;
  rows: WhatsAppBatchCounts;
  createdAt: string;
}>;

export type WhatsAppBatchRow = Readonly<{
  idx: number;
  to: string;
  leadId: string | null;
  params: readonly string[];
  preview: string;
  state: string;
  skipReason: string | null;
  sendsAt?: string | null;
}>;

export type WhatsAppBatchDetail = Readonly<{
  batchId: string;
  status: WhatsAppBatchStatus;
  createdBy: string;
  template: string;
  language: string;
  note: string | null;
  materialLinks: readonly string[];
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
  rows: readonly WhatsAppBatchRow[];
  counts: WhatsAppBatchCounts;
  /** Optional future relay field for an exact worker schedule estimate. */
  nextSendAt?: string | null;
}>;

export type WhatsAppDraft = WhatsAppMessage &
  Readonly<{
    to: string;
    params: readonly string[];
  }>;

const DAY_MS = 24 * 60 * 60 * 1000;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`The relay returned an unreadable WhatsApp ${label}.`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`The relay returned an invalid WhatsApp ${label}.`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  return stringValue(value, label);
}

function finiteInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`The relay returned an invalid WhatsApp ${label}.`);
  }
  return Math.floor(value);
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`The relay returned an invalid WhatsApp ${label}.`);
  }
  return value;
}

function parseQuality(value: unknown): WhatsAppQuality | null {
  if (value === null || value === undefined) return null;
  if (value === "GREEN" || value === "green") return "green";
  if (value === "YELLOW" || value === "yellow") return "yellow";
  if (value === "RED" || value === "red") return "red";
  throw new Error("The relay returned an invalid WhatsApp quality rating.");
}

function parseOutboundState(value: unknown): WhatsAppOutboundState | null {
  if (value === null || value === undefined) return null;
  if (
    value === "sent" ||
    value === "delivered" ||
    value === "read" ||
    value === "failed"
  ) {
    return value;
  }
  throw new Error("The relay returned an invalid WhatsApp outbound state.");
}

function parseTemplateButton(value: unknown): WhatsAppTemplateButton {
  const button = record(value, "template button");
  return {
    type: typeof button.type === "string" ? button.type : "QUICK_REPLY",
    text: stringValue(button.text, "template button text"),
  };
}

export function parseWhatsAppTemplate(value: unknown): WhatsAppTemplate {
  const template = record(value, "template");
  const buttons = Array.isArray(template.buttons) ? template.buttons : [];
  return {
    title: stringValue(template.title, "template title"),
    name: stringValue(template.name, "template name"),
    proposedTitle: nullableString(template.proposedTitle, "proposed title"),
    titleCustom: booleanValue(template.titleCustom, "custom-title flag"),
    language: stringValue(template.language, "template language"),
    category: stringValue(template.category, "template category"),
    status: stringValue(template.status, "template status"),
    body: stringValue(template.body, "template body"),
    slots: Math.max(0, finiteInteger(template.slots, "template slot count")),
    buttons: buttons.map(parseTemplateButton),
  };
}

export function parseWhatsAppStatus(value: unknown): WhatsAppStatus {
  const status = record(value, "status");
  const issues = Array.isArray(status.issues) ? status.issues : [];
  const templates = Array.isArray(status.templates) ? status.templates : [];
  return {
    connected: booleanValue(status.connected, "connected flag"),
    connectionId: nullableString(status.connectionId, "connection id"),
    displayPhoneNumber: nullableString(
      status.displayPhoneNumber,
      "display phone number",
    ),
    verifiedName: nullableString(status.verifiedName, "verified name"),
    quality: parseQuality(status.quality),
    phoneStatus: nullableString(status.phoneStatus, "phone status"),
    dailyNewChatCap: Math.min(
      1000,
      Math.max(0, finiteInteger(status.dailyNewChatCap, "daily new-chat cap")),
    ),
    newChatsSentToday: Math.max(
      0,
      finiteInteger(status.newChatsSentToday, "new-chat count"),
    ),
    sendingPaused: booleanValue(status.sendingPaused, "sending-paused flag"),
    pauseReason: nullableString(status.pauseReason, "pause reason"),
    issues: issues.map((value) => {
      const issue = record(value, "issue");
      return {
        code: stringValue(issue.code, "issue code"),
        message: stringValue(issue.message, "issue message"),
        at: stringValue(issue.at, "issue time"),
      };
    }),
    outreachChannelId: nullableString(
      status.outreachChannelId,
      "Outreach channel id",
    ),
    templatesSyncedAt: nullableString(
      status.templatesSyncedAt,
      "template sync time",
    ),
    templates: templates.map(parseWhatsAppTemplate),
    webhookUrl: nullableString(status.webhookUrl, "webhook URL"),
  };
}

export function parseWhatsAppContact(value: unknown): WhatsAppContact {
  const contact = record(value, "contact");
  const stage = contact.stage ?? "none";
  const allowedStages = new Set<WhatsAppStage>([
    "none",
    "contacted",
    "replied",
    "wants_call",
    "call_booked",
    "quote_sent",
    "client",
    "no_thanks",
    "stopped",
    "not_on_whatsapp",
  ]);
  if (typeof stage !== "string" || !allowedStages.has(stage as WhatsAppStage)) {
    throw new Error("The relay returned an invalid WhatsApp contact stage.");
  }
  const stageSetBy = contact.stageSetBy;
  if (
    stageSetBy !== null &&
    stageSetBy !== undefined &&
    stageSetBy !== "auto" &&
    (typeof stageSetBy !== "string" || !/^[0-9a-f]{64}$/iu.test(stageSetBy))
  ) {
    throw new Error("The relay returned an invalid WhatsApp stage author.");
  }
  return {
    waId: stringValue(contact.waId, "WhatsApp id"),
    e164: stringValue(contact.e164, "contact phone number"),
    displayName: nullableString(contact.displayName, "contact name"),
    profileName: nullableString(contact.profileName, "WhatsApp profile name"),
    businessName: nullableString(contact.businessName, "business name"),
    website: nullableString(contact.website, "business website"),
    label: nullableString(contact.label, "contact label"),
    leadId: nullableString(contact.leadId, "lead id"),
    ownerPubkey: nullableString(contact.ownerPubkey, "owner pubkey"),
    threadRootEventId: nullableString(
      contact.threadRootEventId,
      "thread root id",
    ),
    lastInboundAt: nullableString(contact.lastInboundAt, "last inbound time"),
    lastContactedAt: nullableString(
      contact.lastContactedAt,
      "last contacted time",
    ),
    lastOutboundState: parseOutboundState(contact.lastOutboundState),
    lastReplyAt: nullableString(contact.lastReplyAt, "last reply time"),
    stage: stage as WhatsAppStage,
    stageSetBy: (stageSetBy as "auto" | string | null | undefined) ?? null,
    stageChangedAt: nullableString(
      contact.stageChangedAt,
      "stage changed time",
    ),
    windowOpen: booleanValue(contact.windowOpen, "reply-window flag"),
    windowClosesAt: nullableString(
      contact.windowClosesAt,
      "reply-window close time",
    ),
    optedOut: booleanValue(contact.optedOut, "opt-out flag"),
    paused: booleanValue(contact.paused, "contact-paused flag"),
    pauseReason: nullableString(contact.pauseReason, "contact pause reason"),
    unanswered: booleanValue(contact.unanswered, "unanswered flag"),
    awaitingApproval: contact.awaitingApproval === true,
  };
}

const MESSAGE_DIRECTIONS = new Set<WhatsAppDirection>(["in", "out"]);
const MESSAGE_KINDS = new Set<WhatsAppMessageKind>([
  "text",
  "template",
  "media",
  "button",
]);
const MESSAGE_STATES = new Set<WhatsAppMessageState>([
  "draft",
  "rejected",
  "queued",
  "sending",
  "sent",
  "delivered",
  "read",
  "failed",
  "unconfirmed",
]);

let hasLoggedUnknownWhatsAppMessageState = false;

/** Resets the unknown-message warning when the active community changes. */
export function resetWhatsAppUnknownMessageStateWarning(): void {
  hasLoggedUnknownWhatsAppMessageState = false;
}

function parseWhatsAppMessageState(
  value: unknown,
  direction: WhatsAppDirection,
): WhatsAppMessageState | null {
  const state = typeof value === "string" ? value : null;
  if (direction === "in" && state === "received") return "read";
  if (state !== null && MESSAGE_STATES.has(state as WhatsAppMessageState)) {
    return state as WhatsAppMessageState;
  }
  if (!hasLoggedUnknownWhatsAppMessageState) {
    hasLoggedUnknownWhatsAppMessageState = true;
    console.warn(
      "The relay returned an unknown WhatsApp message state; showing the message without a status.",
      state ?? typeof value,
    );
  }
  return null;
}

export function parseWhatsAppMessage(value: unknown): WhatsAppMessage {
  const message = record(value, "message");
  const direction = stringValue(message.direction, "message direction");
  const kind = stringValue(message.kind, "message kind");
  if (!MESSAGE_DIRECTIONS.has(direction as WhatsAppDirection)) {
    throw new Error(
      "The relay returned an invalid WhatsApp message direction.",
    );
  }
  if (!MESSAGE_KINDS.has(kind as WhatsAppMessageKind)) {
    throw new Error("The relay returned an invalid WhatsApp message kind.");
  }
  const state = parseWhatsAppMessageState(
    message.state,
    direction as WhatsAppDirection,
  );
  return {
    id: stringValue(message.id, "message id"),
    waId: stringValue(message.waId, "message contact id"),
    direction: direction as WhatsAppDirection,
    kind: kind as WhatsAppMessageKind,
    text: stringValue(message.text, "message text"),
    templateName: nullableString(message.templateName, "message template name"),
    state,
    errorCode: nullableString(message.errorCode, "message error code"),
    errorText: nullableString(message.errorText, "message error text"),
    eventId: nullableString(message.eventId, "message event id"),
    senderPubkey: nullableString(message.senderPubkey, "message sender"),
    createdAt: stringValue(message.createdAt, "message time"),
    ...(message.sendsAt === undefined
      ? {}
      : { sendsAt: nullableString(message.sendsAt, "message send time") }),
  };
}

export function parseWhatsAppThread(value: unknown): WhatsAppThread {
  const thread = record(value, "thread");
  if (!Array.isArray(thread.messages)) {
    throw new Error(
      "The relay returned an invalid WhatsApp thread message list.",
    );
  }
  return {
    contact: parseWhatsAppContact(thread.contact),
    messages: thread.messages.map(parseWhatsAppMessage),
  };
}

function parseCounts(
  value: unknown,
  label = "batch counts",
): WhatsAppBatchCounts {
  const counts = record(value, label);
  return {
    total: Math.max(0, finiteInteger(counts.total, "batch total")),
    ready: Math.max(0, finiteInteger(counts.ready, "ready batch count")),
    sent: Math.max(0, finiteInteger(counts.sent, "sent batch count")),
    failed: Math.max(0, finiteInteger(counts.failed, "failed batch count")),
    dropped: Math.max(0, finiteInteger(counts.dropped, "dropped batch count")),
  };
}

function parseBatchStatus(value: unknown): WhatsAppBatchStatus {
  if (
    value === "pending" ||
    value === "approved" ||
    value === "rejected" ||
    value === "completed"
  ) {
    return value;
  }
  throw new Error("The relay returned an invalid WhatsApp batch status.");
}

export function parseWhatsAppBatchSummary(
  value: unknown,
): WhatsAppBatchSummary {
  const batch = record(value, "batch");
  return {
    batchId: stringValue(batch.batchId, "batch id"),
    status: parseBatchStatus(batch.status),
    createdBy: stringValue(batch.createdBy, "batch creator"),
    template: stringValue(batch.template, "batch template"),
    language: stringValue(batch.language, "batch language"),
    rows: parseCounts(batch.rows),
    createdAt: stringValue(batch.createdAt, "batch creation time"),
  };
}

export function parseWhatsAppBatchDetail(value: unknown): WhatsAppBatchDetail {
  const batch = record(value, "batch detail");
  if (!Array.isArray(batch.rows)) {
    throw new Error("The relay returned an invalid WhatsApp batch row list.");
  }
  const rows = batch.rows.map((value): WhatsAppBatchRow => {
    const row = record(value, "batch row");
    if (
      !Array.isArray(row.params) ||
      !row.params.every((item) => typeof item === "string")
    ) {
      throw new Error("The relay returned invalid WhatsApp batch parameters.");
    }
    return {
      idx: Math.max(0, finiteInteger(row.idx, "batch row index")),
      to: stringValue(row.to, "batch row phone number"),
      leadId: nullableString(row.leadId, "batch row lead id"),
      params: row.params,
      preview: stringValue(row.preview, "batch row preview"),
      state: stringValue(row.state, "batch row state"),
      skipReason: nullableString(row.skipReason, "batch row skip reason"),
      ...(row.sendsAt === undefined
        ? {}
        : { sendsAt: nullableString(row.sendsAt, "batch row send time") }),
    };
  });
  return {
    batchId: stringValue(batch.batchId, "batch id"),
    status: parseBatchStatus(batch.status),
    createdBy: stringValue(batch.createdBy, "batch creator"),
    template: stringValue(batch.template, "batch template"),
    language: stringValue(batch.language, "batch language"),
    note: nullableString(batch.note, "batch note"),
    materialLinks: Array.isArray(batch.materialLinks)
      ? batch.materialLinks.filter(
          (link): link is string => typeof link === "string",
        )
      : [],
    decidedBy: nullableString(batch.decidedBy, "batch approver"),
    decidedAt: nullableString(batch.decidedAt, "batch decision time"),
    createdAt: stringValue(batch.createdAt, "batch creation time"),
    rows,
    counts: parseCounts(batch.counts),
    nextSendAt: nullableString(batch.nextSendAt, "next-send time"),
  };
}

export function parseWhatsAppDraft(value: unknown): WhatsAppDraft {
  const draft = record(value, "draft");
  const message = parseWhatsAppMessage(draft);
  if (
    !Array.isArray(draft.params) ||
    !draft.params.every((item) => typeof item === "string")
  ) {
    throw new Error("The relay returned invalid WhatsApp draft parameters.");
  }
  return {
    ...message,
    to: stringValue(draft.to, "draft phone number"),
    params: draft.params,
  };
}

export function renderWhatsAppTemplate(
  body: string,
  params: readonly string[],
): string {
  return body.replace(/\{\{(\d+)\}\}/gu, (slot, rawNumber: string) => {
    const index = Number(rawNumber) - 1;
    return Number.isInteger(index) && index >= 0
      ? (params[index] ?? slot)
      : slot;
  });
}

export function whatsappTemplateDisplayTitle(
  template: WhatsAppTemplate,
): string {
  return template.title;
}

export function whatsappTemplateMetaName(
  template: WhatsAppTemplate,
  expanded: boolean,
): string | null {
  return expanded ? template.name : null;
}

export function maskWhatsAppNumber(value: string): string {
  const digits = value.replace(/\D/gu, "");
  if (digits.length < 7) return value;
  if (digits.startsWith("27") && digits.length >= 9) {
    return `+27 ${digits.slice(2, 4)} *** ${digits.slice(-4)}`;
  }
  return `+${digits.slice(0, 3)} **** ${digits.slice(-4)}`;
}

export function formatWhatsAppPhoneNumber(value: string): string {
  const digits = value.replace(/\D/gu, "");
  if (digits.startsWith("27") && digits.length === 11) {
    return `+27 ${digits.slice(2, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  return value.trim();
}

export function isWhatsAppPhoneLikeName(value: string): boolean {
  const name = value.trim();
  return (
    /^[+]?([\d\s().-])+$/u.test(name) && name.replace(/\D/gu, "").length >= 7
  );
}

/** Format a WhatsApp id or E.164 number for display without hiding digits. */
export function formatWhatsAppNumber(value: string): string {
  const digits = value.replace(/\D/gu, "");
  if (digits.length === 11 && digits.startsWith("27")) {
    return `+27 ${digits.slice(2, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  if (value.trim().startsWith("+") && digits.length > 0) {
    return `+${digits}`;
  }
  return value.trim() || digits;
}

export function isWhatsAppReplyWindowOpen(
  lastInboundAt: string | number | null,
  nowMs: number,
): boolean {
  const inboundMs =
    typeof lastInboundAt === "string"
      ? Date.parse(lastInboundAt)
      : lastInboundAt;
  if (
    typeof inboundMs !== "number" ||
    !Number.isFinite(inboundMs) ||
    !Number.isFinite(nowMs)
  ) {
    return false;
  }
  return nowMs >= inboundMs && nowMs < inboundMs + DAY_MS;
}

export function getWhatsAppDailyCapProgress(
  sentToday: number,
  dailyCap: number,
): { sent: number; cap: number; remaining: number; percentage: number } {
  const sent = Number.isFinite(sentToday)
    ? Math.max(0, Math.floor(sentToday))
    : 0;
  const cap = Number.isFinite(dailyCap)
    ? Math.min(1000, Math.max(0, Math.floor(dailyCap)))
    : 30;
  return {
    sent,
    cap,
    remaining: Math.max(0, cap - sent),
    percentage: cap === 0 ? 0 : Math.min(100, Math.round((sent / cap) * 100)),
  };
}

export function whatsappLeadStatusLabel(status: WhatsAppLeadStatus): string {
  switch (status) {
    case "not-contacted":
      return "Not contacted";
    case "in-batch":
      return "In batch";
    case "sent":
      return "Sent";
    case "replied":
      return "Replied";
    case "opted-out":
      return "Opted out";
  }
}

export function whatsappDeliveryLabel(
  state: WhatsAppMessageState,
  failureReason?: string | null,
  sendsAt?: string | null,
  nowMs = Date.now(),
): string {
  if (state === "failed") {
    const reason = failureReason?.trim();
    return reason ? `Failed: ${reason}` : "Failed";
  }
  switch (state) {
    case "sent":
      return "Sent";
    case "delivered":
      return "Delivered";
    case "read":
      return "Read";
    case "draft":
      return "Draft, needs approval";
    case "rejected":
      return "Rejected";
    case "queued":
      return whatsappQueuedScheduleLabel(sendsAt, nowMs);
    case "sending":
      return "Sending";
    case "unconfirmed":
      return "Unconfirmed, check before retrying";
  }
}

const JOHANNESBURG_DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Africa/Johannesburg",
});

export function whatsappQueuedScheduleLabel(
  sendsAt: string | null | undefined,
  nowMs = Date.now(),
): string {
  if (!sendsAt) return "Queued to send";
  const sendMs = Date.parse(sendsAt);
  if (!Number.isFinite(sendMs) || sendMs <= nowMs) return "Queued to send";

  const sendDay = JOHANNESBURG_DAY_FORMAT.format(new Date(sendMs));
  const today = JOHANNESBURG_DAY_FORMAT.format(new Date(nowMs));
  if (sendDay === today) {
    const time = new Intl.DateTimeFormat("en-ZA", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "Africa/Johannesburg",
    }).format(new Date(sendMs));
    return `Sends today at ${time}`;
  }

  const tomorrow = JOHANNESBURG_DAY_FORMAT.format(new Date(nowMs + DAY_MS));
  return sendDay === tomorrow ? "Sends tomorrow at 08:00" : "Queued to send";
}

export function whatsappQualityLabel(quality: WhatsAppQuality | null): string {
  if (!quality) return "Unavailable";
  switch (quality) {
    case "green":
      return "Green";
    case "yellow":
      return "Yellow";
    case "red":
      return "Red";
  }
}

export function contactWhatsAppStatus(input: {
  optedOut: boolean;
  replied: boolean;
  sent: boolean;
  inBatch: boolean;
}): WhatsAppLeadStatus {
  if (input.optedOut) return "opted-out";
  if (input.replied) return "replied";
  if (input.inBatch) return "in-batch";
  if (input.sent) return "sent";
  return "not-contacted";
}
