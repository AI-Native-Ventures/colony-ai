import type {
  AgentPersona,
  CompanyRoleMetadata,
  CreatePersonaInput,
} from "@/shared/api/types";
import type { HireProposal } from "@/features/company-asks/askRecords";
import { companyHireRolePackFromPersona } from "./companyHireModels";

/**
 * Built-in roles for the Hire catalog. A business never has to write a role
 * pack: every role below is always on offer, and becomes a real persona the
 * first time someone configures or proposes it. Hiring then runs on that
 * persona exactly as it does for any other role pack.
 */
export type BuiltInRole = {
  /** Stable catalog id, shown until the role has a persona of its own. */
  id: string;
  displayName: string;
  /** Short public description kept on the persona. */
  description: string;
  companyRole: CompanyRoleMetadata;
  /** Instructions the persona starts with. */
  systemPrompt: string;
};

/**
 * Harnesses a new employee of any built-in role may run on. The Roles catalog
 * and Configure only offer the ones installed on this Mac.
 */
const WORKERS = ["claude", "codex", "buzz-agent"];

const ASK_RULE =
  "When something needs a decision, raise an ask in the thread and mention the person who should decide.";

const CHAT_RULE =
  "In chat, talk like a person: send one short message per request, only the result, a blocker or one question, and never a progress update. Answer first in one to three short sentences, in plain words, at most 50 words, with no headings or bullet lists unless asked and at most one question per reply. Put anything the person asked to read or use (an article, a draft, code) in a fenced block after one short line: a doc fence for prose, a fence with the language for code. Offer any other long detail in one short line.";

export const BUILT_IN_ROLES: readonly BuiltInRole[] = [
  {
    id: "built-in-role-hospitality-researcher",
    displayName: "Hospitality researcher",
    description:
      "Researches hospitality businesses and markets and reports what it finds.",
    companyRole: {
      job: "Hospitality research",
      skills: ["Market research", "Synthesis"],
      tools: [{ name: "Web search", risk: "low" }],
      workerMenu: WORKERS,
    },
    systemPrompt: `You are a hospitality researcher for the company. Find and read reliable sources about hospitality businesses and markets, then report what you found in plain words, keeping the source for each fact in a document rather than in chat. Say clearly when something could not be confirmed. Never contact anyone outside the company. ${ASK_RULE} ${CHAT_RULE}`,
  },
  {
    id: "built-in-role-social-media-manager",
    displayName: "Social media manager",
    description:
      "Plans, writes and schedules social content for the company's clients.",
    companyRole: {
      job: "Client social content",
      skills: ["Content planning", "Captions", "Scheduling"],
      tools: [
        { name: "Web search", risk: "low" },
        { name: "Social publishing", risk: "high" },
      ],
      workerMenu: WORKERS,
    },
    systemPrompt: `You are a social media manager for the company. Plan content for each client, write captions in the client's own voice and prepare a posting schedule. Draft first: nothing is published until a person approves it. Keep each client's brand notes and past posts in mind. ${ASK_RULE} ${CHAT_RULE}`,
  },
  {
    id: "built-in-role-bookkeeper",
    displayName: "Bookkeeper",
    description:
      "Keeps invoices and payments reconciled and the records clean.",
    companyRole: {
      job: "Invoices and reconciliation",
      skills: ["Reconciliation", "Invoicing"],
      tools: [{ name: "Money records", risk: "medium" }],
      workerMenu: WORKERS,
    },
    systemPrompt: `You are the bookkeeper for the company. Keep invoices, payments and client balances accurate. Match each payment to its invoice, flag anything that does not add up and never guess an amount: if a figure is missing, say it is missing. You prepare invoices and reminders as drafts for a person to approve. ${ASK_RULE} ${CHAT_RULE}`,
  },
  {
    id: "built-in-role-chief-of-staff",
    displayName: "Chief of Staff",
    description: "Coordinates the team's work and keeps open decisions moving.",
    companyRole: {
      job: "Coordinating the team",
      skills: ["Planning", "Delegation", "Follow-up"],
      tools: [{ name: "Team messages", risk: "medium" }],
      workerMenu: WORKERS,
    },
    systemPrompt: `You are the chief of staff for the company. Coordinate work across the team: route each request to the right teammate, follow up on anything that has gone quiet and keep the founder's open decisions moving. Welcome new teammates and show them around. Report results in short, plain messages. ${ASK_RULE} ${CHAT_RULE}`,
  },
  {
    id: "built-in-role-business-development",
    displayName: "Business development",
    description:
      "Finds and qualifies new clients and prepares the first conversation.",
    companyRole: {
      job: "Finding and qualifying clients",
      skills: ["Prospecting", "Lead qualification", "Outreach drafts"],
      tools: [
        { name: "Web search", risk: "low" },
        { name: "Lead records", risk: "medium" },
      ],
      workerMenu: WORKERS,
    },
    systemPrompt: `You are business development for the company. Find independent businesses that fit the services we offer, qualify each one (the need, the contact and the budget range) and keep the source and your notes with every lead. Never guess a price: if a fact is missing, say it is missing. Do not contact anyone outside the company without approval. ${ASK_RULE} ${CHAT_RULE}`,
  },
  {
    id: "built-in-role-writer",
    displayName: "Writer",
    description: "Drafts and edits copy in the company's voice.",
    companyRole: {
      job: "Drafting and editing copy",
      skills: ["Drafting", "Editing", "Tone of voice"],
      tools: [{ name: "Web search", risk: "low" }],
      workerMenu: WORKERS,
    },
    systemPrompt: `You are a writer for the company. Draft and edit copy in the company's voice: clear, warm and short. Check every fact you use and keep the source. Hand drafts back for review and never send or publish anything yourself. ${ASK_RULE} ${CHAT_RULE}`,
  },
];

