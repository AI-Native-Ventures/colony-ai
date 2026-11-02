import { Check, MessageSquare, type LucideIcon } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import type { Channel, ChannelMember } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { normalizePubkey } from "@/shared/lib/pubkey";
import { HashIcon, PrivateChannelIcon } from "@/shared/ui/colonyIcons";
import { UserAvatar } from "@/shared/ui/UserAvatar";
import { ChevronRightGlyph, CopyGlyph } from "./dialogIcons";

/** The panel's white card: 20px radius, hairline ring, no fill border. */
export const SETTINGS_CARD_CLASS =
  "rounded-[1.25rem] bg-colony-pop shadow-[0_0_0_1px_hsl(var(--colony-border))]";

/** One 52px key/value row inside the Details card. */
const DETAIL_ROW_CLASS =
  "flex min-h-[3.25rem] w-full items-center gap-3 border-b border-colony-border px-5 text-left last:border-b-0";
const DETAIL_LABEL_CLASS =
  "flex-1 text-control font-semibold text-colony-fg-secondary";
const DETAIL_VALUE_CLASS = "text-control font-extrabold text-colony-fg";

export function ChannelHero({
  channel,
  onEdit,
}: {
  channel: Channel;
  onEdit?: () => void;
}) {
  const channelDescription = channel.description.trim();
  const description =
    channelDescription || (onEdit ? "Add a description" : null);
  const TypeIcon =
    channel.channelType === "dm"
      ? null
      : channel.visibility === "private"
        ? PrivateChannelIcon
        : HashIcon;
  const body = (
    <>
      <span className="flex size-14 items-center justify-center rounded-full bg-colony-track text-colony-fg">
        {TypeIcon ? (
          <TypeIcon size={20} />
        ) : (
          <MessageSquare className="size-5" />
        )}
      </span>
      {channel.channelType !== "dm" ? (
        <>
          <span
            className="max-w-full truncate text-title-md font-extrabold tracking-[-0.025em] leading-[normal]"
            data-testid="channel-management-name-row"
          >
            {channel.name}
          </span>
          {description ? (
            <span
              className="line-clamp-6 max-w-full whitespace-pre-line text-sm font-medium leading-normal text-colony-fg-secondary"
              data-testid="channel-management-description"
            >
              {description}
            </span>
          ) : null}
        </>
      ) : null}
      {channel.channelType !== "dm" && onEdit ? (
        <span className="text-chip font-extrabold text-colony-accent-ink">
          Edit name and description
        </span>
      ) : null}
    </>
  );
  const cardClass = cn(
    "flex flex-col items-start gap-3 p-[22px] text-left",
    SETTINGS_CARD_CLASS,
  );

  return (
    <div data-testid="channel-management-hero">
      {channel.channelType !== "dm" && onEdit ? (
        <button
          aria-label="Edit channel"
          className={cn(
            cardClass,
            "w-full transition-colors hover:bg-colony-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40",
          )}
          data-testid="channel-management-edit"
          onClick={onEdit}
          type="button"
        >
          {body}
        </button>
      ) : (
        <div className={cardClass}>{body}</div>
      )}
    </div>
  );
}

export function FieldGroup({
  children,
  description,
  testId,
  title,
}: {
  children: React.ReactNode;
  description?: React.ReactNode;
  testId?: string;
  title?: React.ReactNode;
}) {
  return (
    <section
      className={cn("flex flex-col overflow-hidden", SETTINGS_CARD_CLASS)}
      data-testid={testId}
    >
      {title ? (
        <h3 className="px-5 pb-2 pt-4 text-2xs font-extrabold uppercase tracking-[0.09em] text-colony-muted">
          {title}
        </h3>
      ) : null}
      {description ? (
        <p className="px-5 pb-2 text-xs font-medium text-colony-muted">
          {description}
        </p>
      ) : null}
      {children}
    </section>
  );
}

export function getMarkdownPreviewText(content: string) {
  return content
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^#{1,6}\s+/, "")
        .replace(/^>\s?/, "")
        .replace(/^[-*+]\s+\[[ xX]\]\s+/, "")
        .replace(/^[-*+]\s+/, "")
        .replace(/^\d+\.\s+/, "")
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/(\*\*|__)(.*?)\1/g, "$2")
        .replace(/(\*|_)(.*?)\1/g, "$2")
        .replace(/~~(.*?)~~/g, "$1")
        .trim(),
    )
    .filter(Boolean)
    .join(" ");
}

