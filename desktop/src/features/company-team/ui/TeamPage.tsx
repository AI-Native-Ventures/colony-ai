import type { ReactNode } from "react";

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
    <main
      className="min-h-0 w-full flex-1 overflow-y-auto"
      data-testid={testId}
    >
      <header className="flex h-[4.875rem] items-center border-b border-border px-6">
        <p className="text-sm font-semibold">Company / {title}</p>
      </header>
      <div className="mx-auto w-full max-w-[76.875rem] px-5 pb-[3.125rem] pt-[2.1875rem] sm:px-10">
        {children}
      </div>
    </main>
  );
}

/** The frozen company page title, using the named zoom-safe type scale. */
export function TeamPageTitle({ children }: { children: ReactNode }) {
  return (
    <h1 className="text-company-title font-semibold tracking-tight">
      {children}
    </h1>
  );
}
