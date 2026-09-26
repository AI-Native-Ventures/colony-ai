import * as React from "react";
import { Check, Search } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useTheme } from "@/shared/theme/ThemeProvider";
import {
  LIGHT_THEMES,
  SYNTAX_THEMES,
  type SyntaxThemeName,
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

function ThemeCardPreview({
  name,
  vars,
}: {
  name: SyntaxThemeName;
  vars: ThemePreviewVars;
}) {
  return (
    <div
      aria-hidden="true"
      className="w20-theme-card-preview aspect-[1.86] overflow-hidden rounded-xl border border-border/70 bg-background text-foreground"
      style={themeVarsStyle(vars)}
    >
      <div className="grid h-full grid-cols-[24%_minmax(0,1fr)]">
        <div style={sidebarStyle(name)} />
        <div className="flex min-w-0 flex-col gap-3 px-3 py-4">
          <p className="truncate text-3xs font-medium">Campaign studio</p>
          <p className="truncate text-3xs text-muted-foreground">
            The designs are ready for review.
          </p>
          <p className="text-3xs text-emerald-600 dark:text-emerald-400">
            2 replies
          </p>
          <p className="truncate text-3xs text-muted-foreground">
            Message your team...
          </p>
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
    <section className="min-w-0" data-testid="settings-theme-catalog">
      <div className="mb-7 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">
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
      <div className="mb-5 flex flex-wrap items-center gap-5">
        <label
          className="relative w-64 shrink-0"
          htmlFor="theme-catalog-search"
        >
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            className="h-11 pl-9"
            id="theme-catalog-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${SYNTAX_THEMES.length} themes`}
            value={query}
          />
        </label>
        <fieldset className="flex items-center gap-1">
          <legend className="sr-only">Filter themes</legend>
          {(["all", "light", "dark"] as const).map((value) => (
            <button
              aria-pressed={filter === value}
              className={cn(
                "rounded-full px-4 py-2.5 text-sm font-medium capitalize",
                filter === value
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
              key={value}
              onClick={() => setFilter(value)}
              type="button"
            >
              {value}
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
              <ThemeCardPreview name={name} vars={vars} />
              <span className="mt-2 flex items-center justify-between gap-2 text-xs font-medium">
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
          <p className="col-span-full py-12 text-center text-sm text-muted-foreground">
            No themes match that search.
          </p>
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
