import type * as React from "react";

import { cn } from "@/shared/lib/cn";

/**
 * The composer's own glyphs, drawn exactly as the Colony 3.0 boards draw them
 * (24 box, rounded strokes). `size` is in design pixels: the icon follows the
 * type rem, so Cmd +/- zoom scales it with the rest of the composer.
 */
type ComposerIconProps = {
  className?: string;
  size?: number;
};

function Glyph({
  children,
  className,
  fill = "none",
  size = 19,
  strokeWidth = 2,
}: ComposerIconProps & {
  children: React.ReactNode;
  fill?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className={cn("shrink-0", className)}
      fill={fill}
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      style={{ width: `${size / 16}rem`, height: `${size / 16}rem` }}
      viewBox="0 0 24 24"
      width={size}
    >
      {children}
    </svg>
  );
}

export function MentionGlyph(props: ComposerIconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.6 7.2" />
    </Glyph>
  );
}

export function AttachGlyph(props: ComposerIconProps) {
  return (
    <Glyph {...props}>
      <path d="m20 11.5-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" />
    </Glyph>
  );
}

export function EmojiGlyph(props: ComposerIconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0M9.5 9.5v.5M14.5 9.5v.5" />
    </Glyph>
  );
}

export function MicGlyph(props: ComposerIconProps) {
  return (
    <Glyph {...props}>
      <rect height="11" rx="3" width="6" x="9" y="3.5" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
    </Glyph>
  );
}

export function SendGlyph({ size = 18, ...props }: ComposerIconProps) {
  return (
    <Glyph size={size} strokeWidth={2.4} {...props}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </Glyph>
  );
}

export function PlusGlyph({ size = 15, ...props }: ComposerIconProps) {
  return (
    <Glyph size={size} strokeWidth={2.4} {...props}>
      <path d="M12 5v14M5 12h14" />
    </Glyph>
  );
}

export function CloseGlyph({
  size = 14,
  strokeWidth = 2.6,
  ...props
}: ComposerIconProps & { strokeWidth?: number }) {
  return (
    <Glyph size={size} strokeWidth={strokeWidth} {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Glyph>
  );
}

export function CheckGlyph({ size = 17, ...props }: ComposerIconProps) {
  return (
    <Glyph size={size} strokeWidth={2.6} {...props}>
      <path d="m5 12 5 5 9-10" />
    </Glyph>
  );
}

export function TrashGlyph({ size = 17, ...props }: ComposerIconProps) {
  return (
    <Glyph size={size} {...props}>
      <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />
    </Glyph>
  );
}

export function StopGlyph({ size = 14, ...props }: ComposerIconProps) {
  return (
    <Glyph fill="currentColor" size={size} {...props}>
      <rect height="12" rx="2" width="12" x="6" y="6" />
    </Glyph>
  );
}

export function ReplyGlyph({ size = 16, ...props }: ComposerIconProps) {
  return (
    <Glyph size={size} strokeWidth={2.2} {...props}>
      <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Glyph>
  );
}

export function EditGlyph({ size = 16, ...props }: ComposerIconProps) {
  return (
    <Glyph size={size} strokeWidth={2.2} {...props}>
      <path d="M14.5 5.5l4 4L9 19H5v-4z" />
    </Glyph>
  );
}

export function TimeoutGlyph({ size = 17, ...props }: ComposerIconProps) {
  return (
    <Glyph size={size} strokeWidth={2.2} {...props}>
      <circle cx="12" cy="13" r="7.5" />
      <path d="M12 9.5V13M9.5 2.5h5" />
    </Glyph>
  );
}

export function PinGlyph({ size = 16, ...props }: ComposerIconProps) {
  return (
    <Glyph size={size} {...props}>
      <path d="M9 4.5h6l-1 6 3.5 3H6.5L10 10.5zM12 13.5v7" />
    </Glyph>
  );
}

export function SpoilerEyeGlyph({ size = 13, ...props }: ComposerIconProps) {
  return (
    <Glyph size={size} strokeWidth={2.2} {...props}>
      <path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6zM4 20 20 4" />
    </Glyph>
  );
}

/** Formatting toolbar glyphs, in the board's order. */
export function CodeGlyph({ size = 16, ...props }: ComposerIconProps) {
  return (
    <Glyph size={size} strokeWidth={2.2} {...props}>
      <path d="m8 7-5 5 5 5M16 7l5 5-5 5" />
    </Glyph>
  );
}

export function CodeBlockGlyph({ size = 16, ...props }: ComposerIconProps) {
  return (
    <Glyph size={size} {...props}>
      <rect height="15" rx="2.5" width="17" x="3.5" y="4.5" />
      <path d="m9 10-2 2 2 2M15 10l2 2-2 2" />
    </Glyph>
  );
}

export function LinkGlyph({ size = 16, ...props }: ComposerIconProps) {
  return (
    <Glyph size={size} strokeWidth={2.2} {...props}>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </Glyph>
  );
}

export function BulletListGlyph({ size = 16, ...props }: ComposerIconProps) {
  return (
    <Glyph size={size} strokeWidth={2.2} {...props}>
      <path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.1M4.5 12h.1M4.5 17.5h.1" />
    </Glyph>
  );
}

export function OrderedListGlyph({ size = 16, ...props }: ComposerIconProps) {
  return (
    <Glyph size={size} {...props}>
      <path d="M10 6.5h10M10 12h10M10 17.5h10M4 5.5l1.5-1v4M4 11.5a1.5 1.5 0 0 1 3 0c0 1-3 2-3 3h3M4 16.5h2.5l-1.5 1.5a1.3 1.3 0 1 1-1 2" />
    </Glyph>
  );
}

export function QuoteGlyph({ size = 16, ...props }: ComposerIconProps) {
  return (
    <Glyph size={size} strokeWidth={2.2} {...props}>
      <path d="M5 5.5v13M10 8h9M10 12h9M10 16h6" />
    </Glyph>
  );
}

export function SpoilerGlyph({ size = 16, ...props }: ComposerIconProps) {
  return (
    <Glyph size={size} {...props}>
      <path d="M3 12s3.5-6 9-6c1.6 0 3 .5 4.2 1.2M21 12s-3.5 6-9 6c-1.6 0-3-.5-4.2-1.2M4 20 20 4" />
    </Glyph>
  );
}
