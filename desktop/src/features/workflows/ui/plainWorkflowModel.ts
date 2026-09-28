export type PlainFrequency = "weekly" | "daily" | "manual";

export type PlainSchedule = {
  frequency: PlainFrequency;
  day: number;
  time: string;
};

export type PlainAgentStep = {
  id: string;
  kind: "agent";
  title: string;
  assigneePubkey: string;
  instruction: string;
  expectedResult: string;
};

export type PlainApprovalStep = {
  id: string;
  kind: "approval";
  title: string;
  reviewerPubkey: string;
  message: string;
};

export type PlainWorkflowDraft = {
  workflowId: string;
  channelId: string;
  name: string;
  description: string;
  schedule: PlainSchedule;
  steps: PlainWorkflowStep[];
};

export type PlainWorkflowStep = PlainAgentStep | PlainApprovalStep;

export type PlainWorkflowMapping =
  | {
      supported: true;
      draft: Omit<PlainWorkflowDraft, "workflowId" | "channelId">;
    }
  | { supported: false; reasons: string[] };

const PUBKEY = /^[0-9a-f]{64}$/i;
const CRON_DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parseTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}

function normalizeDay(day: number) {
  return ((day % 7) + 7) % 7;
}

/** Converts Johannesburg wall time to the UTC cron supported by the engine. */
export function plainScheduleToCron(schedule: PlainSchedule): string | null {
  if (schedule.frequency === "manual") return null;
  const time = parseTime(schedule.time);
  if (!time) throw new Error("Choose a valid time.");
  const utcHour = (time.hour - 2 + 24) % 24;
  const previousDay = normalizeDay(schedule.day - (time.hour < 2 ? 1 : 0));
  const day = schedule.frequency === "weekly" ? previousDay : "*";
  return `${time.minute} ${utcHour} * * ${day}`;
}

