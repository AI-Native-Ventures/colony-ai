import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { useAgentSessionTranscriptVariant } from "../agentSessionTranscriptContext";
import type { AgentActivityAction } from "../agentSessionTypes";
import type {
  CompactFileEditSummary,
  CompactToolKind,
} from "../agentSessionToolSummary";
import { resolveToolImageSrc } from "../agentSessionUtils";
import {
  ActivityRowLabel,
  splitActivityRowLabel,
  type ActivityRowLabelParts,
} from "../activityRenderClasses/ActivityRow";

export function compactSummaryTone() {
  return "text-muted-foreground/60 transition-colors group-hover/row:text-foreground group-open:text-foreground";
}

export function CompactToolSummaryRow({
  action,
  duration,
  fileEditSummary,
  kind,
  label,
  plainLabel = null,
  preview,
  thumbnailSrc,
}: {
  action: AgentActivityAction | null;
  duration: string | null;
  fileEditSummary: CompactFileEditSummary | null;
  kind: CompactToolKind;
  label: string;
  /**
   * Plain wording for calls that carry a raw shell command. When set, the row
   * shows only this label: no command text, no preview, no tooltip. The raw
   * command stays behind the row's expand control.
   */
  plainLabel?: string | null;
  preview: string | null;
  thumbnailSrc: string | null;
}) {
  const [thumbnailFailed, setThumbnailFailed] = React.useState(false);
  const variant = useAgentSessionTranscriptVariant();
  const isCompactPreview = variant === "compactPreview";
  const mutedTone = compactSummaryTone();
  const resolvedThumbnail = React.useMemo(() => {
    if (!thumbnailSrc || thumbnailFailed) return null;
    return resolveToolImageSrc(thumbnailSrc);
  }, [thumbnailFailed, thumbnailSrc]);
  const actionLabel =
    fileEditSummary || plainLabel
      ? null
      : getCompactToolActionLabel(action, kind, label, preview);

  return (
    <>
      {plainLabel ? (
        <span
          className={cn(
            "min-w-0 truncate font-semibold",
            isCompactPreview ? "text-xs" : "text-sm",
            mutedTone,
          )}
        >
          {plainLabel}
        </span>
      ) : fileEditSummary ? (
        <CompactFileEditSummaryView summary={fileEditSummary} />
      ) : actionLabel ? (
        <ActivityRowLabel
          object={actionLabel.object}
          openToneScope="tool"
          title={actionLabel.title}
          verb={actionLabel.verb}
        />
      ) : (
        <span
          className={cn(
            "shrink-0 font-semibold",
            isCompactPreview ? "text-xs" : "text-sm",
            mutedTone,
          )}
        >
          {label}
        </span>
      )}
      {!fileEditSummary && !plainLabel && resolvedThumbnail ? (
        <img
          alt=""
          className="h-5 w-auto max-w-12 shrink-0 rounded-sm object-cover"
          decoding="async"
          loading="lazy"
          onError={() => setThumbnailFailed(true)}
          src={resolvedThumbnail}
          title={preview ?? undefined}
        />
      ) : !fileEditSummary && !plainLabel && !actionLabel && preview ? (
        <span
          className={cn(
            "min-w-0 max-w-48 truncate",
            isCompactPreview ? "text-xs" : "text-sm",
            mutedTone,
          )}
          title={preview}
        >
          {preview}
        </span>
      ) : null}
      {duration ? (
        <span className={cn("shrink-0 text-xs", mutedTone)}>{duration}</span>
      ) : null}
      <ChevronDown
        className={cn(
          "h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180",
          mutedTone,
        )}
      />
    </>
  );
}

function getCompactToolActionLabel(
  action: AgentActivityAction | null,
  kind: CompactToolKind,
  label: string,
  preview: string | null,
): (ActivityRowLabelParts & { title?: string }) | null {
  if (action) {
    const object = action.object ?? preview ?? undefined;
    return {
      verb: action.verb,
      object,
      title: typeof object === "string" ? object : undefined,
    };
  }

  const parts = splitActivityRowLabel(label);
  if (!parts) return null;

  if (!preview) return parts;

  if (
    kind === "shell" ||
    kind === "file-read" ||
    kind === "skill-read" ||
    kind === "plan" ||
    kind === "image"
  ) {
    return { verb: parts.verb, object: preview, title: preview };
  }

  return parts;
}

function CompactFileEditSummaryView({
  summary,
}: {
  summary: CompactFileEditSummary;
}) {
  return (
    <ActivityRowLabel
      className="max-w-72"
      object={summary.filename}
      openToneScope="tool"
      stats={{
        additions: summary.additions,
        deletions: summary.deletions,
      }}
      title={summary.path}
      verb="Edited"
    />
  );
}
