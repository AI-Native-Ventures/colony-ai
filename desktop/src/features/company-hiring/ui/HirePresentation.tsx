import type { ReactNode } from "react";

import { Button } from "@/shared/ui/button";

export const hirePrimaryButtonClass =
  "bg-[#536d9c] text-white shadow hover:bg-[#4d668f] disabled:bg-[#536d9c] disabled:text-white disabled:opacity-100";

export function HirePageHeader({ title }: { title: string }) {
  return (
    <div className="flex h-[78px] w-full flex-none items-center border-b border-border px-6">
      <p className="text-sm font-semibold text-foreground">Company / {title}</p>
    </div>
  );
}

export function HireBackButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      aria-label="Back"
      className="mb-8 inline-flex items-center gap-1 px-0 pt-4 text-xs text-muted-foreground hover:text-foreground"
      onClick={onClick}
      type="button"
      variant="ghost"
    >
      <span aria-hidden="true">‹</span> Back
    </Button>
  );
}

export function HireField({
  children,
  htmlFor,
  label,
}: {
  children: ReactNode;
  htmlFor: string;
  label: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium" htmlFor={htmlFor}>
      {label}
      {children}
    </label>
  );
}

export function HirePageContent({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-[76.875rem] flex-col px-6 pb-12">
      {children}
    </main>
  );
}

export function HireFlash({ children }: { children: ReactNode }) {
  return (
    <div
      className="mb-[22px] rounded-[7px] border border-border bg-card px-[15px] py-3 text-xs text-foreground"
      role="status"
    >
      {children}
    </div>
  );
}