/** Converts the builder's intentionally narrow schedule shape back to local time. */
export function plainScheduleFromCron(cron: string): PlainSchedule | null {
  const match = /^(\d{1,2}) (\d{1,2}) \* \* (\*|[0-6])$/.exec(cron.trim());
  if (!match) return null;
  const minute = Number(match[1]);
  const utcHour = Number(match[2]);
  if (minute > 59 || utcHour > 23) return null;
  const localHour = (utcHour + 2) % 24;
  const crossesWeekday = utcHour >= 22;
  const utcDay = match[3] === "*" ? null : Number(match[3]);
  const localDay =
    utcDay === null ? 1 : normalizeDay(utcDay + (crossesWeekday ? 1 : 0));
  return {
    frequency: utcDay === null ? "daily" : "weekly",
    day: localDay,
    time: `${String(localHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
  };
}

export function plainDayName(day: number): string {
  return CRON_DAY_NAMES[normalizeDay(day)];
}

export function plainScheduleDescription(schedule: PlainSchedule): string {
  if (schedule.frequency === "manual") return "When I start it";
  const time = parseTime(schedule.time);
  if (!time) return "Choose a start time";
  const formatted = new Intl.DateTimeFormat("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2026, 0, 1, time.hour, time.minute)));
  return schedule.frequency === "weekly"
    ? `Every ${plainDayName(schedule.day)} at ${formatted} · Johannesburg time`
    : `Every day at ${formatted} · Johannesburg time`;
}

export function plainDraftToDefinition(
  draft: Pick<
    PlainWorkflowDraft,
    "name" | "description" | "schedule" | "steps"
  >,
): Record<string, unknown> {
  const name = draft.name.trim();
  if (!name) throw new Error("Add a workflow name.");
  if (draft.steps.length === 0) throw new Error("Add at least one step.");
  const cron = plainScheduleToCron(draft.schedule);
  const steps = draft.steps.map((step) => {
    if (step.kind === "agent") {
      if (!PUBKEY.test(step.assigneePubkey)) {
        throw new Error("Choose an agent for every preparation step.");
      }
      if (!step.instruction.trim())
        throw new Error("Describe what the agent should do.");
      return {
        id: step.id,
        name: step.title.trim() || undefined,
        timeout_secs: 900,
        action: "ask_agent",
        agent_pubkey: step.assigneePubkey.toLowerCase(),
        instruction: step.instruction.trim(),
        expected_result: step.expectedResult.trim() || undefined,
      };
    }
    if (!PUBKEY.test(step.reviewerPubkey)) {
      throw new Error("Choose a reviewer for every approval step.");
    }
    if (!step.message.trim())
      throw new Error("Describe what the reviewer should approve.");
    return {
      id: step.id,
      name: step.title.trim() || undefined,
      action: "request_approval",
      from: step.reviewerPubkey.toLowerCase(),
      message: step.message.trim(),
    };
  });
  return {
    name,
    description: draft.description.trim() || undefined,
    enabled: true,
    trigger: cron === null ? { on: "manual" } : { on: "schedule", cron },
    steps,
  };
}

export function definitionToPlainDraft(
  definitionValue: unknown,
): PlainWorkflowMapping {
  const reasons = new Set<string>();
  const definition = record(definitionValue);
  if (!definition)
    return {
      supported: false,
      reasons: ["The workflow definition is unavailable."],
    };
  if (
    !hasOnlyKeys(definition, [
      "name",
      "description",
      "enabled",
      "trigger",
      "steps",
    ])
  ) {
    reasons.add("It contains settings the plain builder does not edit.");
  }
  if (typeof definition.name !== "string" || !definition.name.trim()) {
    reasons.add("It has no workflow name.");
  }
  if (
    definition.description !== undefined &&
    typeof definition.description !== "string"
  ) {
    reasons.add("Its description cannot be shown in the plain builder.");
  }
  if (definition.enabled === false)
    reasons.add("Its run state is stored in the workflow definition.");

  const trigger = record(definition.trigger);
  let schedule: PlainSchedule = { frequency: "manual", day: 1, time: "08:00" };
  if (!trigger) {
    reasons.add("Its start condition is not supported by the plain builder.");
  } else if (!hasOnlyKeys(trigger, ["on", "cron"])) {
    reasons.add(
      "Its start condition has extra rules the plain builder does not edit.",
    );
  } else if (trigger.on === "manual") {
    if (Object.keys(trigger).length !== 1)
      reasons.add(
        "Its start condition has extra rules the plain builder does not edit.",
      );
  } else if (trigger.on === "schedule" && typeof trigger.cron === "string") {
    const parsed = plainScheduleFromCron(trigger.cron);
    if (parsed) schedule = parsed;
    else
      reasons.add(
        "Its schedule uses a pattern the plain builder cannot represent.",
      );
  } else {
    reasons.add("Its start condition is not supported by the plain builder.");
  }

  const sourceSteps = Array.isArray(definition.steps) ? definition.steps : null;
  if (!sourceSteps || sourceSteps.length === 0) {
    reasons.add("It needs at least one supported step.");
  }
  const steps: PlainWorkflowStep[] = [];
  for (const [index, value] of (sourceSteps ?? []).entries()) {
    const step = record(value);
    if (
      !step ||
      typeof step.id !== "string" ||
      typeof step.action !== "string"
    ) {
      reasons.add(`Step ${index + 1} is not supported by the plain builder.`);
      continue;
    }
    if (step.if !== undefined)
      reasons.add(
        `Step ${index + 1} has a condition the plain builder does not edit.`,
      );
    if (step.timeout_secs !== undefined && step.timeout_secs !== 900) {
      reasons.add(
        `Step ${index + 1} has a custom timeout the plain builder does not edit.`,
      );
    }
    const title = typeof step.name === "string" ? step.name : "";
    if (step.action === "ask_agent") {
      if (
        !hasOnlyKeys(step, [
          "id",
          "name",
          "timeout_secs",
          "action",
          "agent_pubkey",
          "instruction",
          "expected_result",
        ])
      ) {
        reasons.add(
          `Step ${index + 1} has settings the plain builder does not edit.`,
        );
      }
      if (
        typeof step.agent_pubkey !== "string" ||
        !PUBKEY.test(step.agent_pubkey) ||
        typeof step.instruction !== "string"
      ) {
        reasons.add(
          `Step ${index + 1} does not have a named channel agent and instructions.`,
        );
        continue;
      }
      steps.push({
        id: step.id,
        kind: "agent",
        title,
        assigneePubkey: step.agent_pubkey.toLowerCase(),
        instruction: step.instruction,
        expectedResult:
          typeof step.expected_result === "string" ? step.expected_result : "",
      });
    } else if (step.action === "request_approval") {
      if (!hasOnlyKeys(step, ["id", "name", "action", "from", "message"])) {
        reasons.add(
          `Step ${index + 1} has settings the plain builder does not edit.`,
        );
      }
      if (
        typeof step.from !== "string" ||
        !PUBKEY.test(step.from) ||
        typeof step.message !== "string"
      ) {
        reasons.add(`Step ${index + 1} does not name an individual reviewer.`);
        continue;
      }
      steps.push({
        id: step.id,
        kind: "approval",
        title,
        reviewerPubkey: step.from.toLowerCase(),
        message: step.message,
      });
    } else {
      reasons.add(
        `Step ${index + 1} uses an action the plain builder does not support.`,
      );
    }
  }

  if (reasons.size > 0) return { supported: false, reasons: [...reasons] };
  return {
    supported: true,
    draft: {
      name: definition.name as string,
      description:
        typeof definition.description === "string"
          ? definition.description
          : "",
      schedule,
      steps,
    },
  };
}
