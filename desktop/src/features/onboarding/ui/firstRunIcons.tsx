import { createIcon } from "@/shared/ui/colonyIcons";

/**
 * The glyphs the first-run boards draw, as exact 24-unit paths from the design
 * files. Same rounded-stroke recipe as the shell icons (`colonyIcons.tsx`).
 */
export {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
} from "@/shared/ui/colonyIcons";

export const GlobeIcon = createIcon(
  "GlobeIcon",
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z" />
  </>,
);

export const ShieldCheckIcon = createIcon(
  "ShieldCheckIcon",
  <>
    <path d="M12 3.5 19 6v6c0 4.5-3 7.5-7 8.5-4-1-7-4-7-8.5V6z" />
    <path d="m9 12 2 2 4-4" />
  </>,
);

export const ShieldIcon = createIcon(
  "ShieldIcon",
  <path d="M12 3.5 19 6v6c0 4.5-3 7.5-7 8.5-4-1-7-4-7-8.5V6z" />,
);

export const MailIcon = createIcon(
  "MailIcon",
  <>
    <rect height="13" rx="2.5" width="18" x="3" y="5.5" />
    <path d="m4 7.5 8 6 8-6" />
  </>,
);

export const ClockIcon = createIcon(
  "ClockIcon",
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </>,
  { strokeWidth: 2.2 },
);

export const AlertIcon = createIcon(
  "AlertIcon",
  <>
    <path d="M12 4 21 19.5H3z" />
    <path d="M12 10v4M12 17v.2" />
  </>,
  { strokeWidth: 2.4 },
);

export const InfoIcon = createIcon(
  "InfoIcon",
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8v4.5M12 16v.2" />
  </>,
  { strokeWidth: 2.4 },
);

export const TerminalIcon = createIcon(
  "TerminalIcon",
  <path d="m6 8 4 4-4 4M12.5 16h5.5" />,
  { strokeWidth: 2.2 },
);

export const WorkingIcon = createIcon(
  "WorkingIcon",
  <circle cx="12" cy="12" r="7.5" strokeDasharray="4 3.2" />,
  { strokeWidth: 2.6 },
);

export const WaitingCircleIcon = createIcon(
  "WaitingCircleIcon",
  <circle cx="12" cy="12" r="7" />,
  { strokeWidth: 2.2 },
);

export const LockIcon = createIcon(
  "LockIcon",
  <>
    <rect height="10" rx="2.5" width="14" x="5" y="10.5" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </>,
);

export const KeyIcon = createIcon(
  "KeyIcon",
  <>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2" />
  </>,
);

export const PhoneIcon = createIcon(
  "PhoneIcon",
  <>
    <rect height="19" rx="2.5" width="10" x="7" y="2.5" />
    <path d="M11 18.5h2" />
  </>,
);

export const DownloadIcon = createIcon(
  "DownloadIcon",
  <>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5" />
    <path d="M5 19.5h14" />
  </>,
);

export const FileIcon = createIcon(
  "FileIcon",
  <>
    <path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10.5A.5.5 0 0 1 6.5 20V4a.5.5 0 0 1 .5-.5z" />
    <path d="M14 3.5V8h4M12 11.5v5M9.5 14 12 16.5 14.5 14" />
  </>,
);

export const LinkIcon = createIcon(
  "LinkIcon",
  <>
    <path d="M10 13.5a4 4 0 0 0 5.7 0l3.3-3.3a4 4 0 0 0-5.7-5.7l-1.1 1.1" />
    <path d="M14 10.5a4 4 0 0 0-5.7 0L5 13.8a4 4 0 0 0 5.7 5.7l1.1-1.1" />
  </>,
);

export const RefreshIcon = createIcon(
  "RefreshIcon",
  <>
    <path d="M20 12a8 8 0 1 1-2.3-5.6" />
    <path d="M20 4.5V9h-4.5" />
  </>,
  { strokeWidth: 2.2 },
);

export const ArrowRightIcon = createIcon(
  "ArrowRightIcon",
  <path d="M5 12h14M13 6l6 6-6 6" />,
  { strokeWidth: 2.4 },
);

export const CopyIcon = createIcon(
  "CopyIcon",
  <>
    <rect height="11" rx="2.5" width="11" x="8.5" y="8.5" />
    <path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
  </>,
);

export const RingIcon = createIcon(
  "RingIcon",
  <path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5" />,
  { strokeWidth: 2.4 },
);

export const HintIcon = createIcon(
  "HintIcon",
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8v.2" />
  </>,
  { strokeWidth: 2.2 },
);

export const SignOutIcon = createIcon(
  "SignOutIcon",
  <>
    <path d="M14 4.5h4.5a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5H14" />
    <path d="M9.5 16.5 5 12l4.5-4.5M5 12h10" />
  </>,
  { strokeWidth: 2.2 },
);

export const RestartIcon = createIcon(
  "RestartIcon",
  <>
    <path d="M20 12a8 8 0 1 1-2.3-5.6" />
    <path d="M20 4.5V9h-4.5" />
  </>,
  { strokeWidth: 2.2 },
);

export const WifiOffIcon = createIcon(
  "WifiOffIcon",
  <path d="M5 12.5a10 10 0 0 1 3-2M2 9a15 15 0 0 1 4.5-2.8M19 12.5a10 10 0 0 0-3.5-2.2M22 9A15 15 0 0 0 11 5.1M8.5 16a5 5 0 0 1 7 0M12 20h.01M3 3l18 18" />,
  { strokeWidth: 2.2 },
);

export const BriefcaseIcon = createIcon(
  "BriefcaseIcon",
  <>
    <rect height="12" rx="2.5" width="17" x="3.5" y="7.5" />
    <path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5" />
    <path d="M3.5 12.5h17" />
  </>,
);

export const PeopleIcon = createIcon(
  "PeopleIcon",
  <>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
    <path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8" />
    <path d="M17.5 14.2a5.5 5.5 0 0 1 3 5.3" />
  </>,
);

export const PencilIcon = createIcon(
  "PencilIcon",
  <>
    <path d="M14.5 5.5l4 4" />
    <path d="M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5z" />
  </>,
  { strokeWidth: 2.4 },
);

export const CloseXIcon = createIcon(
  "CloseXIcon",
  <path d="M6 6l12 12M18 6 6 18" />,
  { strokeWidth: 2.4 },
);

export const UploadIcon = createIcon(
  "UploadIcon",
  <>
    <path d="M12 15.5V5M7.5 9.5 12 5l4.5 4.5" />
    <path d="M5 19.5h14" />
  </>,
);

export const CameraIcon = createIcon(
  "CameraIcon",
  <>
    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2L9.5 4.5h5L16.3 7h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
    <circle cx="12" cy="12.5" r="3.5" />
  </>,
);
