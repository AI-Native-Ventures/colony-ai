import * as React from "react";
import { ChevronDown } from "lucide-react";

/**
 * A reusable app-sidebar disclosure with an explicit expanded state and a
 * labelled region. Native button behavior provides mouse, Enter, and Space
 * activation without a second keyboard path.
 */
export function SidebarNavigationGroup({
  children,
  defaultExpanded,
  expandForActiveRoute = false,
  label,
  testId,
}: {
  children: React.ReactNode;
  defaultExpanded: boolean;
  expandForActiveRoute?: boolean;
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
          <span data-sidebar-section-title>{label}</span>
          <ChevronDown
            aria-hidden="true"
            className={expanded ? "rotate-0" : "-rotate-90"}
          />
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
