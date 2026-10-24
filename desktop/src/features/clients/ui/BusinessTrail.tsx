import * as React from "react";

import { AppTopChromePortal } from "@/app/AppTopChromePortal";

export type TrailCrumb = { label: string; onClick?: () => void };

/**
 * The top-bar trail for a business page that knows more than its route (the
 * client, the work item or the invoice it shows). The last crumb is the page.
 */
export function BusinessTrail({ crumbs }: { crumbs: readonly TrailCrumb[] }) {
  return (
    <AppTopChromePortal>
      <nav
        aria-label="Breadcrumb"
        className="b3-trail"
        data-testid="top-bar-breadcrumb"
      >
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <React.Fragment key={crumb.label}>
              {index > 0 ? <span aria-hidden="true">/</span> : null}
              {crumb.onClick && !isLast ? (
                <button
                  className="b3-crumb"
                  onClick={crumb.onClick}
                  type="button"
                >
                  {crumb.label}
                </button>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  data-current={isLast ? "true" : undefined}
                >
                  {crumb.label}
                </span>
              )}
            </React.Fragment>
          );
        })}
      </nav>
    </AppTopChromePortal>
  );
}
