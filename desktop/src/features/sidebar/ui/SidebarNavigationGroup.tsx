import * as React from "react";

import { ChevronRightIcon } from "@/shared/ui/colonyIcons";

/**
 * A reusable app-sidebar disclosure with an explicit expanded state and a
 * labelled region. Native button behavior provides mouse, Enter, and Space
 * activation without a second keyboard path.
 */
export function SidebarNavigationGroup({
  children,
  defaultExpanded,
  expandForActiveRoute = false,
  icon,
  label,
  testId,
}: {
  children: React.ReactNode;
  defaultExpanded: boolean;
  expandForActiveRoute?: boolean;
  /** Row icon drawn before the label, as in the Colony 3.0 sidebar. */
  icon?: React.ReactNode;
  label: string;
  testId: string;
}) {
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  const contentId = React.useId();
  const labelId = React.useId();

  React.useEffect(() => {
    if (expandForActiveRoute) setExpanded(true);
  }, [expandForActiveRoute]);

  return (
    <section
      className="sidebar-navigation-group"
      data-expanded={expanded}
      data-testid={testId}
    >
      <h2 className="sidebar-navigation-group-heading">
        <button
          aria-controls={contentId}
          aria-expanded={expanded}
          className="sidebar-navigation-group-toggle"
          data-testid={`${testId}-toggle`}
          id={labelId}
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {icon}
          <span data-sidebar-section-title>{label}</span>
          <ChevronRightIcon aria-hidden="true" size={16} />
        </button>
      </h2>
      <section
        aria-labelledby={labelId}
        className="sidebar-navigation-group-content"
        data-testid={`${testId}-content`}
        hidden={!expanded}
        id={contentId}
      >
        {children}
      </section>
    </section>
  );
}
