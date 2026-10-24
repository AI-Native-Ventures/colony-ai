import type * as React from "react";

import "./agentsColony3.css";

type AgentsDirectoryHeaderProps = {
  agentCount: number;
  defaultsLabel: string;
  defaultsRef: React.Ref<HTMLButtonElement>;
  onAddAgent: () => void;
  onHarnesses: () => void;
  onInvite: () => void;
  onOpenDefaults: (trigger: HTMLButtonElement | null) => void;
  onOpenPeople: () => void;
  peopleCount: number;
};

/**
 * The directory header of the Agents board: title and counts, the three
 * actions, then the Agents and People views with the connections link.
 */
export function AgentsDirectoryHeader({
  agentCount,
  defaultsLabel,
  defaultsRef,
  onAddAgent,
  onHarnesses,
  onInvite,
  onOpenDefaults,
  onOpenPeople,
  peopleCount,
}: AgentsDirectoryHeaderProps) {
  return (
    <>
      <header className="agents-c3-head">
        <div className="agents-c3-titleblock">
          <h1 className="agents-c3-title">Agents</h1>
          <span className="agents-c3-sub">
            {agentCount} {agentCount === 1 ? "agent" : "agents"} · {peopleCount}{" "}
            {peopleCount === 1 ? "person" : "people"}
          </span>
        </div>
        <div className="agents-c3-head-actions">
          <button
            className="agents-c3-btn"
            data-testid="agent-defaults-button"
            onClick={(event) => onOpenDefaults(event.currentTarget)}
            ref={defaultsRef}
            type="button"
          >
            {defaultsLabel}
          </button>
          <button className="agents-c3-btn" onClick={onInvite} type="button">
            Invite a person
          </button>
          <button
            className="agents-c3-btn"
            data-testid="agent-add-button"
            data-variant="primary"
            onClick={onAddAgent}
            type="button"
          >
            <svg
              aria-hidden="true"
              fill="none"
              height="17"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="2.4"
              viewBox="0 0 24 24"
              width="17"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add agent
          </button>
        </div>
      </header>

      <div className="agents-c3-tabrow">
        <nav aria-label="Agent views" className="agents-c3-tabs">
          <button aria-current="page" className="agents-c3-tab" type="button">
            Agents
          </button>
          <button
            className="agents-c3-tab"
            onClick={onOpenPeople}
            type="button"
          >
            People
          </button>
        </nav>
        <button
          className="agents-c3-link"
          style={{ marginLeft: "auto" }}
          onClick={onHarnesses}
          type="button"
        >
          Harnesses &amp; connections →
        </button>
      </div>
    </>
  );
}
