import * as React from "react";
import { useCommunities } from "@/features/communities/useCommunities";
import { useIdentityQuery } from "@/shared/api/hooks";
import {
  ACCENT_STORAGE_KEY,
  DEFAULT_ACCENT,
  GLASS_BACKGROUND_STORAGE_KEY,
  useTheme,
} from "@/shared/theme/ThemeProvider";
import {
  DEFAULT_FIELD_COLORS,
  type FieldColors,
} from "@/shared/theme/sidebarField";
import {
  LIGHT_THEMES,
  SYNTAX_THEMES,
  getThemePair,
  type SyntaxThemeName,
} from "@/shared/theme/theme-loader";
import {
  getConversationDensity,
  setConversationDensity,
  type ConversationDensity,
} from "@/shared/lib/conversationDensityPreference";
import {
  getLinkPreviewStyle,
  setLinkPreviewStyle,
  type LinkPreviewStyle,
} from "@/shared/lib/linkPreviewStylePreference";
import {
  getThreadViewMode,
  setThreadViewMode,
  type ThreadViewMode,
} from "@/features/channels/lib/threadViewModePreference";

import {
  appearanceLastBusinessKey,
  appearanceSnapshotKey,
  writeAppearanceSnapshot,
  readAppearanceSnapshot,
  mergeAppearanceSnapshot,
  mergeLiveAppearanceSnapshot,
  type AppearanceSnapshot,
} from "../lib/appearanceSnapshot";
import {
  readTypeface,
  setTypeface,
  type Typeface,
} from "@/shared/lib/typefacePreference";
import { applyConversationMessageSize } from "../lib/conversationMessageSizePreference";
import { AppearanceFieldColours } from "./AppearanceFieldColours";
import { ACCENTS, LiveAppearancePreview } from "./AppearanceLivePreview";
import {
  SettingsCard,
  SettingsChoice,
  SettingsRow,
  SettingsSwitchRow,
} from "./SettingsKit";
import { CheckSmallIcon } from "./settingsIcons";
import "./SettingsAppearance.css";

type AppearanceMode = "system" | "light" | "dark";

/** Kept in saved snapshots only so older ones still read; the field replaced it. */
const LEGACY_CUSTOM_COLORS: [string, string] = ["#895AF6", "#5A9CF6"];

function currentMode(followSystem: boolean, theme: string): AppearanceMode {
  if (followSystem) return "system";
  return LIGHT_THEMES.has(theme as SyntaxThemeName) ? "light" : "dark";
}

function themeForMode(
  selectedTheme: string,
  mode: AppearanceMode,
): SyntaxThemeName {
  const selected = selectedTheme as SyntaxThemeName;
  if (mode === "system") return selected;
  const wantsLight = mode === "light";
  if (LIGHT_THEMES.has(selected) === wantsLight) return selected;
  if (wantsLight) {
    const lightPair = SYNTAX_THEMES.find(
      (name) => getThemePair(name) === selected,
    );
    return (
      lightPair ??
      SYNTAX_THEMES.find((name) => LIGHT_THEMES.has(name)) ??
      selected
    );
  }
  return (
    getThemePair(selected) ??
    SYNTAX_THEMES.find((name) => !LIGHT_THEMES.has(name)) ??
    selected
  );
}

type CurrentAppearanceTheme = Pick<
  ReturnType<typeof useTheme>,
  | "accentColor"
  | "fieldColors"
  | "followSystem"
  | "glassBackground"
  | "glassOpacity"
  | "prominentActiveTab"
  | "selectedThemeName"
