import * as React from "react";

/** Cards a pipeline column renders at first, and how many more each scroll to its end adds. */
export const PIPELINE_REVEAL_STEP = 50;

type Props<T> = {
  items: readonly T[];
  itemKey: (item: T) => string;
  /** Changing it (the search term) starts the list again at the first step. */
  resetKey: string;
  children: (item: T) => React.ReactNode;
};

/**
 * Renders the first {@link PIPELINE_REVEAL_STEP} items and adds as many each time the end of
 * the list scrolls into view, so a column of thousands of cards stays cheap to draw. The end
 * marker is an empty, unfocusable element hidden from assistive technology; focusing the last
 * rendered card scrolls it into view, which reveals the next step for keyboard users.
 */
export function PipelineRevealList<T>({
  items,
  itemKey,
  resetKey,
  children,
}: Props<T>) {
  const [revealed, setRevealed] = React.useState({
    key: resetKey,
    count: PIPELINE_REVEAL_STEP,
  });
  const endRef = React.useRef<HTMLDivElement | null>(null);
  // Without IntersectionObserver nothing could ever reveal more, so show everything.
  const canObserve = typeof IntersectionObserver !== "undefined";
  const count =
    revealed.key === resetKey ? revealed.count : PIPELINE_REVEAL_STEP;
  const limit = canObserve ? count : items.length;
  const hasMore = items.length > limit;

  React.useEffect(() => {
    const end = endRef.current;
    if (!hasMore || !end || !canObserve) return;
    // A new observer reports the end's current position at once, so a short batch of cards
    // that leaves the end in view reveals the next batch without another scroll.
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      // Absolute, so two reports before the next render reveal one step, not two.
      setRevealed({ key: resetKey, count: limit + PIPELINE_REVEAL_STEP });
    });
    observer.observe(end);
    return () => observer.disconnect();
  }, [canObserve, hasMore, limit, resetKey]);

  return (
    <>
      {items.slice(0, limit).map((item) => (
        <React.Fragment key={itemKey(item)}>{children(item)}</React.Fragment>
      ))}
      {hasMore ? <div aria-hidden="true" ref={endRef} /> : null}
    </>
  );
}
