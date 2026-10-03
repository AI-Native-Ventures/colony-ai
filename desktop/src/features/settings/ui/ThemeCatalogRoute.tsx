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
import "./ThemeCatalogRoute.css";
import { THEME_CATALOG_PALETTES } from "../lib/themeCatalogPalettes";

type ThemeCatalogPalette = {
  background: string;
  foreground: string;
  accent: string;
};

function themeLabel(name: string): string {
  if (name === "buzz") return "Colony";
  if (name === "buzz-dark") return "Colony Dark";
  if (name === "aurora-x") return "Aurora X";
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function paletteStyle(
  palette: ThemeCatalogPalette | undefined,
): React.CSSProperties {
  return {
    "--theme-bg": palette?.background ?? "hsl(var(--background))",
    "--theme-fg": palette?.foreground ?? "hsl(var(--foreground))",
    "--theme-accent": palette?.accent ?? "hsl(var(--foreground))",
  } as React.CSSProperties;
}

function useThemeCatalogPalettes() {
  const [palettes, setPalettes] = React.useState<
    Partial<Record<SyntaxThemeName, ThemeCatalogPalette>>
  >({});
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let canceled = false;
    void Promise.all(
      SYNTAX_THEMES.map(async (name) => {
        const info = extractThemeInfo(name, await loadThemeData(name));
        return [
          name,
          THEME_CATALOG_PALETTES[name] ?? {
            background: info.bg,
            foreground: info.fg,
            accent: info.added ?? info.fg,
          },
        ] as const;
      }),
    )
      .then((entries) => {
        if (!canceled) setPalettes(Object.fromEntries(entries));
      })
      .catch(() => {
        if (!canceled) setFailed(true);
      });
    return () => {
      canceled = true;
    };
  }, []);
  return { palettes, failed };
}

function ThemeCardPreview({
  palette,
}: {
  palette: ThemeCatalogPalette | undefined;
}) {
  return (
    <span
      aria-hidden="true"
      className="d17-theme-mini"
      style={paletteStyle(palette)}
    >
      <i />
      <span>
        <b className="text-badge">Campaign studio</b>
        <em className="text-3xs">The designs are ready for review.</em>
        <small className="text-3xs">2 replies</small>
        <em className="text-3xs">Message your team…</em>
      </span>
    </span>
  );
}

function ThemeWorkspacePreview({
  name,
  palette,
}: {
  name: SyntaxThemeName;
  palette: ThemeCatalogPalette | undefined;
}) {
  return (
    <section
      aria-label={`${themeLabel(name)} workspace preview`}
      className="d17-theme-live"
      data-testid="theme-workspace-preview"
      style={paletteStyle(palette)}
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
              Let’s bring more warmth into the headline.
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
  onPreview,
  onBack,
}: {
  onPreview: (name: SyntaxThemeName) => void;
  onBack: () => void;
}) {
  const theme = useTheme();
  const { palettes, failed } = useThemeCatalogPalettes();
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState("All");
  const names = SYNTAX_THEMES.filter(
    (name) =>
      (filter === "All" || (filter === "Light") === LIGHT_THEMES.has(name)) &&
      themeLabel(name).toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <section
      className="d17-catalog"
      data-testid="settings-theme-catalog"
      data-theme-catalog-ready={
        Object.keys(palettes).length === SYNTAX_THEMES.length ? "true" : "false"
      }
    >
      <header className="d17-heading">
        <div>
          <h1 className="text-settings-title">Find your atmosphere.</h1>
          <p className="text-sm">
            Named themes for your workspace. Only you see your choice.
          </p>
        </div>
        <Button className="d17-preview-back" onClick={onBack} variant="outline">
          Back to appearance
        </Button>
      </header>
      <div className="d17-catalog-tools">
        <input
          aria-label="Search themes"
          className="text-compact"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={`Search ${SYNTAX_THEMES.length} themes`}
          type="search"
          value={query}
        />
        <fieldset className="d17-filter">
          <legend className="sr-only">Theme palette</legend>
          {["All", "Light", "Dark"].map((value) => (
            <button
              aria-pressed={filter === value}
              className="text-xs"
              key={value}
              onClick={() => setFilter(value)}
              type="button"
            >
              {value}
            </button>
          ))}
        </fieldset>
        <span className="text-xs">
          Current: {themeLabel(theme.selectedThemeName)}
        </span>
      </div>
      {failed ? (
        <p role="alert">
          Unable to load theme previews. Reopen themes to retry.
        </p>
      ) : null}
      <div className="d17-theme-grid">
        {names.map((name) => (
          <button
            aria-label={`Preview ${themeLabel(name)}`}
            aria-current={theme.selectedThemeName === name ? "true" : undefined}
            className="d17-theme-tile"
            data-testid={`theme-catalog-${name}`}
            key={name}
            onClick={() => onPreview(name)}
            type="button"
          >
            <ThemeCardPreview palette={palettes[name]} />
            <span className="text-xs">
              {themeLabel(name)}
              <b aria-hidden="true">
                {theme.selectedThemeName === name ? "✓" : ""}
              </b>
            </span>
          </button>
        ))}
        {names.length === 0 ? (
          <div className="d17-theme-empty">
            <h2>No themes found</h2>
            <p className="text-compact">
              Try another name or clear the filters.
            </p>
            <Button
              onClick={() => {
                setQuery("");
                setFilter("All");
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

function ThemeSelectionPage({
  name,
  applied,
  onBack,
  onApply,
  saveFailed = false,
}: {
  name: SyntaxThemeName;
  applied: boolean;
  onBack: () => void;
  onApply: () => void;
  saveFailed?: boolean;
}) {
  const { palettes, failed } = useThemeCatalogPalettes();
  return (
    <section
      className="d17-preview-page"
      data-testid={
        applied ? "settings-theme-applied" : "settings-theme-preview"
      }
    >
      <header className="d17-heading">
        <div>
          <h1 className="text-settings-title">
            {applied ? "Theme applied" : themeLabel(name)}
          </h1>
          <p className="text-sm" role={applied ? "status" : undefined}>
            {applied
              ? "Your personal appearance is updated."
              : "Preview only. Apply when it feels right."}
          </p>
        </div>
        <Button className="d17-preview-back" onClick={onBack} variant="outline">
          Back to themes
        </Button>
      </header>
      <ThemeWorkspacePreview name={name} palette={palettes[name]} />
      {failed ? (
        <p role="alert">
          Unable to load this preview. Back to themes to retry.
        </p>
      ) : null}
      {saveFailed ? (
        <p role="alert">
          Could not save. Your current theme is unchanged. Try again.
        </p>
      ) : null}
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
          className={applied ? "d17-applied-button" : "d17-preview-button"}
          data-testid={applied ? "theme-done" : "theme-use"}
          disabled={!applied && !palettes[name]}
          onClick={onApply}
        >
          {applied ? "Done" : `Use ${themeLabel(name)}`}
        </Button>
      </div>
    </section>
  );
}

export function ThemePreviewRoute(props: {
  name: SyntaxThemeName;
  onBack: () => void;
  onApply: () => void;
  saveFailed: boolean;
}) {
  return <ThemeSelectionPage {...props} applied={false} />;
}

export function ThemeAppliedRoute({
  name,
  onDone,
  onBack,
}: {
  name: SyntaxThemeName;
  onDone: () => void;
  onBack: () => void;
}) {
  return (
    <ThemeSelectionPage name={name} applied onApply={onDone} onBack={onBack} />
  );
}
