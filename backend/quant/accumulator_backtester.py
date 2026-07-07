"""
accumulator_backtester.py
─────────────────────────
Grades accumulator tickets against actual match results from API-Football.

Usage:
    python accumulator_backtester.py --days 30
    python accumulator_backtester.py --start 2026-06-01 --end 2026-06-30
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

from grading_engine import _grade_bet


def _connect_firestore():
    import firebase_admin
    from firebase_admin import credentials, firestore

    if not firebase_admin._apps:
        sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
        if sa_json:
            sa_dict = json.loads(sa_json)
            if "private_key" in sa_dict:
                sa_dict["private_key"] = sa_dict["private_key"].replace('\\n', '\n')
            cred = credentials.Certificate(sa_dict)
        else:
            cred = credentials.ApplicationDefault()
        firebase_admin.initialize_app(cred)

    return firestore.client()


def fetch_results_for_dates(dates: list) -> dict:
    """Fetch finished match results from API-Football for all dates."""
    results_map = {}
    try:
        from api_football_client import fetch_fixtures_by_date, load_grading_cache, RateLimitError

        for date_str in sorted(set(dates)):
            cached = load_grading_cache(date_str) or {}
            if cached:
                results_map.update(cached)
                continue

            try:
                fixtures = fetch_fixtures_by_date(date_str) or []
            except RateLimitError:
                print(f"  Rate limited at {date_str}, using cached only")
                continue

            for item in fixtures:
                fixture = item.get("fixture", {})
                match_id = str(fixture.get("id") or "")
                if not match_id:
                    continue
                status = fixture.get("status", {}).get("short", "")
                if status not in ("FT", "AET", "PEN"):
                    continue
                goals = item.get("goals", {})
                hg, ag = goals.get("home"), goals.get("away")
                if hg is None or ag is None:
                    continue
                results_map[match_id] = {
                    "home_goals": int(hg),
                    "away_goals": int(ag),
                }
    except Exception as e:
        print(f"  API fetch error: {e}")

    return results_map


def grade_accumulators(dates: list):
    """Grade all accumulators for given dates and print report."""
    db = _connect_firestore()

    print(f"\n{'='*70}")
    print(f"  ACCUMULATOR BACKTESTER")
    print(f"{'='*70}")
    print(f"  Dates: {dates[0]} to {dates[-1]} ({len(dates)} days)\n")

    results_map = fetch_results_for_dates(dates)
    print(f"  Results map: {len(results_map)} finished fixtures\n")

    all_acas = []
    tier_stats = defaultdict(lambda: {"total": 0, "won": 0, "lost": 0, "void": 0})

    for date_str in dates:
        doc = db.collection("quant_vip").document(date_str).get()
        if not doc.exists:
            continue

        data = doc.to_dict()
        accumulators = data.get("accumulators", {})

        for tier, acca_list in accumulators.items():
            for acca in acca_list:
                legs = acca.get("legs", [])
                if not legs:
                    continue

                all_won = True
                any_void = False
                leg_results = []

                for leg in legs:
                    fid = str(leg.get("fixture_id", ""))
                    market = leg.get("market", "")
                    result = results_map.get(fid)

                    if not result:
                        leg_results.append({"market": market, "status": "pending"})
                        all_won = False
                        continue

                    hg, ag = result["home_goals"], result["away_goals"]
                    status = _grade_bet(market, hg, ag)
                    leg_results.append({"market": market, "status": status, "score": f"{hg}-{ag}"})

                    if status == "void":
                        any_void = True
                    if status != "won":
                        all_won = False

                tier_stats[tier]["total"] += 1
                if any_void and all_won:
                    tier_stats[tier]["void"] += 1
                elif all_won:
                    tier_stats[tier]["won"] += 1
                else:
                    tier_stats[tier]["lost"] += 1

                all_acas.append({
                    "date": date_str,
                    "tier": tier,
                    "tier_label": acca.get("tier_label", tier),
                    "combined_odds": acca.get("combined_odds", 0),
                    "combined_ev": acca.get("combined_ev", 0),
                    "status": "won" if all_won else "lost",
                    "leg_results": leg_results,
                })

    # Print report
    print(f"  Total accumulators graded: {len(all_acas)}")
    print(f"\n  {'Tier':<25} {'Total':>6} {'Won':>6} {'Lost':>6} {'Hit%':>8}")
    print(f"  {'-'*25} {'-'*6} {'-'*6} {'-'*6} {'-'*8}")
    for tier in ["baseline", "alpha_edge", "syndicate", "variance_play"]:
        ts = tier_stats[tier]
        if ts["total"] == 0:
            continue
        hr = ts["won"] / max(ts["total"], 1) * 100
        label = {"baseline": "The Baseline", "alpha_edge": "The Alpha Edge", "syndicate": "The Syndicate", "variance_play": "The Variance Play"}.get(tier, tier)
        print(f"  {label:<25} {ts['total']:>6} {ts['won']:>6} {ts['lost']:>6} {hr:>7.1f}%")

    # Recent losses detail
    losses = [a for a in all_acas if a["status"] == "lost"]
    if losses:
        print(f"\n  Recent Losses (last 5):")
        for l in losses[-5:]:
            failed_legs = [lr for lr in l["leg_results"] if lr["status"] != "won"]
            failed_markets = ", ".join(f"{lr['market']}({lr['status']})" for lr in failed_legs[:3])
            print(f"    {l['date']} {l['tier_label']}: {failed_markets}")

    return all_acas


def main():
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env.local"))

    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=14)
    parser.add_argument("--start", type=str, default=None)
    parser.add_argument("--end", type=str, default=None)
    args = parser.parse_args()

    if args.start and args.end:
        start = datetime.strptime(args.start, "%Y-%m-%d")
        end = datetime.strptime(args.end, "%Y-%m-%d")
        dates = [(start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range((end - start).days + 1)]
    else:
        end = datetime.now(timezone.utc) - timedelta(days=1)
        start = end - timedelta(days=args.days - 1)
        dates = [(start + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(args.days)]

    grade_accumulators(dates)


if __name__ == "__main__":
    main()
