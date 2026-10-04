import { Mic, PanelRight } from "lucide-react";
import type * as React from "react";

import {
  LIGHT_THEMES,
  type SyntaxThemeName,
} from "@/shared/theme/theme-loader";

import {
  blendColor,
  customGradientStops,
  type AppearanceSnapshot,
} from "../lib/appearanceSnapshot";
import { conversationMessageSizeCss } from "../lib/conversationMessageSizePreference";
import { THEME_CATALOG_PALETTES } from "../lib/themeCatalogPalettes";

export const ACCENTS = [
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

export function MiniTheme({ custom }: { custom: boolean }) {
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

export function LiveAppearancePreview({
  preferences,
  isDark,
}: {
  preferences: AppearanceSnapshot;
  isDark: boolean;
}) {
  const palette =
    preferences.theme === "buzz" || preferences.theme === "buzz-dark"
      ? undefined
      : THEME_CATALOG_PALETTES[preferences.theme];
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
          "--ap-message-size": conversationMessageSizeCss(
            preferences.messageSize,
          ),
          "--ap-glass-alpha": `${preferences.glassOpacity}%`,
          ...(palette
            ? {
                "--ink": palette.foreground,
                "--muted": blendColor(
                  palette.foreground,
                  palette.background,
                  0.35,
                ),
                "--paper": palette.background,
                "--panel": palette.background,
                "--line": blendColor(
                  palette.foreground,
                  palette.background,
                  0.85,
                ),
                "--ap-window-paint": preferences.custom
                  ? `linear-gradient(155deg, ${first}, ${second})`
                  : `linear-gradient(${palette.background}, ${palette.background})`,
              }
            : {}),
        } as React.CSSProperties
      }
    >
      <div className="ap-desktop">
        <div
          className="ap-live-window"
          style={
            palette ? { backgroundImage: "var(--ap-window-paint)" } : undefined
          }
        >
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
