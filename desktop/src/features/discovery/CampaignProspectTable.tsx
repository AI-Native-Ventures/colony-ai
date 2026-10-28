import {
  CheckGlyph,
  ChevronRightGlyph,
  CloseGlyph,
  DownloadGlyph,
  MessageGlyph,
  SearchGlyph,
} from "./DiscoveryIcons";
import { firstName, RunnerAvatar, useRunnerProfile } from "./DiscoveryRunner";
import { BusinessLogoMark } from "./BusinessLogoMark";
import {
  fitLabel,
  prospectStatus,
  type CampaignProspect,
  type ProspectFilter,
} from "./CampaignHelpers";
import type { DiscoveryRunner } from "./discoveryProvider";

import "./colony3-discovery.css";

export type ProspectSort = "fit" | "name";

/*
 * The rows lay out as a grid (the design's columns), and a table element with
 * a grid display loses its native table semantics, so the roles are restated.
 */
const TABLE_ROLE = { role: "table" } as const;
const ROWGROUP_ROLE = { role: "rowgroup" } as const;
const ROW_ROLE = { role: "row" } as const;
const COLUMN_HEADER_ROLE = { role: "columnheader" } as const;
const CELL_ROLE = { role: "cell" } as const;

export function CampaignToolbar({
  exportDisabled,
  filter,
  onExport,
  onFilter,
  onQuery,
  onSort,
  query,
  sort,
}: {
  exportDisabled: boolean;
  filter: ProspectFilter;
  onExport: () => void;
  onFilter: (filter: ProspectFilter) => void;
  onQuery: (query: string) => void;
  onSort: (sort: ProspectSort) => void;
  query: string;
  sort: ProspectSort;
}) {
  return (
    <div className="c3d-toolbar">
      <label className="c3d-toolbar-search">
        <SearchGlyph size={17} />
        <input
          aria-label="Search prospects"
          onChange={(event) => onQuery(event.currentTarget.value)}
          placeholder="Search prospects…"
          value={query}
        />
      </label>
      <select
        aria-label="Filter prospects"
        className="c3d-select"
        id="w10-campaign-filter"
        onChange={(event) =>
          onFilter(event.currentTarget.value as ProspectFilter)
        }
        value={filter}
      >
        <option value="all">All prospects</option>
        <option value="high-fit">Strong fit · 85+</option>
        <option value="accepted">Accepted leads</option>
        <option value="candidates">Not yet accepted</option>
      </select>
      <select
        aria-label="Sort prospects"
        className="c3d-select"
        id="w10-campaign-sort"
        onChange={(event) => onSort(event.currentTarget.value as ProspectSort)}
        value={sort}
      >
        <option value="fit">Best fit first</option>
        <option value="name">Name A–Z</option>
      </select>
      <button
        aria-label="Export visible prospects"
        className="c3d-icon-button"
        disabled={exportDisabled}
        onClick={onExport}
        type="button"
      >
        <DownloadGlyph />
      </button>
    </div>
  );
}

/** The dark bar that appears once rows are selected. */
export function CampaignSelectionBar({
  canAccept,
  count,
  onAccept,
  onClear,
  onDiscuss,
  runner,
}: {
  canAccept: boolean;
  count: number;
  onAccept: () => void;
  onClear: () => void;
  onDiscuss: () => void;
  runner: DiscoveryRunner | null;
}) {
  const runnerProfile = useRunnerProfile(runner);
  const discussWith = runner && runnerProfile.isAgent ? runner : null;
  return (
    <section
      aria-label="Selected prospects"
      className="c3d-selection"
      role="toolbar"
    >
      <strong>{count} selected</strong>
      <button
        className="c3d-selection-action c3d-selection-action--light"
        disabled={!canAccept}
        onClick={onAccept}
        type="button"
      >
        <CheckGlyph /> Accept as lead
      </button>
      <button
        className="c3d-selection-action"
        onClick={onDiscuss}
        type="button"
      >
        {discussWith ? (
          <>
            <RunnerAvatar runner={discussWith} size={22} />
            Discuss with {firstName(discussWith.name)}
          </>
        ) : (
          <>
            <MessageGlyph size={16} /> Discuss in Sales
          </>
        )}
      </button>
      <button
        aria-label="Clear selection"
        className="c3d-selection-clear"
        onClick={onClear}
        type="button"
      >
        <CloseGlyph />
      </button>
    </section>
  );
}

