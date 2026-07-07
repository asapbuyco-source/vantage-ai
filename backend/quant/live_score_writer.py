"""
live_score_writer.py
────────────────────
Fetches live fixtures from API-Football and writes them to Firestore
collection `live_scores/current` for the frontend LiveScores page.

Runs every 2 minutes via scheduler cron job (~30 calls/hour, ~240/day).
Previously the live momentum engine burned 15,000+ credits/day at 
every 2-5 minutes. This version is far more efficient.

Usage:
    python live_score_writer.py
"""

import os, sys, json, math
from datetime import datetime, timezone, timedelta

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1)

try:
    import certifi
    os.environ["GRPC_DEFAULT_SSL_ROOTS_FILE_PATH"] = certifi.where()
except ImportError:
    pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import firebase_admin
    from firebase_admin import firestore as fs, credentials
except ImportError:
    print(json.dumps({"status": "error", "error": "firebase-admin not installed"}))
    sys.exit(1)

LAGOS_TZ = timezone(timedelta(hours=1))
LIVE_STATES = {"1H", "2H", "HT", "ET", "BT", "P", "LIVE", "SUSP", "INT"}


def init_firestore():
    if not firebase_admin._apps:
        sa_raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
        if sa_raw:
            sa_dict = json.loads(sa_raw)
            if "private_key" in sa_dict:
                sa_dict["private_key"] = sa_dict["private_key"].replace('\\n', '\n')
            firebase_admin.initialize_app(credentials.Certificate(sa_dict))
    return fs.client()


def fetch_live_and_write():
    """Fetch live fixtures and write to Firestore."""
    db = init_firestore()

    try:
        from api_football_client import fetch_live_fixtures, RateLimitError
    except ImportError as e:
        print(json.dumps({"status": "error", "error": str(e)}))
        return

    try:
        fixtures = fetch_live_fixtures()
    except RateLimitError:
        print(json.dumps({"status": "rate_limited"}))
        return
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))
        return

    if not fixtures:
        # No live matches — write empty state
        db.collection("live_scores").document("current").set({
            "matches": [],
            "count": 0,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }, merge=True)
        print(json.dumps({"status": "ok", "matches": 0}))
        return

    matches = []
    for item in fixtures:
        fixture = item.get("fixture", {})
        status = fixture.get("status", {})

        if status.get("short") not in LIVE_STATES:
            continue

        teams = item.get("teams", {})
        goals = item.get("goals", {})
        league = item.get("league", {})
        events = item.get("events", [])

        recent_events = []
        for ev in (events or [])[-5:]:
            recent_events.append({
                "minute": ev.get("time", {}).get("elapsed"),
                "type": ev.get("type"),
                "detail": ev.get("detail"),
                "team": ev.get("team", {}).get("name"),
                "player": ev.get("player", {}).get("name"),
            })

        matches.append({
            "id": str(fixture.get("id")),
            "homeTeam": teams.get("home", {}).get("name", ""),
            "awayTeam": teams.get("away", {}).get("name", ""),
            "homeLogo": teams.get("home", {}).get("logo", ""),
            "awayLogo": teams.get("away", {}).get("logo", ""),
            "homeScore": goals.get("home"),
            "awayScore": goals.get("away"),
            "league": league.get("name", ""),
            "leagueLogo": league.get("logo", ""),
            "stateShort": status.get("short"),
            "stateLong": status.get("long"),
            "minute": status.get("elapsed"),
            "events": recent_events,
            "startedAt": fixture.get("timestamp"),
        })

    doc = {
        "matches": matches,
        "count": len(matches),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }

    try:
        db.collection("live_scores").document("current").set(doc, merge=True)
        print(json.dumps({"status": "ok", "matches": len(matches)}))
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))


if __name__ == "__main__":
    # Load env
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env.local"))
    except ImportError:
        pass

    fetch_live_and_write()
