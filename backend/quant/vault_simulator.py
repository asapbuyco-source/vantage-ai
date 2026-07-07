"""
vault_simulator.py
──────────────────
Replays the full quant pipeline against historical Sportmonks data and simulates
the Vault strategy exactly as implemented in the frontend (VaultTab.tsx):

  - 1/8th Kelly staking (0.125 fraction, 2% hard cap)
  - Max 7 picks per day (top by composite score, matching Vault auto-populate)
  - Risk filters applied (probability, EV, odds range, inefficiency, staleness)
  - Safety downgrades (over→lower, win→DC, draw→DC for low confidence)
  - Compounding bankroll: day N+1 starts where day N ended
  - Void bets refund the stake (no profit/loss)
  - CLV tracking when closing odds differ from pick-time odds

Data is cached locally in .vantage_cache/ so each fixture/form/scores request
is only made once — subsequent runs are instant.

Usage:
    python vault_simulator.py              # Interactive (will prompt for bankroll + days)
    python vault_simulator.py 30            # 30 days, default 10000 bankroll
    python vault_simulator.py 60 50000     # 60 days, 50000 starting bankroll

Output:
    - Daily vault simulation with compounding P&L
    - Per-market breakdown (hit rate, ROI, avg odds)
    - CLV analysis
    - EV calibration (predicted vs actual)
    - Model adjustment recommendations
    - CSV export of all graded picks
"""

import os
import sys
import csv
import json
import math
from datetime import datetime, timedelta, timezone
from collections import defaultdict

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

# ── Path setup ────────────────────────────────────────────────────────────────
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env.local"))

from local_cache import LocalCache
from data_pipeline import fetch_matches, SM_TOKEN, _get, _get_paginated
from quant_pipeline import run_pipeline
from kelly_optimizer import kelly_stake, MAX_STAKE_PCT, KELLY_FRACTION
from risk_filters import grade_risk, apply_filters
from ev_engine import ValueBet, evaluate_all_markets
from probability_engine import compute_combined
from poisson_model import compute_probabilities, compute_dynamic_rho
from elo_rating import load_ratings_from_firestore, match_probabilities as elo_probs, get_team_rating, is_derby_match, DEFAULT_ELO
from data_pipeline import TeamStats

try:
    from free_data_client import fetch_match_result_free
except ImportError:
    fetch_match_result_free = None

LAGOS_TZ = timezone(timedelta(hours=1))
MAX_DAILY_PICKS = 7
VAULT_STRATEGY_VERSION = "vault-sim-v2"
VAULT_STRATEGY_NAME = "Simulator EV Quality Top 7"
VAULT_DECISION_TIME_LOCAL = "19:00 Africa/Lagos"

# ── Vault grading (matches replay_engine grade_prediction) ─────────────────
def grade_prediction(prediction: str, result: str) -> str:
    try:
        h, a = map(int, result.split("-"))
    except Exception:
        return "void"
    p = prediction.lower()
    if p == "home win": return "won" if h > a else "lost"
    if p == "away win": return "won" if a > h else "lost"
    if p == "draw": return "won" if h == a else "lost"
    if p == "double chance (1x)": return "won" if h >= a else "lost"
    if p == "double chance (x2)": return "won" if a >= h else "lost"
    if p == "double chance (12)": return "won" if h != a else "lost"
    if p == "draw no bet (home)": return "won" if h > a else ("void" if h == a else "lost")
    if p == "draw no bet (away)": return "won" if a > h else ("void" if h == a else "lost")
    if p == "over 1.5 goals": return "won" if (h + a) > 1.5 else "lost"
    if p == "under 1.5 goals": return "won" if (h + a) < 2 else "lost"
    if p == "over 2.5 goals": return "won" if (h + a) > 2.5 else "lost"
    if p == "under 2.5 goals": return "won" if (h + a) < 3 else "lost"
    if p == "over 3.5 goals": return "won" if (h + a) > 3.5 else "lost"
    if p == "under 3.5 goals": return "won" if (h + a) < 4 else "lost"
    if p in ("btts", "both teams score"): return "won" if h > 0 and a > 0 else "lost"
    if p in ("btts no", "both teams score - no"): return "won" if h == 0 or a == 0 else "lost"
    if p in ("btts + over 2.5", "btts & over 2.5"): return "won" if (h > 0 and a > 0 and h + a > 2) else "lost"
    if p == "over 0.5 goals": return "won" if (h + a) >= 1 else "lost"
    return "void"

