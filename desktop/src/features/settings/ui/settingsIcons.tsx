import type * as React from "react";

/**
 * Icons the Settings pages use that the shell icon set does not carry. Every
 * glyph is the exact 24-unit path from the design boards, drawn as a rounded
 * stroke in `currentColor`; sizes are rem so they follow Cmd +/- zoom.
 */
type IconProps = Omit<React.SVGProps<SVGSVGElement>, "children"> & {
  /** Edge length in design pixels (1 design px = 1/16 rem). */
  size?: number;
  strokeWidth?: number;
};

function createIcon(displayName: string, paths: React.ReactNode, round = true) {
  function Icon({ size = 18, strokeWidth = 2, ...props }: IconProps) {
    const length = `${size / 16}rem`;
    return (
      <svg
        aria-hidden="true"
        fill="none"
        height={length}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin={round ? "round" : undefined}
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

export const AccountIcon = createIcon(
  "AccountIcon",
  <>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </>,
  false,
);

export const AppearanceIcon = createIcon(
  "AppearanceIcon",
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 3.5v17M12 3.5a8.5 8.5 0 0 1 0 17" />
  </>,
  false,
);

export const PreferencesIcon = createIcon(
  "PreferencesIcon",
  <>
    <path d="M6 9.5a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15.5 6 9.5z" />
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
  </>,
);

export const SettingsBusinessIcon = createIcon(
  "SettingsBusinessIcon",
  <>
    <path d="M4 20.5V8.5l8-5 8 5v12" />
    <path d="M9.5 20.5v-6h5v6" />
  </>,
);

/** Agents: an outlined cell, as the design draws the Settings row. */
export const SettingsAgentsIcon = createIcon(
  "SettingsAgentsIcon",
  <path d="M7 4.5h10l5 7.5-5 7.5H7L2 12z" />,
  true,
);

export const BlocksIcon = createIcon(
  "BlocksIcon",
  <>
    <rect height="17" rx="3" width="17" x="3.5" y="3.5" />
    <path d="M3.5 9.5h17M9.5 9.5v11" />
  </>,
  false,
);

export const DeviceIcon = createIcon(
  "DeviceIcon",
  <>
    <rect height="11.5" rx="2" width="17" x="3.5" y="4.5" />
    <path d="M8.5 20h7M12 16v4" />
  </>,
);

export const OnlyYouIcon = createIcon(
  "OnlyYouIcon",
  <>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </>,
  false,
);

export const StatusFaceIcon = createIcon(
  "StatusFaceIcon",
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9.5 9.5v.5M14.5 9.5v.5" />
  </>,
  false,
);

export const CopyIcon = createIcon(
  "CopyIcon",
  <>
    <rect height="11" rx="2" width="11" x="9" y="9" />
    <path d="M5 15V6a2 2 0 0 1 2-2h8" />
  </>,
);

export const MinusIcon = createIcon("MinusIcon", <path d="M6 12h12" />, false);

export const CheckSmallIcon = createIcon(
  "CheckSmallIcon",
  <path d="m5 12 5 5 9-10" />,
);
