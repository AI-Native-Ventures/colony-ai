import * as React from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Mic,
  PanelRight,
  UsersRound,
} from "lucide-react";

import { useCommunities } from "@/features/communities/useCommunities";
import { useIdentityQuery } from "@/shared/api/hooks";
import {
  ACCENT_STORAGE_KEY,
  GLASS_BACKGROUND_STORAGE_KEY,
  useTheme,
} from "@/shared/theme/ThemeProvider";
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
  blendColor,
  customGradientStops,
  isValidHexColor,
  writeAppearanceSnapshot,
  type AppearanceSnapshot,
} from "../lib/appearanceSnapshot";
import { applyConversationMessageSize } from "../lib/conversationMessageSizePreference";

type AppearanceMode = "system" | "light" | "dark";
type AppearanceSettingsPanelProps = {
  onOpenThemeCatalog: () => void;
  onBackToWorkspace?: () => void;
};

const ACCENTS = [
  ["Violet", "#895AF6"],
  ["Neutral", "#74717B"],
  ["Blue", "#3B82F6"],
  ["Cyan", "#06B6D4"],
  ["Green", "#22C55E"],
  ["Orange", "#F97316"],
  ["Red", "#EF4444"],
  ["Pink", "#EC4899"],
  ["Lilac", "#C0A2F1"],
  ["Purple", "#A855F7"],
  ["Indigo", "#6366F1"],
] as const;

const DEFAULT_CUSTOM_COLORS: [string, string] = ["#895AF6", "#5A9CF6"];

const appearancePreviewIconPaths = {
  home: "M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z",
  work: "M5 4h14v17H5Z M9 4V2h6v2M8 10h8M8 14h5",
  globe:
    "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18",
  grid: "M3 3h7v7H3ZM14 3h7v7h-7ZM3 14h7v7H3ZM14 14h7v7h-7Z",
  folder: "M3 6h7l2 3h9v11H3Z",
} as const;

function AppearancePreviewIcon({
  name,
}: {
  name: keyof typeof appearancePreviewIconPaths;
}) {
  return (
    <svg
      aria-hidden="true"
      className="icon"
      fill="none"
      focusable="false"
      height="24"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.65}
      viewBox="0 0 24 24"
      width="24"
    >
      <path d={appearancePreviewIconPaths[name]} />
    </svg>
  );
}

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

export function currentAppearanceSnapshot(
  theme: ReturnType<typeof useTheme>,
): AppearanceSnapshot {
  let density: ConversationDensity = "comfortable";
  let linkPreview: LinkPreviewStyle = "compact";
  let threadLayout: ThreadViewMode = "split";
  let glassBackground = theme.glassBackground;
  let accent = theme.accentColor || "#895AF6";
  try {
    density = getConversationDensity();
    linkPreview = getLinkPreviewStyle();
    threadLayout = getThreadViewMode();
  } catch {
    // Use safe defaults when a preference store is unavailable during startup.
  }
  try {
    const savedAccent = window.localStorage.getItem(ACCENT_STORAGE_KEY);
    accent = savedAccent === null ? "#895AF6" : savedAccent;
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
    customLight: [...DEFAULT_CUSTOM_COLORS],
    customDark: [...DEFAULT_CUSTOM_COLORS],
    glassBackground,
    glassOpacity: theme.glassOpacity,
    prominentActiveTab: theme.prominentActiveTab,
    messageSize: "default",
    density,
    linkPreview,
    threadLayout,
  };
}

