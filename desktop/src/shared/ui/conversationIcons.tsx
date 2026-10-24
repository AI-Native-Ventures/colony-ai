import type * as React from "react";

/**
 * Glyphs the Colony 3.0 conversation boards draw (header, message actions,
 * cards). Each is the exact 24-unit path from the design, drawn in
 * `currentColor`; sizes are design pixels turned into rem so they follow
 * Cmd +/- zoom with the rest of the screen.
 */
type IconProps = Omit<React.SVGProps<SVGSVGElement>, "children"> & {
  size?: number;
  strokeWidth?: number;
};

function createIcon(
  displayName: string,
  paths: React.ReactNode,
  defaults: { strokeWidth?: number; filled?: boolean } = {},
) {
  function Icon({
    size = 19,
    strokeWidth = defaults.strokeWidth ?? 2,
    ...props
  }: IconProps) {
    const length = `${size / 16}rem`;
    return (
      <svg
        aria-hidden="true"
        fill={defaults.filled ? "currentColor" : "none"}
        height={length}
        stroke={defaults.filled ? undefined : "currentColor"}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={defaults.filled ? undefined : strokeWidth}
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

export const WorkAreaToggleIcon = createIcon(
  "WorkAreaToggleIcon",
  <>
    <rect height="15" rx="3" width="17" x="3.5" y="4.5" />
    <path d="M13.5 4.5v15" />
  </>,
);

export const SearchGlyph = createIcon(
  "SearchGlyph",
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4-4" />
  </>,
  { strokeWidth: 2.2 },
);

export const KebabIcon = createIcon(
  "KebabIcon",
  <>
    <circle cx="12" cy="5.5" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="12" cy="18.5" r="1.8" />
  </>,
  { filled: true },
);

export const ReactIcon = createIcon(
  "ReactIcon",
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9.5 9.5v.5M14.5 9.5v.5" />
  </>,
);

export const ReplyBubbleIcon = createIcon(
  "ReplyBubbleIcon",
  <path d="M20 15.5a2.5 2.5 0 0 1-2.5 2.5H8l-4 3.5V6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5z" />,
);

export const RemindIcon = createIcon(
  "RemindIcon",
  <>
    <circle cx="12" cy="13" r="7.5" />
    <path d="M12 9.5V13l2.5 2M5 4 2.5 6.5M19 4l2.5 2.5" />
  </>,
  { strokeWidth: 2.2 },
);

export const FileGlyph = createIcon(
  "FileGlyph",
  <>
    <path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5A.5.5 0 0 1 6.5 20V4a.5.5 0 0 1 .5-.5z" />
    <path d="M14 3.5V8h4" />
  </>,
);

export const HeartGlyph = createIcon(
  "HeartGlyph",
  <path d="M12 20s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.6-7.5 10-7.5 10z" />,
  { filled: true },
);

export const JoinGlyph = createIcon(
  "JoinGlyph",
  <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l4-4-4-4M14 12H4" />,
  { strokeWidth: 2.2 },
);

export const ThumbsUpGlyph = createIcon(
  "ThumbsUpGlyph",
  <path d="M7.5 10.5v9h-3v-9zM7.5 10.5l3.5-6.5a2 2 0 0 1 3 1.9l-.6 3.6h5a2 2 0 0 1 2 2.4l-1.3 6.3a2 2 0 0 1-2 1.8H7.5" />,
);

export const CheckCircleGlyph = createIcon(
  "CheckCircleGlyph",
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m8.5 12.5 2.5 2.5 4.5-5" />
  </>,
  { strokeWidth: 2.2 },
);

export const LinkGlyph = createIcon(
  "LinkGlyph",
  <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
);

export const MarkUnreadGlyph = createIcon(
  "MarkUnreadGlyph",
  <path d="M4 6.5h16M4 12h10M4 17.5h7M18 15v6M15 18h6" />,
);

export const FollowThreadGlyph = createIcon(
  "FollowThreadGlyph",
  <>
    <path d="M20 15.5a2.5 2.5 0 0 1-2.5 2.5H8l-4 3.5V6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5z" />
    <path d="M12 8.5v5M9.5 11h5" />
  </>,
);

export const CopyGlyph = createIcon(
  "CopyGlyph",
  <>
    <rect height="11" rx="2.5" width="11" x="8.5" y="8.5" />
    <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
  </>,
);

export const AskGlyph = createIcon(
  "AskGlyph",
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.7M12 17v.2" />
  </>,
);

export const SendToChannelGlyph = createIcon(
  "SendToChannelGlyph",
  <path d="M5 9h14M4 15h14M10 4 8 20M16 4l-2 16" />,
);

export const PinGlyph = createIcon(
  "PinGlyph",
  <path d="M9 4.5h6l-1 6 3.5 3H6.5L10 10.5zM12 13.5v7" />,
);

export const FlagGlyph = createIcon(
  "FlagGlyph",
  <path d="M5.5 20.5V4.5M5.5 5h11l-2 4 2 4h-11" />,
);

export const TrashGlyph = createIcon(
  "TrashGlyph",
  <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />,
);

export const TimeoutGlyph = createIcon(
  "TimeoutGlyph",
  <>
    <circle cx="12" cy="13" r="7.5" />
    <path d="M12 9.5V13M9.5 2.5h5" />
  </>,
);

export const KickGlyph = createIcon(
  "KickGlyph",
  <path d="M15 4.5h3.5a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H15M10 16l4-4-4-4M14 12H4" />,
);

export const BanGlyph = createIcon(
  "BanGlyph",
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M6 6l12 12" />
  </>,
);

export const EditGlyph = createIcon(
  "EditGlyph",
  <path d="m4.5 19.5 1-4L16.2 4.8a2 2 0 0 1 2.8 2.8L8.3 18.3zM14.5 6.5l3 3" />,
);

export const ChevronLeftGlyph = createIcon(
  "ChevronLeftGlyph",
  <path d="m15 6-6 6 6 6" />,
  { strokeWidth: 2.4 },
);
