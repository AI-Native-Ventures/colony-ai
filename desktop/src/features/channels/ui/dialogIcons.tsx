import type * as React from "react";

/**
 * Glyphs the Colony 3.0 conversation dialogs and panels draw (Report, Delete,
 * Leave, Browse, Channel settings, Channel members). Every path is the exact
 * 24-unit path from the design boards, stroked in `currentColor`; sizes are rem
 * so they follow Cmd +/- zoom. The shell's own set lives in
 * `shared/ui/colonyIcons.tsx`; these are the ones only these surfaces use.
 */
type DialogIconProps = Omit<React.SVGProps<SVGSVGElement>, "children"> & {
  /** Edge length in design pixels (1 design px = 1/16 rem). */
  size?: number;
  strokeWidth?: number;
};

function createIcon(
  displayName: string,
  paths: React.ReactNode,
  defaults: { strokeWidth?: number; fill?: string } = {},
) {
  function Icon({
    size = 19,
    strokeWidth = defaults.strokeWidth ?? 2,
    ...props
  }: DialogIconProps) {
    const length = `${size / 16}rem`;
    return (
      <svg
        aria-hidden="true"
        fill={defaults.fill ?? "none"}
        height={length}
        stroke={defaults.fill ? undefined : "currentColor"}
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
  }
  Icon.displayName = displayName;
  return Icon;
}

export const FlagGlyph = createIcon(
  "FlagGlyph",
  <path d="M5.5 20.5V4.5M5.5 5h11l-2 4 2 4h-11" />,
);

export const TrashGlyph = createIcon(
  "TrashGlyph",
  <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />,
);

export const TrashLinedGlyph = createIcon(
  "TrashLinedGlyph",
  <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />,
);

export const LeaveGlyph = createIcon(
  "LeaveGlyph",
  <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 16l4-4-4-4M19 12H9" />,
);

export const LeaveRowGlyph = createIcon(
  "LeaveRowGlyph",
  <path d="M15 4.5h3.5a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H15M10 16l4-4-4-4M14 12H4" />,
);

export const ArchiveGlyph = createIcon(
  "ArchiveGlyph",
  <>
    <rect height="4.5" rx="1.5" width="17" x="3.5" y="4.5" />
    <path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4" />
  </>,
);

export const CopyGlyph = createIcon(
  "CopyGlyph",
  <>
    <rect height="11" rx="2.5" width="11" x="8.5" y="8.5" />
    <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
  </>,
);

export const CanvasGlyph = createIcon(
  "CanvasGlyph",
  <>
    <rect height="17" rx="3" width="17" x="3.5" y="3.5" />
    <path d="M7.5 8.5h9M7.5 12h9M7.5 15.5h5" />
  </>,
);

export const SearchGlyph = createIcon(
  "SearchGlyph",
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4-4" />
  </>,
);

export const ClockDashedGlyph = createIcon(
  "ClockDashedGlyph",
  <>
    <path d="M12 3.5a8.5 8.5 0 1 1-8 5.6" />
    <path d="M12 7.5V12l3 2" />
    <path d="M4 4.5v4.5h4.5" strokeDasharray="2 2.5" />
  </>,
);

export const GlobeGlyph = createIcon(
  "GlobeGlyph",
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z" />
  </>,
);

export const ChevronDownGlyph = createIcon(
  "ChevronDownGlyph",
  <path d="m6 9 6 6 6-6" />,
);

export const ChevronRightGlyph = createIcon(
  "ChevronRightGlyph",
  <path d="m9 6 6 6-6 6" />,
);

export const MoreHorizontalGlyph = createIcon(
  "MoreHorizontalGlyph",
  <>
    <circle cx="5.5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="18.5" cy="12" r="1.8" />
  </>,
  { fill: "currentColor" },
);

export const SpeechGlyph = createIcon(
  "SpeechGlyph",
  <path d="M5 5.5h14A1.5 1.5 0 0 1 20.5 7v8.5A1.5 1.5 0 0 1 19 17h-7.5L7 20.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z" />,
);
