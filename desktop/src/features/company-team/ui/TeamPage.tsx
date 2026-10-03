import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

/** Page frame shared by the company Team routes. */
export function TeamPage({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section
      className="min-h-0 w-full flex-1 overflow-y-auto"
      data-testid={testId}
    >
      <header className="flex h-[4.875rem] items-center border-b border-border px-6">
        <nav aria-label="Breadcrumb" className="text-sm font-semibold">
          Company / {title}
        </nav>
      </header>
      <div className="mx-auto w-full max-w-[76.875rem] px-5 pb-[3.125rem] pt-[2.1875rem] sm:px-10">
        {children}
      </div>
    </section>
  );
}

/** The frozen company page title, using the named zoom-safe type scale. */
export function TeamPageTitle({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <h1
      ref={ref}
      tabIndex={-1}
      className="text-company-title font-semibold tracking-tight outline-none"
    >
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
