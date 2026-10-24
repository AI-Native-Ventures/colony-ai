import * as React from "react";

import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";

/**
 * Small pieces the AI spend pages share: the tab track under the title and the
 * employee avatar (agents keep their own picture in a squircle).
 */
export type PowerTab<Id extends string> = { id: Id; label: string };

export function PowerTabs<Id extends string>({
  onSelect,
  selected,
  tabs,
}: {
  onSelect: (id: Id) => void;
  selected: Id;
  tabs: ReadonlyArray<PowerTab<Id>>;
}) {
  return (
    <nav aria-label="AI spend views" className="pw-tabs">
      {tabs.map((tab) => (
        <button
          aria-current={selected === tab.id ? "page" : undefined}
          className="pw-tab"
          data-testid={`power-tab-${tab.id}`}
          key={tab.id}
          onClick={() => onSelect(tab.id)}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}

export function EmployeeAvatar({
  avatarUrl,
  className,
  label,
}: {
  avatarUrl: string | null | undefined;
  className?: string;
  label: string;
}) {
  return (
    <ProfileAvatar
      avatarUrl={avatarUrl ?? null}
      className={className}
      label={label}
      shape="squircle"
    />
  );
}

export function ChevronGlyph() {
  return (
    <svg
      aria-hidden="true"
      className="pw-chevron"
      fill="none"
      height="1.125rem"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2.4"
      viewBox="0 0 24 24"
      width="1.125rem"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/** The shell bar's trail: Company, AI spend & power, then the open page. */
export function PowerBreadcrumb({ leaf }: { leaf?: string }) {
  const trail = leaf
    ? ["Company", "AI spend & power", leaf]
    : ["Company", "AI spend & power"];
  return (
    <nav
      aria-label="Breadcrumb"
      className="pw-breadcrumb"
      data-testid="top-bar-breadcrumb"
    >
      {trail.map((label, index) => (
        <React.Fragment key={label}>
          {index > 0 ? <span aria-hidden="true">/</span> : null}
          <span
            aria-current={index === trail.length - 1 ? "page" : undefined}
            data-current={index === trail.length - 1 ? "true" : undefined}
          >
            {label}
          </span>
        </React.Fragment>
      ))}
    </nav>
  );
}
