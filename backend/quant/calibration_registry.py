"""
calibration_registry.py
───────────────────────
Single source of truth for all probability calibration factors.
Versioned, with sample sizes and last-updated dates for auditability.

Replaces the split calibration that existed across:
  - probability_engine.py: MARKET_CALIBRATION  (goals/BTTS primary)
  - ev_engine.py:          MARKET_PROBABILITY_HAIRCUTS  (result markets)

The old split applied two independent haircuts to some markets (e.g. Away Win:
0.65 → 0.52 via probability_engine.py, then 0.52 → 0.44 via ev_engine.py).
This registry provides a single authoritative factor per market.

Version history:
  2026-06-15-v1  Initial — consolidated from probability_engine + ev_engine
  2026-06-29-v3  Workstream 6: Dynamic calibration — season phase + league modifiers
"""

from datetime import datetime, timezone

CALIBRATION_VERSION = "2026-06-29-v3"
CALIBRATION_LAST_UPDATED = datetime(2026, 6, 29, tzinfo=timezone.utc).isoformat()

MARKET_FACTORS = {
    # key: (avg_predicted, avg_actual, discount_factor, sample_size, last_updated)
    # ── Goals markets (updated from 30-day backtest — see prediction_strategy_audit.md) ──
    "over25":  (0.88, 0.82, 0.8, 130, "2026-07-07"),  # Tightened from 0.82 after 14-day audit (54% overconfident losses)
    "under25": (0.12, 0.18, 1.00, 130, "2026-06-25"),
    "over15":  (0.84, 0.72, 0.960, 210, "2026-07-07"),  # Tightened from 0.86 — 84% hit rate is strong but 16% still overconfident
    "under15": (0.16, 0.28, 1.00, 210, "2026-06-25"),
    "over35":  (0.75, 0.50, 0.65,  95, "2026-07-07"),  # Tightened from 0.72 — persistently overconfident
    "under35": (0.38, 0.50, 0.80,  95, "2026-07-07"),  # Tightened from 0.85
    "btts":    (0.57, 0.50, 0.660, 160, "2026-07-07"),  # Tightened from 0.87 — 50% actual hit rate
    "btts_no": (0.43, 0.50, 0.85, 160, "2026-07-07"),  # Tightened from 0.90
    # ── Result markets (updated from backtest — catastrophic -43% ROI, suppressed from bets) ──
    "home_win": (0.60, 0.21, 0.37, 314, "2026-06-25"),  # v1: 0.95 → 21.4% hit rate! Severe overconfidence exposed.
    "away_win": (0.50, 0.14, 0.27, 314, "2026-06-25"),  # v1: 0.80 → 13.6% hit rate! Model cannot predict winners.
    "draw":     (0.22, 0.22, 0.90, 314, "2026-06-25"),  # v1: 0.90 → no change (draw model is reasonably calibrated)
    # ── Derived/composite markets ────────────────────────────────────────────────
    "AH Away +0.5":       (0.55, 0.50, 0.90,  50, "2026-06-25"),
    "Double Chance (X2)": (0.60, 0.55, 0.92,  50, "2026-06-25"),
    "Draw No Bet (Away)": (0.50, 0.45, 0.90,  50, "2026-06-25"),
}

FRAGILE_MARKETS = {"home_win", "away_win", "draw", "btts_no", "over35", "under35", "double_chance_x2"}

# ── Workstream 6: Dynamic Calibration ────────────────────────────────────────

# Layer 1: Season Phase Multiplier
# Model is most reliable in mid-season (Nov-Feb). Early/late season has more variance.
def get_season_phase_multiplier(month: int) -> float:
    """Return a multiplier based on where we are in the season."""
    if month in [8, 9]:    return 0.95   # Early season — less data, more variance
    if month in [10, 11, 12, 1, 2]: return 1.00  # Mid-season — peak reliability
    if month in [3, 4]:    return 0.98   # Spring — title/relegation stress
    if month in [5, 6]:    return 0.95   # End of season — motivation unpredictability
    return 1.00


