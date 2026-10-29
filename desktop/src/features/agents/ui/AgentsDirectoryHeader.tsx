import "./agentsColony3.css";

export function AgentsDirectoryHeader({
  agentCount,
  onHire,
}: {
  agentCount: number;
  onHire: () => void;
}) {
  return (
    <header className="agents-c3-head">
      <div className="agents-c3-titleblock">
        <h1 className="agents-c3-title">Agents</h1>
        <span className="agents-c3-sub">
          {agentCount} {agentCount === 1 ? "agent" : "agents"}
        </span>
      </div>
      <button
        className="agents-c3-btn"
        data-testid="agent-hire-button"
        data-variant="primary"
        onClick={onHire}
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
        Hire an agent
      </button>
    </header>
  );
}
