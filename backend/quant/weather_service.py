"""
weather_service.py
──────────────────
Fetches match-day weather from Open-Meteo (FREE, no API key).
Used to apply probability penalties for adverse conditions.

Open-Meteo:
  Geocoding: https://geocoding-api.open-meteo.com/v1/search
  Forecast:  https://api.open-meteo.com/v1/forecast
  No sign-up, no key, no rate-limit bill for our usage.

Stadium-to-city mapping covers the most common leagues.
Add more stadiums as needed in STADIUM_CITIES below.
"""

import json
import requests
from datetime import datetime, timedelta, timezone
from functools import lru_cache

GEO_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

# WMO weather codes -> OpenWeatherMap-style condition names (keeps downstream logic)
_WMO_CONDITIONS = {
    0: "Clear",
    1: "Clouds", 2: "Clouds", 3: "Clouds",
    45: "Fog", 48: "Fog",
    51: "Drizzle", 53: "Drizzle", 55: "Drizzle", 56: "Drizzle", 57: "Drizzle",
    61: "Rain", 63: "Rain", 65: "Rain", 66: "Rain", 67: "Rain",
    71: "Snow", 73: "Snow", 75: "Snow", 77: "Snow",
    80: "Rain", 81: "Rain", 82: "Rain",
    85: "Snow", 86: "Snow",
    95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm",
}

def _wmo_condition(code):
    return _WMO_CONDITIONS.get(code, "Clear")


def _geocode(city: str, country: str | None = None) -> tuple | None:
    """Resolve a city name to (lat, lon) via Open-Meteo's free geocoding API."""
    try:
        params = {"name": city, "count": 1, "language": "en", "format": "json"}
        resp = requests.get(GEO_URL, params=params, timeout=10)
        if resp.status_code != 200:
            return None
        results = resp.json().get("results") or []
        for r in results:
            if country and r.get("country_code") and r["country_code"].lower() != country.lower():
                continue
            if r.get("latitude") is not None and r.get("longitude") is not None:
                return float(r["latitude"]), float(r["longitude"])
        if results and results[0].get("latitude") is not None and results[0].get("longitude") is not None:
            return float(results[0]["latitude"]), float(results[0]["longitude"])
    except Exception:
        return None
    return None

# Stadium → city mapping for common leagues
# Format: team_name_substring → (city, country_code)
STADIUM_CITIES = {
    "arsenal": ("London", "GB"),
    "chelsea": ("London", "GB"),
    "tottenham": ("London", "GB"),
    "west ham": ("London", "GB"),
    "crystal palace": ("London", "GB"),
    "fulham": ("London", "GB"),
    "brentford": ("London", "GB"),
    "manchester united": ("Manchester", "GB"),
    "manchester city": ("Manchester", "GB"),
    "liverpool": ("Liverpool", "GB"),
    "everton": ("Liverpool", "GB"),
    "newcastle": ("Newcastle", "GB"),
    "aston villa": ("Birmingham", "GB"),
    "wolves": ("Wolverhampton", "GB"),
    "brighton": ("Brighton", "GB"),
    "nottingham": ("Nottingham", "GB"),
    "bournemouth": ("Bournemouth", "GB"),
    "southampton": ("Southampton", "GB"),
    "leicester": ("Leicester", "GB"),
    "leeds": ("Leeds", "GB"),

    "real madrid": ("Madrid", "ES"),
    "barcelona": ("Barcelona", "ES"),
    "atletico madrid": ("Madrid", "ES"),
    "sevilla": ("Sevilla", "ES"),
    "valencia": ("Valencia", "ES"),
    "villarreal": ("Villarreal", "ES"),
    "real betis": ("Sevilla", "ES"),
    "athletic": ("Bilbao", "ES"),
    "real sociedad": ("San Sebastian", "ES"),

    "bayern": ("Munich", "DE"),
    "dortmund": ("Dortmund", "DE"),
    "rb leipzig": ("Leipzig", "DE"),
    "leverkusen": ("Leverkusen", "DE"),
    "eintracht": ("Frankfurt", "DE"),
    "wolfsburg": ("Wolfsburg", "DE"),
    "stuttgart": ("Stuttgart", "DE"),

    "juventus": ("Turin", "IT"),
    "inter": ("Milan", "IT"),
    "milan": ("Milan", "IT"),
    "napoli": ("Naples", "IT"),
    "roma": ("Rome", "IT"),
    "lazio": ("Rome", "IT"),
    "atalanta": ("Bergamo", "IT"),
    "fiorentina": ("Florence", "IT"),

    "psg": ("Paris", "FR"),
    "marseille": ("Marseille", "FR"),
    "lyon": ("Lyon", "FR"),
    "monaco": ("Monaco", "MC"),
    "lille": ("Lille", "FR"),
    "nice": ("Nice", "FR"),
    "rennes": ("Rennes", "FR"),

    "ajax": ("Amsterdam", "NL"),
    "psv": ("Eindhoven", "NL"),
    "feyenoord": ("Rotterdam", "NL"),

    "benfica": ("Lisbon", "PT"),
    "porto": ("Porto", "PT"),
    "sporting": ("Lisbon", "PT"),

    "galatasaray": ("Istanbul", "TR"),
    "fenerbahce": ("Istanbul", "TR"),
    "besiktas": ("Istanbul", "TR"),
}


