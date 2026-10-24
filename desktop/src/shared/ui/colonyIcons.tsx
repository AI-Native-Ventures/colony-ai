import type * as React from "react";

/**
 * The Colony 3.0 icon set used by the shell. Every glyph is the exact 24-unit
 * path from the design (`Sidebar.dc.html`), drawn as a rounded stroke in
 * `currentColor`, so a row only has to set its text colour. Sizes are rem so
 * the icons follow Cmd +/- zoom with the rest of the shell.
 */
type ColonyIconProps = Omit<React.SVGProps<SVGSVGElement>, "children"> & {
  /** Edge length in design pixels (1 design px = 1/16 rem). */
  size?: number;
  strokeWidth?: number;
};

export function createIcon(
  displayName: string,
  paths: React.ReactNode,
  defaults: { strokeWidth?: number; round?: boolean; fill?: string } = {},
) {
  function Icon({
    size = 19,
    strokeWidth = defaults.strokeWidth ?? 2,
    ...props
  }: ColonyIconProps) {
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

export const TodayIcon = createIcon(
  "TodayIcon",
  <>
    <path d="M3.5 11 12 4l8.5 7" />
    <path d="M6 9.5V20h12V9.5" />
  </>,
);

export const ActivityIcon = createIcon(
  "ActivityIcon",
  <>
    <rect height="16" rx="2.5" width="13" x="5.5" y="4.5" />
    <path d="M9.5 3.5h5v3h-5z" />
    <path d="m9.5 13.5 2 2 3.5-4" />
  </>,
);

export const SavedIcon = createIcon(
  "SavedIcon",
  <path d="M7 3.5h10v17l-5-3.8-5 3.8z" />,
);

export const CompanyIcon = createIcon(
  "CompanyIcon",
  <>
    <path d="M4 20.5V8.5l8-5 8 5v12" />
    <path d="M9.5 20.5v-6h5v6" />
  </>,
);

export const BusinessIcon = createIcon(
  "BusinessIcon",
  <>
    <rect height="12.5" rx="2.5" width="17" x="3.5" y="7.5" />
    <path d="M9 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.5v2" />
    <path d="M3.5 12.5h17" />
  </>,
);

export const FactoryIcon = createIcon(
  "FactoryIcon",
  <path d="M3.5 20.5v-10l5.5 3.5v-3.5l5.5 3.5V6.5l6 3.5v10.5z" />,
);

export const LibraryIcon = createIcon(
  "LibraryIcon",
  <>
    <rect height="17" rx="3" width="17" x="3.5" y="3.5" />
    <path d="M3.5 9.5h17M9.5 9.5v11" />
  </>,
);

export const PrivateChannelIcon = createIcon(
  "PrivateChannelIcon",
  <>
    <rect height="10" rx="2.5" width="14" x="5" y="10.5" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </>,
);

export const HashIcon = createIcon(
  "HashIcon",
  <path d="M5 9h14M4 15h14M10 4 8 20M16 4l-2 16" />,
  { round: false },
);

export const ForumIcon = createIcon(
  "ForumIcon",
  <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5z" />,
);

export const PlusIcon = createIcon("PlusIcon", <path d="M12 5v14M5 12h14" />, {
  strokeWidth: 2.4,
  round: false,
});

export const ChevronRightIcon = createIcon(
  "ChevronRightIcon",
  <path d="m9 6 6 6-6 6" />,
  { strokeWidth: 2.4 },
);

export const ChevronLeftIcon = createIcon(
  "ChevronLeftIcon",
  <path d="M15 6l-6 6 6 6" />,
  { strokeWidth: 2.4 },
);

export const SearchIcon = createIcon(
  "SearchIcon",
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4-4" />
  </>,
  { strokeWidth: 2.2, round: false },
);

export const CollapseSidebarIcon = createIcon(
  "CollapseSidebarIcon",
  <>
    <rect height="15" rx="3" width="17" x="3.5" y="4.5" />
    <path d="M9.5 4.5v15" />
  </>,
);

export const ExpandSidebarIcon = createIcon(
  "ExpandSidebarIcon",
  <>
    <rect height="15" rx="3" width="17" x="3.5" y="4.5" />
    <path d="M9.5 4.5v15M13 10l2 2-2 2" />
  </>,
);

export const PowerIcon = createIcon(
  "PowerIcon",
  <path d="M13 3 5.5 13.5h6L10.5 21 18 10.5h-6z" />,
);

export const SettingsIcon = createIcon(
  "SettingsIcon",
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.5v2.2M12 18.3v2.2M4.6 7.75l1.9 1.1M17.5 15.15l1.9 1.1M4.6 16.25l1.9-1.1M17.5 8.85l1.9-1.1" />
  </>,
);

export const RelayOffIcon = createIcon(
  "RelayOffIcon",
  <>
    <path d="M7 18.5h9.5a4 4 0 0 0 1.2-7.8A6 6 0 0 0 7.2 8.6 5 5 0 0 0 7 18.5z" />
    <path d="M4 4l16 16" />
  </>,
);

export const ConnectingIcon = createIcon(
  "ConnectingIcon",
  <path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5" />,
  { strokeWidth: 2.4, round: false },
);

export const WaitingIcon = createIcon(
  "WaitingIcon",
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </>,
);

export const CheckIcon = createIcon("CheckIcon", <path d="m5 12 5 5 9-10" />, {
  strokeWidth: 3,
});

export const UpdateReadyIcon = createIcon(
  "UpdateReadyIcon",
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 16V8M8.5 11.5 12 8l3.5 3.5" />
  </>,
);

export const UpdateAvailableIcon = createIcon(
  "UpdateAvailableIcon",
  <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />,
);

export const CloseIcon = createIcon(
  "CloseIcon",
  <path d="M6 6l12 12M18 6 6 18" />,
  { strokeWidth: 2.6, round: false },
);

export const MicIcon = createIcon(
  "MicIcon",
  <>
    <rect height="11" rx="3" width="6" x="9" y="3.5" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
  </>,
  { strokeWidth: 2.2, round: false },
);

export const FolderIcon = createIcon(
  "FolderIcon",
  <path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
);

export const ProjectsIcon = createIcon(
  "ProjectsIcon",
  <>
    <circle cx="6.5" cy="6" r="2.2" />
    <circle cx="6.5" cy="18" r="2.2" />
    <circle cx="17.5" cy="9" r="2.2" />
    <path d="M6.5 8.2v7.6M17.5 11.2c0 3-4 3.3-9.6 5.4" />
  </>,
);
