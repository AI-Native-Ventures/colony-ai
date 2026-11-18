import * as React from "react";

import {
  loadActiveCommunityId,
  loadCommunities,
} from "@/features/communities/communityStorage";

import { PinGlyph } from "./DiscoveryIcons";
import {
  attachNearbyLocations,
  discoveryLocationKey,
  readRecentDiscoveryLocations,
  rememberDiscoveryLocation,
  type DiscoveryLocation,
} from "./discoveryLocation";
import { searchDiscoveryLocations } from "./discoveryLocationClient";
import { MAX_MULTI_CITY_LOCATIONS, shortPlaceName } from "./multiCityDiscovery";

import "./multi-city-discovery.css";

const LOCATION_DEBOUNCE_MS = 250;

function activeRelayUrl(): string | null {
  const activeId = loadActiveCommunityId();
  return (
    loadCommunities().find((community) => community.id === activeId)
      ?.relayUrl ?? null
  );
}

function browserLocationStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

/**
 * A chip-based place picker. Selection always comes from the relay geocoder,
 * so adding cities never turns ambiguous typed text into a paid search.
 */
export function MultiCityLocationPicker({
  locations,
  onChange,
}: {
  locations: readonly DiscoveryLocation[];
  onChange: (locations: DiscoveryLocation[]) => void;
}) {
  const inputId = React.useId();
  const listId = `${inputId}-options`;
  const [query, setQuery] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  const [suggestions, setSuggestions] = React.useState<DiscoveryLocation[]>(
    () => readRecentDiscoveryLocations(browserLocationStorage()),
  );
  const [recents, setRecents] = React.useState<DiscoveryLocation[]>(() =>
    readRecentDiscoveryLocations(browserLocationStorage()),
  );
  const locationsRef = React.useRef(locations);
  locationsRef.current = locations;
  const searchGenerationRef = React.useRef(0);
  const blurTimeoutRef = React.useRef<number | null>(null);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const activeIndexRef = React.useRef(-1);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const relayUrl = activeRelayUrl();
  const hasE2eHook =
    typeof window !== "undefined" &&
    Boolean(window.__BUZZ_E2E_DISCOVERY_LOCATIONS__);
  const selectedKeys = React.useMemo(
    () => new Set(locations.map(discoveryLocationKey)),
    [locations],
  );
  const baseOptions = query.trim().length < 2 ? recents : suggestions;
  const options = baseOptions.filter(
    (location) => !selectedKeys.has(discoveryLocationKey(location)),
  );
  const optionsRef = React.useRef(options);
  optionsRef.current = options;
  const open =
    focused &&
    options.length > 0 &&
    locations.length < MAX_MULTI_CITY_LOCATIONS;

  React.useEffect(() => {
    const searchGeneration = ++searchGenerationRef.current;
    activeIndexRef.current = -1;
    setActiveIndex(-1);
    if (query.trim().length < 2) {
      setSuggestions(recents);
      setLoading(false);
      setError("");
      return;
    }
    if (!relayUrl && !hasE2eHook) {
      setSuggestions([]);
      setLoading(false);
      setError("Location suggestions need an active community connection.");
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void searchDiscoveryLocations({
        relayUrl: relayUrl ?? "wss://e2e.invalid",
        request: { query },
        signal: controller.signal,
      })
        .then((next) => {
          if (
            !controller.signal.aborted &&
            searchGeneration === searchGenerationRef.current
          ) {
            setSuggestions(next);
          }
        })
        .catch((searchError: unknown) => {
          if (
            controller.signal.aborted ||
            searchGeneration !== searchGenerationRef.current
          ) {
            return;
          }
          setSuggestions([]);
          setError(
            searchError instanceof Error && searchError.message.trim()
              ? searchError.message
              : "Location suggestions are unavailable. Try again.",
          );
        })
        .finally(() => {
          if (
            !controller.signal.aborted &&
            searchGeneration === searchGenerationRef.current
          ) {
            setLoading(false);
          }
        });
    }, LOCATION_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [hasE2eHook, query, recents, relayUrl]);

  React.useEffect(
    () => () => {
      if (blurTimeoutRef.current !== null) {
        window.clearTimeout(blurTimeoutRef.current);
      }
    },
    [],
  );

  function clearBlurTimeout() {
    if (blurTimeoutRef.current === null) return;
    window.clearTimeout(blurTimeoutRef.current);
    blurTimeoutRef.current = null;
  }

  function focusOptions() {
    clearBlurTimeout();
    setFocused(true);
  }

  function deferOptionsClose() {
    clearBlurTimeout();
    blurTimeoutRef.current = window.setTimeout(() => {
      blurTimeoutRef.current = null;
      setFocused(false);
    }, 120);
  }

  function choose(next: DiscoveryLocation) {
    const currentLocations = locationsRef.current;
    if (currentLocations.length >= MAX_MULTI_CITY_LOCATIONS) return;
    const selected = attachNearbyLocations(next, optionsRef.current);
    if (
      currentLocations.some(
        (location) =>
          discoveryLocationKey(location) === discoveryLocationKey(selected),
      )
    ) {
      return;
    }
    const remembered = rememberDiscoveryLocation(
      browserLocationStorage(),
      selected,
    );
    searchGenerationRef.current += 1;
    setRecents(remembered);
    setSuggestions(remembered);
    setLoading(false);
    onChange([...currentLocations, selected]);
    setQuery("");
    focusOptions();
    activeIndexRef.current = -1;
    setActiveIndex(-1);
  }

  function remove(location: DiscoveryLocation) {
    const key = discoveryLocationKey(location);
    onChange(
      locationsRef.current.filter(
        (candidate) => discoveryLocationKey(candidate) !== key,
      ),
    );
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const currentLocations = locationsRef.current;
    if (event.key === "Backspace" && !query && currentLocations.length) {
      event.preventDefault();
      const last = currentLocations.at(-1);
      if (last) remove(last);
      return;
    }
    if (event.key === "ArrowDown") {
      if (!optionsRef.current.length) return;
      event.preventDefault();
      focusOptions();
      const nextIndex = Math.min(
        activeIndexRef.current + 1,
        optionsRef.current.length - 1,
      );
      activeIndexRef.current = nextIndex;
      setActiveIndex(nextIndex);
    } else if (event.key === "ArrowUp") {
      if (!optionsRef.current.length) return;
      event.preventDefault();
      focusOptions();
      const nextIndex = Math.max(activeIndexRef.current - 1, 0);
      activeIndexRef.current = nextIndex;
      setActiveIndex(nextIndex);
    } else if (event.key === "Enter" && activeIndexRef.current >= 0) {
      const candidate = optionsRef.current[activeIndexRef.current];
      if (candidate) {
        event.preventDefault();
        choose(candidate);
      }
    } else if (event.key === "Escape") {
      setFocused(false);
      activeIndexRef.current = -1;
      setActiveIndex(-1);
    }
  }

  const selectedCount = locations.length;
  const hint = loading
    ? "Finding places…"
    : selectedCount >= MAX_MULTI_CITY_LOCATIONS
      ? `You can choose up to ${MAX_MULTI_CITY_LOCATIONS} cities.`
      : selectedCount === 1
        ? `Selected ${locations[0]?.label ?? "place"}. Add another or remove it.`
        : selectedCount
          ? `${selectedCount} cities selected. Add another or remove one.`
          : "Pick one or more places from the list before starting this search.";

  return (
    <div className="c3d-field c3mc-location-picker">
      <label htmlFor={inputId}>
        Cities <span className="sr-only">Location</span>
      </label>
      <div className="c3mc-location-input-wrap">
        <div
          className={`c3mc-location-chips${locations.length ? " is-populated" : ""}`}
          data-testid="multi-city-location-chips"
        >
          {locations.map((location) => {
            const name = shortPlaceName(location.label);
            return (
              <span
                className="c3mc-location-chip"
                key={discoveryLocationKey(location)}
              >
                <PinGlyph size={13} />
                <span>{name}</span>
                <button
                  aria-label={`Remove ${name}`}
                  onClick={() => remove(location)}
                  type="button"
                >
                  ×
                </button>
              </span>
            );
          })}
          <input
            aria-activedescendant={
              activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined
            }
            aria-autocomplete="list"
            aria-controls={listId}
            aria-describedby={`${inputId}-hint`}
            aria-expanded={open}
            autoComplete="off"
            disabled={selectedCount >= MAX_MULTI_CITY_LOCATIONS}
            id={inputId}
            onBlur={deferOptionsClose}
            onChange={(event) => {
              const nextQuery = event.currentTarget.value;
              searchGenerationRef.current += 1;
              activeIndexRef.current = -1;
              setActiveIndex(-1);
              setSuggestions([]);
              setLoading(nextQuery.trim().length >= 2);
              setError("");
              setQuery(nextQuery);
            }}
            onFocus={focusOptions}
            onKeyDown={onKeyDown}
            placeholder={
              selectedCount
                ? "Add another city"
                : "Search a city, suburb, region or country"
            }
            role="combobox"
            value={query}
          />
        </div>
        {open ? (
          <div
            aria-label="City suggestions"
            className="c3d-location-options"
            id={listId}
            role="listbox"
          >
            {options.map((option, index) => (
              <div
                aria-selected={activeIndex === index}
                className={activeIndex === index ? "is-active" : undefined}
                id={`${listId}-${index}`}
                key={discoveryLocationKey(option)}
                onClick={() => choose(option)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    choose(option);
                  }
                }}
                onMouseDown={(event) => event.preventDefault()}
                role="option"
                tabIndex={-1}
              >
                <strong>{option.label}</strong>
                <span>{option.kind}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <p aria-live="polite" className="sr-only" id={`${inputId}-hint`}>
        {hint}
      </p>
      {error ? (
        <p className="c3d-location-error" role="status">
          {error}
        </p>
      ) : null}
    </div>
  );
}
