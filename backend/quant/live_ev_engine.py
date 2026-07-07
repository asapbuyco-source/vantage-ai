"""
live_ev_engine.py
─────────────────
In-play EV evaluator. Fetches live fixtures, calculates remaining-game
expected goals, and evaluates markets at current odds.

Runs every 5 minutes during match windows. Uses ~200 credits/day.

Usage:
    python live_ev_engine.py
"""

import os, sys, json, math
from datetime import datetime, timedelta, timezone
from collections import defaultdict

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
LIVE_STATES = {"1H", "2H", "HT", "LIVE"}


def init_firestore():
    if not firebase_admin._apps:
        sa_raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
        if sa_raw:
            sa_dict = json.loads(sa_raw)
            if "private_key" in sa_dict:
                sa_dict["private_key"] = sa_dict["private_key"].replace('\\n', '\n')
            firebase_admin.initialize_app(credentials.Certificate(sa_dict))
    return fs.client()


def poisson_prob(lam: float, k: int) -> float:
    if lam <= 0:
        return 1.0 if k == 0 else 0.0
    return (lam ** k) * math.exp(-lam) / math.factorial(k)


def evaluate_live_ev():
    """Fetch live fixtures and evaluate in-play EV."""
    db = init_firestore()

    try:
        from api_football_client import fetch_live_fixtures, fetch_odds_for_fixture, RateLimitError
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
        print(json.dumps({"status": "ok", "matches": 0}))
        return

    live_bets = []

    for item in fixtures:
        fixture = item.get("fixture", {})
        status = fixture.get("status", {})
        if status.get("short") not in LIVE_STATES:
            continue

        teams = item.get("teams", {})
        goals = item.get("goals", {})
        elapsed = status.get("elapsed", 0)

        hg, ag = goals.get("home", 0) or 0, goals.get("away", 0) or 0
        if elapsed is None or elapsed <= 0:
            continue

        # Estimate remaining minutes
        if status.get("short") == "1H":
            remaining = 45 - elapsed
            half_factor = 1.0
        elif status.get("short") == "HT":
            remaining = 45
            half_factor = 1.0
        else:
            remaining = 90 - elapsed
            half_factor = 0.5

        remaining = max(1, remaining)

        # Estimate remaining expected goals from league avg
        league_avg_gpg = 2.7  # Default ~2.7 goals per game
        expected_remaining = (league_avg_gpg * remaining / 90) * half_factor

        # Probability of N more goals in remaining time (Poisson)
        p_more_05 = 1.0 - poisson_prob(expected_remaining, 0)
        p_more_15 = p_more_05 - poisson_prob(expected_remaining, 1)

        total_goals = hg + ag
        prob_total_over15 = 1.0 if total_goals > 1 else p_more_15 + (1 - p_more_05)
        prob_total_over25 = 1.0 if total_goals > 2 else (
            1.0 if total_goals == 2 and p_more_05 > 0.5 else
            p_more_15 if total_goals == 1 else
            p_more_05 if total_goals == 0 else 0.0
        )
        prob_btts_yes = 1.0 if hg > 0 and ag > 0 else (
            0.7 if hg > 0 and ag == 0 else
            0.7 if hg == 0 and ag > 0 else
            0.45  # 0-0
        )

        # Fetch current odds
        fid = fixture.get("id")
        odds = {}
        try:
            odds = fetch_odds_for_fixture(fid)
        except Exception:
            pass

        bets_for_match = []

        # Over 1.5 Goals (in-play)
        if odds.get("over15_odds", 0) > 1.05:
            o15_odds = odds["over15_odds"]
            if total_goals < 2:
                ev = prob_total_over15 * o15_odds - 1
                if ev > 0.03:
                    bets_for_match.append({
                        "market": "Over 1.5 Goals LIVE",
                        "probability": round(prob_total_over15, 3),
                        "odds": o15_odds,
                        "ev": round(ev, 3),
                        "current_score": f"{hg}-{ag}",
                        "minute": elapsed,
                    })

        # Over 2.5 Goals (in-play)
        if odds.get("over25_odds", 0) > 1.10:
            o25_odds = odds["over25_odds"]
            if total_goals < 3:
                ev = prob_total_over25 * o25_odds - 1
                if ev > 0.05:
                    bets_for_match.append({
                        "market": "Over 2.5 Goals LIVE",
                        "probability": round(prob_total_over25, 3),
                        "odds": o25_odds,
                        "ev": round(ev, 3),
                        "current_score": f"{hg}-{ag}",
                        "minute": elapsed,
                    })

        # BTTS (in-play)
        if odds.get("btts_yes_odds", 0) > 1.10 and not (hg > 0 and ag > 0):
            btts_odds = odds["btts_yes_odds"]
            ev = prob_btts_yes * btts_odds - 1
            if ev > 0.05:
                bets_for_match.append({
                    "market": "BTTS LIVE",
                    "probability": round(prob_btts_yes, 3),
                    "odds": btts_odds,
                    "ev": round(ev, 3),
                    "current_score": f"{hg}-{ag}",
                    "minute": elapsed,
                })

        for b in bets_for_match:
            live_bets.append({
                "fixture_id": str(fid),
                "home_team": teams.get("home", {}).get("name", ""),
                "away_team": teams.get("away", {}).get("name", ""),
                "league": item.get("league", {}).get("name", ""),
                "minute": elapsed,
                "score": f"{hg}-{ag}",
                "state": status.get("short"),
                **b,
            })

    # Save live value bets to Firestore
    if live_bets:
        live_bets.sort(key=lambda x: x["ev"], reverse=True)
        top = live_bets[:10]

        # VIP: full data with odds and EV
        db.collection("live_ev").document("current").set({
            "bets": top,
            "count": len(live_bets),
            "top_count": len(top),
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }, merge=True)

        # Public: count only (no bets, no markets, no odds)
        db.collection("live_ev_preview").document("current").set({
            "count": len(live_bets),
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }, merge=True)

        print(json.dumps({"status": "ok", "live_bets": len(live_bets), "top_ev": top[0]["ev"] if top else 0}))
    else:
        db.collection("live_ev").document("current").set({
            "bets": [], "count": 0,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }, merge=True)
        db.collection("live_ev_preview").document("current").set({
            "count": 0,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }, merge=True)
        print(json.dumps({"status": "ok", "live_bets": 0}))


if __name__ == "__main__":
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env.local"))
    except ImportError:
        pass

    evaluate_live_ev()