function truncateIdentifier(value: string) {
  if (value.length <= 12) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

export function CopyFieldRow({
  label,
  value,
  testId,
}: {
  icon?: LucideIcon;
  label: string;
  value: string;
  testId?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  const resetTimerRef = React.useRef<number | null>(null);

  React.useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    },
    [],
  );

  async function handleCopy() {
    await writeTextToClipboard(value);
    setCopied(true);
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      resetTimerRef.current = null;
    }, 1_500);
    toast.success(`Copied ${label.toLowerCase()}`);
  }

  return (
    <div className={cn(DETAIL_ROW_CLASS, "py-1 pr-3")} data-testid={testId}>
      <span className={DETAIL_LABEL_CLASS}>{label}</span>
      <code
        className="font-mono text-[calc(13.5*var(--colony-px))] text-colony-fg-secondary"
        title={value}
      >
        {truncateIdentifier(value)}
      </code>
      <button
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        className="relative flex size-9 shrink-0 items-center justify-center rounded-colony-menu-item bg-colony-track text-colony-fg transition-colors hover:bg-colony-border focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40"
        data-copied={copied}
        data-testid={testId ? `${testId}-copy-status` : undefined}
        onClick={() => {
          void handleCopy();
        }}
        title={`Copy ${label}`}
        type="button"
      >
        {copied ? (
          <Check className="size-[0.9375rem]" strokeWidth={2.4} />
        ) : (
          <CopyGlyph size={15} />
        )}
      </button>
    </div>
  );
}

