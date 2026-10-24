import type * as React from "react";

import {
  DEFAULT_FIELD_COLORS,
  FIELD_PRESETS,
  describeFieldColor,
  presetForFieldColors,
  type FieldColors,
} from "@/shared/theme/sidebarField";

import "./AppearanceFieldColours.css";

const SLOTS = [
  { id: "top", label: "Top" },
  { id: "middle", label: "Middle" },
  { id: "bottom", label: "Bottom" },
] as const;

type AppearanceFieldColoursProps = {
  colors: FieldColors | undefined;
  onChange: (colors: FieldColors) => void;
};

/**
 * "Sidebar colours": each person's three field colours, with the Dawn, Peach
 * and Sea presets. The change is a draft until Apply, like the rest of the
 * Appearance page, and is saved per person with their theme.
 */
export function AppearanceFieldColours({
  colors = DEFAULT_FIELD_COLORS,
  onChange,
}: AppearanceFieldColoursProps) {
  const activePreset = presetForFieldColors(colors);
  return (
    <section
      aria-labelledby="appearance-field-title"
      className="cs-card ap-field"
      data-testid="appearance-field"
      style={
        {
          "--ap-field-top": colors[0],
          "--ap-field-middle": colors[1],
          "--ap-field-bottom": colors[2],
        } as React.CSSProperties
      }
    >
      <div className="ap-field-head">
        <h3 id="appearance-field-title">Sidebar colours</h3>
        <p>
          Up to three colours. Text in the sidebar stays readable on any light
          colour.
        </p>
      </div>
      <div className="ap-field-body">
        <div aria-hidden="true" className="ap-field-thumb">
          <i className="ap-field-blob ap-field-blob-top" />
          <i className="ap-field-blob ap-field-blob-middle" />
          <i className="ap-field-blob ap-field-blob-bottom" />
          <i className="ap-field-veil" />
          <span className="ap-field-lines">
            <b />
            <u />
            <s />
            <s />
            <s />
            <s />
          </span>
        </div>
        <div className="ap-field-controls">
          <fieldset className="ap-field-slots">
            <legend className="sr-only">Sidebar colour slots</legend>
            {SLOTS.map((slot, index) => (
              <label className="ap-field-slot" key={slot.id}>
                <input
                  data-testid={`appearance-field-${slot.id}`}
                  onChange={(event) => {
                    const next: FieldColors = [...colors];
                    next[index] = event.target.value.toUpperCase();
                    onChange(next);
                  }}
                  type="color"
                  value={colors[index].toLowerCase()}
                />
                <span>{slot.label}</span>
                <small data-testid={`appearance-field-${slot.id}-name`}>
                  {describeFieldColor(colors[index])}
                </small>
              </label>
            ))}
          </fieldset>
          <div className="ap-field-presets">
            <span className="ap-field-eyebrow">Presets</span>
            <fieldset className="ap-field-preset-row">
              <legend className="sr-only">Preset colour trios</legend>
              {FIELD_PRESETS.map((preset) => (
                <button
                  aria-pressed={activePreset?.id === preset.id}
                  className="ap-field-preset"
                  data-testid={`appearance-field-preset-${preset.id}`}
                  key={preset.id}
                  onClick={() => onChange([...preset.colors])}
                  type="button"
                >
                  <span aria-hidden="true" className="ap-field-dots">
                    {preset.colors.map((color) => (
                      <i key={color} style={{ background: color }} />
                    ))}
                  </span>
                  {preset.label}
                </button>
              ))}
            </fieldset>
          </div>
        </div>
      </div>
    </section>
  );
}
