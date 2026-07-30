"""
grid_search.py
──────────────
Automated Grid Search utility to find the mathematically optimal weights 
for the probability engine (Poisson vs Elo vs Form).
Uses an in-memory cache to prevent API rate limits.
"""

import sys
import os
import itertools
from datetime import datetime, timedelta, timezone

# Add parent directory to path for imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from quant_pipeline import run_pipeline
from data_pipeline import fetch_matches
from replay_engine import get_actual_result, grade_prediction, _safe_print

LAGOS_TZ = timezone(timedelta(hours=1))


def generate_weight_combinations():
    """Generate combinations of Poisson, Elo, Form weights that sum to 1.0 (step 0.05)."""
    combinations = []
    # Test increments of 0.05 (5%)
    steps = [x / 100.0 for x in range(0, 105, 5)]
    
    for p in steps:
        for e in steps:
            for f in steps:
                # We keep H2H at 0 as it's currently disabled due to API limits
                if abs((p + e + f) - 1.0) < 0.001:
                    combinations.append({
                        "poisson": p,
                        "elo": e,
                        "form": f,
                        "h2h": 0.0
                    })
    return combinations


def preload_data(days: int) -> dict:
    """
    Fetch all historical matches and actual scores for the last N days.
    Returns: { date_str: {"matches": [MatchData], "scores": {fixture_id: actual_score}} }
    """
    cache = {}
    _safe_print(f"📥 Preloading {days} days of data into memory cache...")
    
    for i in range(days):
        date_str = (datetime.now(LAGOS_TZ) - timedelta(days=i+1)).strftime("%Y-%m-%d")
        _safe_print(f"   Fetching {date_str}...")
        
        matches = fetch_matches(date_str)
        if not matches:
            continue
            
        scores = {}
        # Use API-Football grading cache for results (same source as grading_engine)
        try:
            from api_football_client import _get as af_get
            from grading_engine import _fetch_results_from_api_football
            date_results = _fetch_results_from_api_football(date_str, matches)
            if date_results:
                for fid, result_str in date_results.items():
                    try:
                        hg, ag = map(int, result_str.split("-"))
                        scores[int(fid)] = f"{hg}-{ag}"
                    except (ValueError, AttributeError):
                        pass
        except Exception as e:
            _safe_print(f"   ⚠️  Score fetch fallback: {e}")
                    
        cache[date_str] = {
            "matches": matches,
            "scores": scores
        }
        
    _safe_print("✅ Preload complete.\n")
    return cache


def evaluate_combination(weights: dict, cache: dict) -> dict:
    """Run the pipeline with specific weights against the cached data."""
    wins = 0
    losses = 0
    roi_sum = 0.0
    
    # We suppress standard output during grid search to keep the console clean
    _null_device = 'nul' if os.name == 'nt' else os.devnull
    sys.stdout = open(_null_device, 'w')
    
    try:
        for date_str, data in cache.items():
            matches = data["matches"]
            scores = data["scores"]

            # Run pipeline using cached matches and custom weights
            result = run_pipeline(date_str, dry_run=True, weights_override=weights, preloaded_matches=matches)

            if result.get("status") != "success":
                continue

            predictions = result.get("predictions", [])
            for pred in predictions:
                fid = pred["fixture_id"]
                actual_score = scores.get(fid)

                if not actual_score:
                    continue

                grade = grade_prediction(pred["prediction"], actual_score)
                if grade == "void":
                    continue

                if grade == "won":
                    wins += 1
                    roi_sum += (pred["odds"] - 1)
                else:
                    losses += 1
                    roi_sum -= 1
    finally:
        sys.stdout.close()
        sys.stdout = sys.__stdout__
        
    decided = wins + losses
    hit_rate = (wins / decided) if decided > 0 else 0.0
    roi = (roi_sum / decided) if decided > 0 else 0.0
    
    return {
        "weights": weights,
        "wins": wins,
        "losses": losses,
        "hit_rate": hit_rate,
        "roi": roi,
        "total_bets": decided
    }


def run_grid_search(days: int = 7):
    _safe_print(f"{'='*60}")
    _safe_print(f"🧠 AUTOMATED GRID SEARCH ({days} DAYS)")
    _safe_print(f"{'='*60}\n")
    
    # 1. Preload Data
    cache = preload_data(days)
    if not cache:
        _safe_print("❌ No data could be fetched. Exiting.")
        return
        
    # 2. Generate Combinations
    combinations = generate_weight_combinations()
    _safe_print(f"🔄 Testing {len(combinations)} mathematical configurations...")
    
    # 3. Test Combinations
    results = []
    count = 0
    for combo in combinations:
        res = evaluate_combination(combo, cache)
        # Only care about configs that produced a reasonable number of bets
        if res["total_bets"] >= days: 
            results.append(res)
            
        count += 1
        if count % 20 == 0:
            _safe_print(f"   Tested {count}/{len(combinations)} combinations...")
            
    # 4. Rank Results
    # Sort primarily by ROI, secondarily by Hit Rate
    results.sort(key=lambda x: (x["roi"], x["hit_rate"]), reverse=True)
    
    _safe_print(f"\n{'='*60}")
    _safe_print("🏆 TOP 5 CONFIGURATIONS FOUND")
    _safe_print(f"{'='*60}")
    
    for i, res in enumerate(results[:5]):
        w = res["weights"]
        _safe_print(f"#{i+1}: Poisson {w['poisson']:.0%} | Elo {w['elo']:.0%} | Form {w['form']:.0%}")
        _safe_print(f"    ROI: {res['roi']:+.2%} | Hit Rate: {res['hit_rate']:.1%} | Bets: {res['total_bets']}")
        _safe_print("-" * 40)
        
    if results:
        w = results[0]["weights"]
        _safe_print("\n👉 To apply the winning formula, update probability_engine.py:")
        _safe_print(f"   W_POISSON = {w['poisson']:.2f}")
        _safe_print(f"   W_ELO     = {w['elo']:.2f}")
        _safe_print(f"   W_FORM    = {w['form']:.2f}")
        _safe_print(f"   W_H2H     = 0.00")
    else:
        _safe_print("No profitable configurations found with sufficient bet volume.")


if __name__ == "__main__":
    days_to_test = 7
    if len(sys.argv) > 1:
        try:
            days_to_test = int(sys.argv[1])
        except:
            pass
            
    run_grid_search(days_to_test)
