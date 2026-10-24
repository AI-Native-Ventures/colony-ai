import type {
  SettingsGroupDescriptor,
  SettingsSection,
} from "./SettingsPanels";
import { OnlyYouIcon } from "./settingsIcons";

type SettingsPageHeadProps = {
  activeSection: SettingsSection;
  businessName: string;
  group: SettingsGroupDescriptor;
  onSelect: (section: SettingsSection) => void;
};

/**
 * The top of a Settings page: its title, the line under it and the tabs that
 * jump between the page's sections. A page with one section has no tabs.
 */
export function SettingsPageHead({
  activeSection,
  businessName,
  group,
  onSelect,
}: SettingsPageHeadProps) {
  const subtitle = group.subtitle.replaceAll("{business}", businessName);
  return (
    <>
      <div className="cs-page-head">
        <div className="cs-page-title">
          <h1>{group.title}</h1>
          <span>{subtitle}</span>
        </div>
        {group.id === "appearance-group" ? (
          <span className="cs-pill" data-testid="appearance-only-you">
            <OnlyYouIcon size={14} strokeWidth={2.4} />
            Only you
          </span>
        ) : null}
      </div>
      {group.sections.length > 1 ? (
        <div
          aria-label={`${group.label} settings sections`}
          className="cs-tabs"
          data-compact={group.sections.length > 3 ? "true" : undefined}
          role="tablist"
        >
          {group.sections.map((entry) => (
            <button
              aria-selected={entry.value === activeSection}
              className="cs-tab"
              data-testid={`settings-inner-${entry.value}`}
              key={entry.value}
              onClick={() => onSelect(entry.value)}
              role="tab"
              type="button"
            >
              {entry.label}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