export function readAppearanceSnapshot(
  key: string,
): Partial<AppearanceSnapshot> | null {
  try {
    const value = window.localStorage.getItem(key);
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<AppearanceSnapshot>;
    return parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function mergeAppearanceSnapshot(
  base: AppearanceSnapshot,
  value: Partial<AppearanceSnapshot> | null,
): AppearanceSnapshot {
  if (!value) return base;
  const colors = (candidate: unknown): [string, string] | null => {
    if (
      Array.isArray(candidate) &&
      candidate.length === 2 &&
      candidate.every(
        (color) => typeof color === "string" && isValidHexColor(color),
      )
    ) {
      return [candidate[0], candidate[1]];
    }
    return null;
  };
  const customLight = colors(value.customLight) ?? base.customLight;
  const customDark = colors(value.customDark) ?? base.customDark;
  return {
    ...base,
    ...value,
    version: 1,
    theme: typeof value.theme === "string" ? value.theme : base.theme,
    accent:
      typeof value.accent === "string" &&
      (isValidHexColor(value.accent) || value.accent === "neutral")
        ? value.accent === "neutral"
          ? "#74717B"
          : value.accent
        : base.accent,
    custom: value.custom === true,
    customLight,
    customDark,
    glassBackground: value.glassBackground === true,
    glassOpacity:
      typeof value.glassOpacity === "number"
        ? Math.max(30, Math.min(90, value.glassOpacity))
        : base.glassOpacity,
    prominentActiveTab:
      typeof value.prominentActiveTab === "boolean"
        ? value.prominentActiveTab
        : base.prominentActiveTab,
    messageSize:
      value.messageSize === "smaller" ||
      value.messageSize === "default" ||
      value.messageSize === "larger"
        ? value.messageSize
        : base.messageSize,
    density:
      value.density === "compact" ||
      value.density === "comfortable" ||
      value.density === "spacious"
        ? value.density
        : base.density,
    linkPreview:
      value.linkPreview === "compact" || value.linkPreview === "rich"
        ? value.linkPreview
        : base.linkPreview,
    threadLayout:
      value.threadLayout === "focus" || value.threadLayout === "split"
        ? value.threadLayout
        : base.threadLayout,
  };
}

function loadPreferences(
  base: AppearanceSnapshot,
  business: Partial<AppearanceSnapshot> | null,
  conversations: Partial<AppearanceSnapshot> | null,
): AppearanceSnapshot {
  const businessSnapshot = mergeAppearanceSnapshot(base, business);
  if (!conversations) return businessSnapshot;
  const globalSnapshot = mergeAppearanceSnapshot(
    businessSnapshot,
    conversations,
  );
  return {
    ...businessSnapshot,
    messageSize: globalSnapshot.messageSize,
    density: globalSnapshot.density,
    linkPreview: globalSnapshot.linkPreview,
    threadLayout: globalSnapshot.threadLayout,
  };
}

function SegmentedChoices<T extends string>({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string;
  value: T;
  options: readonly [T, string][];
  onChange: (next: T) => void;
  testId: string;
}) {
  return (
    <div className="ap-control">
      <fieldset className="ap-segment">
        <legend className="sr-only">{label}</legend>
        {options.map(([option, optionLabel]) => (
          <button
            aria-pressed={option === value}
            data-testid={`${testId}-${option}`}
            key={option}
            onClick={() => onChange(option)}
            type="button"
          >
            {optionLabel}
          </button>
        ))}
      </fieldset>
    </div>
  );
}

function AppearanceRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ap-row">
      <div>
        <strong>{title}</strong>
        {description ? <p>{description}</p> : null}
      </div>
      {children}
    </div>
  );
}

function SwitchControl({
  label,
  checked,
  onChange,
  testId,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  testId: string;
  disabled?: boolean;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="ap-switch"
      data-testid={testId}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <i aria-hidden="true" />
    </button>
  );
}

function MiniTheme({ custom }: { custom: boolean }) {
  return (
    <span aria-hidden="true" className={`ap-mini${custom ? " custom" : ""}`}>
      <i className="ap-mini-nav">
        <b />
        <b />
        <b />
        <b />
      </i>
      <i className="ap-mini-content">
        <b />
        <span />
        <span />
        <em />
      </i>
    </span>
  );
}

