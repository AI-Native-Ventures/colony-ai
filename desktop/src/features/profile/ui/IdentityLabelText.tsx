import type { ResolvedIdentityLabel } from "@/features/profile/lib/identity";
import { cn } from "@/shared/lib/cn";

/**
 * One visual treatment for agent identity everywhere it is rendered as text.
 * The owner suffix is intentionally muted while its full resolved name remains
 * available as a native tooltip.
 */
export function IdentityLabelText({
  className,
  label,
}: {
  className?: string;
  label: ResolvedIdentityLabel | undefined;
}) {
  if (!label) return null;

  return (
    <span className={cn("min-w-0", className)}>
      <span>{label.primary}</span>
      {label.ownerSuffix ? (
        <span
          className="text-colony-muted"
          title={label.ownerTooltip ?? undefined}
        >
          {` (${label.ownerSuffix})`}
        </span>
      ) : null}
      {label.duplicateOrdinal ? (
        <span className="text-colony-muted"> {label.duplicateOrdinal}</span>
      ) : null}
    </span>
  );
}
