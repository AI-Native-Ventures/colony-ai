import * as React from "react";

import { Button } from "@/shared/ui/button";
import { useTheme } from "@/shared/theme/ThemeProvider";
import {
  LIGHT_THEMES,
  SYNTAX_THEMES,
  type SyntaxThemeName,
  extractThemeInfo,
  loadThemeData,
} from "@/shared/theme/theme-loader";
import type { ThemePreviewVars } from "@/shared/theme/ThemePreviewFrame";
import {
  getThemeFallbackPreviewVars,
  useThemePreviewVars,
  withAccentPreviewVars,
} from "@/shared/theme/useThemePreviewVars";
import { cn } from "@/shared/lib/cn";
import { SettingsOptionGroup } from "./SettingsOptionGroup";
import type { ConversationDensity } from "@/shared/lib/conversationDensityPreference";
import "./ThemeCatalogRoute.css";

type ThemeCatalogRouteProps = {
  onPreview: (name: SyntaxThemeName) => void;
};

type ThemeCatalogPalette = {
  background: string;
  foreground: string;
  accent: string;
};

function themeLabel(name: string): string {
  if (name === "buzz") return "Colony";
  if (name === "buzz-dark") return "Colony Dark";
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function themeVarsStyle(vars: ThemePreviewVars): React.CSSProperties {
  return vars as React.CSSProperties;
}

function themeWorkspaceStyle(vars: ThemePreviewVars): React.CSSProperties {
  const background = vars["--background"] ?? "0 0% 100%";
  const foreground = vars["--foreground"] ?? "0 0% 9%";
  const accent = vars["--status-added"] ?? foreground;
  return {
    ...themeVarsStyle(vars),
    "--theme-bg": `hsl(${background})`,
    "--theme-fg": `hsl(${foreground})`,
    "--theme-accent": `hsl(${accent})`,
  } as React.CSSProperties;
}

function themeCardStyle(
  vars: ThemePreviewVars,
  palette: ThemeCatalogPalette | undefined,
): React.CSSProperties {
  return {
    ...themeVarsStyle(vars),
    ...(palette
      ? { backgroundColor: palette.background, color: palette.foreground }
      : {}),
    borderColor: "#88888835",
    "--theme-accent":
      palette?.accent ??
      vars["--status-added"] ??
      `hsl(${vars["--foreground"]})`,
  } as React.CSSProperties;
}

function useThemeCatalogPalettes() {
  const [palettes, setPalettes] = React.useState<
    Partial<Record<SyntaxThemeName, ThemeCatalogPalette>>
  >({});

  React.useEffect(() => {
    let canceled = false;
    void Promise.all(
      SYNTAX_THEMES.map(async (name) => {
        const info = extractThemeInfo(name, await loadThemeData(name));
        return [
          name,
          {
            background: info.bg,
            foreground: info.fg,
            accent: info.added ?? info.fg,
          },
        ] as const;
      }),
    ).then((entries) => {
      if (!canceled) {
        setPalettes(Object.fromEntries(entries));
      }
    });

    return () => {
      canceled = true;
    };
  }, []);

  return palettes;
}

function ThemeCardPreview({
  palette,
  vars,
}: {
  palette: ThemeCatalogPalette | undefined;
  vars: ThemePreviewVars;
}) {
  return (
    <div
      aria-hidden="true"
      className="w20-theme-card-preview flex h-20 items-start rounded-md border px-1 py-0.5 text-sm"
      style={themeCardStyle(vars, palette)}
    >
      Aa
    </div>
  );
}

function ThemeWorkspacePreview({
  displayName,
  name,
  vars,
}: {
  displayName: string;
  name: string;
  vars: ThemePreviewVars;
}) {
  return (
    <section
      aria-label="Theme preview content"
      className="space-y-7 rounded-xl border border-border/70 bg-background p-6 text-foreground"
      data-testid="theme-workspace-preview"
      style={themeWorkspaceStyle(vars)}
    >
      <strong className="block text-sm">{themeLabel(name)}</strong>
      <p className="text-sm text-muted-foreground">Preview content only</p>
      <div className="rounded-lg border border-border/70 bg-card px-4 py-3 text-sm text-card-foreground">
        <p data-testid="theme-preview-person">{displayName}</p>
        <p className="mt-2 text-muted-foreground">Ready for review</p>
      </div>
    </section>
  );
}

export function ThemeCatalogRoute({ onPreview }: ThemeCatalogRouteProps) {
  const theme = useTheme();
  const previewVars = useThemePreviewVars();
  const catalogPalettes = useThemeCatalogPalettes();

  return (
    <section
      className="min-w-0"
      data-testid="settings-theme-catalog"
      data-theme-catalog-ready={
        Object.keys(catalogPalettes).length === SYNTAX_THEMES.length
          ? "true"
          : "false"
      }
    >
      <SettingsOptionGroup
        description="Preview first. Applying a theme and density saves one preference."
        title="Named themes"
      >
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
          {SYNTAX_THEMES.map((name) => {
            const baseVars =
              previewVars[name] ?? getThemeFallbackPreviewVars(name);
            const vars =
              withAccentPreviewVars(baseVars, theme.accentColor) ?? baseVars;
            return (
              <button
                aria-label={`Preview ${themeLabel(name)}`}
                className={cn(
                  "min-w-0 rounded-xl border border-border/70 bg-background p-3 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                  "hover:bg-muted/20",
                )}
                data-testid={`theme-catalog-${name}`}
                key={name}
                onClick={() => onPreview(name)}
                type="button"
              >
                <ThemeCardPreview palette={catalogPalettes[name]} vars={vars} />
                <span className="mt-2 block truncate text-sm font-semibold">
                  {themeLabel(name)}
                </span>
                <span className="mt-1 block text-2xs text-muted-foreground">
                  {LIGHT_THEMES.has(name) ? "Light" : "Dark"} · Preview
                </span>
              </button>
            );
          })}
        </div>
      </SettingsOptionGroup>
    </section>
  );
}

export function ThemePreviewRoute({
  density,
  displayName,
  name,
  onBack,
  onDensityChange,
  onApply,
}: {
  density: ConversationDensity;
  displayName: string;
  name: SyntaxThemeName;
  onBack: () => void;
  onDensityChange: (density: ConversationDensity) => void;
  onApply: () => void;
}) {
  const theme = useTheme();
  const previewVars = useThemePreviewVars();
  const baseVars = previewVars[name] ?? getThemeFallbackPreviewVars(name);
  const vars = withAccentPreviewVars(baseVars, theme.accentColor) ?? baseVars;
  return (
    <section className="min-w-0" data-testid="settings-theme-preview">
      <SettingsOptionGroup title="Theme preview">
        <div className="space-y-5 p-4">
          <ThemeWorkspacePreview
            displayName={displayName}
            name={name}
            vars={vars}
          />
          <label
            className="block space-y-2 text-sm"
            htmlFor="workspace-preview-message-density"
          >
            <span>Message density</span>
            <select
              className="h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="appearance-preview-density"
              id="workspace-preview-message-density"
              onChange={(event) =>
                onDensityChange(
                  event.target.value as Exclude<
                    ConversationDensity,
                    "spacious"
                  >,
                )
              }
              value={density === "spacious" ? "" : density}
            >
              <option disabled value="">
                Choose message density
              </option>
              <option value="compact">Compact</option>
              <option value="comfortable">Comfortable</option>
            </select>
          </label>
          <div className="flex flex-wrap gap-3 border-t border-border/70 pt-4">
            <Button data-testid="theme-use" onClick={onApply} size="sm">
              Apply appearance
            </Button>
            <Button onClick={onBack} size="sm" variant="outline">
              Cancel preview
            </Button>
          </div>
        </div>
      </SettingsOptionGroup>
    </section>
  );
}

export function ThemeAppliedRoute({
  density,
  name,
  onDone,
}: {
  density: ConversationDensity;
  name: SyntaxThemeName;
  onDone: () => void;
}) {
  return (
    <section className="min-w-0" data-testid="settings-theme-applied">
      <SettingsOptionGroup title="Appearance updated">
        <div className="space-y-4 p-4" role="status">
          <p className="text-sm text-muted-foreground">
            {themeLabel(name)} ·{" "}
            {density.charAt(0).toUpperCase() + density.slice(1)}. The preference
            is saved as one selection.
          </p>
          <Button onClick={onDone} size="sm" variant="outline">
            Return to Appearance
          </Button>
        </div>
      </SettingsOptionGroup>
    </section>
  );
}
