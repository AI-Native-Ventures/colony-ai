import { useCanvasQuery } from "@/features/channels/hooks";
import { Button } from "@/shared/ui/button";

import { requestWorkAreaTab } from "../workAreaRequests";
import { channelNotes } from "./workAreaChannelNotes";

const TEST_ID = "work-area-knowledge-notes";

/**
 * The channel's standing notes: its topic, its purpose and its canvas, read from
 * what is already stored (see `workAreaChannelNotes.ts`). Topic and purpose come
 * with the channel list; the canvas is one query that can fail without hiding
 * them. The canvas row opens the Canvas tab, where it can be read in full.
 */
export function KnowledgeChannelNotes({
  channelId,
  topic,
  purpose,
}: {
  channelId: string;
  topic: string | null;
  purpose: string | null;
}) {
  const canvasQuery = useCanvasQuery(channelId);
  const notes = channelNotes({
    topic,
    purpose,
    canvasContent: canvasQuery.data?.content,
  });
  const loading = canvasQuery.isPending;
  const failed = canvasQuery.isError;

  return (
    <section
      aria-labelledby={`${TEST_ID}-title`}
      className="shrink-0 border-b border-border"
      data-testid={TEST_ID}
    >
      <h2
        className="px-3 pt-3 text-xs font-semibold text-foreground"
        id={`${TEST_ID}-title`}
      >
        Channel notes
      </h2>
      {notes.length > 0 ? (
        <ul className="mt-1 pb-1">
          {notes.map((note) =>
            note.kind === "canvas" ? (
              <li key="canvas">
                <button
                  aria-label={`Open the canvas: ${note.preview}`}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid={`${TEST_ID}-canvas`}
                  onClick={() => requestWorkAreaTab("canvas")}
                  type="button"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-muted-foreground">
                      Canvas
                    </span>
                    <span className="block truncate text-sm text-foreground">
                      {note.preview}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="text-sm text-muted-foreground"
                  >
                    ›
                  </span>
                </button>
              </li>
            ) : (
              <li
                className="px-3 py-2"
                data-testid={`${TEST_ID}-${note.kind}`}
                key={note.kind}
              >
                <span className="block text-xs text-muted-foreground">
                  {note.kind === "topic" ? "Topic" : "Purpose"}
                </span>
                <span className="block break-words text-sm text-foreground">
                  {note.text}
                </span>
              </li>
            ),
          )}
        </ul>
      ) : null}
      {loading ? (
        <p
          className="px-3 pb-3 pt-1 text-xs text-muted-foreground"
          data-testid={`${TEST_ID}-loading`}
          role="status"
        >
          Loading the canvas
        </p>
      ) : null}
      {failed ? (
        <div
          className="flex items-center justify-between gap-3 px-3 pb-3 pt-1 text-xs text-muted-foreground"
          data-testid={`${TEST_ID}-failed`}
          role="status"
        >
          <span>The canvas could not be loaded.</span>
          <Button
            className="h-7 px-2 text-xs"
            onClick={() => void canvasQuery.refetch()}
            size="sm"
            type="button"
            variant="outline"
          >
            Retry
          </Button>
        </div>
      ) : null}
      {!loading && !failed && notes.length === 0 ? (
        <p
          className="px-3 pb-3 pt-1 text-xs text-muted-foreground"
          data-testid={`${TEST_ID}-empty`}
        >
          No channel notes yet. A topic, purpose or canvas set for this channel
          appears here.
        </p>
      ) : null}
    </section>
  );
}
