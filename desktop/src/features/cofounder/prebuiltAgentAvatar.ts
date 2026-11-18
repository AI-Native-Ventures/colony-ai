import { agentAntAvatarDataUrl } from "@/features/agents/ui/agentAntAvatar";

import type { PrebuiltAgent } from "./prebuiltAgents";

/** The stable Colony ant artwork for a pre-built agent across every surface. */
export function prebuiltAgentAvatarDataUrl(
  agent: Pick<PrebuiltAgent, "name">,
): string {
  const base64Url = agentAntAvatarDataUrl(agent.name);
  const base64Svg = base64Url.split(",", 2)[1];
  if (!base64Svg) return base64Url;

  // Managed-agent creation uploads base64 data URLs. A self-contained,
  // percent-encoded SVG survives that path as the durable avatar value instead
  // of relying on an opaque uploaded URL, and it remains usable by every
  // offline map/card/chat fallback.
  return `data:image/svg+xml,${encodeURIComponent(atob(base64Svg))}`;
}
