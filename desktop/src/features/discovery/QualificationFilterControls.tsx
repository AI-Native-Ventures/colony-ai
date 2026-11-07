import { ListFilter, X } from "lucide-react";

import {
  QUALIFICATION_SIGNAL_DEFINITIONS,
  qualificationSignalDefinition,
} from "./qualificationCampaign";
import type { QualifySignal } from "./businessRecordContract";
import type {
  QualificationFilter,
  QualificationFilterLead,
} from "./qualifyFilter";

function toggle<T>(values: readonly T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
}

function uniqueValues(values: readonly (string | null)[]): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ].sort((left, right) => left.localeCompare(right));
}

function numberValue(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function rangeValue(
  current: QualificationFilter["rating"],
  key: "min" | "max",
  value: string,
) {
  const number = numberValue(value);
  const next = { ...current, [key]: number };
  return next.min === undefined && next.max === undefined ? undefined : next;
}

function SignalPicker({
  label,
  selected,
  onChange,
}: {
  label: string;
  selected: readonly QualifySignal[];
  onChange: (selected: QualifySignal[]) => void;
}) {
  return (
    <details className="c3q-signal-picker">
      <summary>
        <ListFilter aria-hidden="true" size={14} />
        {label}
        {selected.length ? <span>{selected.length}</span> : null}
      </summary>
      <div>
        {QUALIFICATION_SIGNAL_DEFINITIONS.map((definition) => (
          <label key={definition.signal}>
            <input
              checked={selected.includes(definition.signal)}
              onChange={() => onChange(toggle(selected, definition.signal))}
              type="checkbox"
            />
            <span>
              {definition.label}
              <small>{definition.description}</small>
            </span>
          </label>
        ))}
      </div>
    </details>
  );
}

function SignalChips({
  label,
  selected,
  onRemove,
}: {
  label: string;
  selected: readonly QualifySignal[];
  onRemove: (signal: QualifySignal) => void;
}) {
  return selected.map((signal) => (
    <button
      aria-label={`Remove ${label} filter: ${qualificationSignalDefinition(signal).label}`}
      className="c3q-chip"
      key={`${label}-${signal}`}
      onClick={() => onRemove(signal)}
      type="button"
    >
      {label}: {qualificationSignalDefinition(signal).label}
      <X aria-hidden="true" size={13} />
    </button>
  ));
}

/** The browser-only filter layer over saved Maps and qualification records. */
export function QualificationFilterControls({
  filter,
  matching,
  onChange,
  onSaveList,
  rows,
}: {
  filter: QualificationFilter;
  matching: number;
  onChange: (filter: QualificationFilter) => void;
  onSaveList: () => void;
  rows: readonly QualificationFilterLead[];
}) {
  const categories = uniqueValues(rows.map((row) => row.category));
  const cities = uniqueValues(rows.map((row) => row.city));
  const notChecked = filter.notChecked ?? [];
  return (
    <section
      aria-label="Website check filters"
      className="c3q-filter-panel"
      data-testid="qualification-filter-controls"
    >
      <div className="c3q-filter-heading">
        <div>
          <p>Website checks</p>
          <h2>Find leads by what we found</h2>
        </div>
        <span aria-live="polite" data-testid="qualification-filter-count">
          {matching} {matching === 1 ? "lead" : "leads"}
        </span>
      </div>
      <div className="c3q-filter-controls">
        <SignalPicker
          label="Must have"
          onChange={(mustHave) => onChange({ ...filter, mustHave })}
          selected={filter.mustHave}
        />
        <SignalPicker
          label="Must not have"
          onChange={(mustNotHave) => onChange({ ...filter, mustNotHave })}
          selected={filter.mustNotHave}
        />
        <SignalPicker
          label="Not checked"
          onChange={(next) => onChange({ ...filter, notChecked: next })}
          selected={notChecked}
        />
        <details className="c3q-filter-menu">
          <summary>Maps details</summary>
          <div>
            <fieldset>
              <legend>Rating</legend>
              <label>
                Minimum
                <input
                  aria-label="Minimum rating"
                  inputMode="decimal"
                  min="0"
                  onChange={(event) =>
                    onChange({
                      ...filter,
                      rating: rangeValue(
                        filter.rating,
                        "min",
                        event.currentTarget.value,
                      ),
                    })
                  }
                  placeholder="Any"
                  type="number"
                  value={filter.rating?.min ?? ""}
                />
              </label>
              <label>
                Maximum
                <input
                  aria-label="Maximum rating"
                  inputMode="decimal"
                  min="0"
                  onChange={(event) =>
                    onChange({
                      ...filter,
                      rating: rangeValue(
                        filter.rating,
                        "max",
                        event.currentTarget.value,
                      ),
                    })
                  }
                  placeholder="Any"
                  type="number"
                  value={filter.rating?.max ?? ""}
                />
              </label>
            </fieldset>
            <fieldset>
              <legend>Reviews</legend>
              <label>
                Minimum
                <input
                  aria-label="Minimum reviews"
                  inputMode="numeric"
                  min="0"
                  onChange={(event) =>
                    onChange({
                      ...filter,
                      reviewCount: rangeValue(
                        filter.reviewCount,
                        "min",
                        event.currentTarget.value,
                      ),
                    })
                  }
                  placeholder="Any"
                  type="number"
                  value={filter.reviewCount?.min ?? ""}
                />
              </label>
              <label>
                Maximum
                <input
                  aria-label="Maximum reviews"
                  inputMode="numeric"
                  min="0"
                  onChange={(event) =>
                    onChange({
                      ...filter,
                      reviewCount: rangeValue(
                        filter.reviewCount,
                        "max",
                        event.currentTarget.value,
                      ),
                    })
                  }
                  placeholder="Any"
                  type="number"
                  value={filter.reviewCount?.max ?? ""}
                />
              </label>
            </fieldset>
            {categories.length ? (
              <fieldset>
                <legend>Category</legend>
                {categories.map((category) => (
                  <label key={category}>
                    <input
                      checked={(filter.categories ?? []).includes(category)}
                      onChange={() =>
                        onChange({
                          ...filter,
                          categories: toggle(filter.categories ?? [], category),
                        })
                      }
                      type="checkbox"
                    />
                    {category}
                  </label>
                ))}
              </fieldset>
            ) : null}
            {cities.length ? (
              <fieldset>
                <legend>City</legend>
                {cities.map((city) => (
                  <label key={city}>
                    <input
                      checked={(filter.cities ?? []).includes(city)}
                      onChange={() =>
                        onChange({
                          ...filter,
                          cities: toggle(filter.cities ?? [], city),
                        })
                      }
                      type="checkbox"
                    />
                    {city}
                  </label>
                ))}
              </fieldset>
            ) : null}
          </div>
        </details>
      </div>
      <div className="c3q-filter-chips">
        <SignalChips
          label="Must have"
          onRemove={(signal) =>
            onChange({ ...filter, mustHave: toggle(filter.mustHave, signal) })
          }
          selected={filter.mustHave}
        />
        <SignalChips
          label="Must not have"
          onRemove={(signal) =>
            onChange({
              ...filter,
              mustNotHave: toggle(filter.mustNotHave, signal),
            })
          }
          selected={filter.mustNotHave}
        />
        <SignalChips
          label="Not checked"
          onRemove={(signal) =>
            onChange({ ...filter, notChecked: toggle(notChecked, signal) })
          }
          selected={notChecked}
        />
      </div>
      <button
        className="c3q-save-list"
        disabled={matching === 0}
        onClick={onSaveList}
        type="button"
      >
        Save this exact filter as a static list
      </button>
    </section>
  );
}
