"""
risk_filters.py
───────────────
Strict bet risk filters. A bet must pass ALL conditions to be accepted.

Reject if:
  probability < 0.40  (40% confidence floor, tiered by league)
  EV < 0.05           (5% minimum edge)
  odds > 3.50         (excessive odds)
  odds < 1.30         (too short, poor risk/reward)

Upgrade #8: Odds staleness guard — demotes bets with stale odds.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from ev_engine import ValueBet


# ── Filter thresholds ──────────────────────────────────────────────────────────
MIN_PROBABILITY = 0.40     # Lowered from 0.55 — let EV/inefficiency filters guard quality
MIN_EV = 0.05              # Minimum expected value (5%)
MAX_EV = 0.15              # Defense-in-depth: reject wildly overconfident EV estimates (>15%)
MAX_ODDS = 3.50            # Reject high-risk outliers
MIN_ODDS = 1.40            # P4: Raised from 1.30 — 9 picks below 1.40 had avg 18.9% EV
MIN_INEFFICIENCY = 0.04    # Model must differ from market by at least 4%

# League volatility tiers — less predictable leagues get stricter thresholds
# Derived from backtesting: tier 4+ leagues have 2-3x higher variance in outcomes
LEAGUE_VOLATILITY_MODIFIER = {
    1: 1.0,    # Elite leagues (EPL, La Liga, UCL) — baseline
    2: 1.0,    # Strong leagues (Ligue 1, Eredivisie)
    3: 1.15,   # Secondary (MLS, Brasileirão, Süper Lig) — 15% stricter
    4: 1.30,   # Lower tier (League 1/2, Serie B) — 30% stricter
    5: 1.50,   # Emerging/African leagues — 50% stricter
}


@dataclass
class FilterResult:
    passed: bool
    reason: str | None = None  # Why it failed (if it did)


def apply_filters(bet: ValueBet, league_tier: int = 1) -> FilterResult:
    """
    Run all risk filters on a single ValueBet, with thresholds
    adjusting based on the league tier (safety first) and league volatility.
    """
    # ── League volatility modifier ──────────────────────────────────────────
    vol_mult = LEAGUE_VOLATILITY_MODIFIER.get(league_tier, 1.0)

    # ── Tier-based dynamic thresholds ──────────────────────────────────────────
    t_min_prob = MIN_PROBABILITY * vol_mult
    t_min_ev = MIN_EV * vol_mult
    t_max_ev = MAX_EV / vol_mult  # Stricter cap for volatile leagues

    if league_tier == 3:
        t_min_prob = max(t_min_prob, 0.45)
        t_min_ev = max(t_min_ev, 0.06)
    elif league_tier >= 4:
        t_min_prob = max(t_min_prob, 0.50)
        t_min_ev = max(t_min_ev, 0.08)

    # ── Logic ──────────────────────────────────────────────────────────────────
    if bet.odds < MIN_ODDS:
        return FilterResult(False, f"Odds too low ({bet.odds:.2f} < {MIN_ODDS})")

    if bet.odds > MAX_ODDS:
        return FilterResult(False, f"Odds too high ({bet.odds:.2f} > {MAX_ODDS})")

    if bet.model_prob < t_min_prob:
        return FilterResult(False, f"Probability too low for Tier {league_tier} ({bet.model_prob:.1%} < {t_min_prob:.0%})")

    if bet.expected_value < t_min_ev:
        return FilterResult(False, f"EV too low for Tier {league_tier} ({bet.expected_value:.1%} < {t_min_ev:.0%})")

    if bet.expected_value > t_max_ev:
        return FilterResult(False, f"EV suspiciously high ({bet.expected_value:.1%} > {t_max_ev:.0%}) — likely mispricing or model error")

    if bet.inefficiency < MIN_INEFFICIENCY:
        return FilterResult(False, f"Market inefficiency too small ({bet.inefficiency:.1%} < {MIN_INEFFICIENCY:.0%})")

    # ── Sanity cap for defensive markets (prevents data-quality inflation) ──────
    # No real football match should have ≥88% model confidence for BTTS No or Under 3.5.
    # If we see this, it means xG data is unreliable (e.g., form fetch returned 0 goals).
    m = bet.market.lower()
    is_defensive = "btts no" in m or "under 3.5" in m or "under 2.5" in m
    if is_defensive and bet.model_prob >= 0.88:
        return FilterResult(False, f"Defensive market probability suspiciously high ({bet.model_prob:.1%}) — likely data quality issue, skipping.")

    return FilterResult(True)


def check_odds_staleness(odds_fetched_at: str, max_hours: float = 2.0) -> float:
    """
    Upgrade #8: Check if odds are stale.
    Returns a Kelly multiplier:
      1.0  = fresh odds (< max_hours old)
      0.5  = stale odds (> max_hours old)
      0.25 = very stale odds (> 2x max_hours old)
    """
    if not odds_fetched_at:
        return 0.75  # No timestamp = assume mildly stale
    try:
        fetched = datetime.fromisoformat(odds_fetched_at.replace("Z", "+00:00"))
        age_hours = (datetime.now(timezone.utc) - fetched).total_seconds() / 3600
        if age_hours > max_hours * 2:
            return 0.25  # Very stale
        elif age_hours > max_hours:
            return 0.5   # Stale
        return 1.0       # Fresh
    except Exception:
        return 0.75  # Parse error = assume mildly stale


def odds_age_minutes(odds_fetched_at: str) -> float | None:
    """Return odds age in minutes, or None if the timestamp is missing/invalid."""
    if not odds_fetched_at:
        return None
    try:
        fetched = datetime.fromisoformat(odds_fetched_at.replace("Z", "+00:00"))
        return max(0.0, (datetime.now(timezone.utc) - fetched).total_seconds() / 60)
    except Exception:
        return None


def is_odds_fresh_for_vault(odds_fetched_at: str, max_minutes: float = 75.0) -> bool:
    """Vault staking requires a real, fresh odds timestamp."""
    age = odds_age_minutes(odds_fetched_at)
    return age is not None and age <= max_minutes


def filter_bets(bets: list[ValueBet], league_tier: int = 1) -> list[ValueBet]:
    """
    Filter a list of bets.
    Returns only those that pass all risk filters, sorted by a confidence-weighted
    composite score (not just raw EV) to prefer high-agreement, high-quality picks.

    Score = EV * 0.4 + model_prob * 0.4 + inefficiency * 0.2
    This prevents low-probability defensive markets from always dominating.
    """
    passed = []
    for bet in bets:
        result = apply_filters(bet, league_tier)
        if result.passed:
            passed.append(bet)

    # Sort by safety tier first, then composite quality score
    # This ensures "safe" bets always outrank "risky" ones — critical for financial integrity
    tier_priority = {"safe": 2, "value": 1, "risky": 0}

    # P3: Market ROI bonus — boost high-ROI markets slightly so they get into top 7
    # when they're close to the cutoff. Derived from 30-day backtest.
    # Home/Away Win removed — 1X2 markets suppressed due to -43% ROI.
    MARKET_BONUS = {
        "Under 1.5 Goals": 1.18,   # 73% ROI — most profitable market, significantly under-allocated
        "Over 1.5 Goals": 1.30,    # Boosted from 1.15 — 84% hit rate confirmed, vault anchor
        "Under 3.5 Goals": 1.10,   # 41% ROI but small sample
        "BTTS": 1.05,              # 50% hit rate, +2.2% ROI — consistent edge
        "Over 2.5 Goals": 1.02,    # baseline — already dominant (40% of picks)
        "BTTS No": 1.02,           # 25% ROI but reliable, small boost
    }

    def _quality_score(b: ValueBet) -> float:
        tier = tier_priority.get(grade_risk(b), 0)
        composite = b.expected_value * 0.4 + b.model_prob * 0.4 + b.inefficiency * 0.2
        bonus = MARKET_BONUS.get(b.market, 1.0)
        return tier + composite * bonus  # Tier dominates (2/1/0), composite breaks ties

    return sorted(passed, key=_quality_score, reverse=True)


def grade_risk(bet: ValueBet) -> str:
    """
    Map a bet to a display category, market-aware.
    
    Result markets (1X2/DC/DNB): these rarely exceed 60% model prob
      safe  → ≥ 55% and EV ≥ 6%
      value → ≥ 45% and EV ≥ 5%
      risky → below these thresholds
    
    Goals/BTTS markets: higher certainty is possible
      safe  → ≥ 65% and EV ≥ 8%
      value → ≥ 55% and EV ≥ 5%
      risky → below these thresholds
    """
    m = bet.market.lower()
    is_result = any(k in m for k in ["home win", "away win", "draw", "double chance", "draw no bet"])
    
    if is_result:
        if bet.model_prob >= 0.55 and bet.expected_value >= 0.06:
            return "safe"
        if bet.model_prob >= 0.45 and bet.expected_value >= 0.05:
            return "value"
    else:
        if bet.model_prob >= 0.65 and bet.expected_value >= 0.08:
            return "safe"
        if bet.model_prob >= 0.55 and bet.expected_value >= 0.05:
            return "value"
    return "risky"


def check_btts_blanking_risk(pred: dict) -> tuple[bool, str]:
    """Check if BTTS bet is at risk of one team blanking."""
    market = (pred.get("bet_type") or "").lower()
    if "btts" not in market or "no" in market:
        return False, ""
    
    home_avg_scored = float(pred.get("home_avg_scored", 0) or 0)
    away_avg_scored = float(pred.get("away_avg_scored", 0) or 0)
    
    reasons = []
    if home_avg_scored < 0.8:
        reasons.append(f"{pred.get('home_team', 'Home')} avg {home_avg_scored:.1f} goals")
    if away_avg_scored < 0.8:
        reasons.append(f"{pred.get('away_team', 'Away')} avg {away_avg_scored:.1f} goals")
    
    if reasons:
        return True, f"BTTS blanking risk: {', '.join(reasons)}"
    return False, ""


if __name__ == "__main__":
    from ev_engine import ValueBet
    sample = [
        ValueBet("Home Win", "Home Win", 0.63, 0.54, 1.85, 0.166, 0.09, True),
        ValueBet("Away Win", "Away Win", 0.50, 0.42, 2.40, 0.20, 0.08, True),
        ValueBet("Draw", "Draw", 0.22, 0.28, 3.60, -0.21, -0.06, False),
    ]
    approved = filter_bets(sample)
    print(f"Approved: {len(approved)}")
    for b in approved:
        print(f"  {b.market}: {b.model_prob:.1%} prob | EV {b.expected_value:.1%} | {grade_risk(b)}")