export function CampaignTable({
  onToggle,
  onToggleAll,
  rows,
  selected,
}: {
  onToggle: (prospectId: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  rows: CampaignProspect[];
  selected: ReadonlySet<string>;
}) {
  const allSelected =
    rows.length > 0 &&
    rows.every(({ record }) => selected.has(record.prospectId));
  return (
    <div className="c3d-table-wrap">
      <table aria-label="Prospects" className="c3d-table" {...TABLE_ROLE}>
        <thead {...ROWGROUP_ROLE}>
          <tr {...ROW_ROLE}>
            <th {...COLUMN_HEADER_ROLE}>
              <input
                aria-label="Select all visible prospects"
                checked={allSelected}
                onChange={(event) => onToggleAll(event.currentTarget.checked)}
                type="checkbox"
              />
            </th>
            <th {...COLUMN_HEADER_ROLE}>Business / person</th>
            <th {...COLUMN_HEADER_ROLE}>Location</th>
            <th {...COLUMN_HEADER_ROLE}>Fit</th>
            <th {...COLUMN_HEADER_ROLE}>Status</th>
            <th aria-label="Open profile" {...COLUMN_HEADER_ROLE} />
          </tr>
        </thead>
        <tbody {...ROWGROUP_ROLE}>
          {rows.map((row) => {
            const prospect = row.record.prospect;
            const status = prospectStatus(prospect);
            const isSelected = selected.has(row.record.prospectId);
            const score = prospect.fitScore;
            const href = `#/sales/lead/${row.record.prospectId}`;
            return (
              <tr
                aria-selected={isSelected}
                className={isSelected ? "is-selected" : ""}
                key={row.eventId}
                {...ROW_ROLE}
              >
                <td {...CELL_ROLE}>
                  <input
                    aria-label={`Select ${prospect.party.displayName}`}
                    checked={isSelected}
                    onChange={(event) =>
                      onToggle(
                        row.record.prospectId,
                        event.currentTarget.checked,
                      )
                    }
                    type="checkbox"
                  />
                </td>
                <td {...CELL_ROLE}>
                  <a
                    aria-label={`${prospect.party.displayName}, ${prospect.vertical}`}
                    className="c3d-prospect"
                    href={href}
                  >
                    <BusinessLogoMark
                      className="c3d-prospect-mark"
                      name={prospect.party.displayName}
                      website={prospect.website}
                    />
                    <span className="c3d-prospect-copy">
                      <strong>{prospect.party.displayName}</strong>
                      <span>{prospect.vertical}</span>
                    </span>
                  </a>
                </td>
                <td className="c3d-location" {...CELL_ROLE}>
                  {prospect.location ?? "Not set"}
                </td>
                <td {...CELL_ROLE}>
                  <span className="c3d-fit">
                    <span className="c3d-fit-score">{fitLabel(prospect)}</span>
                    <span aria-hidden="true" className="c3d-fit-bar">
                      <i style={{ width: `${Math.min(100, score ?? 0)}%` }} />
                    </span>
                  </span>
                </td>
                <td {...CELL_ROLE}>
                  <span className={`c3d-pill c3d-pill--${status.tone}`}>
                    {status.label}
                  </span>
                </td>
                <td {...CELL_ROLE}>
                  <a
                    aria-label={`Open ${prospect.party.displayName}`}
                    className="c3d-open"
                    href={href}
                  >
                    <ChevronRightGlyph />
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