def get_weather_context(home_team: str, kickoff_utc: str = None) -> dict:
    """
    Fetch weather for a match venue from Open-Meteo (free, no key).
    If a city name is passed (from API-Football venue data), use it directly.
    If a team name is passed, looks up in STADIUM_CITIES.
    """
    city = home_team.strip() if home_team else None
    if not city:
        return {"has_weather_risk": False, "penalty_reason": "", "error": "unknown_stadium"}

    # Try team name lookup in hardcoded map (for team names passed as input)
    country = None
    city_lower = city.lower()
    for team_key, (city_name, country_code) in STADIUM_CITIES.items():
        if team_key in city_lower:
            city = city_name
            country = country_code
            break

    coords = _geocode(city, country)
    if not coords:
        return {"has_weather_risk": False, "penalty_reason": "", "error": "geocode_failed"}

    try:
        params = {
            "latitude": coords[0],
            "longitude": coords[1],
            "current": "temperature_2m,wind_speed_10m,precipitation,weather_code",
            "wind_speed_unit": "kmh",
            "timezone": "auto",
        }
        resp = requests.get(FORECAST_URL, params=params, timeout=10)
        if resp.status_code != 200:
            return {"has_weather_risk": False, "penalty_reason": "", "error": f"api_error_{resp.status_code}"}

        current = (resp.json().get("current") or {}).get("weather", {}) or resp.json().get("current") or {}
        temp = current.get("temperature_2m", 15)
        wind_kmh = current.get("wind_speed_10m", 0)
        rain = current.get("precipitation", 0)
        condition = _wmo_condition(current.get("weather_code", 0))

        # Risk assessment
        has_risk = False
        reason = ""

        if wind_kmh > 25:
            has_risk = True
            reason = f"High wind ({wind_kmh:.0f} km/h)"
        elif wind_kmh > 20:
            has_risk = True
            reason = f"Moderate wind ({wind_kmh:.0f} km/h)"

        if rain > 3:
            has_risk = True
            reason = (reason + "; " if reason else "") + f"Heavy rain ({rain:.0f}mm/h)"

        if condition in ("Snow", "Thunderstorm"):
            has_risk = True
            reason = (reason + "; " if reason else "") + condition

        return {
            "city": city,
            "temp": round(temp, 0),
            "wind_kmh": round(wind_kmh, 1),
            "rain_mmh": rain,
            "condition": condition,
            "has_weather_risk": has_risk,
            "penalty_reason": reason,
        }

    except Exception as e:
        return {"has_weather_risk": False, "penalty_reason": "", "error": str(e)[:100]}


def get_weather_probability_penalty(weather: dict) -> float:
    """Return a multiplier for Over 2.5 probability based on weather risk."""
    if not weather.get("has_weather_risk"):
        return 1.0

    penalty = 1.0
    wind = weather.get("wind_kmh", 0)
    rain = weather.get("rain_mmh", 0)
    condition = weather.get("condition", "")

    # Wind suppresses goals
    if wind > 25:
        penalty *= 0.85  # High wind: reduce over probability
    elif wind > 20:
        penalty *= 0.92  # Moderate wind

    # Rain suppresses goals slightly
    if rain > 3:
        penalty *= 0.90

    # Extreme weather
    if condition in ("Snow", "Thunderstorm"):
        penalty *= 0.80

    return round(penalty, 2)
