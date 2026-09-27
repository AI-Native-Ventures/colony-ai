import * as React from "react";
import { Check } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
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
import "./ThemeCatalogRoute.css";

type ThemeCatalogRouteProps = {
  onBack: () => void;
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
      className="w20-theme-card-preview h-[8.75rem] overflow-hidden rounded-[10px] border bg-background text-foreground"
      style={themeCardStyle(vars, palette)}
    >
      <div className="grid h-full grid-cols-[24%_minmax(0,1fr)]">
        <div className="w20-theme-card-sidebar" />
        <div className="flex min-w-0 flex-col gap-[13px] px-2.5 py-5">
          <p className="truncate text-badge leading-[1.5] font-bold">
            Campaign studio
          </p>
          <p className="truncate text-3xs">The designs are ready for review.</p>
          <p className="text-3xs" style={{ color: "var(--theme-accent)" }}>
            2 replies
          </p>
          <p className="truncate text-3xs">Message your team…</p>
        </div>
      </div>
    </div>
  );
}

function ThemeWorkspacePreview({ vars }: { vars: ThemePreviewVars }) {
  return (
    <section
      aria-label="Theme preview conversation"
      className="d17-theme-live"
      data-testid="theme-workspace-preview"
      style={themeWorkspaceStyle(vars)}
    >
      <aside className="text-xs">
        <strong className="text-sm">Lerato Social</strong>
        <span>Today</span>
        <span>Work</span>
        <small className="text-badge">Channels</small>
        <b className="text-2xs"># Campaign studio</b>
        <span># the-olive-house</span>
        <span># ideas</span>
        <small className="text-badge">Business</small>
        <span>Website</span>
        <span>Social</span>
        <span>Library</span>
        <footer className="text-2xs">LM · Lerato Molefe</footer>
      </aside>

      <section>
        <header className="text-compact">
          # Campaign studio <small className="text-badge">3 members</small>
        </header>
        <article>
          <b className="text-2xs">MN</b>
          <div>
            <strong className="text-xs">
              Maya Ndlovu <small className="text-badge">10:42</small>
            </strong>
            <p className="text-compact">
              The September designs are ready for feedback.
            </p>
            <div className="d17-design-card">
              <span className="text-xl">Autumn, softly.</span>
              <strong className="text-xs">Olive House · Campaign v3</strong>
              <small className="text-badge">Ready for review</small>
            </div>
            <small className="text-badge">2 replies</small>
          </div>
        </article>
        <article>
          <b className="text-2xs">LM</b>
          <div>
            <strong className="text-xs">
              Lerato Molefe <small className="text-badge">10:44</small>
            </strong>
            <p className="text-compact">
              Let&apos;s bring more warmth into the headline.
            </p>
          </div>
        </article>
        <footer className="text-2xs">
          Message Campaign studio… <span>＋ @ ♩</span>
        </footer>
      </section>
    </section>
  );
}

