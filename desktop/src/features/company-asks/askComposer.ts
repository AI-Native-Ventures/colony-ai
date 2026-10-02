import type { EmployeeAllowanceAction } from "@/features/power/spendModels";
import type { AskType, HireProposal } from "./askRecords";

export type AskComposerType =
  | AskType
  | "hire_proposal"
  | "money_allowance_proposal";
export type AskComposerAllowancePeriod = "day" | "week" | "month";

/** Editable fields for the supported ask types and typed hire proposals. */
export type AskComposerDraft = {
  type: AskComposerType;
  title: string;
  body: string;
  threadTitle: string;
  threadContext: string;
  addresseePubkey: string;
  decideBy: string;
  options: string;
  items: string;
  hireRolePackId: string;
  hireName: string;
  hireTitle: string;
  hireReason: string;
  hireAllowance: string;
  hireAllowancePeriod: "" | "day" | "week" | "month";
  moneyEmployeePubkey: string;
  moneyDuration: "" | "permanent" | "temporary";
  moneyAllowance: string;
  moneyEndDate: string;
  moneyReason: string;
};

/** Field-level validation feedback for the create form. */
export type AskComposerErrors = Partial<Record<keyof AskComposerDraft, string>>;

/** Coordinates needed to build a channel-thread ask create action. */
export type AskComposerCoordinates = {
  channelId: string;
  threadRootEventId?: string;
  askId: string;
  hireId?: string;
};

/** Existing role and runtime details used to build a typed hire proposal. */
export type AskComposerHireContext = Pick<
  HireProposal,
  "rolePack" | "runtimeId" | "providerId" | "modelId"
>;

/** Live employee allowance head used to prepare a versioned approval ask. */
export type AskComposerMoneyAllowanceContext = {
  employeePubkey: string;
  existing?: {
    event: { id: string };
    head: {
      allowance: { amountCents: string; period: AskComposerAllowancePeriod };
      fundingOrder: string[];
    };
  };
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
    category: "general" | "hire" | "money";
    title: string;
    body?: string;
    threadRootEventId?: string;
    threadStart?: { title: string; openingContext?: string };
    addresseePubkey: string;
    decideBy?: string;
    options?: Array<{ id: string; label: string }>;
    items?: Array<{ id: string; label: string }>;
    subject?: { kind: "hire" | "companyMember"; id: string };
    hireProposal?: HireProposal;
    spendAllowanceProposal?: EmployeeAllowanceAction;
  };
};

