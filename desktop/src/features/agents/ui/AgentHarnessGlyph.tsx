import { RuntimeIcon } from "@/features/onboarding/ui/RuntimeIcon";
import type { AcpRuntimeCatalogEntry } from "@/shared/api/types";

/**
 * The harness mark of the Agents boards: a code-brackets glyph for Codex and a
 * terminal glyph for Claude Code. Any other harness keeps its own logo.
 */
export function AgentHarnessGlyph({
  runtime,
  size = 17,
}: {
  runtime: AcpRuntimeCatalogEntry;
  size?: number;
}) {
  const id = runtime.id.trim().toLowerCase();
  if (id === "codex") {
    return (
      <svg
        aria-hidden="true"
        fill="none"
        height={size}
        stroke="hsl(var(--colony-fg-secondary))"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.2"
        viewBox="0 0 24 24"
        width={size}
      >
        <path d="m8 8-4 4 4 4M16 8l4 4-4 4" />
      </svg>
    );
  }
  if (id === "claude") {
    return (
      <svg
        aria-hidden="true"
        fill="none"
        height={size}
        stroke="hsl(var(--colony-fg-secondary))"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width={size}
      >
        <rect height="15" rx="3" width="17" x="3.5" y="4.5" />
        <path d="m7.5 10 3 2.5-3 2.5M12.5 15h4" />
      </svg>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0"
      style={{ height: size, width: size }}
    >
      <RuntimeIcon className="h-full w-full" runtime={runtime} />
    </span>
  );
}
