import {
  QUALIFY_SIGNAL_CODES,
  type QualifySignal,
} from "./businessRecordContract";

export type QualificationRunPhase =
  | "idle"
  | "running"
  | "paused"
  | "failed"
  | "completed"
  | "cancelled";

/**
 * Device-local campaign settings. The discovery relay record stays additive
 * until the relay contract explicitly grows a matching field.
 */
export type CampaignQualificationSettings = {
  enabled: boolean;
  selectedSignals: QualifySignal[];
  runId: string | null;
  phase: QualificationRunPhase;
  failureReason: string | null;
};

export type QualificationSignalDefinition = {
  signal: QualifySignal;
  group: "Website health" | "Customer reach" | "Marketing" | "Contact";
  label: string;
  description: string;
};

export const RECOMMENDED_QUALIFY_SIGNALS: QualifySignal[] =
  QUALIFY_SIGNAL_CODES.slice(0, 7);

export const QUALIFICATION_SIGNAL_DEFINITIONS: readonly QualificationSignalDefinition[] =
  [
    {
      signal: "NO_WEBSITE",
      group: "Website health",
      label: "No website",
      description: "No site, or only a Facebook, Instagram or directory page.",
    },
    {
      signal: "SITE_DOWN",
      group: "Website health",
      label: "Website not loading",
      description: "Down, timing out or showing a security error.",
    },
    {
      signal: "NO_HTTPS",
      group: "Website health",
      label: "Not secure (no padlock)",
      description: "The address starts with http, not https.",
    },
    {
      signal: "NOT_MOBILE_FRIENDLY",
      group: "Website health",
      label: "Hard to use on a phone",
      description: "The page is not set up for small screens.",
    },
    {
      signal: "NO_ONLINE_BOOKING",
      group: "Customer reach",
      label: "No online booking found",
      description:
        "We found no booking link or booking page. A guess, so Scout words it carefully.",
    },
    {
      signal: "NO_WHATSAPP_LINK",
      group: "Customer reach",
      label: "No WhatsApp button on the site",
      description: "Customers have no one-tap way to message them.",
    },
    {
      signal: "HAS_WHATSAPP_LINK",
      group: "Customer reach",
      label: "Has a WhatsApp button",
      description: "Already uses WhatsApp with customers.",
    },
    {
      signal: "RUNNING_ADS",
      group: "Marketing",
      label: "Paying for ads",
      description: "Google or Meta ad tracking found on the site.",
    },
    {
      signal: "STALE_SITE",
      group: "Marketing",
      label: "Looks out of date",
      description: "Old copyright year or no recent posts.",
    },
    {
      signal: "SITE_BUILDER",
      group: "Marketing",
      label: "Built with a site builder",
      description: "The website tool is named in the page code.",
    },
    {
      signal: "INCUMBENT_BUILDER",
      group: "Marketing",
      label: "Built by another provider",
      description: "An agency credit appeared in the footer.",
    },
    {
      signal: "SOCIAL_LINKS",
      group: "Marketing",
      label: "Social pages found",
      description: "Links to their own Facebook or Instagram.",
    },
    {
      signal: "PUBLIC_EMAIL",
      group: "Contact",
      label: "Email shown on the site",
      description: "Saved for later. Colony does not send email yet.",
    },
  ];

const RUN_PHASES = new Set<QualificationRunPhase>([
  "idle",
  "running",
  "paused",
  "failed",
  "completed",
  "cancelled",
]);

export function emptyCampaignQualificationSettings(): CampaignQualificationSettings {
  return {
    enabled: false,
    selectedSignals: [],
    runId: null,
    phase: "idle",
    failureReason: null,
  };
}

function signalsFrom(value: unknown): QualifySignal[] {
  if (!Array.isArray(value)) return [];
  const permitted = new Set<string>(QUALIFY_SIGNAL_CODES);
  return [
    ...new Set(
      value.filter(
        (signal): signal is QualifySignal =>
          typeof signal === "string" && permitted.has(signal),
      ),
    ),
  ];
}

/** Reads an additive local field without making legacy campaigns invalid. */
export function parseCampaignQualificationSettings(
  value: unknown,
): CampaignQualificationSettings {
  if (typeof value !== "object" || value === null) {
    return emptyCampaignQualificationSettings();
  }
  const raw = value as Record<string, unknown>;
  const phase =
    typeof raw.phase === "string" &&
    RUN_PHASES.has(raw.phase as QualificationRunPhase)
      ? (raw.phase as QualificationRunPhase)
      : "idle";
  return {
    enabled: raw.enabled === true,
    selectedSignals: signalsFrom(raw.selectedSignals),
    runId: typeof raw.runId === "string" && raw.runId.trim() ? raw.runId : null,
    phase,
    failureReason:
      typeof raw.failureReason === "string" && raw.failureReason.trim()
        ? raw.failureReason.trim()
        : null,
  };
}

export function cloneCampaignQualificationSettings(
  settings: CampaignQualificationSettings | null | undefined,
): CampaignQualificationSettings {
  return parseCampaignQualificationSettings(settings);
}

export function qualificationSignalDefinition(
  signal: QualifySignal,
): QualificationSignalDefinition {
  return (
    QUALIFICATION_SIGNAL_DEFINITIONS.find(
      (entry) => entry.signal === signal,
    ) ?? {
      signal,
      group: "Website health",
      label: signal,
      description: "",
    }
  );
}

export function qualificationIsConfigured(
  settings: CampaignQualificationSettings | null | undefined,
): boolean {
  const parsed = parseCampaignQualificationSettings(settings);
  return parsed.enabled && parsed.selectedSignals.length > 0;
}
