import type * as React from "react";

/**
 * Glyphs for the account menu, the status and avatar dialogs and the profile
 * panel. Exact 24-unit paths from the design boards (`ProfilePopover`,
 * `EditAvatar`, `ProfilePanel`); sizes are rem so they follow Cmd +/- zoom.
 */
type IconProps = Omit<React.SVGProps<SVGSVGElement>, "children"> & {
  /** Edge length in design pixels (1 design px = 1/16 rem). */
  size?: number;
  strokeWidth?: number;
};

function createIcon(
  displayName: string,
  paths: React.ReactNode,
  defaults: { fill?: string; round?: boolean } = {},
) {
  function Icon({ size = 18, strokeWidth = 2, ...props }: IconProps) {
    const length = `${size / 16}rem`;
    return (
      <svg
        aria-hidden="true"
        fill={defaults.fill ?? "none"}
        height={length}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin={defaults.round === false ? undefined : "round"}
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

export const StatusFaceIcon = createIcon(
  "StatusFaceIcon",
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9.5 9.5v.5M14.5 9.5v.5" />
  </>,
  { round: false },
);

export const CameraIcon = createIcon(
  "CameraIcon",
  <>
    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
    <circle cx="12" cy="13" r="3.5" />
  </>,
);

export const FeedbackIcon = createIcon(
  "FeedbackIcon",
  <path d="M5 5.5h14A1.5 1.5 0 0 1 20.5 7v8.5A1.5 1.5 0 0 1 19 17h-7.5L7 20.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z" />,
);

export const ChevronDownIcon = createIcon(
  "ChevronDownIcon",
  <path d="m6 9 6 6 6-6" />,
);

export const UploadIcon = createIcon(
  "UploadIcon",
  <path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9M5 19.5h14" />,
);

export const PencilIcon = createIcon(
  "PencilIcon",
  <path d="m14.5 5.5 4 4L8 20H4v-4z" />,
);

export const CopyGlyphIcon = createIcon(
  "CopyGlyphIcon",
  <>
    <rect height="12" rx="2" width="12" x="8" y="8" />
    <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
  </>,
);

export const DocumentIcon = createIcon(
  "DocumentIcon",
  <>
    <path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5A.5.5 0 0 1 6.5 20V4a.5.5 0 0 1 .5-.5z" />
    <path d="M14 3.5V8h4M9.5 12.5h5M9.5 16h5" />
  </>,
);

export const MonitorIcon = createIcon(
  "MonitorIcon",
  <>
    <rect height="12" rx="2" width="18" x="3" y="4.5" />
    <path d="M8.5 20h7M12 16.5V20" />
  </>,
);

/** Quick statuses: one glyph per preset, coloured by the row. */
export const MeetingIcon = createIcon(
  "MeetingIcon",
  <>
    <circle cx="9" cy="8.5" r="3" />
    <circle cx="16.5" cy="9.5" r="2.5" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0M14.5 15a4.5 4.5 0 0 1 6 4" />
  </>,
  { round: false },
);

export const CommuteIcon = createIcon(
  "CommuteIcon",
  <>
    <rect height="13" rx="3" width="14" x="5" y="4" />
    <path d="M5 11h14M8 20l1-3M16 20l-1-3" />
    <circle cx="8.5" cy="14" r=".6" />
    <circle cx="15.5" cy="14" r=".6" />
  </>,
);

export const SickIcon = createIcon(
  "SickIcon",
  <>
    <path d="M14 4.5a2 2 0 0 0-4 0v9.3a4 4 0 1 0 4 0z" />
    <path d="M12 10v6" />
  </>,
);

export const VacationIcon = createIcon(
  "VacationIcon",
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
  </>,
  { round: false },
);

export const HomeOfficeIcon = createIcon(
  "HomeOfficeIcon",
  <>
    <path d="M3.5 11 12 4l8.5 7" />
    <path d="M6 9.5V20h12V9.5" />
  </>,
);

/** The four avatar presets after Initials; fills match the board. */
export const StarGlyph = createIcon(
  "StarGlyph",
  <path d="M12 2.5c.9 5 4.5 8.6 9.5 9.5-5 .9-8.6 4.5-9.5 9.5-.9-5-4.5-8.6-9.5-9.5 5-.9 8.6-4.5 9.5-9.5z" />,
  { fill: "currentColor", round: false },
);

export const LeafGlyph = createIcon(
  "LeafGlyph",
  <>
    <path d="M5 19c0-8.5 5.5-13.5 14.5-14 0 9-5.5 14-14.5 14z" />
    <path d="M5 19l7.5-7.5" />
  </>,
);

export const DiamondGlyph = createIcon(
  "DiamondGlyph",
  <>
    <path d="M12 3l9 9-9 9-9-9z" />
    <path d="M12 8.5l3.5 3.5-3.5 3.5-3.5-3.5z" fill="currentColor" />
  </>,
  { round: false },
);

export const SunGlyph = createIcon(
  "SunGlyph",
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
  </>,
  { round: false },
);

export const FlowerGlyph = createIcon(
  "FlowerGlyph",
  <>
    <circle cx="12" cy="6.8" r="3.2" />
    <circle cx="16.9" cy="10.4" r="3.2" />
    <circle cx="15" cy="16.2" r="3.2" />
    <circle cx="9" cy="16.2" r="3.2" />
    <circle cx="7.1" cy="10.4" r="3.2" />
    <circle cx="12" cy="12" r="1.8" fill="currentColor" />
  </>,
  { round: false },
);
