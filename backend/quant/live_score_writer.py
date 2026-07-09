"""
live_score_writer.py
────────────────────
Fetches live fixtures from API-Football and writes them to Firestore
collection `live_scores/current` for the frontend LiveScores page.

Runs every 2 minutes via scheduler cron job.
"""

import os, sys, json, traceback
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

LIVE_STATES = {"1H", "2H", "HT", "ET", "BT", "P", "LIVE", "SUSP", "INT"}


def _init_db():
    """Initialize Firestore, falling back gracefully."""
    try:
        import firebase_admin
        from firebase_admin import firestore as fs, credentials
    except ImportError:
        print("[LiveScores] firebase-admin not installed", file=sys.stderr)
        return None

    try:
        if not firebase_admin._apps:
            sa_raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
            if sa_raw:
                sa_dict = json.loads(sa_raw)
                if "private_key" in sa_dict:
                    sa_dict["private_key"] = sa_dict["private_key"].replace('\\n', '\n')
                firebase_admin.initialize_app(credentials.Certificate(sa_dict))
            else:
                firebase_admin.initialize_app()
        return fs.client()
    except Exception as e:
        print(f"[LiveScores] Firebase init failed: {e}", file=sys.stderr)
        return None


def main():
    db = _init_db()
    if not db:
        print(json.dumps({"status": "error", "error": "no_db"}))
        return

    fixtures = None
    try:
        from api_football_client import fetch_live_fixtures, RateLimitError
        fixtures = fetch_live_fixtures()
    except RateLimitError:
        print(json.dumps({"status": "rate_limited"}))
        return
    except Exception as e:
        print(f"[LiveScores] API fetch error: {e}", file=sys.stderr)
        print(json.dumps({"status": "error", "error": str(e)[:200]}))
        return

    if not fixtures:
        try:
            db.collection("live_scores").document("current").set({
                "matches": [], "count": 0,
                "updatedAt": datetime.now(timezone.utc).isoformat(),
            }, merge=True)
        except Exception:
            pass
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
        evts = (item.get("events") or [])[-5:]

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
            "events": [{"minute": e.get("time", {}).get("elapsed"), "type": e.get("type"),
                        "detail": e.get("detail"), "team": e.get("team", {}).get("name"),
                        "player": e.get("player", {}).get("name")} for e in evts],
            "startedAt": fixture.get("timestamp"),
        })

    try:
        db.collection("live_scores").document("current").set({
            "matches": matches, "count": len(matches),
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }, merge=True)
    except Exception as e:
        print(f"[LiveScores] Firestore write error: {e}", file=sys.stderr)

    print(json.dumps({"status": "ok", "matches": len(matches)}))


if __name__ == "__main__":
    # Only load .env if FIREBASE_SERVICE_ACCOUNT isn't already in environment (Railway has it set)
    try:
        from dotenv import load_dotenv
        if not os.environ.get("FIREBASE_SERVICE_ACCOUNT"):
            root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
            load_dotenv(os.path.join(root, ".env"))
            load_dotenv(os.path.join(root, ".env.local"))
    except ImportError:
        pass

    try:
        main()
    except Exception as e:
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
