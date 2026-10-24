import type * as React from "react";

/** The icon shape a tab kind carries. Lucide icons and these both fit. */
export type WorkAreaTabIcon = React.ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

type IconProps = {
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
};

function icon(children: React.ReactNode): WorkAreaTabIcon {
  return function WorkAreaIcon({
    className,
    "aria-hidden": hidden,
  }: IconProps) {
    return (
      // biome-ignore lint/a11y/noSvgWithoutTitle: decorative; every use sets aria-hidden.
      <svg
        aria-hidden={hidden}
        className={className}
        fill="none"
        height="16"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        viewBox="0 0 24 24"
        width="16"
      >
        {children}
      </svg>
    );
  };
}

/** Tab icons drawn as the ChannelWorkArea board draws them. */
export const CanvasTabIcon = icon(
  <>
    <rect height="17" rx="3" width="17" x="3.5" y="3.5" />
    <path d="M7.5 8.5h9M7.5 12h9M7.5 15.5h5" />
  </>,
);

export const WorkTabIcon = icon(
  <>
    <rect height="15.5" rx="2.5" width="17" x="3.5" y="5" />
    <path d="M3.5 10h17M9 15l2 2 4-4" />
  </>,
);

export const FileTabIcon = icon(
  <>
    <path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5A.5.5 0 0 1 6.5 20V4a.5.5 0 0 1 .5-.5z" />
    <path d="M14 3.5V8h4" />
  </>,
);

export const TerminalTabIcon = icon(
  <>
    <rect height="15" rx="3" width="17" x="3.5" y="4.5" />
    <path d="m7.5 10 3 2.5-3 2.5M12.5 15h4" />
  </>,
);