function LiveAppearancePreview({
  preferences,
  isDark,
}: {
  preferences: AppearanceSnapshot;
  isDark: boolean;
}) {
  const baseColor =
    ACCENTS.find(
      ([, hex]) => hex.toLowerCase() === preferences.accent.toLowerCase(),
    )?.[1] ?? "#895AF6";
  const color = blendColor(
    baseColor,
    isDark ? "#FFFFFF" : "#000000",
    isDark ? 0.5 : 0.35,
  );
  const softColor = blendColor(
    baseColor,
    isDark ? "#1C1C1C" : "#FFFFFF",
    isDark ? 0.86 : 0.88,
  );
  const [first, second] = preferences.custom
    ? customGradientStops(
        preferences.customLight,
        preferences.followSystem
          ? isDark
            ? "dark"
            : "light"
          : LIGHT_THEMES.has(preferences.theme as SyntaxThemeName)
            ? "light"
            : "dark",
      )
    : ["transparent", "transparent"];
  return (
    <div
      className={[
        "ap-preview",
        preferences.custom ? "ap-custom" : "",
        preferences.glassBackground ? "ap-glass" : "",
        preferences.prominentActiveTab ? "ap-prominent" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid="appearance-live-preview"
      style={
        {
          "--ap-accent": color,
          "--ap-soft": softColor,
          "--ap-t1": first,
          "--ap-t2": second,
          "--ap-message-size":
            preferences.messageSize === "smaller"
              ? "0.8125rem"
              : preferences.messageSize === "larger"
                ? "0.9375rem"
                : "0.875rem",
          "--ap-glass-alpha": `${preferences.glassOpacity}%`,
        } as React.CSSProperties
      }
    >
      <div className="ap-desktop">
        <div className="ap-live-window">
          <div className="ap-live-top">
            <span aria-hidden="true">● ● ●</span>
            <span>colony</span>
            <PanelRight aria-hidden="true" className="icon" />
          </div>
          <div className="ap-live-body">
            <aside className="ap-live-nav">
              <strong>Lerato Social</strong>
              <span>
                <AppearancePreviewIcon name="home" /> Today
              </span>
              <span>
                <AppearancePreviewIcon name="work" /> Work
              </span>
              <small>Channels</small>
              <span className="selected"># the-olive-house</span>
              <span># studio</span>
              <span># design</span>
              <small>Business</small>
              <span>
                <AppearancePreviewIcon name="globe" /> Website
              </span>
              <span>
                <AppearancePreviewIcon name="grid" /> Social
              </span>
              <span>
                <AppearancePreviewIcon name="folder" /> Library
              </span>
              <div className="ap-live-person">
                <span>LM</span> Lerato
              </div>
            </aside>
            <div
              className={`ap-live-chat${preferences.threadLayout === "focus" ? " focused" : ""}`}
            >
              <header>
                # the-olive-house <span>3 members</span>
              </header>
              <div className="ap-demo-message">
                <span className="ap-demo-avatar">M</span>
                <div>
                  <strong>
                    Mina <small>10:42</small>
                  </strong>
                  <p>The spring campaign is ready for your feedback.</p>
                  <div className={`ap-demo-link ${preferences.linkPreview}`}>
                    {preferences.linkPreview === "rich" ? (
                      <div className="ap-demo-art">
                        <span>SPRING, SLOWLY.</span>
                        <i />
                      </div>
                    ) : (
                      <span className="ap-demo-link-icon">↗</span>
                    )}
                    <div>
                      <strong>Spring collection</strong>
                      <small>theolivehouse.example</small>
                    </div>
                  </div>
                  <span className="ap-demo-replies">2 replies</span>
                </div>
              </div>
              <div className="ap-demo-message human">
                <span className="ap-demo-avatar">L</span>
                <div>
                  <strong>
                    Lerato <small>10:44</small>
                  </strong>
                  <p>Love this direction. Let’s soften the headline.</p>
                </div>
              </div>
              <div className="ap-demo-thread">
                <header>
                  <span>
                    {preferences.threadLayout === "focus"
                      ? "← Thread"
                      : "Thread"}
                  </span>
                  <span>×</span>
                </header>
                <p>
                  <strong>Mina</strong>
                  <br />
                  I’ll update the design and send a new version.
                </p>
                <div>
                  Reply to thread… <Mic aria-hidden="true" className="icon" />
                </div>
              </div>
              <div className="ap-live-compose">
                Message #the-olive-house…
                <span>
                  <span aria-hidden="true">＋</span>
                  <i>@</i>
                  <Mic aria-hidden="true" />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppearanceSettingsPanel({
  onOpenThemeCatalog,
  onBackToWorkspace,
}: AppearanceSettingsPanelProps) {
  const theme = useTheme();
  const { activeCommunity } = useCommunities();
  const identity = useIdentityQuery();
  const personId = identity.data?.pubkey ?? activeCommunity?.pubkey ?? "local";
  const businessId = activeCommunity?.id ?? "local-business";
  const businessName = activeCommunity?.name ?? "your business";
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
  const [saved, setSaved] = React.useState(true);
  const [undoSnapshot, setUndoSnapshot] =
    React.useState<AppearanceSnapshot | null>(null);
  const [hexDrafts, setHexDrafts] = React.useState<[string, string]>(() => [
    ...preferences.customLight,
  ]);
  const isDark = theme.isDark;

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
    const base = changedBusiness
      ? {
          ...currentRef.current,
          theme: "buzz",
          accent: "#895AF6",
          followSystem: true,
          custom: false,
          customLight: [...DEFAULT_CUSTOM_COLORS] as [string, string],
          customDark: [...DEFAULT_CUSTOM_COLORS] as [string, string],
          glassBackground: false,
          glassOpacity: 65,
          prominentActiveTab: false,
        }
      : currentRef.current;
    const next = loadPreferences(base, business, global);
    setPreferences(next);
    setHexDrafts([...next.customLight]);
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
      themeRef.current.applyAppearance({
        theme: next.theme as SyntaxThemeName,
        accent: next.accent,
        followSystem: next.followSystem,
      });
      themeRef.current.setGlassBackground(
        glassBackgroundSupported && next.glassBackground,
      );
      themeRef.current.setGlassOpacity(next.glassOpacity);
      themeRef.current.setProminentActiveTab(next.prominentActiveTab);
    }
    applyConversationMessageSize(next.messageSize);
    if (global) {
      setConversationDensity(next.density);
      setLinkPreviewStyle(next.linkPreview);
      setThreadViewMode(next.threadLayout);
    }
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
    const root = document.documentElement;
    if (preferences.custom) {
      const mode = preferences.followSystem
        ? isDark
          ? "dark"
          : "light"
        : LIGHT_THEMES.has(preferences.theme as SyntaxThemeName)
          ? "light"
          : "dark";
      const [first, second] = customGradientStops(
        preferences.customLight,
        mode,
      );
      root.style.setProperty("--w20-custom-gradient-start", first);
      root.style.setProperty("--w20-custom-gradient-end", second);
      root.classList.add("w20-custom-appearance");
    } else {
      root.style.removeProperty("--w20-custom-gradient-start");
      root.style.removeProperty("--w20-custom-gradient-end");
      root.classList.remove("w20-custom-appearance");
    }
  }, [
    isDark,
    preferences.custom,
    preferences.customLight,
    preferences.followSystem,
    preferences.theme,
  ]);

  const commit = React.useCallback(
    (
      patch: Partial<AppearanceSnapshot>,
      scope: "business" | "conversations" = "business",
    ) => {
      const next: AppearanceSnapshot = {
        ...preferences,
        ...patch,
        version: 1,
      };
      setPreferences(next);
      if (scope === "conversations") setHexDrafts([...next.customLight]);
      const key = scope === "conversations" ? globalKey : businessKey;
      try {
        if (!writeAppearanceSnapshot(window.localStorage, key, next)) {
          setSaved(false);
          return;
        }
        setSaved(true);
      } catch {
        setSaved(false);
        return;
      }

      if (
        patch.theme !== undefined ||
        patch.accent !== undefined ||
        patch.followSystem !== undefined
      ) {
        theme.applyAppearance({
          theme: next.theme as SyntaxThemeName,
          accent: next.accent,
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
    },
    [businessKey, globalKey, preferences, theme, glassBackgroundSupported],
  );

  function selectMode(mode: AppearanceMode) {
    commit({
      theme: themeForMode(preferences.theme, mode),
      followSystem: mode === "system",
    });
  }

  function updateColor(index: 0 | 1, value: string) {
    const colors: [string, string] = [...preferences.customLight];
    colors[index] = value;
    const darkColors: [string, string] = [...preferences.customDark];
    darkColors[index] = value;
    setHexDrafts([...colors]);
    commit({ customLight: colors, customDark: darkColors, custom: true });
  }

  function resetAppearance() {
    setUndoSnapshot(preferences);
    const resetTheme = SYNTAX_THEMES.includes("buzz" as SyntaxThemeName)
      ? "buzz"
      : preferences.theme;
    commit({
      theme: resetTheme,
      accent: "#895AF6",
      followSystem: true,
      custom: false,
      customLight: [...DEFAULT_CUSTOM_COLORS],
      customDark: [...DEFAULT_CUSTOM_COLORS],
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
  const [accentTint, accentSoft] = React.useMemo(() => {
    const accent = preferences.accent;
    const tint = isDark ? "#ffffff" : "#000000";
    const softBase = isDark ? "#1c1c1c" : "#ffffff";
    const blend = (hex: string, base: string, amount: number) => {
      const parse = (value: string) =>
        [1, 3, 5].map((offset) =>
          Number.parseInt(value.slice(offset, offset + 2), 16),
        );
      const a = parse(hex);
      const b = parse(base);
      return `#${a
        .map((channel, index) =>
          Math.round(channel * amount + b[index] * (1 - amount))
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")}`;
    };
    return [
      blend(accent, tint, isDark ? 0.5 : 0.65),
      blend(accent, softBase, isDark ? 0.14 : 0.12),
    ];
  }, [isDark, preferences.accent]);

  React.useEffect(() => {
    document.documentElement.style.setProperty(
      "--w20-appearance-accent",
      accentTint,
    );
  }, [accentTint]);

  return (
    <div
      className="ap-page ap-appearance w20-appearance"
      data-testid="settings-appearance"
      style={
        {
          "--ap-accent": accentTint,
          "--ap-soft": accentSoft,
          "--ap-glass-alpha": `${preferences.glassOpacity}%`,
          "--ap-t1": customGradientStops(
            preferences.customLight,
            isDark ? "dark" : "light",
          )[0],
          "--ap-t2": customGradientStops(
            preferences.customLight,
            isDark ? "dark" : "light",
          )[1],
        } as React.CSSProperties
      }
    >
      <header className="ap-heading">
        <div>
          <h1 className="text-settings-title">Make yourself at home.</h1>
          <p>Your appearance in {businessName}.</p>
        </div>
        <span className="ap-scope">
          <UsersRound aria-hidden="true" className="icon" /> Only you
        </span>
      </header>
      <div className="ap-appearance-grid">
        <section
          aria-label="Appearance controls"
          className="ap-controls-scroll"
        >
          <button
            className="ap-named-themes"
            data-testid="appearance-open-themes"
            onClick={onOpenThemeCatalog}
            type="button"
          >
            <span>
              <strong>Named themes</strong>
              <small>Browse 62 palettes. Preview before applying.</small>
            </span>
            <span>Browse themes →</span>
          </button>
          <section className="ap-section">
            <h2>Appearance</h2>
            <AppearanceRow title="Colour mode">
              <div className="ap-control">
                <fieldset className="ap-segment">
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
              </div>
            </AppearanceRow>
            <div className="ap-style-row">
              <strong>Theme style</strong>
              <fieldset className="ap-style-options">
                <legend className="sr-only">Theme style</legend>
                {([false, true] as const).map((custom) => (
                  <button
                    aria-label={`${custom ? "Custom" : "Default"} theme style`}
                    aria-pressed={preferences.custom === custom}
                    className="ap-style-option"
                    data-testid={`appearance-theme-${custom ? "custom" : "default"}`}
                    key={String(custom)}
                    onClick={() => commit({ custom })}
                    type="button"
                  >
                    <MiniTheme custom={custom} />
                    <span>
                      {custom ? "Custom" : "Default"}
                      <i>
                        {preferences.custom === custom ? (
                          <Check aria-hidden="true" className="icon" />
                        ) : null}
                      </i>
                    </span>
                  </button>
                ))}
              </fieldset>
            </div>
            {preferences.custom ? (
              <div className="ap-colours">
                {([0, 1] as const).map((index) => (
                  <label key={index}>
                    {index === 0 ? "First colour" : "Second colour"}
                    <span>
                      <input
                        aria-label={
                          index === 0
                            ? "Pick first gradient colour"
                            : "Pick second gradient colour"
                        }
                        data-testid={`appearance-color-picker-${index + 1}`}
                        onChange={(event) =>
                          updateColor(index, event.target.value)
                        }
                        type="color"
                        value={preferences.customLight[index]}
                      />
                      <input
                        aria-invalid={!isValidHexColor(hexDrafts[index])}
                        aria-label={
                          index === 0
                            ? "First gradient colour"
                            : "Second gradient colour"
                        }
                        data-testid={`appearance-color-hex-${index + 1}`}
                        maxLength={7}
                        onBlur={() => {
                          if (!isValidHexColor(hexDrafts[index])) {
                            setHexDrafts([...preferences.customLight]);
                          }
                        }}
                        onChange={(event) => {
                          const value = event.target.value;
                          setHexDrafts((currentDrafts) => {
                            const next: [string, string] = [...currentDrafts];
                            next[index] = value;
                            return next;
                          });
                          if (isValidHexColor(value)) updateColor(index, value);
                        }}
                        pattern="#[a-fA-F0-9]{6}"
                        spellCheck={false}
                        type="text"
                        value={hexDrafts[index].toUpperCase()}
                      />
                    </span>
                  </label>
                ))}
                <p
                  className="ap-colour-error"
                  role="alert"
                  hidden={hexDrafts.every(isValidHexColor)}
                >
                  Use a six-digit hex colour, such as #895AF6.
                </p>
              </div>
            ) : null}
            <AppearanceRow title="Accent colour">
              <fieldset className="ap-accents">
                <legend className="sr-only">Accent colour</legend>
                {ACCENTS.map(([label, hex]) => (
                  <button
                    aria-label={`${label} accent`}
                    aria-pressed={
                      preferences.accent.toLowerCase() === hex.toLowerCase()
                    }
                    className="ap-accent"
                    data-testid={`appearance-accent-${label.toLowerCase()}`}
                    key={label}
                    onClick={() => commit({ accent: hex })}
                    title={label}
                    type="button"
                  >
                    <i style={{ backgroundColor: hex }} />
                  </button>
                ))}
              </fieldset>
            </AppearanceRow>
          </section>
          <section className="ap-section">
            <h2>Window</h2>
            <AppearanceRow
              description={
                glassBackgroundSupported
                  ? "Translucent navigation. Solid content."
                  : "Translucent navigation. Solid content."
              }
              title="Glass background"
            >
              <SwitchControl
                checked={
                  glassBackgroundSupported && preferences.glassBackground
                }
                label="Glass background"
                onChange={(glassBackground) => commit({ glassBackground })}
                testId="appearance-glass"
                disabled={!glassBackgroundSupported}
              />
            </AppearanceRow>
            {glassBackgroundSupported && preferences.glassBackground ? (
              <AppearanceRow title="Glass opacity">
                <div className="ap-control ap-range-control">
                  <input
                    aria-label="Glass opacity"
                    data-testid="appearance-glass-opacity"
                    max={90}
                    min={30}
                    onChange={(event) =>
                      commit({ glassOpacity: Number(event.target.value) })
                    }
                    type="range"
                    value={preferences.glassOpacity}
                  />
                  <output>{preferences.glassOpacity}%</output>
                </div>
              </AppearanceRow>
            ) : null}
            <AppearanceRow title="Prominent selected tab">
              <SwitchControl
                checked={preferences.prominentActiveTab}
                label="Prominent selected tab"
                onChange={(prominentActiveTab) =>
                  commit({ prominentActiveTab })
                }
                testId="appearance-prominent"
              />
            </AppearanceRow>
          </section>
          <section className="ap-section">
            <h2>
              Conversations <small>All businesses</small>
            </h2>
            <AppearanceRow title="Message size">
              <label className="ap-control ap-select-label">
                <span className="sr-only">Message size</span>
                <select
                  aria-label="Message size"
                  data-testid="appearance-message-size"
                  onChange={(event) =>
                    commit(
                      {
                        messageSize: event.target
                          .value as AppearanceSnapshot["messageSize"],
                      },
                      "conversations",
                    )
                  }
                  value={preferences.messageSize}
                >
                  <option value="smaller">Smaller</option>
                  <option value="default">Default</option>
                  <option value="larger">Larger</option>
                </select>
                <ChevronDown aria-hidden="true" className="icon" />
              </label>
            </AppearanceRow>
            <AppearanceRow title="Density">
              <label className="ap-control ap-select-label">
                <span className="sr-only">Conversation density</span>
                <select
                  aria-label="Conversation density"
                  data-testid="appearance-density"
                  onChange={(event) =>
                    commit(
                      { density: event.target.value as ConversationDensity },
                      "conversations",
                    )
                  }
                  value={preferences.density}
                >
                  <option value="compact">Compact</option>
                  <option value="comfortable">Comfortable</option>
                  <option value="spacious">Spacious</option>
                </select>
                <ChevronDown aria-hidden="true" className="icon" />
              </label>
            </AppearanceRow>
            <AppearanceRow title="Link previews">
              <SegmentedChoices
                label="Link previews"
                onChange={(linkPreview) =>
                  commit(
                    { linkPreview: linkPreview as LinkPreviewStyle },
                    "conversations",
                  )
                }
                options={[
                  ["compact", "Compact"],
                  ["rich", "Rich"],
                ]}
                testId="appearance-links"
                value={preferences.linkPreview}
              />
            </AppearanceRow>
            <AppearanceRow title="Thread layout">
              <SegmentedChoices
                label="Thread layout"
                onChange={(threadLayout) =>
                  commit(
                    { threadLayout: threadLayout as ThreadViewMode },
                    "conversations",
                  )
                }
                options={[
                  ["split", "Side by side"],
                  ["focus", "Focused"],
                ]}
                testId="appearance-threads"
                value={preferences.threadLayout}
              />
            </AppearanceRow>
            <AppearanceRow title="Typeface">
              <span className="ap-value">Manrope</span>
            </AppearanceRow>
          </section>
          <div className="ap-reset">
            <button
              className="ap-text-button"
              data-testid="appearance-reset"
              onClick={resetAppearance}
              type="button"
            >
              Reset appearance
            </button>
            {undoSnapshot ? (
              <button
                className="ap-text-button"
                onClick={undoReset}
                type="button"
              >
                Undo reset
              </button>
            ) : null}
          </div>
        </section>
        <aside aria-label="Appearance preview" className="ap-preview-column">
          <div className="ap-preview-label">
            <span>Live preview</span>
            <span>
              <PanelRight aria-hidden="true" className="icon" /> Conversation
            </span>
          </div>
          <LiveAppearancePreview isDark={isDark} preferences={preferences} />
          <p className="ap-preview-note">
            {preferences.glassBackground
              ? "Glass is illustrated here. Desktop blur requires the native app."
              : "Colours stay in the window; your work stays easy to read."}
          </p>
          {onBackToWorkspace ? (
            <button
              className="ap-preview-link"
              data-testid="appearance-try-workspace"
              onClick={onBackToWorkspace}
              type="button"
            >
              Try it in your workspace{" "}
              <ArrowRight aria-hidden="true" className="icon" />
            </button>
          ) : null}
        </aside>
      </div>
      <footer className="ap-foot">
        <span>
          {saved ? <CheckCircle2 aria-hidden="true" className="icon" /> : null}
          {saved
            ? `Saved for you in ${businessName}`
            : "Unable to save locally"}
        </span>
        <span>Local appearance preview</span>
      </footer>
    </div>
  );
}
