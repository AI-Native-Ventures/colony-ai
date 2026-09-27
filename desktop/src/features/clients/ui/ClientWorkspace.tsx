import type { ReactNode } from "react";

import { PageHeader } from "@/shared/ui/PageHeader";

export function ClientWorkspace({
  action,
  children,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  title: ReactNode;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-border/70 px-6 py-5">
        <PageHeader action={action} title={title} />
      </header>
      <main className="min-h-0 flex-1 overflow-auto px-6 py-5">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
          {children}
        </div>
      </main>
    </div>
  );
}

export function RecordMessage({
  children,
  kind = "quiet",
}: {
  children: ReactNode;
  kind?: "quiet" | "error";
}) {
  return (
    <div
      className={
        kind === "error"
          ? "rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
          : "rounded-lg border border-border/70 bg-card px-4 py-3 text-sm text-muted-foreground"
      }
      role={kind === "error" ? "alert" : undefined}
    >
      {children}
    </div>
  );
}

export function RecordCard({
  action,
  children,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  title: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border/70 bg-card p-5 shadow-xs">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function RecordField({
  children,
  label,
}: {
  children: ReactNode;
  label: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm font-medium text-foreground">
        {children}
      </dd>
    </div>
  );
}
