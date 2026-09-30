"""
cricket_pipeline.py
──────────────────
SportMonks Cricket prediction pipeline for Vantage AI.

Uses a dedicated SPORTMONKS_CRICKET_API_TOKEN so cricket does not share the
football SportMonks token. The engine prefers odds-backed match-winner edges;
when odds are unavailable it emits conservative lean picks only.
"""

import datetime
import json
import os
import sys

# Auto-configure gRPC SSL certificate bundle path for Windows/Local environments
try:
    import certifi
    os.environ["GRPC_DEFAULT_SSL_ROOTS_FILE_PATH"] = certifi.where()
except ImportError:
    pass
import urllib.parse
import urllib.request
import urllib.error

try:
    import firebase_admin
    from firebase_admin import credentials, firestore as fs
    FIREBASE_AVAILABLE = True
except ImportError:
    FIREBASE_AVAILABLE = False

SPORTMONKS_CRICKET_API_TOKEN = os.environ.get("SPORTMONKS_CRICKET_API_TOKEN", "")
SPORTMONKS_CRICKET_BASE = "https://cricket.sportmonks.com/api/v2.0"
MAX_PICKS = 10
MIN_EV = 0.02


def get_lagos_date(offset_days=0):
    lagos_tz = datetime.timezone(datetime.timedelta(hours=1))
    lagos = datetime.datetime.now(lagos_tz) + datetime.timedelta(days=offset_days)
    return lagos.strftime("%Y-%m-%d")


