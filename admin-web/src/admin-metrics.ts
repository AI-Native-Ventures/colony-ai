export type MetricValue = number | null;

export interface MetricRange {
  days: 7 | 30 | 90;
  from: string;
  to: string;
}

export interface MetricEnvelope {
  generatedAt: string;
  dataThrough: string;
  range: MetricRange;
}

export interface MetricDelta {
  value: MetricValue;
  previous: MetricValue;
}

export interface AttentionItem {
  key: string;
  severity: "red" | "amber";
  title: string;
  detail: string;
  count: number;
  link: {
    board: "overview" | "businesses" | "business" | "ai-usage" | "health";
    params: { communityId?: string };
  };
}

export interface OverviewMetrics extends MetricEnvelope {
  kpis: {
    people: MetricDelta;
    dau: MetricDelta;
    wau: MetricDelta;
    mau: MetricDelta;
    stickinessPct: MetricDelta;
    newAccounts: MetricDelta;
  };
  series: Array<{
    day: string;
    dau: number;
    wau: number;
    mau: number;
    newAccounts: number;
    partial: boolean;
  }>;
  businesses: {
    total: number;
    archived: number;
    activeThisWeek: number;
    createdThisWeek: number;
    cofounderOn: number;
  };
  agents: {
    total: number;
    scout: number;
    activeThisWeek: number;
    answerWithin5MinPct: MetricValue;
    neverStarted: number;
  };
  ai: {
    month: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    chargedUsd: string;
    byModel: Array<{ model: string; requests: number }>;
  };
  discovery: {
    resultsThisMonth: number;
    capPerBusiness: number;
    repeatsSkipped: MetricValue;
  };
  whatsapp: { sentThisMonth: number; repliedThisMonth: number };
  needsAttention: AttentionItem[];
  unavailable: string[];
}

export type BusinessSort =
  | "active"
  | "people"
  | "agents"
  | "ai"
  | "discovery"
  | "whatsapp"
  | "created"
  | "name";

export interface BusinessRow {
  communityId: string;
  name: string;
  host: string;
  ownerName: string | null;
  createdAt: string;
  archived: boolean;
  people: number;
  agents: number;
  activeDaysLast7: number;
  aiRequests: number;
  aiChargedUsd: string;
  discoveryResultsThisMonth: number;
  discoveryCap: number;
  whatsappSentInRange: number;
  cofounderOn: boolean | null;
  health: "ok" | "warn" | "bad";
}

export interface BusinessesMetrics extends MetricEnvelope {
  total: number;
  activeThisWeek: number;
  items: BusinessRow[];
}

export type OnboardingStep =
  | "brief"
  | "money"
  | "approvals"
  | "accounts"
  | "map";

export type OnboardingStepState = "todo" | "asked" | "done" | "skipped";

export interface OnboardingProgress {
  status: "in_progress" | "complete";
  currentStep: OnboardingStep | null;
  currentStepState: OnboardingStepState | null;
  steps: Array<{ step: OnboardingStep; state: OnboardingStepState }>;
}

export interface BusinessDetailMetrics extends MetricEnvelope {
  business: {
    communityId: string;
    name: string;
    host: string;
    ownerName: string | null;
    ownerPubkeyShort: string | null;
    createdAt: string;
    archived: boolean;
    health: "ok" | "warn" | "bad";
  };
  kpis: {
    people: number;
    newPeopleThisWeek: number;
    agents: number;
    agentNames: string[];
    activeDaysLast7: number;
    discoveryResultsThisMonth: number;
    discoveryCap: number;
    whatsappSentInRange: number;
    whatsappRepliedInRange: number;
  };
  people: {
    byRole: Array<{
      role: string;
      count: number;
      lastActiveAt: string | null;
    }>;
    staleMembers: number;
  };
  agents: Array<{
    pubkeyShort: string;
    name: string;
    runtime: string | null;
    status: "running" | "idle" | "offline";
    lastEventAt: string | null;
    offlineHours: number | null;
    answerRatePct: MetricValue;
    avgAnswerSeconds: MetricValue;
  }>;
  ai: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    chargedUsd: string;
    byModel: Array<{
      model: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      chargedUsd: string;
    }>;
  };
  discovery: {
    resultsThisMonth: number;
    cap: number;
    repeatsSkipped: MetricValue;
  };
  whatsapp: {
    sent: number;
    delivered: number;
    read: number;
    failed: number;
    newChats: number;
    replied: number;
    failedByCode: Array<{ code: string; count: number }>;
  };
  cofounder: {
    on: boolean | null;
    onSince: string | null;
    onboarding: OnboardingProgress | null;
    wakes: { delivered: number; skipped: number; pending: number };
    lastWake: { at: string; status: string; reason: string } | null;
    skippedByOutcome: Array<{ outcome: string; count: number }>;
  };
  problems: {
    gatewayRefusals: number;
    whatsappFailed: number;
    skippedWakes: number;
  };
  series: Array<{
    day: string;
    activePeople: number;
    agentsActive: number;
    aiRequests: number;
    partial: boolean;
  }>;
  unavailable: string[];
}

export interface AiUsageMetrics extends MetricEnvelope {
  kpis: {
    requests: MetricDelta;
    inputTokens: MetricDelta;
    outputTokens: MetricDelta;
    chargedUsd: { value: string | null; previous: string | null };
    refusedOrTimedOutPct: MetricDelta;
    sessions: MetricDelta;
  };
  models: string[];
  series: Array<{
    day: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    chargedUsd: string;
    partial: boolean;
    byModel: Record<string, number>;
  }>;
  gatewayOutcomes: {
    settled: number;
    handedToNextModel: number;
    refused: number;
    timedOut: number;
    other: number;
  } | null;
  topBusinesses: Array<{
    communityId: string;
    name: string;
    requests: number;
  }>;
  notCounted: string;
  unavailable: string[];
}

export interface HealthMetrics {
  generatedAt: string;
  dataThrough: string;
  relay: {
    status: string;
    version: string;
    startedAt: string;
    uptimePct7d: MetricValue;
  };
  connections: { now: number; scope: string };
  cofounderWakes: {
    last24h: { delivered: number; skipped: number; pending: number };
    allTime: { delivered: number; skipped: number; pending: number };
    byOutcome: Array<{
      status: string;
      outcome: string;
      count: number;
      lastAt: string | null;
    }>;
  };
  agents: {
    answerWithin5MinPct: MetricValue;
    previousPct: MetricValue;
    businessesNotAnswering: number;
  };
  whatsapp: {
    failedToday: number;
    failedLast7d: number;
    failedByCode: Array<{ code: string; count: number }>;
  };
  relayErrors: {
    last24h: number;
    byRoute: Array<{ route: string; errors5xx: number; requests: number }>;
  };
  queues: {
    cofounderWakesPending: number;
    aiRequestsPending: number;
    aiRequestsStuck: number;
    whatsappQueued: number;
  };
  checks: Array<{
    key: string;
    label: string;
    status: "ok" | "warn" | "bad" | "unknown";
    value: string;
  }>;
  desktopVersions: Array<{ version: string; people: number }>;
  needsAttention: AttentionItem[];
  unavailable: string[];
}

export interface OperatorProbe {
  role: "operator" | "moderator" | null;
  source?: "config" | "owner_fallback" | "db" | null;
}
