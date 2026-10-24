import * as React from "react";

import {
  readAccessibilityPreference,
  saveAccessibilityPreference,
  type AccessibilityPreference,
} from "@/shared/lib/accessibilityPreference";
import { isMacPlatform } from "@/shared/lib/platform";
import {
  SettingsCard,
  SettingsChoice,
  SettingsRow,
  SettingsSwitchRow,
} from "./SettingsKit";
import "./SettingsAppearance.css";

/**
 * Accessibility: each control takes effect and is saved as it changes, so
 * there is no Save button to forget.
 */
export function AccessibilitySettingsPanel() {
  const [preference, setPreference] = React.useState(
    readAccessibilityPreference,
  );
  const [error, setError] = React.useState("");
  const modifier = isMacPlatform() ? "⌘" : "Ctrl";

  function update(value: Partial<AccessibilityPreference>) {
    const next = { ...preference, ...value };
    if (!saveAccessibilityPreference(next)) {
      setError("Could not save accessibility preferences. Try again.");
      return;
    }
    setError("");
    setPreference(next);
  }

  return (
    <div className="cs-led" data-testid="settings-accessibility">
      <h2 className="cs-section-title">Accessibility</h2>
      <SettingsCard className="cs-narrow">
        <SettingsRow
          help={`Changes type only; ${modifier} + and ${modifier} − zoom everything.`}
          label="Text size"
        >
          <SettingsChoice
            label="Text size"
            onChange={(textSize) => update({ textSize })}
            options={[
              ["smaller", "Smaller"],
              ["default", "Default"],
              ["larger", "Larger"],
            ]}
            testId="accessibility-text-size"
            value={preference.textSize}
          />
        </SettingsRow>
        <SettingsRow label="Motion">
          <SettingsChoice
            label="Motion"
            onChange={(motion) => update({ motion })}
            options={[
              ["system", "Match system"],
              ["reduce", "Reduce motion"],
            ]}
            testId="accessibility-motion"
            value={preference.motion}
          />
        </SettingsRow>
        <SettingsSwitchRow
          checked={preference.keyboardHints}
          help="Shortcuts appear beside actions and in tooltips."
          id="accessibility-keyboard-hints"
          label="Show keyboard hints"
          onCheckedChange={(keyboardHints) => update({ keyboardHints })}
          testId="accessibility-keyboard-hints"
        />
      </SettingsCard>
      {error ? (
        <p className="cs-notice cs-narrow" data-tone="bad" role="alert">
          {error}
        </p>
      ) : null}
      <div className="cs-keyboard-note">
        <strong>Every action has a keyboard path</strong>
        <span>
          Tab moves between controls, Enter or Space activates them, and Esc
          closes dialogs. {modifier} K opens search from anywhere.
        </span>
      </div>
    </div>
  );
}
