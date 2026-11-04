import { Palette } from "lucide-react";
import type { TimelineMessage } from "@/features/messages/types";
import { requestWorkAreaTab } from "@/features/workarea/dock/workAreaRequests";

export type DesignReviewCardData = {
  projectId: string;
  title: string;
  runtime?: string;
};

const PROJECT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function designReviewCardData(
  message: TimelineMessage,
): DesignReviewCardData | null {
  const tag = message.tags?.find(
    (entry) => entry[0] === "colony-design" && PROJECT_ID.test(entry[1] ?? ""),
  );
  if (!tag) return null;
  const projectId = tag[1];
  if (!projectId) return null;
  if (message.body.length > 16_000) return null;
  try {
    const body: unknown = JSON.parse(message.body);
    if (!body || typeof body !== "object") return null;
    const payload = body as Record<string, unknown>;
    if (
      payload.type !== "colony-design-review" ||
      payload.projectId !== projectId
    )
      return null;
    return {
      projectId,
      title:
        typeof payload.title === "string" && payload.title.trim()
          ? payload.title.trim().slice(0, 160)
          : "Design ready for review",
      ...(typeof payload.runtime === "string"
        ? { runtime: payload.runtime.slice(0, 40) }
        : {}),
    };
  } catch {
    return null;
  }
}

export function DesignReviewMessageCard({
  data,
}: {
  data: DesignReviewCardData;
}) {
  return (
    <article
      aria-label={`Open Design review: ${data.title}`}
      className="flex items-center justify-between gap-4 rounded-xl border bg-card p-4 shadow-sm"
      data-testid="design-review-card"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="rounded-lg bg-muted p-2 text-muted-foreground">
          <Palette aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Open Design · ready for review
          </p>
          <h3 className="truncate font-semibold">{data.title}</h3>
          <p className="text-sm text-muted-foreground">
            Private on this computer. Nothing has been published or sent.
          </p>
        </div>
      </div>
      <button
        className="shrink-0 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
        data-testid="design-review-open"
        onClick={() =>
          requestWorkAreaTab("design", { designProjectId: data.projectId })
        }
        type="button"
      >
        Review design
      </button>
    </article>
  );
}
