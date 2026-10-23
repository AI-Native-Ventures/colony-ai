import type * as React from "react";

type ToolRisk = "low" | "medium" | "high";
export type HireTool = { name: string; risk: ToolRisk };

/**
 * Role packs record a risk level per tool, not an effect class. The boards show
 * what a tool does (Read, Changes data, External action), so the class is
 * derived from the risk the pack already carries.
 */
const EFFECTS: Record<ToolRisk, { tone: string; label: string }> = {
  low: { tone: "read", label: "Read" },
  medium: { tone: "change", label: "Changes data" },
  high: { tone: "external", label: "External action" },
};

export function toolChipText(tool: HireTool) {
  const effect = EFFECTS[tool.risk];
  return tool.risk === "low" ? `${effect.label} · Low risk` : effect.label;
}

export function ToolChip({ tool }: { tool: HireTool }) {
  return (
    <span
      className="colony-hire-chip"
      data-tone={EFFECTS[tool.risk].tone}
      data-testid="hire-tool-chip"
    >
      {toolChipText(tool)}
    </span>
  );
}

/** Plain-text tool line for the preview panel: "Web search · low risk". */
export function toolPlainText(tool: HireTool) {
  return `${tool.name} · ${tool.risk} risk`;
}

type GlyphProps = { size?: number; strokeWidth?: number } & Omit<
  React.SVGProps<SVGSVGElement>,
  "children"
>;

function glyph(paths: React.ReactNode, defaults: { strokeWidth: number }) {
  return function Glyph({
    size = 20,
    strokeWidth = defaults.strokeWidth,
    ...props
  }: GlyphProps) {
    const length = `${size / 16}rem`;
    return (
      <svg
        aria-hidden="true"
        fill="none"
        height={length}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
        viewBox="0 0 24 24"
        width={length}
        {...props}
      >
        {paths}
      </svg>
    );
  };
}

export const SearchGlyph = glyph(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4-4" />
  </>,
  { strokeWidth: 2 },
);

const ImageGlyph = glyph(
  <>
    <rect height="14" rx="3" width="17" x="3.5" y="5" />
    <path d="M7.5 15l3-3.5 2.5 2.5 3.5-4.5" />
  </>,
  { strokeWidth: 2 },
);

const DocumentGlyph = glyph(
  <>
    <path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5A.5.5 0 0 1 6.5 20V4a.5.5 0 0 1 .5-.5z" />
    <path d="M9.5 12.5h5M9.5 16h5" />
  </>,
  { strokeWidth: 2 },
);

const PersonGlyph = glyph(
  <>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20c.9-3.6 3.6-5.5 7-5.5s6.1 1.9 7 5.5" />
  </>,
  { strokeWidth: 2 },
);

export const PlusGlyph = glyph(<path d="M12 5v14M5 12h14" />, {
  strokeWidth: 2.2,
});

export const ArrowGlyph = glyph(<path d="M5 12h14M13 6l6 6-6 6" />, {
  strokeWidth: 2.4,
});

export const InfoGlyph = glyph(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 7.8v.2" />
  </>,
  { strokeWidth: 2.4 },
);

export const AlertGlyph = glyph(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8v4.5M12 16v.2" />
  </>,
  { strokeWidth: 2.4 },
);

const ExternalGlyph = glyph(<path d="M7 17 17 7M9 7h8v8" />, {
  strokeWidth: 2.2,
});

/** The glyph in front of a tool in the scope box: what the tool does. */
export function ToolGlyph({
  size = 18,
  tool,
}: {
  size?: number;
  tool: HireTool;
}) {
  if (tool.risk === "low") return <SearchGlyph size={size} strokeWidth={2.2} />;
  if (tool.risk === "medium") {
    return <DocumentGlyph size={size} strokeWidth={2.2} />;
  }
  return <ExternalGlyph size={size} />;
}

type RoleIconKind = "search" | "image" | "document" | "person";

/** Role packs carry no icon, so a stable one is picked from the title and job. */
export function roleIconKind(title: string, job: string): RoleIconKind {
  const text = `${title} ${job}`.toLowerCase();
  if (/research|search|scout|analy|insight|lead|discover/.test(text)) {
    return "search";
  }
  if (
    /social|media|content|design|market|brand|creative|photo|video/.test(text)
  ) {
    return "image";
  }
  if (
    /book|account|invoice|financ|money|admin|legal|record|tax|payroll/.test(
      text,
    )
  ) {
    return "document";
  }
  return "person";
}

export function RoleIcon({
  job,
  size = 20,
  title,
}: {
  job: string;
  size?: number;
  title: string;
}) {
  const kind = roleIconKind(title, job);
  if (kind === "search") return <SearchGlyph size={size} />;
  if (kind === "image") return <ImageGlyph size={size} />;
  if (kind === "document") return <DocumentGlyph size={size} />;
  return <PersonGlyph size={size} />;
}
