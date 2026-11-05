export type ContactFilter =
  | "all"
  | "queued"
  | "replied"
  | "sent"
  | "opted-out"
  | "needs-reply"
  | "wants-call"
  | "in-pipeline";

type WhatsAppOutreachContactFiltersProps = {
  activeFilter: ContactFilter;
  mode: "full" | "dock" | "desk";
  onActiveFilterChange: (filter: ContactFilter) => void;
  onSearchTermChange: (searchTerm: string) => void;
  searchTerm: string;
};

export function WhatsAppOutreachContactFilters({
  activeFilter,
  mode,
  onActiveFilterChange,
  onSearchTermChange,
  searchTerm,
}: WhatsAppOutreachContactFiltersProps) {
  const filters: Array<[ContactFilter, string]> =
    mode === "desk"
      ? [
          ["all", "All"],
          ["queued", "Queued"],
          ["needs-reply", "Needs reply"],
          ["wants-call", "Wants a call"],
          ["opted-out", "Opted out"],
        ]
      : [
          ["all", "All"],
          ["queued", "Queued"],
          ["replied", "Replied"],
          ["sent", "Sent"],
          ["opted-out", "Opted out"],
        ];

  return (
    <>
      <input
        aria-label="Search chats"
        className="c3wa-contact-search"
        onChange={(event) => onSearchTermChange(event.currentTarget.value)}
        placeholder="Search chats"
        type="search"
        value={searchTerm}
      />
      <div
        aria-label="Filter contacts"
        className="c3wa-contact-filters"
        role="tablist"
      >
        {filters.map(([filter, label]) => (
          <button
            aria-selected={activeFilter === filter}
            key={filter}
            onClick={() => onActiveFilterChange(filter)}
            role="tab"
            title={label}
            type="button"
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );
}
