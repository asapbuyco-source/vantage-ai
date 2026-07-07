"""
performance_tracker.py
──────────────────────
Tracks and computes system-wide performance metrics.

Reads all graded quant_predictions from Firestore and computes:
  - Total bets, wins, losses, voids
  - Win rate (excluding voids)
  - ROI (return on investment)
  - Profit/loss in units
  - Closing Line Value (CLV) tracking
  - Streak (current consecutive wins)
"""

import sys
from datetime import datetime, timezone, timedelta
from collections import defaultdict

LAGOS_TZ = timezone(timedelta(hours=1))


def _get_firestore():
    try:
        import os, json
        import firebase_admin
        from firebase_admin import firestore as fs, credentials

        # Initialize only if not already done (each Python process starts fresh)
        if not firebase_admin._apps:
            sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
            if sa_json:
                cred = credentials.Certificate(json.loads(sa_json))
            else:
                cred = credentials.ApplicationDefault()
            firebase_admin.initialize_app(cred)

        return fs.client()
    except Exception as e:
        print(f"[Perf] Firestore unavailable: {e}", file=sys.stderr)
        return None



def _compute_period_stats(predictions: list[dict]) -> dict:
    """Compute stats for a list of predictions."""
    total = wins = losses = voids = 0
    stakes = profits = 0.0
    clv_values = []

    for pred in predictions:
        status = pred.get("status", "pending")
        if status == "pending":
            continue
        # ISSUE-04: Only include bets the system actually recommended (safe/value).
        # Lean and no_edge picks pollute win rate and ROI with untracked stakes.
        category = pred.get("category", "")
        if category not in ("safe", "value"):
            continue
        total += 1
        # ISSUE-04: Default was 1.0 — caused fake 1% stake inflation on missing data.
        kelly_stake = float(pred.get("kelly_stake", 0.0))
        if kelly_stake <= 0.0:
            continue  # Skip zero-stake records from tracking
        stake_unit = kelly_stake / 100.0  # Convert to fractional

        if status == "won":
            wins += 1
            odds = float(pred.get("odds", 1.0))
            profits += stake_unit * (odds - 1.0)
            stakes += stake_unit
        elif status == "lost":
            losses += 1
            profits -= stake_unit
            stakes += stake_unit
        else:  # void
            voids += 1

        # CLV: read the pre-computed value from grading engine
        clv = pred.get("clv")
        if clv is not None:
            clv_values.append(float(clv))

    graded = wins + losses  # Exclude voids from win rate
    win_rate = wins / graded if graded > 0 else 0.0
    roi = profits / stakes if stakes > 0 else 0.0
    avg_clv = sum(clv_values) / len(clv_values) if clv_values else None
    positive_clv_pct = (sum(1 for c in clv_values if c > 0) / len(clv_values)) if clv_values else None

    return {
        "total_bets": total,
        "wins": wins,
        "losses": losses,
        "voids": voids,
        "win_rate": round(win_rate, 4),
        "roi": round(roi, 4),
        "profit_units": round(profits, 4),
        "stakes_units": round(stakes, 4),
        "avg_clv": round(avg_clv, 4) if avg_clv is not None else None,
        "clv_sample_size": len(clv_values),
        "positive_clv_pct": round(positive_clv_pct, 4) if positive_clv_pct is not None else None,
    }


def _compute_streak(predictions: list[dict]) -> int:
    """Compute current consecutive win streak (positive) or loss streak (negative)."""
    graded = [p for p in predictions if p.get("status") in ("won", "lost")]
    if not graded:
        return 0
    # Most recent first (assume sorted by date already)
    graded.reverse()
    streak = 0
    first_status = graded[0].get("status")
    for p in graded:
        if p.get("status") == first_status:
            streak += 1
        else:
            break
    return streak if first_status == "won" else -streak


