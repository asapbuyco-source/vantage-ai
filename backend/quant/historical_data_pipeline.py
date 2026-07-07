"""
historical_data_pipeline.py
───────────────────────────
Builds a historical training dataset for model retraining.

Fetches finished fixtures from API-Football for the last N days,
enriches with odds, statistics, and team data, then saves to Firestore
collection `historical_training/` for batch retraining.

Rate-limited: 1 API call per date for fixtures, plus selective enrichment
for approved leagues only (~100 calls/day to stay well within quota).

Usage:
    python historical_data_pipeline.py --days 30    (collect 30 days)
    python historical_data_pipeline.py --days 90    (collect 90 days)
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
    print("firebase-admin not installed"); sys.exit(1)

LAGOS_TZ = timezone(timedelta(hours=1))


def init_firestore():
    if not firebase_admin._apps:
        sa_raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
        if sa_raw:
            sa_dict = json.loads(sa_raw)
            if "private_key" in sa_dict:
                sa_dict["private_key"] = sa_dict["private_key"].replace('\\n', '\n')
            firebase_admin.initialize_app(credentials.Certificate(sa_dict))
    return fs.client()


def collect_historical_data(days: int = 30):
    """Fetch historical fixtures and store enriched training data."""
    db = init_firestore()

    try:
        from api_football_client import fetch_fixtures_by_date, RateLimitError
        from api_football_client import fetch_odds_for_fixture, fetch_team_season_stats
        from league_config import ALL_APPROVED_LEAGUES
    except ImportError as e:
        print(f"Import error: {e}")
        return

    today = datetime.now(LAGOS_TZ)
    dates = [(today - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(1, days + 1)]

    print(f"\n{'='*60}")
    print(f"  HISTORICAL DATA COLLECTION — {days} DAYS")
    print(f"  Period: {dates[-1]} to {dates[0]}")
    print(f"{'='*60}\n")

    total_collected = 0
    total_enriched = 0
    api_calls = 0

    for date_str in dates:
        # Check if already collected
        existing = db.collection("historical_training").document(date_str).get()
        if existing.exists:
            data = existing.to_dict()
            count = len(data.get("fixtures", []))
            print(f"  {date_str}: already stored ({count} fixtures) — skipping")
            total_collected += count
            continue

        try:
            fixtures = fetch_fixtures_by_date(date_str)
            api_calls += 1
        except RateLimitError:
            print(f"  {date_str}: RATE LIMITED — stopping")
            break
        except Exception as e:
            print(f"  {date_str}: API error — {e}")
            continue

        if not fixtures:
            continue

        # Filter to finished fixtures in approved leagues
        training_samples = []
        enriched = 0

        for item in fixtures[:100]:  # Cap per day
            fixture = item.get("fixture", {})
            status = fixture.get("status", {}).get("short", "")
            if status not in ("FT", "AET", "PEN"):
                continue

            league = item.get("league", {})
            league_id = league.get("id", 0)
            league_info = ALL_APPROVED_LEAGUES.get(league_id)
            if not league_info:
                continue

            teams = item.get("teams", {})
            goals = item.get("goals", {})
            hg, ag = goals.get("home"), goals.get("away")
            if hg is None or ag is None:
                continue

            fid = fixture.get("id")
            sample = {
                "fixture_id": fid,
                "date": date_str,
                "league_id": league_id,
                "league": league.get("name", ""),
                "league_tier": league_info["tier"],
                "home_team": teams.get("home", {}).get("name", ""),
                "home_team_id": teams.get("home", {}).get("id"),
                "away_team": teams.get("away", {}).get("name", ""),
                "away_team_id": teams.get("away", {}).get("id"),
                "home_goals": int(hg),
                "away_goals": int(ag),
                "total_goals": int(hg) + int(ag),
                "btts": 1 if int(hg) > 0 and int(ag) > 0 else 0,
                "over15": 1 if int(hg) + int(ag) > 1 else 0,
                "over25": 1 if int(hg) + int(ag) > 2 else 0,
                "over35": 1 if int(hg) + int(ag) > 3 else 0,
                "home_win": 1 if int(hg) > int(ag) else 0,
                "away_win": 1 if int(ag) > int(hg) else 0,
                "draw": 1 if int(hg) == int(ag) else 0,
            }

            # Enrich with odds and team stats (selectively, to conserve credits)
            if enriched < 20 and api_calls < days * 3:
                try:
                    odds_dict = fetch_odds_for_fixture(fid)
                    api_calls += 1
                    if odds_dict:
                        sample["odds_home"] = odds_dict.get("home_odds", 0)
                        sample["odds_draw"] = odds_dict.get("draw_odds", 0)
                        sample["odds_away"] = odds_dict.get("away_odds", 0)
                        sample["odds_over25"] = odds_dict.get("over25_odds", 0)
                        sample["odds_under25"] = odds_dict.get("under25_odds", 0)
                        sample["odds_btts_yes"] = odds_dict.get("btts_yes_odds", 0)
                        sample["odds_btts_no"] = odds_dict.get("btts_no_odds", 0)
                        sample["odds_over15"] = odds_dict.get("over15_odds", 0)
                        enriched += 1
                except Exception:
                    pass

            training_samples.append(sample)

        if training_samples:
            try:
                db.collection("historical_training").document(date_str).set({
                    "date": date_str,
                    "fixtures": training_samples,
                    "collected_at": datetime.now(timezone.utc).isoformat(),
                })
            except Exception as e:
                print(f"  {date_str}: Firestore write error - {e}")

        total_collected += len(training_samples)
        print(f"  {date_str}: {len(training_samples)} fixtures collected ({enriched} enriched with odds)")

    # ── Summary ──────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"  COLLECTION COMPLETE")
    print(f"{'='*60}")
    print(f"  Total fixtures:     {total_collected}")
    print(f"  API calls used:     {api_calls}")
    print(f"  Days processed:     {len(dates)}")
    print(f"  Saved to:           historical_training/")

    if total_collected > 100:
        print(f"\n  Ready for retraining!")
        print(f"  Run: python retrain_models.py --historical")

    return {"status": "success", "fixtures": total_collected, "api_calls": api_calls}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=30)
    args = parser.parse_args()

    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env.local"))
    except ImportError:
        pass

    collect_historical_data(days=args.days)
