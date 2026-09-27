export function GoalRouteHeader({ title }: { title: string }) {
  return (
    <div className="flex h-[78px] w-full flex-none items-center border-b border-border px-6">
      <p className="text-sm font-semibold text-foreground">Company / {title}</p>
    </div>
  );
}

export function GoalRouteBackLink({
  label = "Back",
  onClick,
}: {
  label?: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="mb-8 inline-flex items-center gap-1 pt-4 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onClick}
      type="button"
    >
      <span aria-hidden="true">‹</span> {label}
    </button>
  );
}