def compute_and_save_performance() -> dict:
    """
    Main entry: compute performance across all available quant prediction dates
    and save aggregated stats to Firestore `quant_performance/all`.
    """
    db = _get_firestore()
    if not db:
        return {"status": "error", "error": "no_firestore"}

    all_preds = []
    daily = {}

    try:
        docs = db.collection("quant_predictions").stream()
        for doc in docs:
            data = doc.to_dict()
            preds = data.get("predictions", [])
            # Annotate with date
            for p in preds:
                p["_date"] = doc.id
            all_preds.extend(preds)
            daily[doc.id] = _compute_period_stats(preds)
    except Exception as e:
        print(f"[Perf] Error reading quant_predictions: {e}", file=sys.stderr)
        return {"status": "error", "error": str(e)}

    if not all_preds:
        return {"status": "skipped", "reason": "no_data"}

    overall = _compute_period_stats(all_preds)
    overall["streak"] = _compute_streak(all_preds)
    overall["daily"] = daily
    overall["computed_at"] = datetime.now(timezone.utc).isoformat()

    # Weekly stats (last 7 days)
    today = datetime.now(LAGOS_TZ).strftime("%Y-%m-%d")
    from datetime import timedelta
    week_dates = {
        (datetime.now(LAGOS_TZ) - timedelta(days=i)).strftime("%Y-%m-%d")
        for i in range(7)
    }
    weekly_preds = [p for p in all_preds if p.get("_date") in week_dates]
    weekly = _compute_period_stats(weekly_preds)

    # Monthly stats (last 30 days)
    month_dates = {
        (datetime.now(LAGOS_TZ) - timedelta(days=i)).strftime("%Y-%m-%d")
        for i in range(30)
    }
    monthly_preds = [p for p in all_preds if p.get("_date") in month_dates]
    monthly = _compute_period_stats(monthly_preds)

    result = {
        "overall": overall,
        "weekly": weekly,
        "monthly": monthly,
        "risk_metrics": compute_risk_metrics(all_preds),
        "computed_at": overall["computed_at"],
    }

    try:
        db.collection("quant_performance").document("all").set(result, merge=True)
        print(f"[Perf] ✅ Performance saved: {overall['total_bets']} bets | WR: {overall['win_rate']:.1%} | ROI: {overall['roi']:.1%}")
    except Exception as e:
        print(f"[Perf] Firestore write error: {e}", file=sys.stderr)

    return {"status": "success", **result}


# ── Phase 3.5: Sharpe / Sortino Ratio ───────────────────────────────────────

def compute_sharpe_ratio(daily_returns: list, risk_free_rate: float = 0.02) -> float:
    """Annualized Sharpe ratio from daily returns (fractional, e.g. 0.01 = 1%)."""
    if len(daily_returns) < 5:
        return 0.0
    mean = sum(daily_returns) / len(daily_returns)
    variance = sum((r - mean) ** 2 for r in daily_returns) / (len(daily_returns) - 1)
    std = variance ** 0.5
    if std == 0:
        return 0.0
    daily_risk_free = risk_free_rate / 252
    return round(((mean - daily_risk_free) / std) * (252 ** 0.5), 4)


def compute_sortino_ratio(daily_returns: list, risk_free_rate: float = 0.02) -> float:
    """Sortino ratio using only downside deviation."""
    if len(daily_returns) < 5:
        return 0.0
    mean = sum(daily_returns) / len(daily_returns)
    downside = [r for r in daily_returns if r < 0]
    if not downside:
        return float('inf')
    downside_variance = sum((r - 0) ** 2 for r in downside) / len(downside)
    downside_std = downside_variance ** 0.5
    if downside_std == 0:
        return 0.0
    daily_risk_free = risk_free_rate / 252
    return round(((mean - daily_risk_free) / downside_std) * (252 ** 0.5), 4)


def compute_risk_metrics(predictions: list) -> dict:
    """Compute risk-adjusted return metrics from graded predictions."""
    daily_returns = {}
    for p in predictions:
        if p.get("status") not in ("won", "lost"):
            continue
        date = p.get("_date", "")
        odds = float(p.get("pick_time_odds", 0) or p.get("odds", 0) or 0)
        stake = float(p.get("kelly_stake", 1) or 1) / 100.0
        if odds <= 1.0 or stake <= 0:
            continue

        if p["status"] == "won":
            ret = stake * (odds - 1)
        else:
            ret = -stake

        daily_returns[date] = daily_returns.get(date, 0.0) + ret

    returns_list = list(daily_returns.values())
    sharpe = compute_sharpe_ratio(returns_list)
    sortino = compute_sortino_ratio(returns_list)

    return {
        "sharpe_ratio": sharpe,
        "sortino_ratio": sortino,
        "trading_days": len(returns_list),
        "total_return_pct": round(sum(returns_list) * 100, 2),
    }


if __name__ == "__main__":
    result = compute_and_save_performance()
    if result.get("status") == "success":
        ovr = result.get("overall", {})
        print(f"Overall: {ovr.get('total_bets')} bets | Win Rate: {ovr.get('win_rate'):.1%} | ROI: {ovr.get('roi'):.1%}")
    else:
        print(result)