# Layer 2: League-Aware Goals Calibration
# Different leagues have different average goals per game.
# The fixed over25 × 0.82 works for EPL average (2.7 GPG) but is wrong for Serie A (2.4 GPG) or Bundesliga (3.1 GPG).
# Tuple format: (league_id, over25_adj, btts_adj) relative to base calibration
LEAGUE_GOALS_MODIFIER = {
    # ── Elite (very well calibrated) ─────────────────────────────────
    39:   (1.00, 1.00),   # EPL — baseline (~2.8 GPG)
    140:  (0.96, 0.97),   # La Liga — lower scoring (~2.5 GPG)
    78:   (1.06, 1.04),   # Bundesliga — higher scoring (~3.1 GPG)
    135:  (0.95, 0.96),   # Serie A — defensive (~2.6 GPG)
    61:   (1.02, 1.01),   # Ligue 1 — near baseline (~2.7 GPG)
    # ── High-scoring leagues ─────────────────────────────────────────
    72:   (1.06, 1.04),   # Eredivisie (~3.2 GPG)
    169:  (1.07, 1.05),   # Chinese Super League (~3.3 GPG)
    98:   (1.04, 1.02),   # J1 League (~2.8 GPG, high variance)
    # ── Low/medium-scoring second-tier ───────────────────────────────
    395:  (0.92, 0.94),   # Serie B Italy (~2.2 GPG)
    302:  (0.94, 0.95),   # Ligue 2 (~2.3 GPG)
    567:  (0.90, 0.90),   # Segunda Division (~2.1 GPG)
    85:   (0.96, 0.97),   # 2. Bundesliga (~2.6 GPG)
    # ── Defensive / low-scoring leagues ──────────────────────────────
    254:  (0.85, 0.86),   # Brasileirao Serie B (~2.0 GPG) — very defensive
    10:   (0.95, 0.96),   # England League 1 (~2.4 GPG)
    12:   (0.94, 0.95),   # England League 2 (~2.3 GPG)
    14:   (0.96, 0.97),   # National League (~2.5 GPG)
    51:   (0.93, 0.94),   # Liga Portugal 2 (~2.2 GPG)
    401:  (0.94, 0.95),   # PSL South Africa (~2.3 GPG)
    255:  (0.96, 0.97),   # USL Championship (~2.6 GPG)
    # ── South American (home-heavy, high variance) ──────────────────
    71:   (0.98, 0.97),   # Brasileirao Serie A — fewer goals than European peers
    325:  (0.96, 0.95),   # Argentine Primera — physical, low scoring
    266:  (0.97, 0.96),   # Chile Primera
    281:  (0.96, 0.95),   # Peru Liga 1
}


def get_league_goals_modifier(league_id: int | None) -> tuple[float, float]:
    """Return (over25_adj, btts_adj) for a given league. Defaults to (1.0, 1.0) if unknown."""
    if league_id is None:
        return (1.0, 1.0)
    entry = LEAGUE_GOALS_MODIFIER.get(league_id)
    if entry:
        return entry
    return (1.0, 1.0)


def get_dynamic_calibration_factor(
    market_key: str,
    default: float = 0.95,
    league_id: int | None = None,
    month: int | None = None,
) -> float:
    """
    Get adaptive calibration factor incorporating:
    1. Base market calibration factor
    2. Season phase multiplier (if month provided)
    3. League goals modifier (if league_id provided and market is goals-related)
    """
    base_factor = get_calibration_factor(market_key, default)

    # Apply season phase multiplier
    if month is not None:
        season_mult = get_season_phase_multiplier(month)
        base_factor *= season_mult

    # Apply league-specific goals modifier for goals/BTTS markets
    if league_id is not None and any(k in market_key.lower() for k in ['over', 'under', 'btts']):
        over25_adj, btts_adj = get_league_goals_modifier(league_id)
        if 'over25' in market_key.lower() or 'under25' in market_key.lower():
            base_factor *= over25_adj
        elif 'btts' in market_key.lower():
            base_factor *= btts_adj

    return round(base_factor, 4)


def get_calibration_factor(market_key: str, default: float = 0.95) -> float:
    """Return the single authoritative calibration factor for a market."""
    entry = MARKET_FACTORS.get(market_key)
    if entry:
        return entry[2]
    return default


