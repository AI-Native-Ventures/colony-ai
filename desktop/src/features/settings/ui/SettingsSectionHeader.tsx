import type { ReactNode } from "react";

/** The title of a Settings section: a heading, its note and an action. */
export function SettingsSectionHeader({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className="cs-section-head">
      <div className="cs-section-head-copy">
        <h2 className="cs-section-title">{title}</h2>
        {description ? <p className="cs-section-note">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
