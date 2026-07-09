"""
vault_sim_after_fixes.py
────────────────────────
Simulates how the vault EV strategy WOULD HAVE performed with all Phase 1
fixes applied: DC X2 removed, BTTS blanking filtered, tighter calibration,
and Over 1.5 promotion.

Usage:
    python vault_sim_after_fixes.py --days 30
"""

import os, sys, json, math
from datetime import datetime, timedelta, timezone
from collections import defaultdict

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import firebase_admin
    from firebase_admin import firestore as fs, credentials
except ImportError:
    print("firebase-admin not installed"); sys.exit(1)

# ── Vault Constants ─────────────────────────────────────────────────────────
KELLY_FRACTION = 0.125
MAX_STAKE_PCT = 0.02
FRAGILE_MAX = 0.01
WATCH_MAX = 0.015
MAX_DAILY_PICKS = 7
LAGOS_TZ = timezone(timedelta(hours=1))

FRAGILE_KEYWORDS = ["away win", "draw no bet", "btts no", "over 3.5", "over 4.5", "under 0.5"]
WATCH_KEYWORDS = ["under 1.5", "under 2.5", "under 3.5", "double chance (x2)", "draw no bet (away)"]

# PHASE 1: Suppressed markets (DC X2 removed)
SUPPRESSED_MARKETS = {"double chance (x2)", "dc x2"}

# Only proven high-hit-rate markets enter the vault
VAULT_APPROVED_MARKETS = ["over 1.5", "under 3.5"]

# PHASE 1: Tighter calibration factors (applied at bet level)
TIGHTER_CALIBRATION = {
    "over25": 0.80,
    "over15": 0.96,
    "over35": 0.65,
    "btts": 0.66,
    "btts_no": 0.85,
    "under35": 0.80,
}

# PHASE 1: Higher BTTS ev threshold (blanking filter substitute)
BTTS_MIN_EV_PCT = 5.0  # Raised from 2.0%


def market_to_key(market: str) -> str:
    m = market.lower().strip()
    mapping = {
        "away win": "away_win", "draw": "draw", "btts no": "btts_no",
        "over 3.5 goals": "over35", "under 2.5 goals": "under25",
        "under 3.5 goals": "under35", "btts": "btts",
        "over 2.5 goals": "over25", "home win": "home_win",
        "over 1.5 goals": "over15",
    }
    for k, v in mapping.items():
        if k in m:
            return v
    return m.replace(" ", "_").replace("-", "_")


def market_max_stake(market: str, tier: str = "stable") -> float:
    t = (tier or "stable").lower()
    if t == "fragile":
        return FRAGILE_MAX
    if t == "watch":
        return WATCH_MAX
    m = (market or "").lower()
    for kw in FRAGILE_KEYWORDS:
        if kw in m:
            return FRAGILE_MAX
    for kw in WATCH_KEYWORDS:
        if kw in m:
            return WATCH_MAX
    return MAX_STAKE_PCT


def kelly_stake_pct(prob: float, odds: float, market: str, calib_tier: str) -> float:
    if odds <= 1.0 or prob <= 0 or prob >= 1:
        return 0.0
    b = odds - 1.0
    full = (b * prob - (1 - prob)) / b
    if full <= 0:
        return 0.0
    frac = full * KELLY_FRACTION
    cap = market_max_stake(market, calib_tier)
    return min(cap, frac)