def get_actual_result(match_data: dict) -> str | None:
    scores = match_data.get("scores", [])
    if not scores:
        return None
    participants = match_data.get("participants", [])
    home_p = next((p for p in participants if p.get("meta", {}).get("location") == "home"), {})
    away_p = next((p for p in participants if p.get("meta", {}).get("location") == "away"), {})
    home_id = home_p.get("id")
    away_id = away_p.get("id")
    if not home_id or not away_id:
        return None
    home_goals = away_goals = None
    for s in scores:
        p_id = s.get("participant_id")
        desc = s.get("description", "")
        goals = s.get("score", {}).get("goals")
        if p_id == home_id and desc in ("CURRENT", "FT", "FINAL"): home_goals = goals
        if p_id == away_id and desc in ("CURRENT", "FT", "FINAL"): away_goals = goals
    if home_goals is None or away_goals is None:
        return None
    return f"{home_goals}-{away_goals}"


def _safe_print(text: str, file=sys.stdout):
    try:
        print(text, file=file)
    except UnicodeEncodeError:
        print(text.encode("ascii", "replace").decode("ascii"), file=file)


# ── Main vault simulator ─────────────────────────────────────────────────────
def run_vault_simulation(days: int, starting_bankroll: float, use_cache: bool = True, output_csv: bool = True):
    cache = LocalCache() if use_cache else None

    print(f"\n{'='*70}")
    print(f"  VAULT SIMULATOR — {days}-DAY BACKTEST")
    print(f"  Starting Bankroll: {starting_bankroll:,.0f} FCFA")
    print(f"  Strategy: 1/8th Kelly (0.125x), 2% default cap, max {MAX_DAILY_PICKS} picks/day")
    print(f"  Cache: {'ON' if cache else 'OFF'}")
    print(f"{'='*70}\n")

    bankroll = starting_bankroll
    all_picks = []
    daily_log = []
    market_stats = defaultdict(lambda: {"wins": 0, "losses": 0, "voids": 0, "staked": 0.0, "returned": 0.0, "picks": 0})
    ev_buckets = defaultdict(lambda: {"wins": 0, "losses": 0, "odds_sum": 0.0})
    max_bankroll = bankroll
    min_bankroll = bankroll
    max_drawdown_pct = 0.0
    win_streak = loss_streak = max_win_streak = max_loss_streak = 0

    dates_processed = 0
    dates_with_picks = 0

    for i in range(days):
        date_str = (datetime.now(LAGOS_TZ) - timedelta(days=i+1)).strftime("%Y-%m-%d")
        print(f"[Day {i+1}/{days}] Analyzing {date_str}...")

        # ── Run pipeline ──────────────────────────────────────────────
        # If cache is available, we patch the API calls to use cache
        original_get = None
        original_get_paginated = None
        if cache:
            import data_pipeline as dp
            original_get = dp._get
            original_get_paginated = dp._get_paginated

            def _cached_get(path, params=None):
                return cache.get_or_fetch(path, params, original_get)

            def _cached_get_paginated(path, params=None, max_pages=5):
                key = f"{path}_pag"
                if params:
                    for k in sorted(params.keys()):
                        if k != "api_token":
                            key += f"_{k}={params[k]}"
                key += f"_mp{max_pages}"
                cached = cache.get(f"_pag_{key}", None)
                if cached is not None:
                    return cached
                result = original_get_paginated(path, params, max_pages)
                if result is not None:
                    cache.put(f"_pag_{key}", None, result)
                return result

            dp._get = _cached_get
            dp._get_paginated = _cached_get_paginated

        try:
            result = run_pipeline(date_str, dry_run=True)
        finally:
            if cache and original_get:
                dp._get = original_get
                dp._get_paginated = original_get_paginated

        if result["status"] != "success":
            print(f"   Skipping: {result.get('reason', 'unknown')}")
            continue

        dates_processed += 1
        predictions = result.get("predictions", [])

        # ── Deduplicate predictions by fixture_id ──────────────────────────
        seen_fids = set()
        deduped_preds = []
        for pred in predictions:
            fid = pred.get("fixture_id", "")
            if fid not in seen_fids:
                seen_fids.add(fid)
                deduped_preds.append(pred)
        if len(deduped_preds) < len(predictions):
            print(f"   Deduped {len(predictions)} -> {len(deduped_preds)} predictions")
        predictions = deduped_preds

        # ── Grade predictions against actual results ─────────────────────
        daily_picks = []
        for pred in predictions:
            fid = pred.get("fixture_id", "")
            if not fid:
                continue

            # Fetch actual result (with cache, fallback to free stack)
            raw_match = None
            if SM_TOKEN:
                if cache:
                    raw_match = cache.get_or_fetch(f"/fixtures/{fid}", {"include": "scores;participants"}, original_get if original_get else _get)
                else:
                    raw_match = _get(f"/fixtures/{fid}", {"include": "scores;participants"})

            # Fallback to free data stack if Sportmonks returned nothing
            if (not raw_match or not raw_match.get("data")) and fetch_match_result_free:
                free_result = fetch_match_result_free(fid)
                if free_result:
                    # Wrap in Sportmonks-compatible dict for get_actual_result
                    raw_match = {"data": {
                        "scores": [
                            {"participant_id": 1, "description": "CURRENT", "score": {"goals": free_result["home_goals"]}},
                            {"participant_id": 2, "description": "CURRENT", "score": {"goals": free_result["away_goals"]}},
                        ],
                        "participants": [
                            {"id": 1, "meta": {"location": "home"}},
                            {"id": 2, "meta": {"location": "away"}},
                        ]
                    }}

            if not raw_match or not raw_match.get("data"):
                continue

            actual_score = get_actual_result(raw_match["data"])
            if not actual_score:
                continue

            # ── Apply Vault rules ───────────────────────────────────────
            prediction = pred.get("prediction", pred.get("bet_type", ""))
            if not prediction or prediction == "N/A":
                continue

            odds = pred.get("odds", 0)
            probability = pred.get("probability", 0)
            ev_pct = pred.get("ev_pct", 0)
            expected_value = pred.get("expected_value", 0)
            inefficiency = pred.get("inefficiency", 0)
            kelly_pct = pred.get("kelly_stake", 0)
            league_tier = pred.get("league_tier", 2)

            if pred.get("vault_eligible") is False or pred.get("odds_fresh") is False:
                continue

            if league_tier >= 5:
                continue

            if odds <= 1.0 or probability <= 0:
                continue

            # Risk filter: minimum EV and probability (matching VaultTab)
            if ev_pct < 2:  # VaultTab filters to ev_pct >= 2
                continue

            # Kelly stake calculation (matches VaultTab + kelly_optimizer)
            # kelly_pct is already quarter-Kelly capped by market risk.
            # VaultTab: stakeAmount = Math.round(currentBankroll * (kellyStakePct / 100))
            if kelly_pct <= 0:
                continue

            stake_pct = kelly_pct / 100.0
            stake_pct = min(stake_pct, MAX_STAKE_PCT)  # Default hard cap at 3%
            stake_amount = round(bankroll * stake_pct, 2)

            if stake_amount < 1:  # Minimum 1 FCFA
                continue

            grade = grade_prediction(prediction, actual_score)

            # Calculate profit/loss (matches VaultTab exactly)
            if grade == "won":
                profit = round(stake_amount * (odds - 1), 2)
            elif grade == "lost":
                profit = round(-stake_amount, 2)
            elif grade == "void":
                profit = 0.0
            else:
                continue

            # CLV tracking
            pick_odds = pred.get("pick_time_odds", 0) or pred.get("odds", 0)
            clv = 0.0
            if pick_odds > 0 and odds > 0 and pick_odds != odds:
                clv = ((1/pick_odds) - (1/odds))

            daily_picks.append({
                "date": date_str,
                "strategy_version": VAULT_STRATEGY_VERSION,
                "strategy_name": VAULT_STRATEGY_NAME,
                "decision_time_local": VAULT_DECISION_TIME_LOCAL,
                "fixture_id": fid,
                "home_team": pred.get("home_team", ""),
                "away_team": pred.get("away_team", ""),
                "league": pred.get("league", ""),
                "league_tier": league_tier,
                "prediction": prediction,
                "odds": odds,
                "probability": probability,
                "ev_pct": ev_pct,
                "expected_value": expected_value,
                "inefficiency": inefficiency,
                "kelly_pct": kelly_pct,
                "stake_pct": round(stake_pct * 100, 2),
                "stake_amount": stake_amount,
                "actual_score": actual_score,
                "grade": grade,
                "profit": profit,
                "bankroll_before": bankroll,
                "clv": clv,
                "category": pred.get("category", ""),
                "value_rank": pred.get("value_rank", ""),
                "model_confidence": pred.get("model_confidence", 0),
                "safety_downgrade": pred.get("safety_downgrade", ""),
            })

        # ── Limit to top MAX_DAILY_PICKS (sorted by composite quality, matching VaultTab) ─
        daily_picks.sort(key=lambda p: (
            {"safe": 2, "value": 1, "risky": 0, "lean": -1}.get(p.get("category", ""), -1),
            p.get("expected_value", 0) * 0.4 + p.get("probability", 0) * 0.4 + p.get("inefficiency", 0) * 0.2,
        ), reverse=True)
        daily_picks = daily_picks[:MAX_DAILY_PICKS]

        if not daily_picks:
            print(f"   No qualifying picks for {date_str}")
            continue

        dates_with_picks += 1

        # ── Apply compounding: update bankroll after each pick ──────────
        daily_profit = 0.0
        for pick in daily_picks:
            # Recalculate stake based on bankroll at time of pick
            # (matches VaultTab: stake = bankroll * kelly_pct / 100)
            stake = round(bankroll * (pick["kelly_pct"] / 100), 2)
            stake = min(stake, bankroll * MAX_STAKE_PCT)  # Default hard cap at 3%
            stake = max(stake, 1.0) if stake >= 1 else 0  # Min 1 FCFA
            if stake < 1:
                pick["stake_amount"] = 0
                pick["profit"] = 0
                continue

            pick["stake_amount"] = stake
            pick["bankroll_before"] = bankroll

            if pick["grade"] == "won":
                profit = round(stake * (pick["odds"] - 1), 2)
            elif pick["grade"] == "lost":
                profit = round(-stake, 2)
            else:
                profit = 0.0

            pick["profit"] = profit
            bankroll = round(bankroll + profit, 2)
            daily_profit += profit

            # Track market stats
            mkt = pick["prediction"]
            ms = market_stats[mkt]
            ms["picks"] += 1
            ms["staked"] += stake
            if pick["grade"] == "won":
                ms["wins"] += 1
                ms["returned"] += stake * pick["odds"]
            elif pick["grade"] == "lost":
                ms["losses"] += 1
            else:
                ms["voids"] += 1
                ms["returned"] += stake

            # Track EV calibration
            ev_bucket = int(pick["ev_pct"] // 10) * 10
            ev_key = f"{ev_bucket}-{ev_bucket+10}%"
            eb = ev_buckets[ev_key]
            if pick["grade"] == "won":
                eb["wins"] += 1
            elif pick["grade"] == "lost":
                eb["losses"] += 1
            eb["odds_sum"] += pick["odds"]

            # Streaks
            if pick["grade"] == "won":
                win_streak += 1
                loss_streak = 0
                max_win_streak = max(max_win_streak, win_streak)
            elif pick["grade"] == "lost":
                loss_streak += 1
                win_streak = 0
                max_loss_streak = max(max_loss_streak, loss_streak)

            all_picks.append(pick)

        # Track drawdown
        max_bankroll = max(max_bankroll, bankroll)
        min_bankroll = min(min_bankroll, bankroll)
        drawdown_pct = (max_bankroll - bankroll) / max_bankroll if max_bankroll > 0 else 0
        max_drawdown_pct = max(max_drawdown_pct, drawdown_pct)

        print(f"   Day {i+1}: {len(daily_picks)} picks, P/L: {daily_profit:+,.0f} FCFA, Bankroll: {bankroll:,.0f}")

        daily_log.append({
            "day": i + 1,
            "date": date_str,
            "picks": len(daily_picks),
            "profit": daily_profit,
            "bankroll": bankroll,
            "max_drawdown_pct": round(max_drawdown_pct * 100, 1),
        })

    # ── PRINT FINAL REPORT ─────────────────────────────────────────────
    total_picks = len(all_picks)
    wins = sum(1 for p in all_picks if p["grade"] == "won")
    losses = sum(1 for p in all_picks if p["grade"] == "lost")
    voids = sum(1 for p in all_picks if p["grade"] == "void")
    decided = wins + losses
    hit_rate = wins / decided if decided > 0 else 0
    total_staked = sum(p["stake_amount"] for p in all_picks)
    total_returned = sum(p["stake_amount"] * p["odds"] if p["grade"] == "won" else (0 if p["grade"] == "lost" else p["stake_amount"]) for p in all_picks)
    total_profit = sum(p["profit"] for p in all_picks)
    flat_roi = total_profit / total_staked if total_staked > 0 else 0

    # CLV
    clv_picks = [p for p in all_picks if p.get("clv", 0) != 0]
    avg_clv = sum(p["clv"] for p in clv_picks) / len(clv_picks) if clv_picks else 0
    clv_positive_rate = sum(1 for p in clv_picks if p["clv"] > 0) / len(clv_picks) if clv_picks else 0

    print(f"\n{'='*70}")
    print(f"  VAULT SIMULATION REPORT — {days} DAYS")
    print(f"{'='*70}")
    print(f"  Starting Bankroll:   {starting_bankroll:>12,.0f} FCFA")
    print(f"  Final Bankroll:       {bankroll:>12,.0f} FCFA")
    print(f"  Net P/L:             {total_profit:>+12,.0f} FCFA")
    print(f"  ROI (Kelly-staked):  {flat_roi:>+.1%}")
    print(f"{'─'*70}")
    print(f"  Days analyzed:       {dates_processed:>12}")
    print(f"  Days with picks:     {dates_with_picks:>12}")
    print(f"  Total picks:         {total_picks:>12}")
    print(f"  Wins / Losses:       {wins:>5} / {losses:<5}  (voids: {voids})")
    print(f"  Hit rate:            {hit_rate:>11.1%}")
    print(f"  Total staked:        {total_staked:>12,.0f} FCFA")
    print(f"  Total returned:      {total_returned:>12,.0f} FCFA")
    print(f"{'─'*70}")
    print(f"  Max bankroll:        {max_bankroll:>12,.0f} FCFA")
    print(f"  Min bankroll:        {min_bankroll:>12,.0f} FCFA")
    print(f"  Max drawdown:        {max_drawdown_pct:>11.1%}")
    print(f"  Win streak (max):    {max_win_streak:>12}")
    print(f"  Loss streak (max):   {max_loss_streak:>12}")
    print(f"{'─'*70}")
    if clv_picks:
        print(f"  Avg CLV:             {avg_clv:>+11.2%}")
        print(f"  CLV positive rate:   {clv_positive_rate:>11.1%}")
    print(f"{'─'*70}")

    # Per-market breakdown
    if market_stats:
        print(f"\n  {'MARKET':<26} {'W':>4} {'L':>4} {'V':>3} {'Hit%':>7} {'Staked':>10} {'ROI':>8}")
        print(f"  {'-'*26} {'-'*4} {'-'*4} {'-'*3} {'-'*7} {'-'*10} {'-'*8}")
        for mkt, ms in sorted(market_stats.items(), key=lambda x: x[1]["picks"], reverse=True):
            w, l = ms["wins"], ms["losses"]
            n = w + l
            if n == 0:
                continue
            hr = w / n
            roi = (ms["returned"] - ms["staked"]) / ms["staked"] if ms["staked"] > 0 else 0
            flag = " *" if hr < 0.45 and n >= 5 else ""
            print(f"  {mkt:<26} {w:>4} {l:>4} {ms['voids']:>3} {hr:>6.1%} {ms['staked']:>10,.0f} {roi:>+7.1%}{flag}")

    # EV Calibration
    if ev_buckets:
        print(f"\n  EV CALIBRATION (predicted EV vs actual performance):")
        print(f"  {'EV Bucket':<18} {'N':>4} {'Hit%':>7} {'Avg Odds':>9} {'Actual ROI':>11}")
        print(f"  {'-'*18} {'-'*4} {'-'*7} {'-'*9} {'-'*11}")
        for key in sorted(ev_buckets.keys()):
            eb = ev_buckets[key]
            n = eb["wins"] + eb["losses"]
            if n < 3:
                continue
            hr = eb["wins"] / n
            avg_o = eb["odds_sum"] / n
            actual_roi = ((eb["wins"] * (avg_o - 1)) - eb["losses"]) / n
            direction = "OVER" if hr < 0.5 else ("UNDER" if hr > 0.65 else "ok")
            print(f"  {key:<18} {n:>4} {hr:>6.1%} {avg_o:>9.2f} {actual_roi:>+10.1%}  {direction}")

    # Daily log
    print(f"\n  DAILY VAULT LOG:")
    print(f"  {'Day':>4} {'Date':<12} {'Picks':>5} {'P/L':>12} {'Bankroll':>12} {'DD%':>6}")
    print(f"  {'-'*4} {'-'*12} {'-'*5} {'-'*12} {'-'*12} {'-'*6}")
    for dl in daily_log:
        print(f"  {dl['day']:>4} {dl['date']:<12} {dl['picks']:>5} {dl['profit']:>+11,.0f} {dl['bankroll']:>12,.0f} {dl['max_drawdown_pct']:>5.1f}%")

    # Verdict
    pct_return = (bankroll - starting_bankroll) / starting_bankroll * 100 if starting_bankroll > 0 else 0
    verdict = "PROFITABLE" if bankroll > starting_bankroll else ("NEEDS CALIBRATION" if bankroll < starting_bankroll * 0.85 else "MARGINAL")
    print(f"\n{'='*70}")
    print(f"  VERDICT: {verdict}")
    print(f"  Starting: {starting_bankroll:,.0f} -> Final: {bankroll:,.0f} ({pct_return:+.1f}%)")
    print(f"{'='*70}\n")

    # CSV export
    if output_csv and all_picks:
        csv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", f"vault_sim_{days}d.csv")
        try:
            with open(csv_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=all_picks[0].keys())
                writer.writeheader()
                writer.writerows(all_picks)
            print(f"  CSV exported: {csv_path}")
        except Exception as e:
            print(f"  CSV export failed: {e}")

    # Cache stats
    if cache:
        print(f"\n  {cache.stats()}")

    return {
        "starting_bankroll": starting_bankroll,
        "final_bankroll": bankroll,
        "net_pnl": total_profit,
        "roi": flat_roi,
        "total_picks": total_picks,
        "wins": wins,
        "losses": losses,
        "voids": voids,
        "hit_rate": hit_rate,
        "max_drawdown_pct": max_drawdown_pct,
        "dates_processed": dates_processed,
        "dates_with_picks": dates_with_picks,
        "daily_log": daily_log,
        "picks": all_picks,
    }


if __name__ == "__main__":
    print("\n" + "=" * 50)
    print("  VANTAGE VAULT SIMULATOR")
    print("  Backtests the Vault strategy against historical data")
    print("=" * 50 + "\n")

    # Interactive prompts
    if len(sys.argv) >= 3:
        days = int(sys.argv[1])
        bankroll = float(sys.argv[2])
    else:
        try:
            days_input = input("  How many days to simulate? [7]: ").strip()
            days = int(days_input) if days_input else 7
        except (ValueError, EOFError):
            days = 7

        try:
            bankroll_input = input(f"  Starting bankroll (FCFA)? [10000]: ").strip()
            bankroll = float(bankroll_input) if bankroll_input else 10000.0
        except (ValueError, EOFError):
            bankroll = 10000.0

    print(f"\n  Simulating {days} days with {bankroll:,.0f} FCFA starting bankroll...\n")

    result = run_vault_simulation(days=days, starting_bankroll=bankroll)
