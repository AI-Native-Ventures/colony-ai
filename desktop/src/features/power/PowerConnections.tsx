import { useQuery } from "@tanstack/react-query";
import type * as React from "react";

import { useAcpRuntimesQuery } from "@/features/agents/hooks";
import { globalAgentConfigQueryKey } from "@/features/agents/useGlobalAgentConfig";
import { getGlobalAgentConfig } from "@/shared/api/tauriGlobalAgentConfig";

type ConnectionTone = "ok" | undefined;

function Tile({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "accent";
}) {
  return (
    <span aria-hidden="true" className="pw-tile" data-tone={tone}>
      {children}
    </span>
  );
}

function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="1.25rem"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="1.25rem"
    >
      {children}
    </svg>
  );
}

function ConnectionRow({
  action,
  detail,
  icon,
  onAction,
  status,
  testId,
  title,
  tone,
}: {
  action: string;
  detail: string;
  icon: React.ReactNode;
  onAction: () => void;
  status: string;
  testId: string;
  title: string;
  tone?: ConnectionTone;
}) {
  return (
    <li className="pw-connection" data-testid={testId}>
      {icon}
      <span className="pw-connection-copy">
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      <span className="pw-badge" data-tone={tone}>
        {status}
      </span>
      <button className="pw-button" onClick={onAction} type="button">
        {action}
      </button>
    </li>
  );
}

/**
 * Connections: where the AI employees get their models. Read only; every
 * change is made in Settings, Agents.
 */
export function PowerConnections({
  creditsLaunched,
  creditsStatus,
  onManage,
}: {
  creditsLaunched: boolean;
  /** Balance text once credits are live, or a short state word. */
  creditsStatus: string;
  onManage: () => void;
}) {
  const runtimesQuery = useAcpRuntimesQuery({ enabled: true });
  const configQuery = useQuery({
    queryKey: globalAgentConfigQueryKey,
    queryFn: getGlobalAgentConfig,
    retry: false,
  });
  const signedIn = (runtimesQuery.data ?? []).filter(
    (runtime) =>
      runtime.availability === "available" &&
      runtime.authStatus.status === "logged_in",
  );
  const openRouterConnected = configQuery.data?.provider === "openrouter";

  return (
    <section
      aria-labelledby="power-connections-title"
      className="pw-stack"
      data-testid="power-connections"
    >
      <h2 className="pw-section-title" id="power-connections-title">
        Connections
      </h2>
      <ul className="pw-list">
        <ConnectionRow
          action="Manage"
          detail={
            signedIn.length > 0
              ? `Use AI plans you already pay for · ${signedIn.map((runtime) => runtime.label).join(", ")}`
              : "Use AI plans you already pay for"
          }
          icon={
            <Tile>
              <Glyph>
                <rect height="13" rx="2.5" width="17" x="3.5" y="5.5" />
                <path d="M3.5 10h17M7.5 14.5h3" />
              </Glyph>
            </Tile>
          }
          onAction={onManage}
          status={
            runtimesQuery.isLoading
              ? "Checking"
              : signedIn.length > 0
                ? "Connected"
                : "Unavailable"
          }
          testId="power-connection-subscriptions"
          title="Existing subscriptions"
          tone={signedIn.length > 0 ? "ok" : undefined}
        />
        <ConnectionRow
          action="Manage"
          detail="Pay as you go when agents run on Colony Agent"
          icon={
            <Tile tone="accent">
              <Glyph>
                <path d="M13 3 5.5 13.5h6L10.5 21 18 10.5h-6z" />
              </Glyph>
            </Tile>
          }
          onAction={onManage}
          status={creditsLaunched ? creditsStatus : "Coming soon"}
          testId="power-connection-credits"
          title="Colony credits"
        />
        <ConnectionRow
          action={openRouterConnected ? "Manage" : "Connect"}
          detail="One account for models from many providers"
          icon={
            <Tile>
              <Glyph>
                <circle cx="6" cy="12" r="2.5" />
                <circle cx="18" cy="6" r="2.5" />
                <circle cx="18" cy="18" r="2.5" />
                <path d="M8.3 11 15.7 7M8.3 13l7.4 4" />
              </Glyph>
            </Tile>
          }
          onAction={onManage}
          status={
            configQuery.isLoading
              ? "Checking"
              : openRouterConnected
                ? "Connected"
                : "Not connected"
          }
          testId="power-connection-openrouter"
          title="OpenRouter"
          tone={openRouterConnected ? "ok" : undefined}
        />
        <ConnectionRow
          action="Manage"
          detail="Bring your own API keys"
          icon={
            <Tile>
              <Glyph>
                <circle cx="8" cy="15" r="4" />
                <path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2" />
              </Glyph>
            </Tile>
          }
          onAction={onManage}
          status="Unavailable"
          testId="power-connection-keys"
          title="Provider keys"
        />
      </ul>
    </section>
  );
}
