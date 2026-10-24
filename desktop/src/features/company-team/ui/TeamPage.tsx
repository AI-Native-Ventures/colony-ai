import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import "./TeamScreen.css";

/**
 * Page frame shared by the company Team routes. The breadcrumb lives in the
 * shell's top bar, so the page is only the scrolling content column.
 */
export function TeamPage({
  children,
  testId,
}: {
  /** Kept for callers that name the page; the top bar shows the trail. */
  title?: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="team-page" data-testid={testId}>
      <div className="team-page-inner">{children}</div>
    </section>
  );
}

/** The Colony 3.0 page title: 40/800 with tight tracking. */
export function TeamPageTitle({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <h1 className="team-page-title" ref={ref} tabIndex={-1}>
      {children}
    </h1>
  );
}

/** Activate and focus the adjacent tab with standard tab-list keys. */
export function handleTeamTabKeys(event: KeyboardEvent<HTMLButtonElement>) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const tabs = Array.from(
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
      "[role=tab]",
    ) ?? [],
  );
  const index = tabs.indexOf(event.currentTarget);
  if (!tabs.length || index < 0) return;
  event.preventDefault();
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
          tabs.length;
  tabs[next]?.click();
  tabs[next]?.focus();
}
