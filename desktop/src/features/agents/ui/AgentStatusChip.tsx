import type * as React from "react";

import { agentChipTone, type AgentChipTone } from "./agentPageModel";

const ATTENTION_ICON = (
  <svg
    aria-hidden="true"
    fill="none"
    height="13"
    stroke="currentColor"
    strokeLinecap="round"
    strokeWidth="2.6"
    viewBox="0 0 24 24"
    width="13"
  >
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8v4.5M12 16v.2" />
  </svg>
);

const ARCHIVE_ICON = (
  <svg
    aria-hidden="true"
    fill="none"
    height="13"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    strokeWidth="2.4"
    viewBox="0 0 24 24"
    width="13"
  >
    <rect height="4.5" rx="1" width="17" x="3.5" y="4.5" />
    <path d="M5.5 9v10.5h13V9M10 13h4" />
  </svg>
);

/** A status chip of the Agents boards: Ready, Working, Offline, Needs attention, Archived. */
export function AgentStatusChip({
  label,
  size = "md",
  tone,
  testId,
}: {
  label: string;
  size?: "md" | "sm";
  tone?: AgentChipTone;
  testId?: string;
}) {
  const resolved = tone ?? agentChipTone(label);
  let lead: React.ReactNode = <span aria-hidden="true" className="agents-c3-dot" />;
  if (resolved === "needs") lead = ATTENTION_ICON;
  if (resolved === "archived") lead = ARCHIVE_ICON;
  if (resolved === "plain") lead = null;
  return (
    <span
      className="agents-c3-chip"
      data-size={size}
      data-testid={testId}
      data-tone={resolved}
    >
      {lead}
      {label}
    </span>
  );
}
