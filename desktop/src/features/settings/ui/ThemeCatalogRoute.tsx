import * as React from "react";
import { ArrowLeft, Check, Search } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { useTheme } from "@/shared/theme/ThemeProvider";
import {
  LIGHT_THEMES,
  SYNTAX_THEMES,
  type SyntaxThemeName,
} from "@/shared/theme/theme-loader";
import {
  BUZZ_GRADIENT_STOPS,
  ThemePreviewFrame,
} from "@/shared/theme/ThemePreviewFrame";
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

function miniPreviewMessage(isDark: boolean) {
  return (
    <div className="max-w-2xl overflow-hidden rounded-xl border border-border/70 bg-background shadow-sm">
      <div className="border-b border-border/60 px-4 py-3">
        <p className="text-sm font-semibold"># design</p>
        <p className="text-xs text-muted-foreground">
          A thoughtful place for the work.
        </p>
      </div>
      <div className="space-y-4 p-4">
        <div>
          <p className="text-sm font-semibold">
            Maya{" "}
            <span className="ml-1 text-2xs font-normal text-muted-foreground">
              10:42 AM
            </span>
          </p>
          <p className="mt-1 text-sm">
            The new designs are ready for your review.
          </p>
        </div>
        <div className="ml-8 border-l-2 border-primary/30 pl-3">
          <p className="text-xs font-medium">Lerato</p>
          <p className="mt-1 text-sm">
            I have added notes to the latest version.
          </p>
        </div>
        <div
          className={cn(
            "rounded-lg border border-border/60 p-3",
            isDark ? "bg-muted/30" : "bg-muted/45",
          )}
        >
          <p className="text-xs font-medium">Today</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your workspace, in a different light.
          </p>
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
      <Button className="mb-4 -ml-2" onClick={onBack} size="sm" variant="ghost">
        <ArrowLeft aria-hidden="true" className="mr-1 size-4" /> Back to
        appearance
      </Button>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            Find your atmosphere.
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Named themes for your workspace. Only you see your choice.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          Current: {themeLabel(theme.selectedThemeName)}
        </span>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <label
          className="relative min-w-52 flex-1"
          htmlFor="theme-catalog-search"
        >
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            className="pl-9"
            id="theme-catalog-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Search ${SYNTAX_THEMES.length} themes`}
            value={query}
          />
        </label>
        <fieldset className="flex gap-1 rounded-lg border border-border/70 bg-muted/35 p-1">
          <legend className="sr-only">Filter themes</legend>
          {(["all", "light", "dark"] as const).map((value) => (
            <button
              aria-pressed={filter === value}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium capitalize",
                filter === value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground",
              )}
              key={value}
              onClick={() => setFilter(value)}
              type="button"
            >
              {value}
            </button>
          ))}
        </fieldset>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {filtered.map((name) => {
          const vars = withAccentPreviewVars(
            previewVars[name] ?? getThemeFallbackPreviewVars(name),
            theme.accentColor,
          );
          return (
            <button
              aria-label={`Preview ${themeLabel(name)}`}
              className="group min-w-0 rounded-xl p-2 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              data-testid={`theme-catalog-${name}`}
              key={name}
              onClick={() => onPreview(name)}
              type="button"
            >
              <ThemePreviewFrame
                className="aspect-[1.52] w-full overflow-hidden rounded-lg border border-border/60 transition-shadow group-hover:shadow-md"
                sidebarGradient={BUZZ_GRADIENT_STOPS[name]}
                vars={vars}
              />
              <span className="mt-2 flex items-center justify-between gap-2 text-xs font-medium">
                <span className="truncate">{themeLabel(name)}</span>
                {theme.selectedThemeName === name ? (
                  <Check
                    aria-label="Current theme"
                    className="size-3.5 shrink-0 text-primary"
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
  const vars = withAccentPreviewVars(
    previewVars[name] ?? getThemeFallbackPreviewVars(name),
    theme.accentColor,
  );
  return (
    <section className="min-w-0" data-testid="settings-theme-preview">
      <Button className="mb-4 -ml-2" onClick={onBack} size="sm" variant="ghost">
        <ArrowLeft aria-hidden="true" className="mr-1 size-4" /> Back to themes
      </Button>
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            {themeLabel(name)}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Preview only. Apply when it feels right.
          </p>
        </div>
        <Button data-testid="theme-use" onClick={onApply} size="sm">
          Use theme
        </Button>
      </div>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(16rem,0.7fr)_minmax(0,1.3fr)]">
        <ThemePreviewFrame
          className="aspect-[1.52] w-full overflow-hidden rounded-xl border border-border/60"
          sidebarGradient={BUZZ_GRADIENT_STOPS[name]}
          vars={vars}
        />
        {miniPreviewMessage(!LIGHT_THEMES.has(name))}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        {LIGHT_THEMES.has(name) ? "Light" : "Dark"} palette · Message density
        and text size stay as you set them.
      </p>
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
  return (
    <section className="min-w-0" data-testid="settings-theme-applied">
      <Button className="mb-4 -ml-2" onClick={onBack} size="sm" variant="ghost">
        <ArrowLeft aria-hidden="true" className="mr-1 size-4" /> Back to themes
      </Button>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-primary">Theme applied</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">
            Your personal appearance is updated.
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {themeLabel(name)}
          </p>
        </div>
        <Button onClick={onDone} size="sm">
          Done
        </Button>
      </div>
      {miniPreviewMessage(!LIGHT_THEMES.has(name))}
    </section>
  );
}
