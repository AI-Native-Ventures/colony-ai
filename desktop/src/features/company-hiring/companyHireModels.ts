import { verifyEvent } from "nostr-tools/pure";

import type { HireProposal } from "@/features/company-asks/askRecords";
import type { AgentPersona } from "@/shared/api/types";
import type { RelayEvent } from "@/shared/api/types";
import { KIND_HIRE_HEAD } from "@/shared/constants/kinds";

export const COMPANY_HIRE_SCHEMA_VERSION = 1;
export const COMPANY_HIRE_HEAD_QUERY_LIMIT = 1_000;

export type HireStatus =
  | "proposed"
  | "awaiting_founder"
  | "approved"
  | "hired"
  | "denied";

export type CompanyHireHead = {
  schemaVersion: number;
  proposal: HireProposal;
  status: HireStatus;
  proposedByPubkey: string;
  sourceAskId?: string;
  sourceAskChannelId?: string;
  founderPubkey?: string;
  employeePubkey?: string;
  introductionEventId?: string;
  denialReason?: string;
  sourceActionEventId: string;
};

export type CompanyHireHeadRecord = {
  dTag: string;
  event: RelayEvent;
  head: CompanyHireHead;
};

export type CompanyHireActionKind =
  | "create"
  | "update"
  | "approve"
  | "attach_employee"
  | "complete"
  | "deny";

