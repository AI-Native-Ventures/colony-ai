import type {
  AcpRuntimeCatalogEntry,
  ManagedAgent,
  ManagedAgentRuntimeStatus,
  RuntimeConfigSurface,
} from "@/shared/api/types";
import type { TeamMember } from "./teamModels";
import type { OpenRouterOutcome } from "@/shared/api/tauriOpenRouter";
import {
  PERSONA_LLM_PROVIDER_OPTIONS,
  requiredCredentialEnvKeys,
} from "@/features/agents/ui/agentConfigOptions";

/** Runtime evidence is separate from the employee's company position. */
export function employeeRuntimeStatus(
  member: Pick<TeamMember, "managedAgent" | "relayAgent">,
  runtime: ManagedAgentRuntimeStatus | undefined,
  working: boolean,
  failed = false,
): string {
  if (
    failed ||
    runtime?.lifecycle === "failed" ||
    runtime?.localSetup === false
  )
    return "Needs attention";
  if (
    runtime?.lifecycle === "stopped" ||
    (!runtime &&
      (member.managedAgent?.status === "stopped" ||
        member.managedAgent?.status === "not_deployed"))
  )
    return "Offline";
  if (working) return "Working";
  if (runtime?.lifecycle === "ready" || runtime?.lifecycle === "listening")
    return "Ready";
  if (runtime) return "Needs attention";
  if (
    member.relayAgent?.status === "online" ||
    member.relayAgent?.status === "away"
  )
    return "Ready";
  if (member.relayAgent?.status === "offline") return "Offline";
  return "Needs attention";
}

/** Prefer published artwork, then instance artwork, then the definition. */
export function employeeAvatarSource(input: {
  profile?: string | null;
  instance?: string | null;
  definition?: string | null;
  personaId?: string | null;
  name: string;
  scoutArt: string;
}): string | null {
  const scout =
    input.personaId === "builtin:fizz" ||
    input.name.trim().toLowerCase() === "scout";
  return (
    input.profile?.trim() ||
    input.instance?.trim() ||
    (scout ? input.scoutArt : input.definition?.trim()) ||
    null
  );
}

/** Keep legacy protocol identifiers out of the harness display label. */
export function employeeHarnessLabel(label: string | null | undefined): string {
  return (
    label?.replace(/\bBuzz Agent\b/gi, "Colony Agent").trim() || "Not reported"
  );
}

/** Only named model fields are projected; personal config keys never enter this view model. */
export function employeeModelFields(surface: RuntimeConfigSurface | undefined) {
  const config = surface?.normalized;
  return {
    model: config?.model?.value?.trim() || "Not reported",
    effort: config?.thinkingEffort?.value?.trim() || "Not reported",
    outputLimit: config?.maxOutputTokens?.value?.trim() || null,
    contextLimit: config?.contextLimit?.value?.trim() || null,
  };
}

/** Report account authentication separately from unreported billing and usage. */
export function employeeFundingSource(
  agent: ManagedAgent | null,
  runtime: AcpRuntimeCatalogEntry | undefined,
  provider?: string | null,
  openRouter?: OpenRouterOutcome,
) {
  if (!agent || !runtime)
    return {
      source: "Connection not reported",
      state: "Connection status unavailable",
    };
  const auth = runtime.authStatus.status;
  if (auth !== "not_applicable") {
    return {
      source: `${employeeHarnessLabel(runtime.label)} account`,
      state:
        runtime.availability !== "available"
          ? "Unavailable on this device"
          : auth === "logged_in"
            ? "Connected"
            : auth === "logged_out"
              ? "Sign-in needed"
              : auth === "config_invalid"
                ? "Needs attention"
                : "Connection not reported",
    };
  }
  const route = provider?.trim() || agent.provider?.trim();
  if (!route)
    return {
      source: "Connection not reported",
      state: "Funding source has not been reported",
    };
  const keys = requiredCredentialEnvKeys(runtime.id, route);
  const configured =
    keys.length > 0 &&
    keys.every((key) => Boolean(agent.envVars?.[key]?.trim()));
  const label =
    PERSONA_LLM_PROVIDER_OPTIONS.find(
      (option) => option.id === route.toLowerCase(),
    )?.label.replace(/\bBuzz\b/g, "Colony") ?? route;
  if (route.toLowerCase() === "openrouter" && !configured) {
    return {
      source: label,
      state: !openRouter
        ? "Connection not reported"
        : openRouter.status === "connected"
          ? "Connected"
          : openRouter.status === "limit"
            ? "Spending limit reached"
            : openRouter.status === "linked"
              ? "Linked; connection test needed"
              : openRouter.status === "unlinked" ||
                  openRouter.status === "cancelled"
                ? "Not connected"
                : openRouter.status === "reauth"
                  ? "Sign-in needed"
                  : "Needs attention",
    };
  }
  return {
    source: `${label}${configured ? " · Own key" : ""}`,
    state: configured
      ? "Key configured; account status not reported"
      : "Account status not reported",
  };
}