/** Empty draft used when opening the create route. */
export const EMPTY_ASK_COMPOSER_DRAFT: AskComposerDraft = {
  type: "approval",
  title: "",
  body: "",
  threadTitle: "",
  threadContext: "",
  addresseePubkey: "",
  decideBy: "",
  options: "",
  items: "",
  hireRolePackId: "",
  hireName: "",
  hireTitle: "",
  hireReason: "",
  hireAllowance: "",
  hireAllowancePeriod: "",
  moneyEmployeePubkey: "",
  moneyDuration: "",
  moneyAllowance: "",
  moneyEndDate: "",
  moneyReason: "",
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_ID_PATTERN = /^[0-9a-f]{64}$/i;
const MAX_ALLOWANCE_CENTS = (1n << 64n) - 1n;

function allowanceCents(value: string) {
  const normalized = value.trim();
  if (normalized.length > 21) return null;
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,2}))?$/.exec(normalized);
  if (!match) return null;
  const whole = BigInt(match[1] ?? "0");
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  const cents = whole * 100n + fraction;
  return cents <= MAX_ALLOWANCE_CENTS ? cents : null;
}

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
  hire?: AskComposerHireContext,
  moneyAllowance?: AskComposerMoneyAllowanceContext,
  now = new Date(),
): AskComposerErrors {
  const errors: AskComposerErrors = {};
  if (draft.type === "hire_proposal") {
    if (
      !draft.hireRolePackId ||
      !hire ||
      hire.rolePack.personaId !== draft.hireRolePackId
    ) {
      errors.hireRolePackId = "Choose a company role pack.";
    }
    if (!draft.hireName.trim()) errors.hireName = "Add the proposed name.";
    else if (draft.hireName.trim().length > 120) {
      errors.hireName = "Use 120 characters or fewer.";
    }
    if (!draft.hireTitle.trim()) errors.hireTitle = "Add the job title.";
    else if (draft.hireTitle.trim().length > 120) {
      errors.hireTitle = "Use 120 characters or fewer.";
    }
    if (!draft.hireReason.trim()) {
      errors.hireReason =
        "A reason is required. Spaces alone are not a reason.";
    } else if (Array.from(draft.hireReason).length > 1000) {
      errors.hireReason = "Use 1,000 characters or fewer.";
    }
    if (
      !/^\d+(?:\.\d{1,2})?$/.test(draft.hireAllowance) ||
      Number(draft.hireAllowance) <= 0
    ) {
      errors.hireAllowance = "Enter a positive allowance amount.";
    }
    if (draft.hireAllowancePeriod !== "week") {
      errors.hireAllowancePeriod = "Choose an available allowance period.";
    }
    if (
      hire &&
      (!hire.runtimeId.trim() ||
        !hire.rolePack.workerMenu.includes(hire.runtimeId))
    ) {
      errors.hireRolePackId = "The selected role has no configured runtime.";
    }
  } else if (draft.type === "money_allowance_proposal") {
    if (!HEX_ID_PATTERN.test(draft.moneyEmployeePubkey)) {
      errors.moneyEmployeePubkey =
        "Choose an employee with a real allowance record.";
    } else if (
      !moneyAllowance ||
      moneyAllowance.employeePubkey.toLowerCase() !==
        draft.moneyEmployeePubkey.toLowerCase()
    ) {
      errors.moneyEmployeePubkey = "The selected employee is unavailable.";
    } else if (!moneyAllowance.existing) {
      errors.moneyEmployeePubkey =
        "Choose an employee with a configured allowance.";
    }
    if (
      draft.moneyDuration !== "permanent" &&
      draft.moneyDuration !== "temporary"
    ) {
      errors.moneyDuration = "Choose a change duration.";
    }
    const cents = allowanceCents(draft.moneyAllowance);
    if (cents === null || cents === 0n) {
      errors.moneyAllowance =
        "Enter a positive USD amount with up to two decimal places.";
    }
    if (!draft.moneyReason.trim()) {
      errors.moneyReason = "Add a reason for the allowance change.";
    } else if (Array.from(draft.moneyReason).length > 1000) {
      errors.moneyReason = "Use 1,000 characters or fewer.";
    }
    if (draft.moneyDuration === "temporary") {
      const existing = moneyAllowance?.existing;
      if (!existing) {
        errors.moneyDuration =
          "A temporary change needs a configured permanent allowance.";
      } else {
        if (
          cents !== null &&
          cents > 0n &&
          cents <= BigInt(existing.head.allowance.amountCents)
        ) {
          errors.moneyAllowance =
            "A temporary allowance must be higher than the permanent allowance.";
        }
      }
      const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(draft.moneyEndDate);
      const endDate = dateMatch
        ? new Date(`${draft.moneyEndDate}T23:59:59.999Z`)
        : null;
      const validDate = Boolean(
        dateMatch &&
          endDate &&
          Number.isFinite(endDate.getTime()) &&
          endDate.toISOString().slice(0, 10) === draft.moneyEndDate,
      );
      if (!validDate || !endDate || endDate <= now) {
        errors.moneyEndDate = "Choose a future end date.";
      }
    }
  } else {
    const title = draft.title.trim();
    if (!title) errors.title = "Add a short title.";
    else if (title.length > 180) errors.title = "Use 180 characters or fewer.";

    if (draft.body.trim().length > 4000) {
      errors.body = "Use 4,000 characters or fewer.";
    }
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
    if (coordinates.threadRootEventId) {
      if (!HEX_ID_PATTERN.test(coordinates.threadRootEventId)) {
        errors.title = "The discussion thread is unavailable.";
      }
    } else {
      const threadTitle = draft.threadTitle.trim();
      if (!threadTitle) {
        errors.threadTitle = "Add a title for the new discussion.";
      } else if (threadTitle.length > 180) {
        errors.threadTitle = "Use 180 characters or fewer.";
      }
      if (draft.threadContext.trim().length > 4000) {
        errors.threadContext = "Use 4,000 characters or fewer.";
      }
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
  hire?: AskComposerHireContext,
  moneyAllowance?: AskComposerMoneyAllowanceContext,
): AskCreateAction {
  const errors = validateAskComposerDraft(
    draft,
    coordinates,
    hire,
    moneyAllowance,
  );
  if (Object.keys(errors).length > 0) {
    throw new Error("The ask draft is not valid.");
  }

  const isHireProposal = draft.type === "hire_proposal";
  const isMoneyAllowanceProposal = draft.type === "money_allowance_proposal";
  const askType: AskType =
    draft.type === "hire_proposal" || draft.type === "money_allowance_proposal"
      ? "approval"
      : draft.type;
  let hireProposal: HireProposal | undefined;
  if (isHireProposal) {
    if (!hire) throw new Error("Choose an existing company role pack.");
    hireProposal = {
      hireId: coordinates.hireId ?? "",
      rolePack: hire.rolePack,
      displayName: draft.hireName.trim(),
      title: draft.hireTitle.trim(),
      introductionChannelId: coordinates.channelId,
      runtimeId: hire.runtimeId,
      ...(hire.providerId ? { providerId: hire.providerId } : {}),
      ...(hire.modelId ? { modelId: hire.modelId } : {}),
      weeklyAllowance: draft.hireAllowance.trim(),
    };
    if (!UUID_PATTERN.test(hireProposal.hireId)) {
      throw new Error("The hire proposal coordinates are not valid.");
    }
  }

  let spendAllowanceProposal: EmployeeAllowanceAction | undefined;
  if (isMoneyAllowanceProposal) {
    if (!moneyAllowance) {
      throw new Error("The selected employee allowance is unavailable.");
    }
    const existing = moneyAllowance.existing;
    if (!existing) {
      throw new Error("The selected employee allowance is unavailable.");
    }
    const amountCents = allowanceCents(draft.moneyAllowance);
    if (amountCents === null) {
      throw new Error("The proposed allowance amount is invalid.");
    }
    const temporary = draft.moneyDuration === "temporary";
    const expiresAt = temporary
      ? new Date(`${draft.moneyEndDate}T23:59:59.999Z`).toISOString()
      : undefined;
    spendAllowanceProposal = {
      schemaVersion: 1,
      employeePubkey: draft.moneyEmployeePubkey.toLowerCase(),
      expectedHeadEventId: existing.event.id,
      allowance: temporary
        ? existing.head.allowance
        : {
            amountCents: amountCents.toString(),
            period: existing.head.allowance.period,
          },
      ...(temporary && expiresAt
        ? {
            temporaryAllowance: {
              allowance: {
                amountCents: amountCents.toString(),
                period: existing.head.allowance.period,
              },
              expiresAt,
            },
          }
        : {}),
      fundingOrder: existing.head.fundingOrder,
    };
  }

  const decideBy = draft.decideBy
    ? new Date(draft.decideBy).toISOString()
    : undefined;
  const ask: AskCreateAction["ask"] = {
    schemaVersion: 1,
    askId: coordinates.askId,
    type: askType,
    category: isHireProposal
      ? "hire"
      : isMoneyAllowanceProposal
        ? "money"
        : "general",
    title: isHireProposal
      ? draft.hireTitle.trim()
      : isMoneyAllowanceProposal
        ? "Allowance change request"
        : draft.title.trim(),
    ...(isHireProposal
      ? { body: draft.hireReason.trim() }
      : isMoneyAllowanceProposal
        ? { body: draft.moneyReason.trim() }
        : draft.body.trim()
          ? { body: draft.body.trim() }
          : {}),
    ...(coordinates.threadRootEventId
      ? { threadRootEventId: coordinates.threadRootEventId }
      : {
          threadStart: {
            title: draft.threadTitle.trim(),
            ...(draft.threadContext.trim()
              ? { openingContext: draft.threadContext.trim() }
              : {}),
          },
        }),
    addresseePubkey: draft.addresseePubkey.toLowerCase(),
    ...(hireProposal
      ? {
          subject: { kind: "hire" as const, id: hireProposal.hireId },
          hireProposal,
        }
      : spendAllowanceProposal
        ? {
            subject: {
              kind: "companyMember" as const,
              id: spendAllowanceProposal.employeePubkey,
            },
            spendAllowanceProposal,
          }
        : decideBy
          ? { decideBy }
          : {}),
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
  threadRootEventId: string | undefined,
  askId: string,
): string[][] {
  const tags = [
    ["h", channelId],
    ["d", `channel:${channelId}:ask:${askId}`],
  ];
  if (threadRootEventId) {
    tags.push(
      ["e", threadRootEventId, "", "root"],
      ["e", threadRootEventId, "", "reply"],
    );
  }
  return tags;
}