export type CompanyHireAction = {
  schemaVersion: number;
  hireId: string;
  action: CompanyHireActionKind;
  expectedHeadEventId?: string;
  proposal?: HireProposal;
  employeePubkey?: string;
  introductionEventId?: string;
  reason?: string;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64_RE = /^[0-9a-f]{64}$/;
const STATUSES = new Set<HireStatus>([
  "proposed",
  "awaiting_founder",
  "approved",
  "hired",
  "denied",
]);
const ACTIONS = new Set<CompanyHireActionKind>([
  "create",
  "update",
  "approve",
  "attach_employee",
  "complete",
  "deny",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function parseProposal(value: unknown): HireProposal | null {
  if (!isObject(value) || !isObject(value.rolePack)) return null;
  const rolePack = value.rolePack;
  if (
    !hasOnlyKeys(value, [
      "hireId",
      "rolePack",
      "displayName",
      "title",
      "managerPubkey",
      "introductionChannelId",
      "runtimeId",
      "providerId",
      "modelId",
      "weeklyAllowance",
    ]) ||
    !hasOnlyKeys(rolePack, [
      "personaId",
      "title",
      "job",
      "skills",
      "tools",
      "workerMenu",
      "defaultAllowance",
    ]) ||
    typeof value.hireId !== "string" ||
    !UUID_RE.test(value.hireId) ||
    typeof value.displayName !== "string" ||
    !value.displayName.trim() ||
    typeof value.title !== "string" ||
    !value.title.trim() ||
    (value.managerPubkey !== undefined &&
      (typeof value.managerPubkey !== "string" ||
        !HEX64_RE.test(value.managerPubkey))) ||
    typeof value.introductionChannelId !== "string" ||
    !UUID_RE.test(value.introductionChannelId) ||
    typeof value.runtimeId !== "string" ||
    !value.runtimeId.trim() ||
    (value.providerId !== undefined &&
      (typeof value.providerId !== "string" || !value.providerId.trim())) ||
    (value.modelId !== undefined &&
      (typeof value.modelId !== "string" || !value.modelId.trim())) ||
    (value.weeklyAllowance !== undefined &&
      (typeof value.weeklyAllowance !== "string" ||
        !/^\d+(?:\.\d{1,2})?$/.test(value.weeklyAllowance) ||
        Number(value.weeklyAllowance) <= 0)) ||
    typeof rolePack.personaId !== "string" ||
    !rolePack.personaId.trim() ||
    typeof rolePack.title !== "string" ||
    !rolePack.title.trim() ||
    typeof rolePack.job !== "string" ||
    !rolePack.job.trim() ||
    !Array.isArray(rolePack.skills) ||
    !rolePack.skills.every(
      (skill) => typeof skill === "string" && skill.trim().length > 0,
    ) ||
    !Array.isArray(rolePack.tools) ||
    !rolePack.tools.every(
      (tool) =>
        isObject(tool) &&
        hasOnlyKeys(tool, ["name", "risk"]) &&
        typeof tool.name === "string" &&
        tool.name.trim().length > 0 &&
        (tool.risk === "low" || tool.risk === "medium" || tool.risk === "high"),
    ) ||
    !Array.isArray(rolePack.workerMenu) ||
    rolePack.workerMenu.length === 0 ||
    !rolePack.workerMenu.every(
      (worker) => typeof worker === "string" && worker.trim().length > 0,
    ) ||
    (rolePack.defaultAllowance !== undefined &&
      (typeof rolePack.defaultAllowance !== "string" ||
        !/^\d+(?:\.\d{1,2})?$/.test(rolePack.defaultAllowance) ||
        Number(rolePack.defaultAllowance) <= 0))
  ) {
    return null;
  }
  return value as unknown as HireProposal;
}

export function companyHireRolePackFromPersona(
  persona: AgentPersona,
): HireProposal["rolePack"] | null {
  const role = persona.companyRole;
  if (
    !role ||
    !persona.isActive ||
    typeof role.job !== "string" ||
    !role.job.trim() ||
    !Array.isArray(role.skills) ||
    !Array.isArray(role.tools) ||
    !Array.isArray(role.workerMenu) ||
    role.workerMenu.length === 0
  ) {
    return null;
  }
  return {
    personaId: persona.id,
    title: persona.displayName,
    job: role.job,
    skills: [...role.skills],
    tools: role.tools.map((tool) => ({ name: tool.name, risk: tool.risk })),
    workerMenu: [...role.workerMenu],
  };
}

function parseHead(value: unknown): CompanyHireHead | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "proposal",
      "status",
      "proposedByPubkey",
      "sourceAskId",
      "sourceAskChannelId",
      "founderPubkey",
      "employeePubkey",
      "introductionEventId",
      "denialReason",
      "sourceActionEventId",
    ]) ||
    value.schemaVersion !== COMPANY_HIRE_SCHEMA_VERSION ||
    !parseProposal(value.proposal) ||
    typeof value.status !== "string" ||
    !STATUSES.has(value.status as HireStatus) ||
    typeof value.proposedByPubkey !== "string" ||
    !HEX64_RE.test(value.proposedByPubkey) ||
    (value.sourceAskId !== undefined &&
      (typeof value.sourceAskId !== "string" ||
        !UUID_RE.test(value.sourceAskId))) ||
    (value.sourceAskChannelId !== undefined &&
      (typeof value.sourceAskChannelId !== "string" ||
        !UUID_RE.test(value.sourceAskChannelId))) ||
    (value.sourceAskId === undefined) !==
      (value.sourceAskChannelId === undefined) ||
    (value.founderPubkey !== undefined &&
      (typeof value.founderPubkey !== "string" ||
        !HEX64_RE.test(value.founderPubkey))) ||
    (value.employeePubkey !== undefined &&
      (typeof value.employeePubkey !== "string" ||
        !HEX64_RE.test(value.employeePubkey))) ||
    (value.introductionEventId !== undefined &&
      (typeof value.introductionEventId !== "string" ||
        !HEX64_RE.test(value.introductionEventId))) ||
    (value.denialReason !== undefined &&
      typeof value.denialReason !== "string") ||
    typeof value.sourceActionEventId !== "string" ||
    !HEX64_RE.test(value.sourceActionEventId)
  ) {
    return null;
  }
  const proposal = parseProposal(value.proposal);
  if (!proposal || proposal.hireId === "") return null;
  if (
    (value.status === "approved" || value.status === "hired") &&
    typeof value.founderPubkey !== "string"
  ) {
    return null;
  }
  if (
    (value.employeePubkey !== undefined &&
      value.status !== "approved" &&
      value.status !== "hired") ||
    (value.introductionEventId !== undefined &&
      value.employeePubkey === undefined) ||
    (value.status === "hired" &&
      (value.employeePubkey === undefined ||
        value.introductionEventId === undefined))
  ) {
    return null;
  }
  return value as unknown as CompanyHireHead;
}

export function companyHireDTag(hireId: string) {
  if (!UUID_RE.test(hireId)) {
    throw new Error("Hire coordinates require a hire UUID.");
  }
  return `company:hire:${hireId.toLowerCase()}`;
}

