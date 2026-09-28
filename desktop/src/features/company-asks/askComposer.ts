import type { AskType } from "./askRecords";

/** Editable fields for the five supported ask types. */
export type AskComposerDraft = {
  type: AskType;
  title: string;
  body: string;
  addresseePubkey: string;
  decideBy: string;
  options: string;
  items: string;
};

/** Field-level validation feedback for the create form. */
export type AskComposerErrors = Partial<Record<keyof AskComposerDraft, string>>;

/** Coordinates needed to build a channel-thread ask create action. */
export type AskComposerCoordinates = {
  channelId: string;
  threadRootEventId: string;
  askId: string;
};

/** Kind 47032 command content for creating one ask. */
export type AskCreateAction = {
  schemaVersion: 1;
  askId: string;
  action: "create";
  ask: {
    schemaVersion: 1;
    askId: string;
    type: AskType;
    category: "general";
    title: string;
    body?: string;
    threadRootEventId: string;
    addresseePubkey: string;
    decideBy?: string;
    options?: Array<{ id: string; label: string }>;
    items?: Array<{ id: string; label: string }>;
  };
};

/** Empty draft used when opening the create route. */
export const EMPTY_ASK_COMPOSER_DRAFT: AskComposerDraft = {
  type: "approval",
  title: "",
  body: "",
  addresseePubkey: "",
  decideBy: "",
  options: "",
  items: "",
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_ID_PATTERN = /^[0-9a-f]{64}$/i;

function listItems(value: string) {
  return value
    .split(/\r?\n/)
    .map((label) => label.trim())
    .filter(Boolean);
}

/** Validates the draft against the persisted ask record contract. */
export function validateAskComposerDraft(
  draft: AskComposerDraft,
  coordinates?: Pick<AskComposerCoordinates, "channelId" | "threadRootEventId">,
): AskComposerErrors {
  const errors: AskComposerErrors = {};
  const title = draft.title.trim();
  if (!title) errors.title = "Add a short title.";
  else if (title.length > 180) errors.title = "Use 180 characters or fewer.";

  if (draft.body.trim().length > 4000) {
    errors.body = "Use 4,000 characters or fewer.";
  }

  if (!HEX_ID_PATTERN.test(draft.addresseePubkey)) {
    errors.addresseePubkey = "Choose a person or AI employee.";
  }

  if (draft.decideBy && !Number.isFinite(Date.parse(draft.decideBy))) {
    errors.decideBy = "Choose a valid decision date.";
  }

  if (coordinates) {
    if (!UUID_PATTERN.test(coordinates.channelId)) {
      errors.title = "The conversation is unavailable.";
    }
    if (!HEX_ID_PATTERN.test(coordinates.threadRootEventId)) {
      errors.title = "The discussion thread is unavailable.";
    }
  }

  if (draft.type === "choice") {
    const options = listItems(draft.options);
    if (options.length < 2 || options.length > 8) {
      errors.options = "Add between 2 and 8 choices, one per line.";
    } else if (options.some((option) => option.length > 180)) {
      errors.options = "Each choice must be 180 characters or fewer.";
    }
  }

  if (draft.type === "checklist") {
    const items = listItems(draft.items);
    if (items.length < 1 || items.length > 20) {
      errors.items = "Add between 1 and 20 items, one per line.";
    } else if (items.some((item) => item.length > 180)) {
      errors.items = "Each item must be 180 characters or fewer.";
    }
  }

  return errors;
}

/** Builds the exact kind 47032 create content from a valid draft. */
export function buildAskCreateAction(
  draft: AskComposerDraft,
  coordinates: AskComposerCoordinates,
): AskCreateAction {
  const errors = validateAskComposerDraft(draft, coordinates);
  if (Object.keys(errors).length > 0) {
    throw new Error("The ask draft is not valid.");
  }

  const decideBy = draft.decideBy
    ? new Date(draft.decideBy).toISOString()
    : undefined;
  const ask: AskCreateAction["ask"] = {
    schemaVersion: 1,
    askId: coordinates.askId,
    type: draft.type,
    category: "general",
    title: draft.title.trim(),
    ...(draft.body.trim() ? { body: draft.body.trim() } : {}),
    threadRootEventId: coordinates.threadRootEventId,
    addresseePubkey: draft.addresseePubkey.toLowerCase(),
    ...(decideBy ? { decideBy } : {}),
    ...(draft.type === "choice"
      ? {
          options: listItems(draft.options).map((label, index) => ({
            id: `option-${index + 1}`,
            label,
          })),
        }
      : {}),
    ...(draft.type === "checklist"
      ? {
          items: listItems(draft.items).map((label, index) => ({
            id: `item-${index + 1}`,
            label,
          })),
        }
      : {}),
  };

  return {
    schemaVersion: 1,
    askId: coordinates.askId,
    action: "create",
    ask,
  };
}

/** Builds Nostr tags for a create action, including its thread placement. */
export function buildAskCreateTags(
  channelId: string,
  threadRootEventId: string,
  askId: string,
): string[][] {
  return [
    ["h", channelId],
    ["d", `channel:${channelId}:ask:${askId}`],
    ["e", threadRootEventId, "", "root"],
    ["e", threadRootEventId, "", "reply"],
  ];
}