>;
export function currentAppearanceSnapshot(
  theme: CurrentAppearanceTheme,
): AppearanceSnapshot {
  let density: ConversationDensity = "comfortable";
  let linkPreview: LinkPreviewStyle = "compact";
  let threadLayout: ThreadViewMode = "split";
  let glassBackground = theme.glassBackground;
  let accent = theme.accentColor || DEFAULT_ACCENT;
  try {
    density = getConversationDensity();
    linkPreview = getLinkPreviewStyle();
    threadLayout = getThreadViewMode();
  } catch {
    // Use safe defaults when a preference store is unavailable during startup.
  }
  try {
    const savedAccent = window.localStorage.getItem(ACCENT_STORAGE_KEY);
    accent = savedAccent === null ? DEFAULT_ACCENT : savedAccent;
    const savedGlass = window.localStorage.getItem(
      GLASS_BACKGROUND_STORAGE_KEY,
    );
    if (savedGlass !== null) glassBackground = savedGlass === "true";
  } catch {
    // Theme provider values remain usable when storage is blocked.
  }
  return {
    version: 1,
    theme: theme.selectedThemeName,
    accent: accent === "neutral" ? "#74717B" : accent,
    followSystem: theme.followSystem,
    custom: false,
    customLight: [...LEGACY_CUSTOM_COLORS],
    field: [...theme.fieldColors],
    glassBackground,
    glassOpacity: theme.glassOpacity,
    prominentActiveTab: theme.prominentActiveTab,
    messageSize: "default",
    density,
    linkPreview,
    threadLayout,
  };
}

function loadPreferences(
  base: AppearanceSnapshot,
  business: Partial<AppearanceSnapshot> | null,
  conversations: Partial<AppearanceSnapshot> | null,
): AppearanceSnapshot {
  const businessSnapshot = mergeLiveAppearanceSnapshot(base, business);
  const globalSnapshot = mergeAppearanceSnapshot(
    businessSnapshot,
    conversations,
  );
  return {
    ...businessSnapshot,
    theme: base.theme,
    accent: base.accent,
    field: base.field,
    followSystem: base.followSystem,
    messageSize: globalSnapshot.messageSize,
    density: base.density,
    linkPreview: base.linkPreview,
    threadLayout: base.threadLayout,
  };
}

