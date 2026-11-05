import { ListFilter, X } from "lucide-react";

import {
  outreachFilterCounts,
  type OutreachFilters,
  type OutreachRow,
  type OutreachWhatsAppStatus,
} from "./outreachSelection";

const WHATSAPP_OPTIONS: Array<{
  value: OutreachWhatsAppStatus;
  label: string;
}> = [
  { value: "not-contacted", label: "Not contacted" },
  { value: "in-batch", label: "In a batch, waiting for you" },
  { value: "sent", label: "Sent" },
  { value: "replied", label: "Replied" },
  { value: "opted-out", label: "Opted out" },
  { value: "no-number", label: "No WhatsApp number" },
];

const STAGE_OPTIONS = [
  { value: "new", label: "New" },
  { value: "qualified", label: "Qualified" },
  { value: "in_conversation", label: "In conversation" },
  { value: "proposal", label: "Proposal" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "client", label: "Client" },
];

function toggleValue<T>(values: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(values);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function OutreachFilterControls({
  filters,
  onChange,
  query,
  rows,
  matching,
  pageSelectedCount,
  allMatchingSelected,
  onSelectAllMatching,
  showSelectAll = true,
}: {
  filters: OutreachFilters;
  onChange: (filters: OutreachFilters) => void;
  query: string;
  rows: readonly OutreachRow[];
  matching: number;
  pageSelectedCount: number;
  allMatchingSelected: boolean;
  onSelectAllMatching: () => void;
  showSelectAll?: boolean;
}) {
  const counts = outreachFilterCounts(rows, filters, query);
  const selectedWhatsAppStatuses = WHATSAPP_OPTIONS.filter(({ value }) =>
    filters.whatsappStatuses.has(value),
  );
  const selectedWhatsAppCount = [...filters.whatsappStatuses].reduce(
    (total, status) => total + counts.whatsapp[status],
    0,
  );
  const whatsappSummary = selectedWhatsAppStatuses[0]
    ? `${selectedWhatsAppStatuses[0].label}${filters.whatsappStatuses.size > 1 ? ` +${filters.whatsappStatuses.size - 1}` : ""} ${selectedWhatsAppCount}`
    : "Status";
  return (
    <div className="c3l-filter-summary">
      <section aria-label="Active filters" className="c3l-filter-chips">
        {filters.hasPhone !== null ? (
          <button
            aria-label="Remove phone number filter"
            className="c3l-filter-chip"
            onClick={() => onChange({ ...filters, hasPhone: null })}
            type="button"
          >
            {filters.hasPhone ? "Has phone number" : "No phone number"}{" "}
            {counts.hasPhone}
            <X aria-hidden="true" size={14} />
          </button>
        ) : null}
        {filters.whatsappStatuses.size > 0 ? (
          <div className="c3l-whatsapp-filter-chip">
            <details className="c3l-whatsapp-filter-menu">
              <summary aria-label="Filter by WhatsApp status">
                <span>WhatsApp: </span>
                {whatsappSummary}
              </summary>
              <div className="c3l-whatsapp-filter-menu-content">
                <strong>WhatsApp status</strong>
                {WHATSAPP_OPTIONS.map(({ value, label }) => (
                  <label key={value}>
                    <input
                      checked={filters.whatsappStatuses.has(value)}
                      onChange={() =>
                        onChange({
                          ...filters,
                          whatsappStatuses: toggleValue(
                            filters.whatsappStatuses,
                            value,
                          ),
                        })
                      }
                      type="checkbox"
                    />
                    <span>{label}</span>
                    <small>{counts.whatsapp[value]}</small>
                  </label>
                ))}
                <p>Counts are for leads with a phone number.</p>
              </div>
            </details>
            <button
              aria-label="Remove WhatsApp filter"
              className="c3l-filter-chip-clear"
              onClick={() =>
                onChange({ ...filters, whatsappStatuses: new Set() })
              }
              type="button"
            >
              <X aria-hidden="true" size={14} />
            </button>
          </div>
        ) : null}
        {[...filters.stages].map((stage) => {
          const option = STAGE_OPTIONS.find((item) => item.value === stage);
          return option ? (
            <button
              aria-label={`Remove stage filter: ${option.label}`}
              className="c3l-filter-chip"
              key={stage}
              onClick={() =>
                onChange({
                  ...filters,
                  stages: toggleValue(filters.stages, stage),
                })
              }
              type="button"
            >
              Stage: {option.label} {counts.stages[stage] ?? 0}
              <X aria-hidden="true" size={14} />
            </button>
          ) : null;
        })}
        <details className="c3l-filter-menu">
          <summary>
            <ListFilter aria-hidden="true" size={14} />
            <span>Add filter</span>
          </summary>
          <div className="c3l-filter-menu-content">
            <fieldset>
              <legend>Phone</legend>
              <label>
                <input
                  checked={filters.hasPhone === true}
                  onChange={() =>
                    onChange({
                      ...filters,
                      hasPhone: filters.hasPhone === true ? null : true,
                    })
                  }
                  type="checkbox"
                />
                Has phone number <span>{counts.hasPhone}</span>
              </label>
            </fieldset>
            <fieldset>
              <legend>WhatsApp status</legend>
              {WHATSAPP_OPTIONS.map(({ value, label }) => (
                <label key={value}>
                  <input
                    checked={filters.whatsappStatuses.has(value)}
                    onChange={() =>
                      onChange({
                        ...filters,
                        whatsappStatuses: toggleValue(
                          filters.whatsappStatuses,
                          value,
                        ),
                      })
                    }
                    type="checkbox"
                  />
                  {label} <span>{counts.whatsapp[value]}</span>
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Stage</legend>
              {STAGE_OPTIONS.map(({ value, label }) => (
                <label key={value}>
                  <input
                    checked={filters.stages.has(value)}
                    onChange={() =>
                      onChange({
                        ...filters,
                        stages: toggleValue(filters.stages, value),
                      })
                    }
                    type="checkbox"
                  />
                  {label} <span>{counts.stages[value] ?? 0}</span>
                </label>
              ))}
            </fieldset>
          </div>
        </details>
      </section>
      <div className="c3l-match-row">
        <span aria-live="polite" className="c3l-match-count">
          {matching} of {rows.length} match
        </span>
        {showSelectAll && pageSelectedCount > 0 && !allMatchingSelected ? (
          <button
            className="c3l-match-select-all"
            onClick={onSelectAllMatching}
            type="button"
          >
            Select all {matching} matching leads
          </button>
        ) : null}
      </div>
    </div>
  );
}
