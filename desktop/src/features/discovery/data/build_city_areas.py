#!/usr/bin/env python3 -I
"""Build city-areas.json: the suburbs Discovery searches inside a big city.

    python3 -I build_city_areas.py

Why: Google Maps ends one search at about 100 to 150 places, however big the
place it names. A whole-city search for Johannesburg plumbers found 96; one
page each for Sandton, Soweto and Randburg found 48 more it had missed
(18 Nov 2026). So a campaign for a big city goes on suburb by suburb, all
inside the city the owner chose.

The suburb names below are written by hand, in the order a person would
search them (business centres first). Each name is looked up once on Photon
(the free geocoder the relay's place picker already uses) to get its point
and to prove it exists in the right province near the city. A name Photon
cannot place there is left out and reported. Only public place names are
sent; nothing about any user.

The points are approximate (Photon may return a street of the same name).
Searches send Maps the suburb's name, never its point; the point only keys
saved coverage. A point already in city-areas.json is kept on a rebuild, so a
hand-corrected point stays.
"""

import json
import math
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "city-areas.json"
PHOTON = "https://photon.komoot.io/api"
USER_AGENT = "Colony Discovery city areas build/1.0"

# name, province, centre (lat, lng), other names, max km from centre, suburbs
CITIES = [
    {
        "name": "Johannesburg",
        "aliases": ["Joburg", "City of Johannesburg", "Jozi"],
        "region": "Gauteng",
        "centre": (-26.205, 28.049722),
        "radiusKm": 45,
        "areas": [
            "Sandton", "Randburg", "Rosebank", "Fourways", "Midrand",
            "Roodepoort", "Soweto", "Bryanston", "Rivonia", "Sunninghill",
            "Morningside", "Woodmead", "Parktown", "Braamfontein", "Melville",
            "Northcliff", "Linden", "Greenside", "Parkhurst", "Houghton Estate",
            "Illovo", "Ferndale", "Blairgowrie", "Craighall", "Hyde Park",
            "Northriding", "Honeydew", "Florida", "Weltevreden Park",
            "Ruimsig", "Lonehill", "Douglasdale", "Paulshof", "Kyalami",
            "Lenasia", "Alexandra", "Diepsloot", "Booysens", "Ormonde",
            "Mondeor", "Glenvista", "Turffontein", "Rosettenville",
            "Kensington", "Highlands North", "Norwood", "Orange Grove",
            "Bez Valley", "Yeoville", "Crown Mines",
        ],
    },
    {
        "name": "Pretoria",
        "aliases": ["Tshwane", "City of Tshwane"],
        "region": "Gauteng",
        "centre": (-25.7459277, 28.1879101),
        "radiusKm": 45,
        "areas": [
            "Centurion", "Hatfield", "Brooklyn", "Menlyn", "Arcadia",
            "Lynnwood", "Garsfontein", "Faerie Glen", "Moreleta Park",
            "Waterkloof", "Montana", "Sinoville", "Wonderboom",
            "Pretoria North", "Akasia", "Silverton", "Pretoria West",
            "Sunnyside", "Rietondale", "Queenswood", "Lyttelton", "Irene",
            "Highveld", "Eldoraigne", "Wierdapark", "Rooihuiskraal",
            "Equestria", "Die Wilgers", "Silver Lakes", "Mooikloof", "Annlin",
            "Gezina", "Capital Park", "Erasmuskloof", "Elardus Park",
            "Hennopspark", "Laudium", "Mamelodi", "Atteridgeville",
            "Soshanguve", "Olievenhoutbosch", "Ga-Rankuwa", "Hammanskraal",
        ],
    },
    {
        "name": "Cape Town",
        "aliases": ["City of Cape Town", "Kaapstad"],
        "region": "Western Cape",
        "centre": (-33.9288301, 18.4172197),
        "radiusKm": 55,
        "areas": [
            "Bellville", "Durbanville", "Claremont", "Sea Point",
            "Green Point", "Gardens", "Woodstock", "Observatory",
            "Rondebosch", "Newlands", "Wynberg", "Kenilworth", "Constantia",
            "Tokai", "Bergvliet", "Plumstead", "Retreat", "Muizenberg",
            "Fish Hoek", "Noordhoek", "Hout Bay", "Camps Bay", "Milnerton",
            "Table View", "Bloubergstrand", "Parow", "Goodwood",
            "Brackenfell", "Kuils River", "Kraaifontein", "Somerset West",
            "Strand", "Gordon's Bay", "Pinelands", "Montague Gardens",
            "Century City", "Epping", "Athlone", "Lansdowne",
            "Mitchells Plain", "Khayelitsha", "Gugulethu", "Grassy Park",
            "Philippi", "Salt River", "Melkbosstrand", "Atlantis",
        ],
    },
    {
        "name": "Durban",
        "aliases": ["eThekwini", "Thekwini"],
        "region": "KwaZulu-Natal",
        "centre": (-29.8618145, 31.009909),
        "radiusKm": 45,
        "areas": [
            "Umhlanga", "Durban North", "Berea", "Morningside", "Glenwood",
            "Musgrave", "Westville", "Pinetown", "Hillcrest", "Kloof",
            "Gillitts", "New Germany", "Queensburgh", "Bellair", "Montclair",
            "Umbilo", "Greyville", "Overport", "Sydenham", "Mayville",
            "Springfield", "La Lucia", "Mount Edgecombe", "Riverhorse Valley",
            "Verulam", "Tongaat", "Phoenix", "KwaMashu", "Chatsworth",
            "Umlazi", "Amanzimtoti", "Isipingo", "Bluff", "Mobeni",
            "Jacobs", "Prospecton", "Reservoir Hills", "Malvern",
            "Waterfall", "Sea View",
        ],
    },
    {
        "name": "Sandton",
        "aliases": [],
        "region": "Gauteng",
        "centre": (-26.1045525, 28.0545147),
        "radiusKm": 15,
        "areas": [
            "Bryanston", "Rivonia", "Morningside", "Sunninghill", "Woodmead",
            "Illovo", "Hyde Park", "Parkmore", "Benmore Gardens", "Sandown",
            "Wendywood", "Gallo Manor", "Paulshof", "Lonehill",
            "Douglasdale", "Atholl", "Inanda", "Strathavon", "Marlboro",
            "Kelvin",
        ],
    },
    {
        "name": "Gqeberha",
        "aliases": ["Port Elizabeth", "Nelson Mandela Bay"],
        "region": "Eastern Cape",
        "centre": (-33.9608369, 25.6022423),
        "radiusKm": 40,
        "areas": [
            "Summerstrand", "Newton Park", "Walmer", "Humewood", "Mill Park",
            "Greenacres", "Lorraine", "Kabega Park", "Westering",
            "Sunridge Park", "Charlo", "Mount Pleasant", "Framesby",
            "Cotswold", "North End", "Korsten", "Gelvandale", "New Brighton",
            "Motherwell", "KwaZakhele", "Despatch", "Kariega",
            "Bluewater Bay", "Fairview", "Parsons Hill",
        ],
    },
    {
        "name": "Bloemfontein",
        "aliases": ["Mangaung"],
        "region": "Free State",
        "centre": (-29.1182537, 26.2299128),
        "radiusKm": 30,
        "areas": [
            "Westdene", "Willows", "Brandwag", "Universitas",
            "Langenhoven Park", "Bayswater", "Fichardt Park", "Heuwelsig",
            "Dan Pienaar", "Hilton", "Pellissier", "Fauna", "Wilgehof",
            "Bainsvlei", "Hamilton", "Oranjesig", "Arboretum", "Noordhoek",
            "Batho", "Heidedal",
        ],
    },
    {
        "name": "East London",
        "aliases": ["Buffalo City", "eMonti"],
        "region": "Eastern Cape",
        "centre": (-33.0152850, 27.9116370),
        "radiusKm": 35,
        "areas": [
            "Vincent", "Berea", "Nahoon", "Beacon Bay", "Gonubie", "Quigney",
            "Southernwood", "Selborne", "Cambridge", "Amalinda",
            "Abbotsford", "Baysville", "Bonnie Doon", "Stirling",
            "Greenfields", "Arcadia", "West Bank", "Mdantsane",
        ],
    },
    {
        "name": "Pietermaritzburg",
        "aliases": ["Msunduzi", "Maritzburg"],
        "region": "KwaZulu-Natal",
        "centre": (-29.6006068, 30.3794118),
        "radiusKm": 25,
        "areas": [
            "Scottsville", "Hayfields", "Clarendon", "Wembley", "Montrose",
            "Chase Valley", "Athlone", "Prestbury", "Northdale",
            "Raisethorpe", "Pelham", "Lincoln Meade", "Mkondeni",
            "Edendale", "Imbali", "Blackridge", "Bisley", "Oak Park",
        ],
    },
]