export function InfoFieldRow({
  label,
  onClick,
  trailing,
  value,
  testId,
}: {
  icon?: LucideIcon;
  label: string;
  multiline?: boolean;
  onClick?: () => void;
  trailing?: React.ReactNode;
  value: string;
  testId?: string;
}) {
  const content = (
    <>
      <span className={DETAIL_LABEL_CLASS}>{label}</span>
      {trailing}
      <span className={cn(DETAIL_VALUE_CLASS, "truncate")}>{value}</span>
      {onClick ? (
        <ChevronRightGlyph
          className="shrink-0 text-colony-muted"
          size={16}
          strokeWidth={2.4}
        />
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button
        className={cn(
          DETAIL_ROW_CLASS,
          "min-h-14 transition-colors hover:bg-colony-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-colony-accent/40",
        )}
        data-testid={testId}
        onClick={onClick}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <div className={DETAIL_ROW_CLASS} data-testid={testId}>
      {content}
    </div>
  );
}

export function EditableInfoFieldRow({
  editTestId,
  label,
  onEdit,
  value,
  testId,
}: {
  editTestId?: string;
  icon?: LucideIcon;
  label: string;
  multiline?: boolean;
  onEdit?: () => void;
  value: string;
  testId: string;
}) {
  const content = (
    <>
      <span className={DETAIL_LABEL_CLASS}>{label}</span>
      <span className={cn(DETAIL_VALUE_CLASS, "truncate")}>{value}</span>
      {onEdit ? (
        <span aria-hidden="true" className="hidden" data-testid={editTestId} />
      ) : null}
    </>
  );

  if (onEdit) {
    return (
      <button
        aria-label={`Edit ${label.toLowerCase()}`}
        className={cn(
          DETAIL_ROW_CLASS,
          "transition-colors hover:bg-colony-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-colony-accent/40",
        )}
        data-testid={testId}
        onClick={onEdit}
        type="button"
      >
        {content}
      </button>
    );
  }

  return (
    <div className={DETAIL_ROW_CLASS} data-testid={testId}>
      {content}
    </div>
  );
}

type ActionFieldRowProps = {
  destructive?: boolean;
  description?: string;
  disabled?: boolean;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  label: string;
  onClick?: () => void;
  testId: string;
};

/** A row of the Leave / Archive / Delete card. */
export const ActionFieldRow = React.forwardRef<
  HTMLButtonElement,
  ActionFieldRowProps
>(function ActionFieldRow(
  {
    destructive = false,
    description,
    disabled,
    icon: Icon,
    label,
    onClick,
    testId,
    ...triggerProps
  },
  ref,
) {
  return (
    <button
      className={cn(
        "flex h-12 w-full items-center gap-3 rounded-colony-control-lg px-3 text-left text-control font-bold transition-colors hover:bg-colony-track/70 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40 disabled:cursor-not-allowed disabled:opacity-50",
        destructive ? "text-colony-danger" : "text-colony-fg",
      )}
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      ref={ref}
      type="button"
      {...triggerProps}
    >
      <Icon className="shrink-0" data-slot="field-row-icon" size={18} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {description ? (
        <span className="truncate text-xs font-medium text-colony-muted">
          {description}
        </span>
      ) : null}
    </button>
  );
});

/** The Actions card that holds Leave, Archive and Delete rows. */
export function ActionFieldGroup({
  children,
  testId,
}: {
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      className={cn("flex flex-col gap-1 p-2", SETTINGS_CARD_CLASS)}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

/** A card-sized link row: icon tile, title, help line and a chevron. */
export function IngressRow({
  description,
  helpText,
  icon: Icon,
  label,
  onClick,
  testId,
  trailing,
}: {
  description?: string;
  helpText?: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  label: string;
  onClick: () => void;
  testId: string;
  trailing?: string;
}) {
  const line = description ?? helpText;
  return (
    <section data-testid={`${testId}-section`}>
      <button
        aria-label={`Open ${label.toLowerCase()}`}
        className={cn(
          "flex w-full items-center gap-3.5 px-5 py-[18px] text-left transition-colors hover:bg-colony-surface focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-colony-accent/40",
          SETTINGS_CARD_CLASS,
        )}
        data-testid={testId}
        onClick={onClick}
        type="button"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-colony-control-lg bg-colony-wash text-colony-fg-secondary">
          <Icon size={19} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="text-sm font-extrabold text-colony-fg">{label}</span>
          {line ? (
            <span className="line-clamp-3 text-chip font-medium leading-[1.45] text-colony-muted">
              {line}
            </span>
          ) : null}
        </span>
        {trailing ? (
          <span className="text-xs font-medium text-colony-muted">
            {trailing}
          </span>
        ) : null}
        <ChevronRightGlyph
          className="shrink-0 text-colony-muted"
          size={16}
          strokeWidth={2.4}
        />
      </button>
    </section>
  );
}

/** Overlapping member avatars for the Members row (people round, agents squircle). */
export function SettingsMemberStack({
  currentPubkey,
  members,
  testIdPrefix = "channel-management-member",
}: {
  currentPubkey?: string;
  members: ChannelMember[];
  testIdPrefix?: string;
}) {
  const visibleMembers = React.useMemo(() => members.slice(0, 3), [members]);
  const visiblePubkeys = React.useMemo(
    () => visibleMembers.map((member) => member.pubkey),
    [visibleMembers],
  );
  const profilesQuery = useUsersBatchQuery(visiblePubkeys);
  const profiles = profilesQuery.data?.profiles;
  const overflowCount = members.length - visibleMembers.length;

  if (members.length === 0) return null;

  return (
    <div
      className="flex shrink-0 items-center"
      data-testid={`${testIdPrefix}-avatar-stack`}
    >
      {visibleMembers.map((member, index) => {
        const normalizedPubkey = normalizePubkey(member.pubkey);
        const profile = profiles?.[normalizedPubkey];
        const label = resolveUserLabel({
          currentPubkey,
          fallbackName: member.displayName,
          profiles,
          pubkey: member.pubkey,
        });
        return (
          <span
            className={index > 0 ? "-ml-1.5" : ""}
            data-testid={`${testIdPrefix}-avatar`}
            key={normalizedPubkey}
            style={{ zIndex: index + 1 }}
          >
            <UserAvatar
              avatarUrl={profile?.avatarUrl ?? null}
              className="!size-[1.625rem] text-3xs ring-2 ring-colony-pop"
              displayName={label}
              pubkey={member.pubkey}
              fallbackDelayMs={0}
              shape={profile?.isAgent ? "squircle" : "circle"}
            />
          </span>
        );
      })}
      {overflowCount > 0 ? (
        <span
          className="-ml-1.5 flex size-[1.625rem] items-center justify-center rounded-full bg-colony-track text-3xs font-extrabold text-colony-fg-secondary ring-2 ring-colony-pop"
          data-testid={`${testIdPrefix}-avatar-overflow`}
          style={{ zIndex: visibleMembers.length + 1 }}
          title={`${overflowCount} more members`}
        >
          +{overflowCount}
        </span>
      ) : null}
    </div>
  );
}