export function parseCompanyHireHeadEvent(
  event: RelayEvent,
  relaySelfPubkey: string,
  expectedHireId?: string,
): CompanyHireHeadRecord | null {
  if (
    event.kind !== KIND_HIRE_HEAD ||
    event.pubkey.toLowerCase() !== relaySelfPubkey.toLowerCase()
  ) {
    return null;
  }
  try {
    if (!verifyEvent(event)) return null;
  } catch {
    return null;
  }
  const dTags = event.tags.filter((tag) => tag[0] === "d");
  if (event.tags.length !== 1 || dTags.length !== 1 || dTags[0]?.length !== 2) {
    return null;
  }
  let content: unknown;
  try {
    content = JSON.parse(event.content) as unknown;
  } catch {
    return null;
  }
  const head = parseHead(content);
  const dTag = dTags[0][1];
  if (
    !head ||
    head.proposal.hireId !== dTag?.slice("company:hire:".length) ||
    dTag !== companyHireDTag(head.proposal.hireId) ||
    (expectedHireId !== undefined &&
      head.proposal.hireId.toLowerCase() !== expectedHireId.toLowerCase())
  ) {
    return null;
  }
  return { dTag, event, head };
}

export function parseCompanyHireAction(
  value: unknown,
): CompanyHireAction | null {
  if (
    !isObject(value) ||
    !hasOnlyKeys(value, [
      "schemaVersion",
      "hireId",
      "action",
      "expectedHeadEventId",
      "proposal",
      "employeePubkey",
      "introductionEventId",
      "reason",
    ]) ||
    value.schemaVersion !== COMPANY_HIRE_SCHEMA_VERSION ||
    typeof value.hireId !== "string" ||
    !UUID_RE.test(value.hireId) ||
    typeof value.action !== "string" ||
    !ACTIONS.has(value.action as CompanyHireActionKind) ||
    (value.expectedHeadEventId !== undefined &&
      (typeof value.expectedHeadEventId !== "string" ||
        !HEX64_RE.test(value.expectedHeadEventId))) ||
    (value.employeePubkey !== undefined &&
      (typeof value.employeePubkey !== "string" ||
        !HEX64_RE.test(value.employeePubkey))) ||
    (value.introductionEventId !== undefined &&
      (typeof value.introductionEventId !== "string" ||
        !HEX64_RE.test(value.introductionEventId))) ||
    (value.reason !== undefined && typeof value.reason !== "string")
  ) {
    return null;
  }
  const action = value.action as CompanyHireActionKind;
  const hasHead = value.expectedHeadEventId !== undefined;
  const proposal =
    value.proposal === undefined ? null : parseProposal(value.proposal);
  if (value.proposal !== undefined && !proposal) return null;
  if (action === "create") {
    return !hasHead &&
      proposal?.hireId === value.hireId &&
      value.employeePubkey === undefined &&
      value.introductionEventId === undefined &&
      value.reason === undefined
      ? (value as unknown as CompanyHireAction)
      : null;
  }
  if (action === "update") {
    return hasHead &&
      proposal?.hireId === value.hireId &&
      value.employeePubkey === undefined &&
      value.introductionEventId === undefined &&
      value.reason === undefined
      ? (value as unknown as CompanyHireAction)
      : null;
  }
  if (!hasHead || value.proposal !== undefined) return null;
  if (action === "approve") {
    return value.employeePubkey === undefined &&
      value.introductionEventId === undefined &&
      value.reason === undefined
      ? (value as unknown as CompanyHireAction)
      : null;
  }
  if (action === "attach_employee") {
    return typeof value.employeePubkey === "string" &&
      value.introductionEventId === undefined &&
      value.reason === undefined
      ? (value as unknown as CompanyHireAction)
      : null;
  }
  if (action === "complete") {
    return typeof value.employeePubkey === "string" &&
      typeof value.introductionEventId === "string" &&
      value.reason === undefined
      ? (value as unknown as CompanyHireAction)
      : null;
  }
  return typeof value.reason === "string" &&
    value.reason.trim().length > 0 &&
    value.employeePubkey === undefined &&
    value.introductionEventId === undefined
    ? (value as unknown as CompanyHireAction)
    : null;
}
