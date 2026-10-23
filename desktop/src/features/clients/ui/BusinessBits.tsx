import type { ReactNode } from "react";

import type { PersonInfo } from "@/features/clients/lib/usePeople";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { cn } from "@/shared/lib/cn";

type IconProps = { size?: number; strokeWidth?: number; className?: string };

function Svg({
  children,
  className,
  size = 18,
  strokeWidth = 2.4,
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={size}
    >
      {children}
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Svg size={16} {...props}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </Svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Svg size={16} {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg size={17} {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <Svg size={17} strokeWidth={2.2} {...props}>
      <rect height="10" rx="2.5" width="14" x="5" y="10.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </Svg>
  );
}

export function BriefcaseIcon(props: IconProps) {
  return (
    <Svg size={20} strokeWidth={2} {...props}>
      <rect height="12.5" rx="2.5" width="17" x="3.5" y="7.5" />
      <path d="M9 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5.5v2" />
    </Svg>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <Svg size={15} strokeWidth={2} {...props}>
      <path d="M14 3.5H7a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7.5z" />
      <path d="M14 3.5v4h4" />
    </Svg>
  );
}

export function WarningIcon(props: IconProps) {
  return (
    <Svg size={14} {...props}>
      <path d="M12 4 21 19.5H3z" />
      <path d="M12 10v4M12 17v.2" />
    </Svg>
  );
}

export function ListIcon(props: IconProps) {
  return (
    <Svg size={16} strokeWidth={2.2} {...props}>
      <path d="M8 6.5h12M8 12h12M8 17.5h12M4 6.5h.5M4 12h.5M4 17.5h.5" />
    </Svg>
  );
}

export function BoardIcon(props: IconProps) {
  return (
    <Svg size={16} strokeWidth={2.2} {...props}>
      <rect height="15" rx="1.5" width="5" x="3.5" y="4.5" />
      <rect height="10" rx="1.5" width="5" x="9.5" y="4.5" />
      <rect height="12.5" rx="1.5" width="5" x="15.5" y="4.5" />
    </Svg>
  );
}

const AVATAR_CLASS = {
  16: "size-[calc(16*var(--b3u))] text-[calc(8*var(--colony-px))]",
  24: "size-[calc(24*var(--b3u))] text-[calc(10*var(--colony-px))]",
  26: "size-[calc(26*var(--b3u))] text-[calc(11*var(--colony-px))]",
  30: "size-[calc(30*var(--b3u))] text-[calc(12*var(--colony-px))]",
  32: "size-[calc(32*var(--b3u))] text-[calc(13*var(--colony-px))]",
  38: "size-[calc(38*var(--b3u))] text-[calc(15*var(--colony-px))]",
  44: "size-[calc(44*var(--b3u))] text-[calc(17*var(--colony-px))]",
} as const;

/** A person (round) or an agent (the agent's own picture), at a design size. */
export function PersonAvatar({
  person,
  size,
}: {
  person: PersonInfo;
  size: keyof typeof AVATAR_CLASS;
}) {
  return (
    <ProfileAvatar
      avatarUrl={person.avatarUrl}
      className={cn(AVATAR_CLASS[size])}
      label={person.name}
      shape={person.isAgent ? "squircle" : "circle"}
    />
  );
}

export type PillTone = "default" | "ok" | "need" | "bad" | "info" | "accent";

export function Pill({
  children,
  dot = false,
  size,
  tone = "default",
  ...rest
}: {
  children: ReactNode;
  dot?: boolean;
  size?: "sm" | "lg";
  tone?: PillTone;
  "data-testid"?: string;
}) {
  return (
    <span className="b3-pill" data-size={size} data-tone={tone} {...rest}>
      {dot ? <span className="b3-pill-dot" /> : null}
      {children}
    </span>
  );
}

const LEADING_ARTICLES = new Set(["the", "a", "an"]);

/** The tile letter for a client: its first word, skipping "The". */
export function clientInitial(name: string): string {
  const words = name.trim().split(/\s+/);
  const word =
    words.length > 1 && LEADING_ARTICLES.has(words[0].toLowerCase())
      ? words[1]
      : words[0];
  return (word ?? "").charAt(0).toUpperCase();
}

export function formatStatus(status: string): string {
  return status
    .split(/([\s_-]+)/)
    .map((part) =>
      /^[a-z]/i.test(part) ? part[0].toUpperCase() + part.slice(1) : part,
    )
    .join("");
}

export function ClientStatusPill({
  size,
  status,
}: {
  size?: "sm" | "lg";
  status: string;
}) {
  const tone: PillTone =
    status === "active" ? "ok" : status === "onboarding" ? "info" : "default";
  return (
    <Pill dot size={size} tone={tone}>
      {formatStatus(status)}
    </Pill>
  );
}

const WORK_STATUS_LABELS: Record<string, string> = {
  active: "In progress",
  review: "Needs review",
  blocked: "Blocked",
  paused: "Paused",
  complete: "Complete",
  archived: "Archived",
};

export function workStatusLabel(status: string): string {
  return WORK_STATUS_LABELS[status] ?? formatStatus(status);
}

export function workStatusTone(status: string): PillTone {
  switch (status) {
    case "review":
      return "need";
    case "blocked":
      return "bad";
    case "active":
      return "accent";
    case "complete":
      return "ok";
    default:
      return "default";
  }
}

export function WorkStatusPill({
  label,
  size,
  status,
}: {
  label?: string;
  size?: "sm" | "lg";
  status: string;
}) {
  return (
    <Pill size={size} tone={workStatusTone(status)}>
      {label ?? workStatusLabel(status)}
    </Pill>
  );
}
