"""
weather_service.py
──────────────────
Fetches match-day weather from OpenWeatherMap free tier.
Used to apply probability penalties for adverse conditions.

FREE API: OpenWeatherMap
  Sign up at: https://openweathermap.org/api
  Free tier: 60 calls/minute, 1,000 calls/day
  Get your API key from: https://home.openweathermap.org/api_keys
  Set as: OPENWEATHER_API_KEY env variable

Stadium-to-city mapping covers the most common leagues.
Add more stadiums as needed in STADIUM_CITIES below.
"""

import os, json
import requests
from datetime import datetime, timedelta, timezone
from functools import lru_cache

API_KEY = os.environ.get("OPENWEATHER_API_KEY", "")
BASE_URL = "https://api.openweathermap.org/data/2.5/weather"

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
    Fetch weather for a match venue.
    If a city name is passed (from API-Football venue data), use it directly.
    If a team name is passed, looks up in STADIUM_CITIES.
    """
    if not API_KEY:
        return {"has_weather_risk": False, "penalty_reason": "", "error": "no_api_key"}

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

    try:
        params = {
            "q": f"{city},{country}" if country else city,
            "appid": API_KEY,
            "units": "metric",
        }
        resp = requests.get(BASE_URL, params=params, timeout=10)
        if resp.status_code != 200:
            return {"has_weather_risk": False, "penalty_reason": "", "error": f"api_error_{resp.status_code}"}

        data = resp.json()
        wind_speed = data.get("wind", {}).get("speed", 0)  # m/s
        wind_kmh = wind_speed * 3.6  # Convert to km/h
        rain = data.get("rain", {}).get("1h", 0) if "rain" in data else 0
        condition = data.get("weather", [{}])[0].get("main", "")
        temp = data.get("main", {}).get("temp", 15)

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