def sm_get(path, params=None):
    if not SPORTMONKS_CRICKET_API_TOKEN:
        raise RuntimeError("SPORTMONKS_CRICKET_API_TOKEN is not configured")

    query = {
        "api_token": SPORTMONKS_CRICKET_API_TOKEN,
        **(params or {}),
    }
    url = f"{SPORTMONKS_CRICKET_BASE}{path}?{urllib.parse.urlencode(query)}"
    req = urllib.request.Request(url, headers={"User-Agent": "VantageAI-Cricket/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _name(obj, fallback="Unknown"):
    if not isinstance(obj, dict):
        return fallback
    return obj.get("name") or obj.get("fullname") or obj.get("code") or fallback


def _team_logo(obj):
    if not isinstance(obj, dict):
        return ""
    return obj.get("image_path") or obj.get("logo_path") or ""


def _decimal(value):
    try:
        val = float(value)
        return val if val > 1 else 0.0
    except (TypeError, ValueError):
        return 0.0


def _extract_match_winner_odds(fixture, home_name, away_name):
    odds_rows = fixture.get("odds") or fixture.get("bookmakers") or []
    if isinstance(odds_rows, dict):
        odds_rows = odds_rows.get("data") or []

    home_odds = []
    away_odds = []
    for row in odds_rows if isinstance(odds_rows, list) else []:
        label = str(row.get("label") or row.get("name") or row.get("team") or "").lower()
        market = str(row.get("market") or row.get("market_name") or row.get("type") or "").lower()
        price = _decimal(row.get("value") or row.get("price") or row.get("odds"))
        if price <= 0:
            continue
        if market and "winner" not in market and "match" not in market and "moneyline" not in market:
            continue
        if home_name.lower() in label or label in {"localteam", "home", "1"}:
            home_odds.append(price)
        elif away_name.lower() in label or label in {"visitorteam", "away", "2"}:
            away_odds.append(price)

    return (max(home_odds) if home_odds else 0.0, max(away_odds) if away_odds else 0.0)


def _fixture_date_range(date_str):
    return f"{date_str} 00:00:00,{date_str} 23:59:59"


def fetch_fixtures(date_str):
    if not SPORTMONKS_CRICKET_API_TOKEN:
        print("[Cricket] No SPORTMONKS_CRICKET_API_TOKEN configured. Skipping cricket fixtures.")
        return []
    params = {
        "filter[starts_between]": _fixture_date_range(date_str),
        "include": "localteam,visitorteam,league,venue,odds",
    }
    data = sm_get("/fixtures", params)
    rows = data.get("data") if isinstance(data, dict) else data
    return rows if isinstance(rows, list) else []


def process_fixtures(fixtures):
    picks = []
    for fixture in fixtures:
        local = fixture.get("localteam") or fixture.get("localteam_data") or {}
        visitor = fixture.get("visitorteam") or fixture.get("visitorteam_data") or {}
        league = fixture.get("league") or fixture.get("league_data") or {}
        home_team = _name(local, "Home Team")
        away_team = _name(visitor, "Away Team")
        home_odds, away_odds = _extract_match_winner_odds(fixture, home_team, away_team)

        prediction_team = home_team
        prediction_en = "Home Win"
        prediction_fr = "Victoire domicile"
        confidence = 55
        category = "lean"
        odds = max(home_odds, away_odds, 1.0)
        ev = 0.0
        analysis_note = "Fixture model lean; no usable SportMonks odds were returned."

        if home_odds > 1 and away_odds > 1:
            home_ip = 1 / home_odds
            away_ip = 1 / away_odds
            total_ip = home_ip + away_ip
            home_prob = home_ip / total_ip
            away_prob = away_ip / total_ip
            if away_prob > home_prob:
                prediction_team = away_team
                prediction_en = "Away Win"
                prediction_fr = "Victoire exterieure"
                confidence = round(away_prob * 100)
                odds = away_odds
                ev = (away_odds * away_prob) - 1
            else:
                confidence = round(home_prob * 100)
                odds = home_odds
                ev = (home_odds * home_prob) - 1
            category = "value" if ev >= MIN_EV else "lean"
            analysis_note = f"SportMonks cricket odds consensus: {prediction_team} at {confidence}% with EV {round(ev * 100, 1)}%."

        picks.append({
            "id": f"cricket_{fixture.get('id')}",
            "fixture_id": str(fixture.get("id") or ""),
            "league": _name(league, "Cricket"),
            "league_tier": 2,
            "fixtureId": fixture.get("id"),
            "homeTeam": home_team,
            "awayTeam": away_team,
            "homeTeamLogo": _team_logo(local),
            "awayTeamLogo": _team_logo(visitor),
            "time": fixture.get("starting_at") or fixture.get("starting_at_timestamp") or "",
            "prediction": prediction_en,
            "prediction_en": prediction_en,
            "prediction_fr": prediction_fr,
            "confidence": confidence,
            "probability": round(confidence / 100, 4),
            "odds": round(odds, 2),
            "category": category,
            "value_rank": "medium" if category in ("safe", "value") else "low",
            "vault_eligible": True,
            "analysis_en": analysis_note,
            "analysis_fr": analysis_note,
            "sport": "cricket",
            "status": "pending",
            "expected_value": round(ev, 4),
            "ev_pct": round(ev * 100, 1),
            "generatedBy": "sportmonks_cricket_quant",
        })

    picks.sort(key=lambda p: (p["category"] == "value", p["confidence"], p["ev_pct"]), reverse=True)
    return picks[:MAX_PICKS]


def init_firebase():
    if not FIREBASE_AVAILABLE:
        return None
    if firebase_admin._apps:
        return fs.client()
    sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
    if not sa_json:
        print("[Cricket] FIREBASE_SERVICE_ACCOUNT not set; skipping Firestore.", file=sys.stderr)
        return None
    cred = credentials.Certificate(json.loads(sa_json))
    firebase_admin.initialize_app(cred)
    return fs.client()


def save_to_firestore(db, date_str, matches):
    if not db:
        print("[Cricket] Firestore not available; write skipped.")
        return
    db.collection("cricket_predictions").document(date_str).set({
        "matches": matches,
        "generatedAt": datetime.datetime.utcnow().isoformat() + "Z",
        "generatedBy": "sportmonks_cricket_quant",
        "updatedAt": datetime.datetime.utcnow().isoformat() + "Z",
        "date": date_str,
    })
    print(f"[Cricket] Saved {len(matches)} cricket predictions to Firestore for {date_str}.")


def main():
    dry_run = "--dry-run" in sys.argv
    date_arg = next((arg for arg in sys.argv[1:] if arg and not arg.startswith("--")), None)
    date_str = date_arg or get_lagos_date()
    print(f"[Cricket] Pipeline starting for {date_str} (dry_run={dry_run})")

    try:
        fixtures = fetch_fixtures(date_str)
    except Exception as exc:
        print(f"[Cricket] Fetch failed: {exc}", file=sys.stderr)
        sys.exit(1)

    picks = process_fixtures(fixtures)
    print("[Cricket] Pipeline complete!")
    print(f"  Fixtures analyzed: {len(fixtures)}")
    print(f"  Value picks identified: {len(picks)}")

    if dry_run:
        return
    save_to_firestore(init_firebase(), date_str, picks)


if __name__ == "__main__":
    main()
