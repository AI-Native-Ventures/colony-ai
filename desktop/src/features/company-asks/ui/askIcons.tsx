import type * as React from "react";

/**
 * Glyphs the Raise-an-ask boards draw by hand (`AskCompose.dc.html`,
 * `AskEmpty.dc.html`, `AskMoney.dc.html`): the exact 24-unit paths from the
 * design, rounded strokes in `currentColor`. Sizes are design pixels (1/16 rem)
 * so the icons follow Cmd +/- zoom with the surrounding text.
 */
type AskIconProps = Omit<React.SVGProps<SVGSVGElement>, "children"> & {
  size?: number;
  strokeWidth?: number;
};

function createAskIcon(displayName: string, paths: React.ReactNode) {
  function Icon({ size = 19, strokeWidth = 2.2, ...props }: AskIconProps) {
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

export const AskApprovalIcon = createAskIcon(
  "AskApprovalIcon",
  <path d="m5 12 5 5 9-10" />,
);

export const AskQuestionIcon = createAskIcon(
  "AskQuestionIcon",
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.6 9.5a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2.1-2.4 3.5M12 17v.2" />
  </>,
);

export const AskChoiceIcon = createAskIcon(
  "AskChoiceIcon",
  <path d="M6 4v16M6 6h9l-2 3 2 3H6" />,
);

export const AskChecklistIcon = createAskIcon(
  "AskChecklistIcon",
  <>
    <rect height="16" rx="3" width="16" x="4" y="4" />
    <path d="m8 12 3 3 5-6" />
  </>,
);

export const AskVerdictIcon = createAskIcon(
  "AskVerdictIcon",
  <path d="M12 3.5v17M5 8h14M5 8l-2.5 6a3 3 0 0 0 5 0zM19 8l-2.5 6a3 3 0 0 0 5 0z" />,
);

export const AskHireIcon = createAskIcon(
  "AskHireIcon",
  <>
    <circle cx="10" cy="8.5" r="3.5" />
    <path d="M3.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6" />
  </>,
);

export const AskArrowRightIcon = createAskIcon(
  "AskArrowRightIcon",
  <path d="M5 12h14M13 6l6 6-6 6" />,
);

export const AskArrowUpRightIcon = createAskIcon(
  "AskArrowUpRightIcon",
  <path d="M7 17 17 7M9 7h8v8" />,
);

export const AskSearchIcon = createAskIcon(
  "AskSearchIcon",
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </>,
);

export const AskInfoIcon = createAskIcon(
  "AskInfoIcon",
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8v.2" />
  </>,
);

export const AskShieldIcon = createAskIcon(
  "AskShieldIcon",
  <path d="M12 3.5 19 6v6c0 4.5-3 7.5-7 8.5-4-1-7-4-7-8.5V6z" />,
);

export const AskDiamondIcon = createAskIcon(
  "AskDiamondIcon",
  <path d="M12 3 21 12 12 21 3 12z" />,
);

export const AskCloseIcon = createAskIcon(
  "AskCloseIcon",
  <path d="M6 6l12 12M18 6 6 18" />,
);

export const AskPlusIcon = createAskIcon(
  "AskPlusIcon",
  <path d="M12 5v14M5 12h14" />,
);

export const AskPersonIcon = createAskIcon(
  "AskPersonIcon",
  <>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </>,
);