def distance_km(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * 6371 * math.asin(min(1, math.sqrt(h)))


def photon(query, centre):
    params = urllib.parse.urlencode(
        {"q": query, "lat": centre[0], "lon": centre[1], "limit": 8, "lang": "en"}
    )
    request = urllib.request.Request(
        f"{PHOTON}?{params}", headers={"User-Agent": USER_AGENT}
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as error:  # noqa: BLE001 - retried, then reported
            if attempt == 3:
                raise
            time.sleep(3 + attempt * 3)
    return {"features": []}


def locate(area, city):
    """The point of `area` in `city`'s province within its radius, or None."""
    for query in (f"{area}, {city['name']}", f"{area}, {city['region']}"):
        body = photon(query, city["centre"])
        time.sleep(1.1)
        for feature in body.get("features", []):
            props = feature.get("properties", {})
            if (props.get("countrycode") or "").upper() != "ZA":
                continue
            if (props.get("state") or "") != city["region"]:
                continue
            lng, lat = feature["geometry"]["coordinates"][:2]
            if distance_km(city["centre"], (lat, lng)) > city["radiusKm"]:
                continue
            if area.lower() not in (props.get("name") or "").lower() and (
                props.get("name") or ""
            ).lower() not in area.lower():
                continue
            return round(lat, 5), round(lng, 5)
    return None


def main():
    previous = {}
    if OUT.exists():
        for city in json.loads(OUT.read_text())["cities"]:
            for entry in city["areas"]:
                previous[(city["name"], entry["name"])] = (
                    entry["latitude"],
                    entry["longitude"],
                )
    cities = []
    missing = []
    for city in CITIES:
        areas = []
        for area in city["areas"]:
            point = previous.get((city["name"], area)) or locate(area, city)
            if point is None:
                missing.append(f"{area} ({city['name']})")
                continue
            areas.append({"name": area, "latitude": point[0], "longitude": point[1]})
        cities.append(
            {
                "name": city["name"],
                "aliases": city["aliases"],
                "countryCode": "ZA",
                "region": city["region"],
                "latitude": city["centre"][0],
                "longitude": city["centre"][1],
                "radiusKm": city["radiusKm"],
                "areas": areas,
            }
        )
        print(f"{city['name']}: {len(areas)} of {len(city['areas'])}", flush=True)
    OUT.write_text(
        json.dumps({"version": 1, "cities": cities}, indent=1, ensure_ascii=False)
        + "\n"
    )
    if missing:
        print("Not placed:", ", ".join(missing), file=sys.stderr)


if __name__ == "__main__":
    main()