type RolePack = HireProposal["rolePack"];

/** One card of the catalog: a real role pack, or a built-in not yet added. */
export type RoleCatalogEntry = {
  /** The persona, or a persona-shaped stand-in for a built-in role. */
  persona: AgentPersona;
  rolePack: RolePack;
  /** Set while the role has no persona of its own yet. */
  builtIn: BuiltInRole | null;
};

/** Case and spacing never make two roles different. */
export function roleKey(displayName: string) {
  return displayName.trim().replace(/\s+/g, " ").toLowerCase();
}

export function isBuiltInRoleId(id: string) {
  return BUILT_IN_ROLES.some((role) => role.id === id);
}

/** The persona that already stands for a built-in role, if the business has one. */
export function findRolePersona(
  personas: readonly AgentPersona[],
  role: BuiltInRole,
): AgentPersona | null {
  const key = roleKey(role.displayName);
  return (
    personas.find(
      (persona) =>
        companyHireRolePackFromPersona(persona) !== null &&
        roleKey(persona.displayName) === key,
    ) ?? null
  );
}

function standInPersona(role: BuiltInRole): AgentPersona {
  return {
    id: role.id,
    displayName: role.displayName,
    avatarUrl: null,
    description: role.description,
    companyRole: role.companyRole,
    systemPrompt: role.systemPrompt,
    runtime: null,
    model: null,
    provider: null,
    namePool: [],
    isBuiltIn: false,
    isActive: true,
    shared: false,
    envVars: {},
    respondTo: null,
    respondToAllowlist: [],
    parallelism: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * The Roles catalog: the business's own role packs first, then every built-in
 * role it does not have yet.
 */
export function buildRoleCatalog(
  personas: readonly AgentPersona[],
  builtIns: readonly BuiltInRole[] = BUILT_IN_ROLES,
): RoleCatalogEntry[] {
  const own = personas.flatMap((persona) => {
    const rolePack = companyHireRolePackFromPersona(persona);
    return rolePack ? [{ persona, rolePack, builtIn: null }] : [];
  });
  const added = builtIns.flatMap((role) => {
    if (findRolePersona(personas, role)) return [];
    const persona = standInPersona(role);
    const rolePack = companyHireRolePackFromPersona(persona);
    return rolePack ? [{ persona, rolePack, builtIn: role }] : [];
  });
  return [...own, ...added];
}

/** What the persona of a built-in role is created from. */
export function builtInRoleInput(role: BuiltInRole): CreatePersonaInput {
  return {
    displayName: role.displayName,
    description: role.description,
    companyRole: {
      job: role.companyRole.job,
      skills: [...role.companyRole.skills],
      tools: role.companyRole.tools.map((tool) => ({ ...tool })),
      workerMenu: [...role.companyRole.workerMenu],
      ...(role.companyRole.defaultAllowance
        ? { defaultAllowance: role.companyRole.defaultAllowance }
        : {}),
    },
    systemPrompt: role.systemPrompt,
  };
}

const inFlight = new Map<string, Promise<string>>();

/**
 * Gives a built-in role its persona and returns the persona's id. Safe to call
 * twice, at once or on a second hire: a persona the business already has for
 * the role is reused, and calls that overlap share one creation.
 */
export function materializeBuiltInRole(
  role: BuiltInRole,
  deps: {
    /** The business's personas, read fresh. */
    listPersonas: () => Promise<readonly AgentPersona[]>;
    createPersona: (input: CreatePersonaInput) => Promise<AgentPersona>;
    /** Keeps two communities' creations apart. */
    scope?: string;
  },
): Promise<string> {
  const key = `${deps.scope ?? ""}:${role.id}`;
  const running = inFlight.get(key);
  if (running) return running;
  const work = (async () => {
    const existing = findRolePersona(await deps.listPersonas(), role);
    if (existing) return existing.id;
    return (await deps.createPersona(builtInRoleInput(role))).id;
  })().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, work);
  return work;
}
