import type * as React from "react";
import {
  Anchor,
  BriefcaseBusiness,
  Car,
  Clapperboard,
  Dices,
  Factory,
  FlaskConical,
  HeartHandshake,
  Landmark,
  Leaf,
  Megaphone,
  Mountain,
  Pill,
  Plane,
  Radio,
  Recycle,
  Rocket,
  Shield,
  Truck,
  Umbrella,
  Users,
  Zap,
} from "lucide-react";

/**
 * The strokes the Colony 3.0 Discovery and Campaign boards draw. Every path is
 * the exact 24-unit path from the design; sizes are rem so the icons follow
 * Cmd +/- zoom with the rest of the screen.
 */
function Glyph({
  children,
  size = 18,
  strokeWidth = 2,
}: {
  children: React.ReactNode;
  /** Edge length in design pixels (1 design px = 1/16 rem). */
  size?: number;
  strokeWidth?: number;
}) {
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
    >
      {children}
    </svg>
  );
}

type IconProps = { size?: number; strokeWidth?: number };

export function SearchGlyph({ size = 20, strokeWidth = 2.2 }: IconProps) {
  return (
    <Glyph size={size} strokeWidth={strokeWidth}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4-4" />
    </Glyph>
  );
}

export function ReturnGlyph({ size = 14, strokeWidth = 2.4 }: IconProps) {
  return (
    <Glyph size={size} strokeWidth={strokeWidth}>
      <path d="M19 5v7a3 3 0 0 1-3 3H6M10 11l-4 4 4 4" />
    </Glyph>
  );
}

export function ArrowRightGlyph({ size = 18, strokeWidth = 2.4 }: IconProps) {
  return (
    <Glyph size={size} strokeWidth={strokeWidth}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Glyph>
  );
}

export function ArrowLeftGlyph({ size = 16, strokeWidth = 2.4 }: IconProps) {
  return (
    <Glyph size={size} strokeWidth={strokeWidth}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </Glyph>
  );
}

export function ChevronRightGlyph({ size = 17, strokeWidth = 2.4 }: IconProps) {
  return (
    <Glyph size={size} strokeWidth={strokeWidth}>
      <path d="m9 6 6 6-6 6" />
    </Glyph>
  );
}

export function CheckGlyph({ size = 15, strokeWidth = 2.8 }: IconProps) {
  return (
    <Glyph size={size} strokeWidth={strokeWidth}>
      <path d="m5 12 5 5 9-10" />
    </Glyph>
  );
}

export function CloseGlyph({ size = 15, strokeWidth = 2.6 }: IconProps) {
  return (
    <Glyph size={size} strokeWidth={strokeWidth}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Glyph>
  );
}

export function PlusGlyph({ size = 15, strokeWidth = 2.6 }: IconProps) {
  return (
    <Glyph size={size} strokeWidth={strokeWidth}>
      <path d="M12 5v14M5 12h14" />
    </Glyph>
  );
}

export function PinGlyph({ size = 15, strokeWidth = 2 }: IconProps) {
  return (
    <Glyph size={size} strokeWidth={strokeWidth}>
      <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15 12 21 12 21z" />
      <circle cx="12" cy="10" r="2.3" />
    </Glyph>
  );
}

export function DownloadGlyph({ size = 18, strokeWidth = 2.2 }: IconProps) {
  return (
    <Glyph size={size} strokeWidth={strokeWidth}>
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </Glyph>
  );
}

export function MessageGlyph({ size = 18, strokeWidth = 2 }: IconProps) {
  return (
    <Glyph size={size} strokeWidth={strokeWidth}>
      <path d="M20.5 12a8 8 0 0 1-11.7 7.1L4 20.5l1.4-4.6A8 8 0 1 1 20.5 12z" />
    </Glyph>
  );
}

export function InfoGlyph({ size = 18, strokeWidth = 2.2 }: IconProps) {
  return (
    <Glyph size={size} strokeWidth={strokeWidth}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5M12 8v.2" />
    </Glyph>
  );
}

export function NoticeGlyph({ size = 18, strokeWidth = 2.2 }: IconProps) {
  return (
    <Glyph size={size} strokeWidth={strokeWidth}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v4.5M12 16v.2" />
    </Glyph>
  );
}

/* ------------------------------------------------------------ industries -- */

const TILE_COLOURS = [
  "var(--colony-discovery-tile-rose)",
  "var(--colony-discovery-tile-amber)",
  "var(--colony-discovery-tile-blue)",
  "var(--colony-discovery-tile-violet)",
  "var(--colony-discovery-tile-green)",
  "var(--colony-discovery-tile-gold)",
] as const;

type IndustryArt = { tile: string; glyph: () => React.ReactNode };

type LucideGlyph = React.ComponentType<{
  className?: string;
  size?: number | string;
  strokeWidth?: number;
  "aria-hidden"?: boolean;
}>;

