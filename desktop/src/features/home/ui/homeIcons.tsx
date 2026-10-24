import type * as React from "react";

/**
 * Glyphs the Home screens (Today and Activity) draw that the shell icon set
 * does not carry. Exact 24-unit paths from the design boards; sizes are rem.
 */
type IconProps = Omit<React.SVGProps<SVGSVGElement>, "children"> & {
  size?: number;
  strokeWidth?: number;
};

function createIcon(displayName: string, paths: React.ReactNode) {
  function Icon({ size = 18, strokeWidth = 2, ...props }: IconProps) {
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
  }
  Icon.displayName = displayName;
  return Icon;
}

export const BellIcon = createIcon(
  "BellIcon",
  <>
    <path d="M6 9.5a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15.5 6 9.5z" />
    <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
  </>,
);

export const AlertCircleIcon = createIcon(
  "AlertCircleIcon",
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8v4.5M12 16v.2" />
  </>,
);

export const WarningIcon = createIcon(
  "WarningIcon",
  <>
    <path d="M12 4 21 19.5H3z" />
    <path d="M12 10v4M12 17v.2" />
  </>,
);

export const FileIcon = createIcon(
  "FileIcon",
  <>
    <path d="M7 3.5h6.5L18 8v12.5H7z" />
    <path d="M13 3.5V8h5" />
  </>,
);

export const ClockIcon = createIcon(
  "ClockIcon",
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </>,
);

export const ExternalIcon = createIcon(
  "ExternalIcon",
  <>
    <path d="M14 4.5h5.5V10" />
    <path d="M19.5 4.5 11 13" />
    <path d="M17 14v4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 18V9a1.5 1.5 0 0 1 1.5-1.5H10" />
  </>,
);
