import * as React from "react";
import { invokeTauri } from "@/shared/api/tauriTransport";
import type { WorkAreaTabPanelProps } from "../workAreaTabRegistry";

type DesignReview = {
  projectId: string;
  title: string;
  status: string;
  review: string;
  previewHtml: string;
  thumbnails: Array<{ name: string; dataUrl: string }>;
  feedback: string | null;
};

export function WorkAreaDesignTab({ active, tab }: WorkAreaTabPanelProps) {
  const projectId = tab.designProjectId;
  const [review, setReview] = React.useState<DesignReview | null>(null);
  const [feedback, setFeedback] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const generation = React.useRef(0);

  const refresh = React.useCallback(async () => {
    if (!projectId) return;
    const attempt = ++generation.current;
    setError(null);
    try {
      const next = await invokeTauri<DesignReview>("get_colony_design_review", {
        projectId,
      });
      if (generation.current === attempt) setReview(next);
    } catch (failure) {
      if (generation.current === attempt) {
        setError(
          failure instanceof Error
            ? failure.message
            : "The local design preview could not be opened.",
        );
      }
    }
  }, [projectId]);

  React.useEffect(() => {
    if (active) void refresh();
    return () => {
      generation.current += 1;
    };
  }, [active, refresh]);

  const act = async (action: "approve" | "changes") => {
    if (!projectId || busy) return;
    if (action === "changes" && !feedback.trim()) {
      setError("Add a note so the agent knows what to change.");
      return;
    }
    const attempt = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const next = await invokeTauri<DesignReview>("review_colony_design", {
        projectId,
        action,
        feedback: action === "changes" ? feedback.trim() : null,
      });
      if (generation.current === attempt) {
        setReview(next);
        setFeedback("");
      }
    } catch (failure) {
      if (generation.current === attempt) {
        setError(
          failure instanceof Error
            ? failure.message
            : "Your review could not be saved. Try again.",
        );
      }
    } finally {
      if (generation.current === attempt) setBusy(false);
    }
  };

  if (!projectId) {
    return <p role="status">This design review is missing its project id.</p>;
  }

  return (
    <section
      aria-label="Design review"
      className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4"
      data-testid="design-review-panel"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Open Design · private preview
          </p>
          <h2 className="mt-1 text-lg font-semibold">
            {review?.title ?? "Loading design…"}
          </h2>
          {review ? (
            <p className="text-sm text-muted-foreground">
              {review.review === "approved"
                ? "Approved. Your agent can use this design as its source."
                : review.review === "changes_requested"
                  ? "Changes requested"
                  : "Ready for your review"}
            </p>
          ) : null}
        </div>
        <button
          className="rounded-md border px-3 py-2 text-sm"
          data-testid="design-review-refresh"
          disabled={busy}
          onClick={() => void refresh()}
          type="button"
        >
          Refresh
        </button>
      </header>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {review?.thumbnails.length ? (
        <section
          aria-label="Design screenshots"
          className="grid grid-cols-2 gap-3"
        >
          {review.thumbnails.map((thumbnail) => (
            <figure className="min-w-0" key={thumbnail.name}>
              <img
                alt={`Design screenshot ${thumbnail.name}`}
                className="max-h-64 w-full rounded-md border object-contain"
                loading="lazy"
                src={thumbnail.dataUrl}
              />
              <figcaption className="mt-1 truncate text-xs text-muted-foreground">
                {thumbnail.name}
              </figcaption>
            </figure>
          ))}
        </section>
      ) : null}

      {review?.previewHtml ? (
        <section className="flex min-h-[320px] flex-1 flex-col gap-2">
          <h3 className="text-sm font-medium">Interactive-size preview</h3>
          <iframe
            className="min-h-[320px] flex-1 rounded-md border bg-white"
            data-testid="design-preview-frame"
            sandbox=""
            srcDoc={review.previewHtml}
            title={`${review.title} preview`}
          />
        </section>
      ) : (
        <p
          className="rounded-md border p-4 text-sm text-muted-foreground"
          role="status"
        >
          The agent has not produced an HTML preview yet. Refresh after its run.
        </p>
      )}

      {review?.feedback ? (
        <p
          className="rounded-md bg-muted p-3 text-sm"
          data-testid="design-review-feedback"
        >
          Requested changes: {review.feedback}
        </p>
      ) : null}

      {review?.review !== "approved" ? (
        <section className="flex flex-col gap-3 border-t pt-4">
          <label
            className="flex flex-col gap-1 text-sm font-medium"
            htmlFor={`design-feedback-${projectId}`}
          >
            Ask for changes
            <textarea
              className="min-h-20 rounded-md border bg-background p-2 font-normal"
              data-testid="design-feedback-input"
              id={`design-feedback-${projectId}`}
              onChange={(event) => setFeedback(event.currentTarget.value)}
              placeholder="What should the agent adjust?"
              value={feedback}
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              className="rounded-md border px-3 py-2 text-sm"
              data-testid="design-request-changes"
              disabled={busy}
              onClick={() => void act("changes")}
              type="button"
            >
              Ask for changes
            </button>
            <button
              className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
              data-testid="design-approve"
              disabled={busy || review?.status !== "ready_for_review"}
              onClick={() => void act("approve")}
              type="button"
            >
              Approve design
            </button>
          </div>
        </section>
      ) : null}
    </section>
  );
}