/** The industries the board draws, with the board's own tile and strokes. */
const DESIGN_INDUSTRIES: Record<string, IndustryArt> = {
  "fashion-apparel": {
    tile: "var(--colony-discovery-tile-rose)",
    glyph: () => (
      <path d="M8.5 4 12 6l3.5-2 4.5 3-2.5 3.5-2-1V20h-7V9.5l-2 1L4 7z" />
    ),
  },
  "home-living": {
    tile: "var(--colony-discovery-tile-amber)",
    glyph: () => (
      <>
        <path d="M3.5 11 12 4l8.5 7" />
        <path d="M6 9.5V20h12V9.5" />
      </>
    ),
  },
  healthcare: {
    tile: "var(--colony-discovery-tile-blue)",
    glyph: () => (
      <path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" />
    ),
  },
  legal: {
    tile: "var(--colony-discovery-tile-violet)",
    glyph: () => (
      <>
        <path d="M12 4v16M7.5 20h9M5 7.5h14" />
        <path d="M7 7.5 4.5 13a2.6 2.6 0 0 0 5 0zM17 7.5 14.5 13a2.6 2.6 0 0 0 5 0z" />
      </>
    ),
  },
  "financial-services": {
    tile: "var(--colony-discovery-tile-green)",
    glyph: () => (
      <>
        <path d="M3.5 9.5 12 4.5l8.5 5" />
        <path d="M5.5 10v7M10 10v7M14 10v7M18.5 10v7M3.5 19.5h17" />
      </>
    ),
  },
  "real-estate": {
    tile: "var(--colony-discovery-tile-gold)",
    glyph: () => (
      <>
        <rect height="17" rx="1.5" width="14" x="5" y="3.5" />
        <path d="M9 8h2M13 8h2M9 12h2M13 12h2M10.5 20.5v-4h3v4" />
      </>
    ),
  },
  technology: {
    tile: "#E9F0FC",
    glyph: () => (
      <>
        <rect height="11.5" rx="2" width="17" x="3.5" y="4.5" />
        <path d="M8.5 20h7M12 16v4" />
      </>
    ),
  },
  construction: {
    tile: "#FFF1E3",
    glyph: () => (
      <>
        <path d="M4 17.5h16v2.5H4z" />
        <path d="M6 17.5a6 6 0 0 1 12 0" />
        <path d="M12 11.5V5" />
      </>
    ),
  },
  education: {
    tile: "#EFEAFB",
    glyph: () => (
      <>
        <path d="M2.5 9 12 4.5 21.5 9 12 13.5z" />
        <path d="M6.5 11v4.5c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3V11" />
      </>
    ),
  },
  hospitality: {
    tile: "#E5F5EF",
    glyph: () => (
      <>
        <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15 12 21 12 21z" />
        <circle cx="12" cy="10" r="2.3" />
      </>
    ),
  },
  "food-beverage": {
    tile: "#FFF6DC",
    glyph: () => (
      <>
        <path d="M5 8.5h11v5a5.5 5.5 0 0 1-11 0z" />
        <path d="M16 9.5h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5v2M12 3.5v2" />
      </>
    ),
  },
  "beauty-wellness": {
    tile: "#FBEAF2",
    glyph: () => (
      <>
        <path d="M5 19c0-8 6-14 14-14 0 8-6 14-14 14z" />
        <path d="M5 19l8-8" />
      </>
    ),
  },
};

/** The industries the app has that the board does not draw. */
const FALLBACK_INDUSTRY_GLYPHS: Record<string, LucideGlyph> = {
  manufacturing: Factory,
  "professional-services": BriefcaseBusiness,
  transportation: Truck,
  agriculture: Leaf,
  energy: Zap,
  telecommunications: Radio,
  "media-entertainment": Clapperboard,
  security: Shield,
  automotive: Car,
  insurance: Umbrella,
  "marketing-advertising": Megaphone,
  "human-resources": Users,
  "environmental-services": Recycle,
  "non-profit": HeartHandshake,
  "mining-resources": Mountain,
  "aerospace-defense": Rocket,
  "government-public-sector": Landmark,
  chemicals: FlaskConical,
  "pharmaceuticals-life-sciences": Pill,
  "aviation-airlines": Plane,
  "marine-ports": Anchor,
  "gambling-casinos": Dices,
};

function tileFor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TILE_COLOURS[hash % TILE_COLOURS.length];
}

/** Pastel tile behind an industry's icon. */
export function industryTileColour(id: string): string {
  return DESIGN_INDUSTRIES[id]?.tile ?? tileFor(id);
}

/** An industry's icon at `size` design pixels; the board's art or a stroke fallback. */
export function IndustryGlyph({ id, size }: { id: string; size: number }) {
  const art = DESIGN_INDUSTRIES[id];
  if (art) {
    return (
      <Glyph size={size} strokeWidth={2}>
        {art.glyph()}
      </Glyph>
    );
  }
  const Fallback = FALLBACK_INDUSTRY_GLYPHS[id] ?? BriefcaseBusiness;
  return <Fallback aria-hidden size={`${size / 16}rem`} strokeWidth={2} />;
}