export function ThemeCatalogRoute({
  onBack,
  onPreview,
}: ThemeCatalogRouteProps) {
  const theme = useTheme();
  const previewVars = useThemePreviewVars();
  const catalogPalettes = useThemeCatalogPalettes();
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<"all" | "light" | "dark">("all");
  const filtered = SYNTAX_THEMES.filter((name) => {
    const matchesQuery = themeLabel(name)
      .toLowerCase()
      .includes(query.trim().toLowerCase());
    const matchesMode =
      filter === "all" ||
      (filter === "light" ? LIGHT_THEMES.has(name) : !LIGHT_THEMES.has(name));
    return matchesQuery && matchesMode;
  });

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
      <div className="mb-[30px] flex items-start justify-between gap-4">
        <div>
          <h2 className="text-settings-title font-semibold">
            Find your atmosphere.
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Named themes for your workspace. Only you see your choice.
          </p>
        </div>
        <Button onClick={onBack} size="sm" variant="outline">
          Back to appearance
        </Button>
      </div>
      <div className="mb-[25px] flex flex-wrap items-center gap-5">
        <label
          className="w-[260px] min-w-[260px] shrink-0"
          htmlFor="theme-catalog-search"
        >
          <Input
            aria-label="Search themes"
            className="w20-theme-catalog-search h-[43.5px] rounded-[8px] border-[#eae7eb] bg-[#f8f7f8] px-[14px] py-[11px] dark:border-[#39323f] dark:bg-[#29252f]"
            id="theme-catalog-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${SYNTAX_THEMES.length} themes`}
            type="search"
            value={query}
          />
        </label>
        <fieldset className="flex items-center gap-[5px]">
          <legend className="sr-only">Filter themes</legend>
          {(["all", "light", "dark"] as const).map((value) => (
            <button
              aria-pressed={filter === value}
              className={cn(
                "rounded-[20px] px-4 py-2 text-xs font-medium",
                filter === value
                  ? "bg-[#e6dbed] text-[#4d3a5e]"
                  : "text-muted-foreground hover:text-foreground",
              )}
              key={value}
              onClick={() => setFilter(value)}
              type="button"
            >
              {value.charAt(0).toUpperCase() + value.slice(1)}
            </button>
          ))}
        </fieldset>
        <span className="ml-auto text-xs text-muted-foreground">
          Current: {themeLabel(theme.selectedThemeName)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 xl:grid-cols-4">
        {filtered.map((name) => {
          const baseVars =
            previewVars[name] ?? getThemeFallbackPreviewVars(name);
          const vars =
            withAccentPreviewVars(baseVars, theme.accentColor) ?? baseVars;
          return (
            <button
              aria-label={`Preview ${themeLabel(name)}`}
              className="group min-w-0 rounded-xl text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              data-testid={`theme-catalog-${name}`}
              key={name}
              onClick={() => onPreview(name)}
              type="button"
            >
              <ThemeCardPreview palette={catalogPalettes[name]} vars={vars} />
              <span className="mt-2.5 flex items-center justify-between gap-2 text-xs leading-[1.125rem] font-medium">
                <span className="truncate">{themeLabel(name)}</span>
                {theme.selectedThemeName === name ? (
                  <Check
                    aria-label="Current theme"
                    className="size-3.5 shrink-0 text-foreground"
                  />
                ) : null}
              </span>
            </button>
          );
        })}
        {filtered.length === 0 ? (
          <div className="col-span-full py-[70px] text-center">
            <h2 className="text-base font-semibold">No themes found</h2>
            <p className="my-[15px] text-compact text-muted-foreground">
              Try another name or clear the filters.
            </p>
            <Button
              onClick={() => {
                setFilter("all");
                setQuery("");
              }}
              variant="outline"
            >
              Clear filters
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function ThemePreviewRoute({
  name,
  onBack,
  onApply,
}: {
  name: SyntaxThemeName;
  onBack: () => void;
  onApply: () => void;
}) {
  const theme = useTheme();
  const previewVars = useThemePreviewVars();
  const baseVars = previewVars[name] ?? getThemeFallbackPreviewVars(name);
  const vars = withAccentPreviewVars(baseVars, theme.accentColor) ?? baseVars;
  return (
    <section className="min-w-0" data-testid="settings-theme-preview">
      <div className="mb-7 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-settings-title font-semibold">
            {themeLabel(name)}
          </h2>
          <p className="d17-preview-intro mt-[9px] text-sm leading-[1.5]">
            Preview only. Apply when it feels right.
          </p>
        </div>
        <Button
          className="d17-preview-back"
          onClick={onBack}
          size="sm"
          variant="outline"
        >
          Back to themes
        </Button>
      </div>
      <div className="max-w-[59.375rem]">
        <ThemeWorkspacePreview vars={vars} />
        <div className="d17-preview-footer text-compact">
          <p>
            {LIGHT_THEMES.has(name) ? "Light" : "Dark"} palette ·{" "}
            {themeLabel(name)}
            <br />
            <small className="text-2xs">
              Message density and text size stay as you set them.
            </small>
          </p>
          <Button
            className="d17-preview-button"
            data-testid="theme-use"
            onClick={onApply}
            size="sm"
          >
            Use {themeLabel(name)}
          </Button>
        </div>
      </div>
    </section>
  );
}

export function ThemeAppliedRoute({
  name,
  onBack,
  onDone,
}: {
  name: SyntaxThemeName;
  onBack: () => void;
  onDone: () => void;
}) {
  const theme = useTheme();
  const previewVars = useThemePreviewVars();
  const baseVars = previewVars[name] ?? getThemeFallbackPreviewVars(name);
  const vars = withAccentPreviewVars(baseVars, theme.accentColor) ?? baseVars;
  return (
    <section className="min-w-0" data-testid="settings-theme-applied">
      <div className="mb-7 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-settings-title font-semibold">Theme applied</h2>
          <p className="d17-preview-intro mt-[9px] text-sm leading-[1.5]">
            Your personal appearance is updated.
          </p>
        </div>
        <Button
          className="d17-preview-back"
          onClick={onBack}
          size="sm"
          variant="outline"
        >
          Back to themes
        </Button>
      </div>
      <div className="max-w-[59.375rem]">
        <ThemeWorkspacePreview vars={vars} />
        <div className="d17-preview-footer text-compact">
          <p>
            {LIGHT_THEMES.has(name) ? "Light" : "Dark"} palette ·{" "}
            {themeLabel(name)}
            <br />
            <small className="text-2xs">
              Message density and text size stay as you set them.
            </small>
          </p>
          <Button className="d17-applied-button" onClick={onDone} size="sm">
            Done
          </Button>
        </div>
      </div>
    </section>
  );
}
