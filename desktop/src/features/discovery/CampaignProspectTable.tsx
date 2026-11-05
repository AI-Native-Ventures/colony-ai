import { Link } from "@tanstack/react-router";

import {
  CheckGlyph,
  CloseGlyph,
  DownloadGlyph,
  MessageGlyph,
  SearchGlyph,
} from "./DiscoveryIcons";
import { ListPlus, MoreHorizontal, Sparkles } from "lucide-react";
import { BusinessLogoMark } from "./BusinessLogoMark";
import type { CampaignProspect, ProspectFilter } from "./CampaignHelpers";
import type { AcceptButtonState } from "./bulkAccept";
import type { ProspectStage } from "./businessRecordContract";
import { DiscoveryLeadTags } from "./DiscoveryLeadTags";
import { discoveryTagFitLabel } from "./discoveryTags";

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
        <option value="fit">Best fit</option>
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
  accept,
  count,
  onAccept,
  onAddToList,
  onAskScout,
  onBatch,
  onChangeStage,
  onMarkLost,
  canWrite,
  busy,
  onClear,
  onDiscuss,
}: {
  accept: AcceptButtonState;
  count: number;
  onAccept: () => void;
  onAddToList: () => void;
  onAskScout: () => void;
  onBatch: () => void;
  onChangeStage: (stage: ProspectStage) => void;
  onMarkLost: () => void;
  canWrite: boolean;
  busy: boolean;
  onClear: () => void;
  onDiscuss: () => void;
}) {
  return (
    <section
      aria-label="Selected prospects"
      className="c3d-selection"
      role="toolbar"
    >
      <strong>{count} selected</strong>
      <button
        aria-describedby={accept.note ? "c3d-selection-note" : undefined}
        className="c3d-selection-action c3d-selection-action--light"
        disabled={accept.disabled}
        onClick={onAccept}
        type="button"
      >
        <CheckGlyph />
        {accept.label.startsWith("Accepting ")
          ? accept.label
          : "Accept as lead"}
      </button>
      <button
        className="c3d-selection-action c3d-selection-action--light"
        disabled={!canWrite || busy}
        onClick={onAddToList}
        type="button"
      >
        <ListPlus aria-hidden="true" size={15} /> Add to outreach list
      </button>
      <button
        className="c3d-selection-action"
        disabled={!canWrite || busy}
        onClick={onBatch}
        type="button"
      >
        WhatsApp batch
      </button>
      <button
        className="c3d-selection-action c3d-selection-ask"
        onClick={onAskScout}
        type="button"
      >
        <Sparkles aria-hidden="true" size={15} /> Ask Scout
      </button>
      <details className="c3d-selection-more">
        <summary>
          <MoreHorizontal aria-hidden="true" size={15} /> More
        </summary>
        <div className="c3d-selection-more-menu">
          <details className="c3d-selection-stage-menu">
            <summary>
              Change stage <span aria-hidden="true">›</span>
            </summary>
            <div>
              {(
                [
                  ["qualified", "Qualified"],
                  ["in_conversation", "In conversation"],
                  ["proposal", "Proposal"],
                  ["won", "Won"],
                ] as Array<[ProspectStage, string]>
              ).map(([stage, label]) => (
                <button
                  disabled={!canWrite || busy}
                  key={stage}
                  onClick={() => onChangeStage(stage)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </details>
          <button
            disabled={!canWrite || busy}
            onClick={onMarkLost}
            type="button"
          >
            Mark lost
          </button>
          <button onClick={onDiscuss} type="button">
            <MessageGlyph size={16} /> Discuss in Sales
          </button>
        </div>
      </details>
      <button
        aria-label="Clear selection"
        className="c3d-selection-clear"
        onClick={onClear}
        type="button"
      >
        <CloseGlyph /> Clear
      </button>
      {accept.note ? (
        <p className="c3d-selection-note" id="c3d-selection-note">
          {accept.note}
        </p>
      ) : null}
    </section>
  );
}

export function CampaignTable({
  outreachByLead,
  onToggle,
  onToggleAll,
  rows,
  selected,
}: {
  outreachByLead: ReadonlyMap<string, { phone: string; whatsapp: string }>;
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
                aria-label={`Select all ${rows.length} prospects on this page`}
                checked={allSelected}
                onChange={(event) => onToggleAll(event.currentTarget.checked)}
                type="checkbox"
              />
            </th>
            <th {...COLUMN_HEADER_ROLE}>Business</th>
            <th {...COLUMN_HEADER_ROLE}>Phone</th>
            <th {...COLUMN_HEADER_ROLE}>Location</th>
            <th {...COLUMN_HEADER_ROLE}>Fit</th>
            <th {...COLUMN_HEADER_ROLE}>WhatsApp</th>
          </tr>
        </thead>
        <tbody {...ROWGROUP_ROLE}>
          {rows.map((row) => {
            const prospect = row.record.prospect;
            const isSelected = selected.has(row.record.prospectId);
            const score = prospect.fitScore;
            const tagFit = discoveryTagFitLabel(prospect.discoveryTags ?? []);
            const fit =
              tagFit ??
              (score == null
                ? "Not scored"
                : score >= 87
                  ? "Strong fit"
                  : "Possible fit");
            const matchedTags = (prospect.discoveryTags ?? [])
              .slice()
              .sort((left, right) => Number(right.picked) - Number(left.picked))
              .slice(0, 3)
              .map((match) => match.tag);
            const outreach = outreachByLead.get(row.record.prospectId);
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
                  <Link
                    aria-label={`${prospect.party.displayName}, ${prospect.vertical}${matchedTags.length ? `, matching tags ${matchedTags.join(", ")}` : ""}`}
                    className="c3d-prospect"
                    params={{ prospectId: row.record.prospectId }}
                    to="/sales/lead/$prospectId"
                  >
                    <BusinessLogoMark
                      className="c3d-prospect-mark"
                      logoUrl={prospect.logoUrl}
                      name={prospect.party.displayName}
                      placePhotoUrl={prospect.placePhotoUrl}
                      website={prospect.website}
                    />
                    <span className="c3d-prospect-copy">
                      <strong title={prospect.party.displayName}>
                        {prospect.party.displayName}
                      </strong>
                      <span title={prospect.vertical}>{prospect.vertical}</span>
                      <DiscoveryLeadTags
                        limit={3}
                        tags={prospect.discoveryTags}
                      />
                    </span>
                  </Link>
                </td>
                <td className="c3d-phone" {...CELL_ROLE}>
                  {outreach?.phone || "Not set"}
                </td>
                <td className="c3d-location" {...CELL_ROLE}>
                  {prospect.location ?? "Not set"}
                </td>
                <td {...CELL_ROLE}>
                  <span className="c3d-fit">
                    <span className="c3d-fit-score">{fit}</span>
                    <span aria-hidden="true" className="c3d-fit-bar">
                      <i style={{ width: `${Math.min(100, score ?? 0)}%` }} />
                    </span>
                  </span>
                </td>
                <td {...CELL_ROLE}>{outreach?.whatsapp ?? "Not contacted"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