def resolve_market_for_grade(market: str, hg: int, ag: int) -> str:
    m = market.lower().strip()
    total = hg + ag
    if "home win" in m and "draw no bet" not in m and "double" not in m:
        return "won" if hg > ag else "lost"
    if "away win" in m and "draw no bet" not in m and "double" not in m:
        return "won" if ag > hg else "lost"
    if m == "draw":
        return "won" if hg == ag else "lost"
    if "double chance (1x)" in m:
        return "won" if hg >= ag else "lost"
    if "double chance (x2)" in m:
        return "won" if ag >= hg else "lost"
    if "double chance (12)" in m:
        return "won" if hg != ag else "lost"
    if "draw no bet (home)" in m:
        if hg == ag: return "void"
        return "won" if hg > ag else "lost"
    if "draw no bet (away)" in m:
        if hg == ag: return "void"
        return "won" if ag > hg else "lost"
    if "over 0.5" in m:
        return "won" if total > 0 else "lost"
    if "over 1.5" in m:
        return "won" if total > 1 else "lost"
    if "over 2.5" in m:
        return "won" if total > 2 else "lost"
    if "over 3.5" in m:
        return "won" if total > 3 else "lost"
    if "under 1.5" in m:
        return "won" if total < 2 else "lost"
    if "under 2.5" in m:
        return "won" if total < 3 else "lost"
    if "under 3.5" in m:
        return "won" if total < 4 else "lost"
    if ("btts" in m or "both teams to score" in m) and "no" not in m:
        return "won" if hg > 0 and ag > 0 else "lost"
    if ("btts" in m or "both teams to score" in m) and "no" in m:
        return "won" if (hg == 0 or ag == 0) else "lost"
    if "btts + over 2.5" in m:
        return "won" if (hg > 0 and ag > 0 and total > 2) else "lost"
    return "void"


def load_results_cache(date_str: str) -> dict:
    cache_file = os.path.join(os.path.dirname(__file__), ".cache", f"grading_results_{date_str}.json")
    if not os.path.exists(cache_file):
        return {}
    with open(cache_file, "r") as f:
        return json.load(f)


def check_btts_blanking(pred: dict) -> bool:
    """Phase 1.3: Check if BTTS bet is at risk of blanking."""
    market = (pred.get("bet_type") or pred.get("prediction") or "").lower()
    if "btts" not in market or "no" in market:
        return False
    home_avg = float(pred.get("home_avg_scored", 1.0) or 1.0)
    away_avg = float(pred.get("away_avg_scored", 1.0) or 1.0)
    return home_avg < 0.8 or away_avg < 0.8


def apply_phase1_filters(candidates: list) -> list:
    """Apply all Phase 1 fixes to filter and re-prioritize candidates."""
    filtered = []

    for c in candidates:
        market_lower = c["market"].lower().strip()

        # Phase 1.2: Remove suppressed markets (DC X2)
        if any(s in market_lower for s in SUPPRESSED_MARKETS):
            continue

        # Vault market whitelist: only proven high-hit-rate markets
        if not any(m in market_lower for m in VAULT_APPROVED_MARKETS):
            continue

        # Phase 1.3: BTTS blanking filter
        if "btts" in market_lower and "no" not in market_lower and "both teams to score" in market_lower:
            pass  # handled below
        elif "btts" in market_lower and "no" not in market_lower:
            if c.get("btts_blanking", False):
                continue

        # Phase 1.4: Tighter calibration
        orig_prob = c["probability"]
        key = market_to_key(c["market"])
        tighter_factor = TIGHTER_CALIBRATION.get(key)
        if tighter_factor:
            c["probability"] = round(orig_prob * tighter_factor, 4)
            # Recalculate kelly with tighter prob
            c["kelly_pct"] = kelly_stake_pct(c["probability"], c["odds"], c["market"], c["calibration_tier"]) * 100

        # Phase 1.3: Higher EV threshold for BTTS
        if "btts" in market_lower and "no" not in market_lower:
            if c["ev_pct"] < BTTS_MIN_EV_PCT:
                continue

        # Phase 1.5: Over 1.5 priority boost
        if "over 1.5" in market_lower:
            c["priority_boost"] = 1.5

        filtered.append(c)

    # Phase 1.5: Sort with Over 1.5 priority first, then category, then quality
    tier_priority = {"safe": 3, "value": 2}
    filtered.sort(key=lambda c: (
        1 if "over 1.5" in c.get("market", "").lower() else 0,  # O1.5 always first
        tier_priority.get(c.get("category", ""), 0),
        (c.get("expected_value", 0) * 0.4 + c["probability"] * 0.4 + c.get("inefficiency", 0) * 0.2),
    ), reverse=True)

    return filtered