def get_calibration_metadata(market_key: str) -> dict:
    """Return full metadata for audit trail."""
    entry = MARKET_FACTORS.get(market_key)
    if entry:
        return {
            "avg_predicted": entry[0],
            "avg_actual": entry[1],
            "discount_factor": entry[2],
            "sample_size": entry[3],
            "last_updated": entry[4],
        }
    return {"discount_factor": 0.95, "sample_size": 0, "note": "default"}


def get_calibration_tier(market_key: str) -> str:
    """Return trust tier for display."""
    if market_key in FRAGILE_MARKETS:
        return "fragile"
    factor = get_calibration_factor(market_key, 0.97)
    if factor < 0.95:
        return "watch"
    return "stable"


# ── Layer 3: Auto-Update from Grading Data ────────────────────────────────────
# After grading runs each day, record actual hit rates per market.
# Every 14 days, auto-adjust calibration factors toward actual performance.

_CALIBRATION_STATS_KEY = "calibration_stats"


def _normalize_market_key(market: str) -> str:
    """Normalize market string to registry key format."""
    m = market.lower().strip()
    if "over 2.5" in m or "over2.5" in m:
        return "over25"
    if "under 2.5" in m or "under2.5" in m:
        return "under25"
    if "over 1.5" in m or "over1.5" in m:
        return "over15"
    if "under 1.5" in m or "under1.5" in m:
        return "under15"
    if "over 3.5" in m or "over3.5" in m:
        return "over35"
    if "under 3.5" in m or "under3.5" in m:
        return "under35"
    if "btts" in m and "no" not in m:
        return "btts"
    if "btts" in m and "no" in m:
        return "btts_no"
    if "home win" in m:
        return "home_win"
    if "away win" in m:
        return "away_win"
    if m == "draw":
        return "draw"
    return m


def update_calibration_from_results(graded_predictions: list[dict]) -> dict:
    """
    Update calibration statistics from graded predictions.

    Called after grading runs each day. Records predicted vs actual outcomes
    per market. Every 14 days, auto-adjusts calibration factors toward actual
    performance if there's a significant divergence (>5% over 20+ samples).

    Args:
        graded_predictions: List of prediction dicts with 'status' ('won'/'lost'/'void')
                          and market info

    Returns:
        Summary dict of what was updated
    """
    market_results: dict[str, dict] = {}

    for pred in graded_predictions:
        if pred.get("status") not in ("won", "lost"):
            continue

        market = pred.get("bet_type", "")
        if not market:
            continue

        key = _normalize_market_key(market)
        if key not in market_results:
            market_results[key] = {"predicted": [], "actual": []}

        model_prob = pred.get("calibrated_probability") or pred.get("probability", 0) / 100.0
        actual = 1.0 if pred.get("status") == "won" else 0.0

        market_results[key]["predicted"].append(model_prob)
        market_results[key]["actual"].append(actual)

    updates = {}
    for key, data in market_results.items():
        n = len(data["predicted"])
        if n < 5:
            continue

        avg_predicted = sum(data["predicted"]) / n
        avg_actual = sum(data["actual"]) / n
        divergence = abs(avg_predicted - avg_actual)

        # Only update if >5% divergence over 20+ samples
        if n >= 20 and divergence > 0.05:
            # Adjust factor toward actual performance
            if key in MARKET_FACTORS:
                old_factor = MARKET_FACTORS[key][2]
                # Move factor 20% toward the ratio of actual/predicted
                if avg_predicted > 0:
                    ratio = avg_actual / avg_predicted
                    new_factor = old_factor * (1 + (ratio - 1) * 0.2)
                    new_factor = max(0.70, min(1.05, new_factor))

                    old_entry = MARKET_FACTORS[key]
                    MARKET_FACTORS[key] = (
                        round(avg_predicted, 4),
                        round(avg_actual, 4),
                        round(new_factor, 4),
                        old_entry[3] + n,
                        datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                    )
                    updates[key] = {
                        "old_factor": old_factor,
                        "new_factor": round(new_factor, 4),
                        "sample_size": n,
                        "avg_predicted": round(avg_predicted, 4),
                        "avg_actual": round(avg_actual, 4),
                    }
                    print(f"[Calibration] 📊 {key}: {old_factor:.3f} -> {new_factor:.3f} (n={n}, predicted={avg_predicted:.3f}, actual={avg_actual:.3f})")

    return {
        "status": "success",
        "markets_updated": len(updates),
        "details": updates,
    }