export function AppearanceSettingsPanel() {
  const theme = useTheme();
  const { activeCommunity } = useCommunities();
  const identity = useIdentityQuery();
  const personId = identity.data?.pubkey ?? activeCommunity?.pubkey ?? "local";
  const businessId = activeCommunity?.id ?? "local-business";
  const businessKey = appearanceSnapshotKey(personId, businessId);
  const lastBusinessKey = appearanceLastBusinessKey(personId);
  const globalKey = appearanceSnapshotKey(personId, "global-conversations");
  const current = currentAppearanceSnapshot(theme);
  const currentRef = React.useRef(current);
  const themeRef = React.useRef(theme);
  currentRef.current = current;
  themeRef.current = theme;
  const glassBackgroundSupported =
    theme.glassBackgroundSupported && !window.colonyDesktop;
  const [preferences, setPreferences] = React.useState(() => {
    const business = readAppearanceSnapshot(businessKey);
    const global = readAppearanceSnapshot(globalKey);
    return loadPreferences(current, business, global);
  });
  const previewIsDark = preferences.followSystem
    ? theme.isDark
    : !LIGHT_THEMES.has(preferences.theme as SyntaxThemeName);
  const [saved, setSaved] = React.useState(true);
  const [appliedPreferences, setAppliedPreferences] =
    React.useState(preferences);
  const [previousAppearance, setPreviousAppearance] =
    React.useState<AppearanceSnapshot | null>(null);
  const appearancePending =
    JSON.stringify(preferences) !== JSON.stringify(appliedPreferences);
  const [undoSnapshot, setUndoSnapshot] =
    React.useState<AppearanceSnapshot | null>(null);

  React.useEffect(() => {
    const business = readAppearanceSnapshot(businessKey);
    const global = readAppearanceSnapshot(globalKey);
    let previousBusinessId: string | null = null;
    try {
      previousBusinessId = window.localStorage.getItem(lastBusinessKey);
    } catch {
      // Scoping metadata is optional when storage is blocked.
    }
    const changedBusiness =
      previousBusinessId !== null && previousBusinessId !== businessId;
    const base = currentRef.current;
    const next = loadPreferences(base, business, global);
    setPreferences(next);
    setAppliedPreferences(next);
    if (!business) {
      let snapshotWritten = false;
      try {
        snapshotWritten = writeAppearanceSnapshot(
          window.localStorage,
          businessKey,
          next,
        );
        if (snapshotWritten) {
          window.localStorage.setItem(lastBusinessKey, businessId);
        }
      } catch {
        snapshotWritten = false;
      }
      setSaved(snapshotWritten);
    } else {
      try {
        window.localStorage.setItem(lastBusinessKey, businessId);
      } catch {
        // The appearance snapshot remains correctly scoped without this hint.
      }
    }
    if (business || changedBusiness || previousBusinessId === null) {
      themeRef.current.setGlassBackground(
        glassBackgroundSupported && next.glassBackground,
      );
      themeRef.current.setGlassOpacity(next.glassOpacity);
      themeRef.current.setProminentActiveTab(next.prominentActiveTab);
    }
    applyConversationMessageSize(next.messageSize);
    // The scope IDs are the source of truth. Provider values are mirrored only
    // after a saved snapshot is loaded for this person and business.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    businessId,
    businessKey,
    globalKey,
    lastBusinessKey,
    glassBackgroundSupported,
  ]);

  React.useEffect(() => {
    const update = (previous: AppearanceSnapshot) => ({
      ...previous,
      theme: theme.selectedThemeName,
      accent: theme.accentColor,
      field: [...theme.fieldColors] as FieldColors,
      followSystem: theme.followSystem,
    });
    setPreferences(update);
    setAppliedPreferences(update);
  }, [
    theme.selectedThemeName,
    theme.accentColor,
    theme.fieldColors,
    theme.followSystem,
  ]);

  const applyCommit = React.useCallback(
    (
      patch: Partial<AppearanceSnapshot>,
      scope: "business" | "conversations" = "business",
    ) => {
      const next: AppearanceSnapshot = {
        ...(scope === "conversations" ? appliedPreferences : preferences),
        ...patch,
        version: 1,
      };
      const key = scope === "conversations" ? globalKey : businessKey;
      try {
        if (!writeAppearanceSnapshot(window.localStorage, key, next)) {
          setSaved(false);
          return false;
        }
        setSaved(true);
        if (scope === "conversations") {
          setPreferences((previous) => ({ ...previous, ...patch }));
          setAppliedPreferences((previous) => ({ ...previous, ...patch }));
        } else {
          setPreferences(next);
          setAppliedPreferences(next);
        }
      } catch {
        setSaved(false);
        return false;
      }

      if (
        patch.theme !== undefined ||
        patch.accent !== undefined ||
        patch.field !== undefined ||
        patch.followSystem !== undefined
      ) {
        theme.applyAppearance({
          theme: next.theme as SyntaxThemeName,
          accent: next.accent,
          field: next.field,
          followSystem: next.followSystem,
        });
      }
      if (patch.glassBackground !== undefined) {
        theme.setGlassBackground(
          glassBackgroundSupported && next.glassBackground,
        );
      }
      if (patch.glassOpacity !== undefined)
        theme.setGlassOpacity(next.glassOpacity);
      if (patch.prominentActiveTab !== undefined) {
        theme.setProminentActiveTab(next.prominentActiveTab);
      }
      if (patch.messageSize !== undefined) {
        applyConversationMessageSize(next.messageSize);
      }
      if (patch.density !== undefined) setConversationDensity(next.density);
      if (patch.linkPreview !== undefined)
        setLinkPreviewStyle(next.linkPreview);
      if (patch.threadLayout !== undefined)
        setThreadViewMode(next.threadLayout);
      return true;
    },
    [
      businessKey,
      globalKey,
      preferences,
      appliedPreferences,
      theme,
      glassBackgroundSupported,
    ],
  );

  function commit(
    patch: Partial<AppearanceSnapshot>,
    scope: "business" | "conversations" = "business",
  ) {
    if (scope === "conversations") {
      applyCommit(patch, scope);
      return;
    }
    const next = { ...preferences, ...patch };
    setPreferences(next);
    setSaved(true);
  }

  function applyBusinessAppearance(snapshot: AppearanceSnapshot) {
    return applyCommit({
      theme: snapshot.theme,
      accent: snapshot.accent,
      field: snapshot.field,
      followSystem: snapshot.followSystem,
      custom: false,
      customLight: snapshot.customLight,
      glassBackground: snapshot.glassBackground,
      glassOpacity: snapshot.glassOpacity,
      prominentActiveTab: snapshot.prominentActiveTab,
    });
  }

  function applyDraft() {
    const previous = appliedPreferences;
    if (applyBusinessAppearance(preferences)) setPreviousAppearance(previous);
  }

  function cancelDraft() {
    setPreferences(appliedPreferences);
    setSaved(true);
  }

  function selectMode(mode: AppearanceMode) {
    commit({
      theme: themeForMode(preferences.theme, mode),
      followSystem: mode === "system",
    });
  }

  function resetAppearance() {
    setUndoSnapshot(preferences);
    const resetTheme = SYNTAX_THEMES.includes("buzz" as SyntaxThemeName)
      ? "buzz"
      : preferences.theme;
    commit({
      theme: resetTheme,
      accent: DEFAULT_ACCENT,
      field: [...DEFAULT_FIELD_COLORS],
      followSystem: true,
      custom: false,
      customLight: [...LEGACY_CUSTOM_COLORS],
      glassBackground: false,
      glassOpacity: 65,
      prominentActiveTab: false,
    });
  }

  function undoReset() {
    if (!undoSnapshot) return;
    commit(undoSnapshot);
    setUndoSnapshot(null);
  }

  const mode = currentMode(preferences.followSystem, preferences.theme);
  React.useEffect(() => {
    document.documentElement.style.setProperty(
      "--w20-appearance-accent",
      appliedPreferences.accent,
    );
  }, [appliedPreferences.accent]);

  const [typeface, setTypefaceState] = React.useState<Typeface>(readTypeface);
  const accentHex =
    ACCENTS.find(
      ([, hex]) => hex.toLowerCase() === preferences.accent.toLowerCase(),
    )?.[1] ?? preferences.accent;

  return (
    <div
      className="cs-appearance"
      data-testid="settings-appearance"
      style={
        {
          "--cs-accent": accentHex,
          "--cs-accent-soft": "#f7f4fd",
        } as React.CSSProperties
      }
    >
      <div className="cs-appearance-controls">
        <SettingsCard title="Theme" titleId="appearance-theme-title">
          <SettingsRow label="Colour mode">
            <fieldset className="cs-choice">
              <legend className="sr-only">Colour mode</legend>
              {(["system", "light", "dark"] as const).map((option) => (
                <button
                  aria-pressed={mode === option}
                  data-testid={`appearance-mode-${option}`}
                  key={option}
                  onClick={() => selectMode(option)}
                  type="button"
                >
                  {option === "system"
                    ? "System"
                    : option === "light"
                      ? "Light"
                      : "Dark"}
                </button>
              ))}
            </fieldset>
          </SettingsRow>
          <SettingsRow label="Accent colour">
            <fieldset className="cs-accents">
              <legend className="sr-only">Accent colour</legend>
              {ACCENTS.map(([label, hex]) => (
                <button
                  aria-label={`${label} accent`}
                  aria-pressed={
                    preferences.accent.toLowerCase() === hex.toLowerCase()
                  }
                  className="cs-accent"
                  data-testid={`appearance-accent-${label.toLowerCase()}`}
                  key={label}
                  onClick={() => commit({ accent: hex })}
                  style={{ "--cs-swatch": hex } as React.CSSProperties}
                  title={label}
                  type="button"
                />
              ))}
            </fieldset>
          </SettingsRow>
        </SettingsCard>

        <AppearanceFieldColours
          colors={preferences.field}
          onChange={(field) => commit({ field })}
        />

        <SettingsCard title="Window" titleId="appearance-window-title">
          <SettingsSwitchRow
            checked={glassBackgroundSupported && preferences.glassBackground}
            disabled={!glassBackgroundSupported}
            help={
              glassBackgroundSupported
                ? "Let the desktop show softly through the window."
                : "Not available in this app"
            }
            id="appearance-glass"
            label="Glass background"
            onCheckedChange={(glassBackground) => commit({ glassBackground })}
            testId="appearance-glass"
          />
          {glassBackgroundSupported ? (
            <SettingsRow
              htmlFor="appearance-glass-opacity"
              label="Glass opacity"
            >
              <span className="cs-range">
                <input
                  data-testid="appearance-glass-opacity"
                  id="appearance-glass-opacity"
                  max={90}
                  min={30}
                  onChange={(event) =>
                    commit({ glassOpacity: Number(event.target.value) })
                  }
                  type="range"
                  value={preferences.glassOpacity}
                />
                <output>{preferences.glassOpacity}%</output>
              </span>
            </SettingsRow>
          ) : null}
          <SettingsSwitchRow
            checked={preferences.prominentActiveTab}
            help="Give the open tab a stronger fill."
            id="appearance-prominent"
            label="Prominent selected tab"
            onCheckedChange={(prominentActiveTab) =>
              commit({ prominentActiveTab })
            }
            testId="appearance-prominent"
          />
        </SettingsCard>

        <SettingsCard title="Conversations" titleId="appearance-conv-title">
          <SettingsRow label="Message size">
            <SettingsChoice
              label="Message size"
              onChange={(messageSize) =>
                commit({ messageSize }, "conversations")
              }
              options={[
                ["smaller", "Smaller"],
                ["default", "Default"],
                ["larger", "Larger"],
              ]}
              testId="appearance-message-size"
              value={preferences.messageSize}
            />
          </SettingsRow>
          <SettingsRow label="Link previews">
            <SettingsChoice
              label="Link previews"
              onChange={(linkPreview) =>
                commit({ linkPreview }, "conversations")
              }
              options={[
                ["compact", "Compact"],
                ["rich", "Rich"],
              ]}
              testId="appearance-links"
              value={preferences.linkPreview}
            />
          </SettingsRow>
          <SettingsRow label="Thread layout">
            <SettingsChoice
              label="Thread layout"
              onChange={(threadLayout) =>
                commit({ threadLayout }, "conversations")
              }
              options={[
                ["split", "Side by side"],
                ["focus", "Focused"],
              ]}
              testId="appearance-threads"
              value={preferences.threadLayout}
            />
          </SettingsRow>
          <SettingsRow htmlFor="appearance-typeface" label="Typeface">
            <select
              className="cs-select cs-select-inline"
              data-testid="appearance-typeface"
              id="appearance-typeface"
              onChange={(event) => {
                const next = event.target.value as Typeface;
                setTypefaceState(next);
                setTypeface(next);
              }}
              value={typeface}
            >
              <option value="manrope">Manrope</option>
              <option value="inter">Inter</option>
              <option value="system">System</option>
            </select>
          </SettingsRow>
        </SettingsCard>

        <div className="cs-reset">
          <button
            className="cs-text-button"
            data-testid="appearance-reset"
            onClick={resetAppearance}
            type="button"
          >
            Reset appearance
          </button>
          {undoSnapshot ? (
            <button
              className="cs-text-button"
              onClick={undoReset}
              type="button"
            >
              Undo reset
            </button>
          ) : null}
        </div>
      </div>

      <aside aria-label="Appearance preview" className="cs-appearance-preview">
        <div className="cs-preview-card">
          <LiveAppearancePreview
            isDark={previewIsDark}
            preferences={preferences}
          />
          <div className="cs-preview-foot">
            <span
              className="cs-preview-status"
              data-state={
                !saved ? "error" : appearancePending ? "pending" : "applied"
              }
            >
              {saved && !appearancePending ? (
                <CheckSmallIcon size={14} strokeWidth={2.6} />
              ) : (
                <i aria-hidden="true" />
              )}
              <span data-testid="appearance-apply-status" role="status">
                {!saved
                  ? "Unable to save locally"
                  : appearancePending
                    ? "Preview only"
                    : "Applied"}
              </span>
            </span>
            {appearancePending ? (
              <button
                className="cs-preview-ghost"
                data-testid="appearance-cancel"
                onClick={cancelDraft}
                type="button"
              >
                Cancel
              </button>
            ) : null}
            {previousAppearance ? (
              <button
                className="cs-preview-outline"
                data-testid="appearance-revert"
                onClick={() => {
                  if (applyBusinessAppearance(previousAppearance)) {
                    setPreviousAppearance(null);
                  }
                }}
                type="button"
              >
                Revert
              </button>
            ) : null}
            <button
              className="cs-preview-apply"
              data-testid="appearance-apply"
              disabled={!appearancePending}
              onClick={applyDraft}
              type="button"
            >
              Apply
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
