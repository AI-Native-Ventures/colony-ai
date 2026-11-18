import cityAreaData from "./data/city-areas.json";
import { distanceKm, type DiscoveryLocation } from "./discoveryLocation";

/**
 * The suburbs a whole-city campaign searches, inside the city the owner chose.
 *
 * Google Maps ends one search at about 100 to 150 places, however big the
 * place it names. On 18 Nov 2026 the owner's whole-city campaigns stopped
 * under 200 (Johannesburg plumbers: 96). One page each for Sandton, Soweto and
 * Randburg found 48 plumbers the whole-city search had missed. So once the
 * whole-city search runs out, the campaign goes on suburb by suburb. That is
 * not widening the area: every suburb is part of the city the owner picked.
 * Nearby places outside it are still only searched after the owner's yes.
 *
 * The lists live in `data/city-areas.json` (built by `build_city_areas.py`).
 * A place that is not one of those cities has no suburbs here and searches
 * the way it always did.
 */

type CityAreaEntry = {
  name: string;
  latitude: number;
  longitude: number;
};

type CityEntry = {
  name: string;
  aliases: string[];
  countryCode: string;
  region: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  areas: CityAreaEntry[];
};

const CITIES: readonly CityEntry[] = (cityAreaData as { cities: CityEntry[] })
  .cities;

/**
 * How far the chosen point may sit from a listed city's centre and still be
 * that city. Geocoders put a city's point near its centre; a place with the
 * same name elsewhere in the country is further away.
 */
const SAME_CITY_KM = 25;

function nameKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function firstPart(label: string): string {
  return label.split(",")[0]?.trim() ?? "";
}

function lastPart(label: string): string {
  const parts = label.split(",");
  return parts.at(-1)?.trim() ?? "";
}

function cityFor(place: DiscoveryLocation): CityEntry | null {
  if (place.kind !== "city") return null;
  const name = nameKey(firstPart(place.label));
  if (!name) return null;
  return (
    CITIES.find((city) => {
      if (place.countryCode !== city.countryCode) return false;
      const names = [city.name, ...city.aliases].map(nameKey);
      if (!names.includes(name)) return false;
      return (
        distanceKm(place, {
          ...place,
          latitude: city.latitude,
          longitude: city.longitude,
        }) <= SAME_CITY_KM
      );
    }) ?? null
  );
}

/**
 * The suburbs of the chosen city, in the order they are searched (business
 * centres first). Empty for any other place.
 */
export function suburbsOf(
  place: DiscoveryLocation | null | undefined,
): DiscoveryLocation[] {
  if (!place) return [];
  const city = cityFor(place);
  if (!city) return [];
  const country = lastPart(place.label);
  const cityName = firstPart(place.label) || city.name;
  return city.areas.map((area) => ({
    label: [area.name, cityName, city.region, country]
      .filter((part) => part.length > 0)
      .join(", "),
    latitude: area.latitude,
    longitude: area.longitude,
    countryCode: city.countryCode,
    region: place.region ?? city.region,
    kind: "suburb" as const,
    boundingBox: null,
  }));
}