def run_simulation(days: int = 30, bankroll: float = 10000):
    """Simulate vault with ALL Phase 1 fixes applied."""

    # ── Init Firestore ──────────────────────────────────────────────────
    if not firebase_admin._apps:
        sa_raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
        if sa_raw:
            sa_dict = json.loads(sa_raw)
            if "private_key" in sa_dict:
                sa_dict["private_key"] = sa_dict["private_key"].replace('\\n', '\n')
            cred = credentials.Certificate(sa_dict)
            firebase_admin.initialize_app(cred)
    db = fs.client()

    today = datetime.now(LAGOS_TZ)
    dates = [(today - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days, 0, -1)]

    print(f"\n{'='*70}")
    print(f"  VAULT SIMULATION — PHASE 1 FIXES APPLIED")
    print(f"  Period: {dates[0]} to {dates[-1]} ({len(dates)} days)")
    print(f"  Starting Bankroll: {bankroll:,.0f} FCFA")
    print(f"  Fixes active: DC X2 removed, BTTS filter, tighter calib, O1.5 boost")
    print(f"{'='*70}\n")

    all_daily_picks = []
    daily_log = []
    market_stats = defaultdict(lambda: {"picks": 0, "wins": 0, "losses": 0, "voids": 0, "staked": 0.0, "returned": 0.0})
    dates_with_picks = 0
    total_skipped_dcx2 = 0
    total_skipped_btts = 0
    max_bankroll = bankroll
    max_drawdown = 0.0

    for date_str in dates:
        doc = db.collection("quant_predictions").document(date_str).get()
        if not doc.exists:
            continue

        data = doc.to_dict()
        predictions = data.get("predictions", [])
        if not predictions:
            continue

        next_date = (datetime.strptime(date_str, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
        results = {}
        results.update(load_results_cache(date_str) or {})
        results.update(load_results_cache(next_date) or {})

        # ── Build raw candidates ──────────────────────────────────────
        candidates = []
        for pred in predictions:
            market = pred.get("bet_type") or pred.get("prediction") or ""
            if not market or market == "N/A":
                continue

            if pred.get("vault_eligible") is False:
                continue
            if pred.get("odds_fresh") is False:
                continue

            odds = float(pred.get("pick_time_odds", 0) or pred.get("odds", 0) or 0)
            prob = float(pred.get("calibrated_probability", 0) or pred.get("probability", 0) or 0)

            if odds <= 1.0 or prob <= 0:
                continue

            category = pred.get("category", "lean")
            if category not in ("safe", "value"):
                continue

            league_tier = pred.get("league_tier", 2)
            if league_tier >= 5:
                continue

            ev_pct = float(pred.get("ev_pct", 0) or 0)
            if ev_pct < 2:
                continue

            calib_tier = pred.get("calibration_tier", "stable") or "stable"
            kelly = kelly_stake_pct(prob, odds, market, calib_tier) * 100
            if kelly <= 0:
                continue

            fid = str(pred.get("fixture_id", ""))
            result = results.get(fid)
            if not result:
                continue

            hg, ag = result.get("home_goals", 0) or 0, result.get("away_goals", 0) or 0
            grade = resolve_market_for_grade(market, hg, ag)

            candidates.append({
                "fixture_id": fid,
                "date": date_str,
                "home_team": pred.get("home_team", ""),
                "away_team": pred.get("away_team", ""),
                "league": pred.get("league", ""),
                "market": market,
                "odds": odds,
                "probability": prob,
                "ev_pct": ev_pct,
                "kelly_pct": kelly,
                "calibration_tier": calib_tier,
                "category": category,
                "score": f"{hg}-{ag}",
                "grade": grade,
                "value_rank": pred.get("value_rank", "medium"),
                "inefficiency": pred.get("inefficiency", 0),
                "expected_value": pred.get("expected_value", 0),
                "btts_blanking": check_btts_blanking(pred),
            })

        if not candidates:
            continue

        before_count = len(candidates)

        # ── APPLY PHASE 1 FIXES ──────────────────────────────────────
        candidates = apply_phase1_filters(candidates)

        after_count = len(candidates)
        skipped = before_count - after_count
        if skipped:
            total_skipped_dcx2 += skipped  # approximate, includes all skips

        if not candidates:
            continue

        candidates = candidates[:MAX_DAILY_PICKS]
        dates_with_picks += 1

        # ── Compounding ───────────────────────────────────────────────
        day_profit = 0.0
        day_picks = []

        for c in candidates:
            stake_pct = min(c["kelly_pct"] / 100.0, market_max_stake(c["market"], c["calibration_tier"]))
            stake = round(bankroll * stake_pct, 2)
            if stake < 1:
                continue

            grade = c["grade"]
            if grade == "won":
                profit = round(stake * (c["odds"] - 1), 2)
            elif grade == "lost":
                profit = round(-stake, 2)
            elif grade == "void":
                profit = 0.0
            else:
                continue

            c["stake"] = stake
            c["profit"] = profit
            c["bankroll_before"] = bankroll
            bankroll = round(bankroll + profit, 2)
            day_profit += profit
            day_picks.append(c)

            ms = market_stats[c["market"]]
            ms["picks"] += 1
            ms["staked"] += stake
            if grade == "won":
                ms["wins"] += 1
                ms["returned"] += stake * c["odds"]
            elif grade == "lost":
                ms["losses"] += 1
            else:
                ms["voids"] += 1
                ms["returned"] += stake

        if day_picks:
            all_daily_picks.append(day_picks)
            daily_log.append({
                "date": date_str, "picks": len(day_picks),
                "profit": day_profit, "bankroll": bankroll,
            })
            max_bankroll = max(max_bankroll, bankroll)
            if max_bankroll > 0:
                dd = (max_bankroll - bankroll) / max_bankroll
                max_drawdown = max(max_drawdown, dd)

            print(f"  {date_str}: {len(day_picks)} picks | P/L: {day_profit:+,.0f} | Bankroll: {bankroll:,.0f}")

    # ── REPORT ────────────────────────────────────────────────────────────
    total_picks = sum(len(dp) for dp in all_daily_picks)
    wins = sum(1 for dp in all_daily_picks for c in dp if c["grade"] == "won")
    losses = sum(1 for dp in all_daily_picks for c in dp if c["grade"] == "lost")
    voids = sum(1 for dp in all_daily_picks for c in dp if c["grade"] == "void")
    decided = wins + losses
    hit_rate = wins / max(decided, 1)
    total_staked = sum(c["stake"] for dp in all_daily_picks for c in dp)
    total_profit = sum(c["profit"] for dp in all_daily_picks for c in dp)
    roi = total_profit / max(total_staked, 0.01)
    pct_return = (bankroll - 10000) / 10000 * 100

    # Sharpe/Sortino
    daily_returns = []
    b = 10000.0
    for dl in daily_log:
        ret = dl["profit"] / max(b, 1)
        daily_returns.append(ret)
        b = dl["bankroll"]

    sharpe = 0.0
    sortino = 0.0
    if len(daily_returns) >= 5:
        mean_ret = sum(daily_returns) / len(daily_returns)
        std_ret = (sum((r - mean_ret) ** 2 for r in daily_returns) / max(len(daily_returns) - 1, 1)) ** 0.5
        if std_ret > 0:
            sharpe = (mean_ret / std_ret) * (252 ** 0.5)
        downside = [r for r in daily_returns if r < 0]
        if downside:
            down_std = (sum((r - 0) ** 2 for r in downside) / max(len(downside), 1)) ** 0.5
            if down_std > 0:
                sortino = (mean_ret / down_std) * (252 ** 0.5)

    # ── PRINT ─────────────────────────────────────────────────────────────
    print(f"\n{'='*70}")
    print(f"  VAULT SIMULATION — PHASE 1 FIXES APPLIED")
    print(f"{'='*70}")
    print(f"  Starting Bankroll:   {10000:>12,.0f} FCFA")
    print(f"  Final Bankroll:      {bankroll:>12,.0f} FCFA")
    print(f"  Net P/L:             {total_profit:>+12,.0f} FCFA  ({pct_return:+.1f}%)")
    print(f"  ROI (Kelly-staked):  {roi:>+12.1%}")
    print(f"  Hit Rate:            {hit_rate:>12.1%}")
    print(f"  Sharpe Ratio (ann):  {sharpe:>+12.2f}")
    print(f"  Sortino Ratio (ann): {sortino:>+12.2f}")
    print(f"{'-'*70}")
    print(f"  Trading Days:        {dates_with_picks:>12}")
    print(f"  Total Picks:         {total_picks:>12}")
    print(f"  Wins / Losses:       {wins:>5} / {losses:<5}  (voids: {voids})")
    print(f"  Max Drawdown:        {max_drawdown*100:>11.1f}%")
    print(f"  Banned (DC X2 etc):  {total_skipped_dcx2 if total_skipped_dcx2 else '~'+str(before_count - after_count if 'before_count' in dir() else 0):>12}")

    if market_stats:
        print(f"\n  {'MARKET':<28} {'Picks':>5} {'W':>4} {'L':>4} {'Hit%':>7} {'Staked':>10} {'ROI':>8}")
        print(f"  {'-'*28} {'-'*5} {'-'*4} {'-'*4} {'-'*7} {'-'*10} {'-'*8}")
        for mkt, ms in sorted(market_stats.items(), key=lambda x: x[1]["picks"], reverse=True):
            w, l = ms["wins"], ms["losses"]
            n = w + l
            if n == 0:
                continue
            hr = w / n
            mkt_roi = (ms["returned"] - ms["staked"]) / ms["staked"] if ms["staked"] > 0 else 0
            flag = " !" if hr < 0.45 and n >= 3 else ""
            print(f"  {mkt[:28]:<28} {ms['picks']:>5} {w:>4} {l:>4} {hr:>6.1%} {ms['staked']:>10,.0f} {mkt_roi:>+7.1%}{flag}")

    # Daily log
    print(f"\n  DAILY VAULT LOG:")
    print(f"  {'Date':<12} {'Picks':>5} {'P/L':>12} {'Bankroll':>12} {'Cumul%':>8}")
    print(f"  {'-'*12} {'-'*5} {'-'*12} {'-'*12} {'-'*8}")
    for dl in daily_log:
        cumul_pct = (dl["bankroll"] - 10000) / 10000 * 100
        print(f"  {dl['date']:<12} {dl['picks']:>5} {dl['profit']:>+11,.0f} {dl['bankroll']:>12,.0f} {cumul_pct:>+7.1f}%")

    verdict = "PROFITABLE" if bankroll > 10000 else ("NEEDS WORK" if bankroll < 9000 else "MARGINAL")
    print(f"\n{'='*70}")
    print(f"  VERDICT: {verdict}")
    print(f"  Bankroll: 10,000 FCFA -> {bankroll:,.0f} FCFA ({pct_return:+.1f}%)")
    print(f"{'='*70}\n")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--bankroll", type=float, default=10000)
    args = parser.parse_args()

    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env.local"))
    except ImportError:
        pass

    run_simulation(days=args.days, bankroll=args.bankroll)
