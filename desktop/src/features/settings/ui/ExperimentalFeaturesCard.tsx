import { setAgentManagedProfiles } from "@/shared/api/tauriWorkspace";
import { desktopFeatures, useFeatureToggle } from "@/shared/features";
import type { FeatureDefinition } from "@/shared/features";
import { SettingsSwitchRow } from "./SettingsKit";

/** Preview features that are not in the lean app have no switch here. */
const NOT_LISTED = new Set(["workflows", "projects", "pulse", "forum"]);

function FeatureRow({ feature }: { feature: FeatureDefinition }) {
  const [enabled, toggle] = useFeatureToggle(feature.id);
  const switchId = `feature-toggle-${feature.id}`;

  return (
    <SettingsSwitchRow
      checked={enabled}
      help={feature.description}
      id={switchId}
      label={feature.name}
      onCheckedChange={(value) => {
        toggle(value);
        if (feature.id === "agentManagedProfiles") {
          void setAgentManagedProfiles(value).catch((error) => {
            console.error(
              "Failed to apply agent-managed profiles setting:",
              error,
            );
          });
        }
      }}
      testId={switchId}
    />
  );
}

export function ExperimentalFeaturesCard() {
  // The manifest is preview-only by definition; every desktop entry is a
  // preview feature.
  const previewFeatures = desktopFeatures.filter(
    (feature) => !NOT_LISTED.has(feature.id),
  );

  return (
    <section
      aria-labelledby="experiments-title"
      className="cs-card"
      data-testid="settings-experimental"
    >
      <div className="cs-card-head">
        <h2 className="cs-card-subtitle" id="experiments-title">
          Experiments
        </h2>
        <span className="cs-row-help">
          Preview features. Turning one on adds it to your sidebar.
        </span>
      </div>
      {previewFeatures.map((f) => (
        <FeatureRow feature={f} key={f.id} />
      ))}
    </section>
  );
}
