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

function sidebarStyle(name: string): React.CSSProperties {
  return {
    backgroundImage: LIGHT_THEMES.has(name as SyntaxThemeName)
      ? "linear-gradient(155deg, #eddbe9, #d9dcea)"
      : "linear-gradient(155deg, #56445f, #404458)",
  };
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

function ThemeWorkspacePreview({
  name,
  vars,
}: {
  name: SyntaxThemeName;
  vars: ThemePreviewVars;
}) {
  return (
    <div
      className="w20-theme-workspace-preview grid min-h-[29.75rem] grid-cols-[12.5rem_minmax(0,1fr)] overflow-hidden rounded-xl border border-border/80 bg-background text-foreground shadow-sm"
      data-testid="theme-workspace-preview"
      style={themeVarsStyle(vars)}
    >
      <aside
        className="flex min-h-0 flex-col gap-5 px-4 py-5 text-xs"
        style={sidebarStyle(name)}
      >
        <strong className="text-sm font-semibold">Lerato Social</strong>
        <div className="flex flex-col gap-3">
          <span>Today</span>
          <span>Work</span>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-2xs text-muted-foreground">Channels</span>
          <span className="rounded-md bg-foreground/10 px-2 py-1.5 font-medium">
            # Campaign studio
          </span>
          <span># the-olive-house</span>
          <span># ideas</span>
        </div>
        <div className="flex flex-col gap-3">
          <span className="text-2xs text-muted-foreground">Business</span>
          <span>Website</span>
          <span>Social</span>
          <span>Library</span>
        </div>
        <span className="mt-auto text-2xs">LM · Lerato Molefe</span>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/70 px-5">
          <strong className="text-sm font-semibold"># Campaign studio</strong>
          <span className="text-2xs text-muted-foreground">3 members</span>
        </header>
        <div className="flex min-h-0 flex-1 flex-col px-5 py-6">
          <div className="flex gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-xs font-semibold">
              MN
            </span>
            <div className="min-w-0">
              <p className="text-xs">
                <strong className="font-semibold">Maya Ndlovu</strong>{" "}
                <span className="text-2xs text-muted-foreground">10:42</span>
              </p>
              <p className="mt-2 text-sm">
                The September designs are ready for feedback.
              </p>
              <div className="mt-4 w-[17.5rem] overflow-hidden rounded-lg border border-border/80">
                <div className="flex h-20 items-center bg-gradient-to-br from-[#e7d8bc] to-[#c9d2c3] px-6 text-xl text-stone-700">
                  Autumn, softly.
                </div>
                <div className="space-y-1 px-3 py-2">
                  <p className="text-xs font-semibold">
                    Olive House · Campaign v3
                  </p>
                  <p className="text-2xs text-muted-foreground">
                    Ready for review
                  </p>
                </div>
              </div>
            </div>
          </div>
          <span className="ml-12 mt-4 text-2xs text-muted-foreground">
            2 replies
          </span>
          <div className="mt-7 flex gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-xs font-semibold">
              LM
            </span>
            <div>
              <p className="text-xs">
                <strong className="font-semibold">Lerato Molefe</strong>{" "}
                <span className="text-2xs text-muted-foreground">10:44</span>
              </p>
              <p className="mt-2 text-sm">
                Let&apos;s bring more warmth into the headline.
              </p>
            </div>
          </div>
          <div className="mt-auto flex h-11 shrink-0 items-center rounded-lg border border-border/80 px-3 text-xs text-muted-foreground">
            <span>Message Campaign studio...</span>
            <span className="ml-auto">+ @ ♪</span>
          </div>
        </div>
      </div>
    </div>
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
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">
            {themeLabel(name)}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Preview only. Apply when it feels right.
          </p>
        </div>
        <Button onClick={onBack} size="sm" variant="outline">
          Back to themes
        </Button>
      </div>
      <div className="max-w-[59.375rem]">
        <ThemeWorkspacePreview name={name} vars={vars} />
        <div className="mt-6 flex items-start justify-between gap-4">
          <p className="text-xs">
            {LIGHT_THEMES.has(name) ? "Light" : "Dark"} palette ·{" "}
            {themeLabel(name)}
            <span className="mt-1 block text-2xs text-muted-foreground">
              Message density and text size stay as you set them.
            </span>
          </p>
          <Button
            className="bg-[#5b4568] text-white hover:bg-[#4b3957]"
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
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">
            Theme applied
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Your personal appearance is updated.
          </p>
        </div>
        <Button onClick={onBack} size="sm" variant="outline">
          Back to themes
        </Button>
      </div>
      <div className="max-w-[59.375rem]">
        <ThemeWorkspacePreview name={name} vars={vars} />
        <div className="mt-6 flex items-start justify-between gap-4">
          <p className="text-xs">
            {LIGHT_THEMES.has(name) ? "Light" : "Dark"} palette ·{" "}
            {themeLabel(name)}
            <span className="mt-1 block text-2xs text-muted-foreground">
              Message density and text size stay as you set them.
            </span>
          </p>
          <Button
            className="bg-[#5b4568] text-white hover:bg-[#4b3957]"
            onClick={onDone}
            size="sm"
          >
            Done
          </Button>
        </div>
      </div>
    </section>
  );
}
