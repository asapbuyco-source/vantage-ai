"""
ev_engine.py
─────────────
Expected Value engine + market inefficiency detection.

EV = (model_probability × decimal_odds) − 1
Flag a bet if:
  EV ≥ 0.05  (5% minimum edge)
  model_prob - devigged_market_prob ≥ 0.06  (6% inefficiency)

Vig removal: We use the standard devig formula across the 1X2 market
  p_devig(outcome) = (1/odds) / sum(1/all_market_odds)
This removes the bookmaker's overround before comparing to model probability,
preventing the system from overstating its edge by 5-8%.
"""

import os
import math
from dataclasses import dataclass
from typing import Optional
from calibration_registry import get_calibration_factor, get_calibration_tier, FRAGILE_MARKETS, CALIBRATION_VERSION, get_dynamic_calibration_factor
from probability_engine import CombinedProbabilities
from data_pipeline import OddsData


# ── Constants ─────────────────────────────────────────────────────────────────
MIN_EV = 0.05           # 5% minimum expected value
MIN_INEFFICIENCY = 0.06  # Default 6% model vs market gap (used for goals/BTTS)

# BetPawa / local bookmaker margin adjustment.
# Bet365 (what API-Football returns) typically has 2-4% margin.
# BetPawa and other African bookmakers have 5-8% margin.
# Set BOOKMAKER_MARGIN env var to 0.06 for BetPawa (6% discount).
# EV calculation: (prob * (odds * (1 - margin))) - 1
BOOKMAKER_MARGIN = float(os.environ.get("BOOKMAKER_MARGIN", "0.0"))

# Market-aware inefficiency: bookmakers price 1X2 very tightly (1-2% margin),
# so requiring 6%+ gap blocks almost all 1X2 bets. Lower threshold for result markets.
# FIX #6: Raised "result" from 0.03 to 0.04 to match risk_filters.MIN_INEFFICIENCY=0.04.
# Previously, bets with 3.x% inefficiency were flagged is_value=True here but then
# silently rejected by risk_filters — producing confusing phantom value bets.
MARKET_INEFFICIENCY = {
    "result": 0.04,      # 4% for Home Win, Away Win, Draw, DC, DNB (aligned with risk_filters)
    "goals": 0.05,       # 5% for Over/Under goals
    "btts": 0.05,        # 5% for BTTS Yes/No
}

# Legacy map: ev_engine uses display names; registry uses internal keys.
# Normalise here so get_calibration_factor gets the right key.
_MARKET_KEY_MAP = {
    "Away Win": "away_win",
    "Draw": "draw",
    "BTTS No": "btts_no",
    "Over 3.5 Goals": "over35",
    "Under 2.5 Goals": "under25",
    "Under 3.5 Goals": "under35",
    "BTTS": "btts",
    "Over 2.5 Goals": "over25",
    "Home Win": "home_win",
    "Draw No Bet (Away)": "Draw No Bet (Away)",
    "AH Away +0.5": "AH Away +0.5",
    "Double Chance (X2)": "Double Chance (X2)",
}


def _market_to_key(market: str) -> str:
    return _MARKET_KEY_MAP.get(market, market.lower().replace(" ", "_").replace("-", "_"))


def calibrate_market_probability(
    raw_prob: float,
    market: str,
    league_id: int | None = None,
    month: int | None = None,
) -> tuple[float, float, str]:
    """Return calibrated probability, factor, and trust tier for auditability."""
    key = _market_to_key(market)
    factor = get_dynamic_calibration_factor(key, 0.97, league_id, month)
    calibrated = max(0.01, min(0.99, raw_prob * factor))
    tier = get_calibration_tier(key)
    return calibrated, factor, tier

def _get_market_category(market: str) -> str:
    """Classify a market into a category for threshold selection."""
    m = market.lower()
    if any(k in m for k in ["home win", "away win", "draw", "double chance", "draw no bet"]):
        return "result"
    if any(k in m for k in ["over", "under"]):
        return "goals"
    if "btts" in m:
        return "btts"
    return "goals"  # Default to stricter threshold


# ── Market → probability mapping ───────────────────────────────────────────────
MARKET_TO_PROB = {
    "Home Win": "home_win",
    "Away Win": "away_win",
    "Draw": "draw",
    "Double Chance (1X)": "double_chance_1x",
    "Double Chance (X2)": "double_chance_x2",
    "Double Chance (12)": "double_chance_12",
    "Draw No Bet (Home)": "draw_no_bet_home",
    "Draw No Bet (Away)": "draw_no_bet_away",
    # OPP-02: AH -0.5 maps to same probability as Draw No Bet (often better odds)
    "AH Home -0.5": "draw_no_bet_home",
    "AH Away +0.5": "draw_no_bet_away",
    "Over 1.5 Goals": "over15",
    "Under 1.5 Goals": "under15",   # ISSUE-02: was missing — profitable defensive market
    "Over 2.5 Goals": "over25",
    "Under 2.5 Goals": "under25",
    "Over 3.5 Goals": "over35",
    "Under 3.5 Goals": "under35",
    "BTTS": "btts",
    "BTTS No": "btts_no",
    # OPP-01: BTTS + Over 2.5 composite — bookmakers price this inefficiently
    "BTTS + Over 2.5": "btts_and_over25",
    # First Half markets
    "Over 0.5 FH Goals": "fh_over05",
    "Over 1.5 FH Goals": "fh_over15",
    "BTTS FH": "fh_btts",
    "1H Home Win": "fh_home_win",
    "1H Draw": "fh_draw",
    "1H Away Win": "fh_away_win",
    # Over/Under 0.5 & 4.5 Goals (extreme goal lines)
    "Over 0.5 Goals": "over05",
    "Under 0.5 Goals": "under05",
    "Over 4.5 Goals": "over45",
    "Under 4.5 Goals": "under45",
    # Corner markets
    "Over 8.5 Corners": "over85_corners",
    "Over 9.5 Corners": "over95_corners",
}

# Market → odds field in OddsData
MARKET_TO_ODDS_FIELD = {
    "Home Win": "home_odds",
    "Away Win": "away_odds",
    "Draw": "draw_odds",
    "Double Chance (1X)": "dc_1x_odds",
    "Double Chance (X2)": "dc_x2_odds",
    "Double Chance (12)": "dc_12_odds",
    "Draw No Bet (Home)": "dnb_home_odds",
    "Draw No Bet (Away)": "dnb_away_odds",
    # OPP-02: AH -0.5 collected in OddsData — wire it to EV evaluation
    "AH Home -0.5": "ah_home_minus05",
    "AH Away +0.5": "ah_away_plus05",
    "Over 1.5 Goals": "over15_odds",
    "Under 1.5 Goals": "under15_odds",
    "Over 2.5 Goals": "over25_odds",
    "Under 2.5 Goals": "under25_odds",   # FIX Bug 3: was missing — market was silently skipped
    "Over 3.5 Goals": "over35_odds",
    "Under 3.5 Goals": "under35_odds",
    "BTTS": "btts_yes_odds",
    "BTTS No": "btts_no_odds",
    # OPP-01: BTTS + Over 2.5 composite odds field (computed in data_pipeline)
    "BTTS + Over 2.5": "btts_and_over25_odds",
    # First Half odds
    "Over 0.5 FH Goals": "fh_over05_odds",
    "Over 1.5 FH Goals": "fh_over15_odds",
    "BTTS FH": "fh_btts_odds",
    "1H Home Win": "fh_home_odds",
    "1H Draw": "fh_draw_odds",
    "1H Away Win": "fh_away_odds",
    # Corner odds
    "Over 8.5 Corners": "corners_over85_odds",
    "Over 9.5 Corners": "corners_over95_odds",
}


@dataclass
class ValueBet:
    market: str
    bet_label: str          # Human-readable e.g. "Home Win"
    model_prob: float       # Our model's probability
    market_prob: float      # Implied by bookmaker odds
    odds: float             # Decimal odds
    expected_value: float   # EV (positive = value)
    inefficiency: float     # model_prob - market_prob
    is_value: bool          # Passes all filters
    raw_model_prob: float = 0.0
    calibration_factor: float = 1.0
    calibration_tier: str = "stable"


def devig_1x2(home_odds: float, draw_odds: float, away_odds: float) -> tuple[float, float, float]:
    """
    Remove the bookmaker's vig from 1X2 odds using the Power (Logarithmic) method.
    This naturally shifts more margin onto longshots, correctly modelling 
    the bookmaker's favorite-longshot bias.
    """
    if home_odds <= 1.0 or draw_odds <= 1.0 or away_odds <= 1.0:
        # Fallback: raw implied probs
        raw = [1/o if o > 1 else 0 for o in [home_odds, draw_odds, away_odds]]
        total = sum(raw) or 1.0
        return tuple(r / total for r in raw)  # type: ignore
        
    implied = [1/home_odds, 1/draw_odds, 1/away_odds]
    overround = sum(implied)
    
    if overround <= 1.001:
        return tuple(implied)

    # Binary search to find power 'k' where sum(implied^k) = 1.0
    low, high = 0.0, 2.0
    for _ in range(20):
        k = (low + high) / 2.0
        if sum(math.pow(p, k) for p in implied) > 1.0:
            low = k
        else:
            high = k
            
    k = (low + high) / 2.0
    return math.pow(implied[0], k), math.pow(implied[1], k), math.pow(implied[2], k)


def devig_outright(odds: float, market_odds: list[float]) -> float:
    """
    Remove vig for any market using the Power method.
    """
    valid = [o for o in market_odds if o > 1.0]
    if not valid:
        return 1.0 / odds if odds > 1.0 else 0.0
        
    implied = [1/o for o in valid]
    overround = sum(implied)
    
    if overround <= 1.001:
        return 1.0 / odds
        
    low, high = 0.0, 2.0
    for _ in range(20):
        k = (low + high) / 2.0
        if sum(math.pow(p, k) for p in implied) > 1.0:
            low = k
        else:
            high = k
            
    k = (low + high) / 2.0
    return math.pow(1/odds, k)


def implied_prob(odds: float) -> float:
    """Raw implied probability (with vig, used as fallback only)."""
    if odds <= 1.0:
        return 1.0
    return 1.0 / odds


def compute_ev(model_prob: float, odds: float) -> float:
    """EV = (prob × odds) − 1"""
    return (model_prob * odds) - 1.0


# Markets that STILL require dedicated odds (if odds field is 0, skip them)
# Now much smaller since we fetch DC, DNB, O/U 1.5/3.5 directly
DEDICATED_ODDS_MARKETS = set()  # All markets now have dedicated odds fields


def compute_line_movement(odds: 'OddsData') -> dict:
    """
    Compute line movement signals from opening vs current odds.
    Returns a dict with movement direction and magnitude for 1X2 markets.
    Positive shift = market moved in favour of that outcome (sharps agree).
    """
    signals = {}
    pairs = [
        ("Home Win",  odds.opening_home_odds, odds.home_odds),
        ("Draw",      odds.opening_draw_odds, odds.draw_odds),
        ("Away Win",  odds.opening_away_odds, odds.away_odds),
    ]
    for market, opening, current in pairs:
        if opening > 1.0 and current > 1.0:
            # Implied probability shift
            open_impl = 1.0 / opening
            curr_impl = 1.0 / current
            shift = curr_impl - open_impl  # positive = odds shortened = sharps backing this
            signals[market] = round(shift, 4)
    return signals


def evaluate_all_markets(
    probs: 'CombinedProbabilities',
    odds: 'OddsData',
    league_id: int | None = None,
    month: int | None = None,
) -> list[ValueBet]:
    """
    Evaluate all available markets and return all ValueBet objects.
    Uses devigged implied probabilities for market comparison.
    Skips DC/DNB markets unless dedicated odds are available.

    Args:
        probs: CombinedProbabilities from the model
        odds: OddsData with current bookmaker odds
        league_id: Optional league ID for league-aware calibration
        month: Optional month (1-12) for season-phase calibration
    """
    results: list[ValueBet] = []

    # Compute devigged 1X2 probs once
    home_dv, draw_dv, away_dv = devig_1x2(
        odds.home_odds, odds.draw_odds, odds.away_odds
    ) if (odds.home_odds > 1.0 and odds.draw_odds > 1.0 and odds.away_odds > 1.0) else (0.0, 0.0, 0.0)

    # Compute line movement signals (Upgrade #3)
    line_signals = compute_line_movement(odds)

    # Build per-market devigged probabilities
    market_devig: dict[str, float] = {}
    if odds.home_odds > 1.0:
        market_devig["Home Win"] = home_dv
        market_devig["Draw"] = draw_dv
        market_devig["Away Win"] = away_dv
    # Double Chance devig
    if odds.dc_1x_odds > 1.0 and odds.dc_x2_odds > 1.0 and odds.dc_12_odds > 1.0:
        dc_total = (1/odds.dc_1x_odds) + (1/odds.dc_x2_odds) + (1/odds.dc_12_odds)
        market_devig["Double Chance (1X)"] = (1/odds.dc_1x_odds) / dc_total
        market_devig["Double Chance (X2)"] = (1/odds.dc_x2_odds) / dc_total
        market_devig["Double Chance (12)"] = (1/odds.dc_12_odds) / dc_total
    # Draw No Bet devig
    if odds.dnb_home_odds > 1.0 and odds.dnb_away_odds > 1.0:
        dnb_total = (1/odds.dnb_home_odds) + (1/odds.dnb_away_odds)
        market_devig["Draw No Bet (Home)"] = (1/odds.dnb_home_odds) / dnb_total
        market_devig["Draw No Bet (Away)"] = (1/odds.dnb_away_odds) / dnb_total
    # Over/Under 1.5
    if odds.over15_odds > 1.0 and odds.under15_odds > 1.0:
        market_devig["Over 1.5 Goals"] = devig_outright(odds.over15_odds, [odds.over15_odds, odds.under15_odds])
        market_devig["Under 1.5 Goals"] = devig_outright(odds.under15_odds, [odds.over15_odds, odds.under15_odds])
    # Over/Under 2.5
    if odds.over25_odds > 1.0 and odds.under25_odds > 1.0:
        ov_dv = devig_outright(odds.over25_odds, [odds.over25_odds, odds.under25_odds])
        un_dv = devig_outright(odds.under25_odds, [odds.over25_odds, odds.under25_odds])
        market_devig["Over 2.5 Goals"] = ov_dv
        market_devig["Under 2.5 Goals"] = un_dv
    # Over/Under 3.5
    if odds.over35_odds > 1.0 and odds.under35_odds > 1.0:
        market_devig["Over 3.5 Goals"] = devig_outright(odds.over35_odds, [odds.over35_odds, odds.under35_odds])
        market_devig["Under 3.5 Goals"] = devig_outright(odds.under35_odds, [odds.over35_odds, odds.under35_odds])
    # BTTS
    if odds.btts_yes_odds > 1.0 and odds.btts_no_odds > 1.0:
        market_devig["BTTS"] = devig_outright(odds.btts_yes_odds, [odds.btts_yes_odds, odds.btts_no_odds])
        market_devig["BTTS No"] = devig_outright(odds.btts_no_odds, [odds.btts_yes_odds, odds.btts_no_odds])

    for market, prob_attr in MARKET_TO_PROB.items():
        raw_model_prob = getattr(probs, prob_attr, None)
        if raw_model_prob is None:
            continue
        model_prob, calibration_factor, calibration_tier = calibrate_market_probability(raw_model_prob, market, league_id, month)

        odds_attr = MARKET_TO_ODDS_FIELD.get(market, "")
        market_odds = getattr(odds, odds_attr, 0.0) if odds_attr else 0.0
        if market_odds <= 1.05:
            continue

        if market_odds <= 1.05:
            continue

        # Use devigged market probability (preferred) falling back to raw implied
        mkt_prob = market_devig.get(market, implied_prob(market_odds))
        
        # Apply bookmaker margin adjustment (BetPawa ~6% below Bet365)
        adjusted_odds = market_odds * (1.0 - BOOKMAKER_MARGIN)
        ev = compute_ev(model_prob, adjusted_odds)
        inefficiency = model_prob - mkt_prob

        # Line movement bonus/penalty (Upgrade #3)
        # If sharps moved the line in our direction, boost confidence
        line_shift = line_signals.get(market, 0.0)
        line_agrees = line_shift > 0.02  # Sharp money backs our pick
        line_disagrees = line_shift < -0.03  # Sharp money opposes our pick

        is_value = (ev >= MIN_EV) and (inefficiency >= MARKET_INEFFICIENCY.get(_get_market_category(market), MIN_INEFFICIENCY))

        # If line strongly disagrees (-3%+ shift against us), demote
        if line_disagrees and is_value:
            is_value = ev >= MIN_EV * 1.5  # Require 50% more EV to override sharp signal

        # STEP 2: Market Filtering (Drop underperforming markets)
        if market in ["Home Win", "Away Win", "Draw", "Double Chance (X2)"]:
            continue  # Disabled: 1X2 = -40% ROI, DC X2 = 38% win rate

        # STEP 1: Cap EV at 10% to prevent wild overconfidence
        capped_ev = min(ev, 0.10)

        results.append(ValueBet(
            market=market,
            bet_label=market,
            model_prob=round(model_prob, 4),
            market_prob=round(mkt_prob, 4),
            odds=round(adjusted_odds, 2),
            expected_value=round(capped_ev, 4),
            inefficiency=round(inefficiency, 4),
            is_value=is_value,
            raw_model_prob=round(raw_model_prob, 4),
            calibration_factor=round(calibration_factor, 4),
            calibration_tier=calibration_tier,
        ))

    results.sort(key=lambda x: x.expected_value, reverse=True)
    return results


def get_best_value_bet(
    probs: CombinedProbabilities,
    odds: OddsData,
) -> Optional[ValueBet]:
    """
    Return the single best value bet (highest EV that passes all filters).
    Returns None if no value found.
    """
    all_bets = evaluate_all_markets(probs, odds)
    for bet in all_bets:
        if bet.is_value:
            return bet
    return None


if __name__ == "__main__":
    from data_pipeline import OddsData
    from probability_engine import CombinedProbabilities

    # Mock test
    probs = CombinedProbabilities(
        home_win=0.63, draw=0.22, away_win=0.15,
        over25=0.60, under25=0.40, btts=0.55, btts_no=0.45,
        double_chance_1x=0.85, double_chance_x2=0.37, double_chance_12=0.78,
        draw_no_bet_home=0.71, draw_no_bet_away=0.29,
    )
    odds = OddsData(home_odds=1.85, draw_odds=3.60, away_odds=5.00,
                    over25_odds=1.90, under25_odds=1.95,
                    btts_yes_odds=1.85, btts_no_odds=1.95)

    bet = get_best_value_bet(probs, odds)
    if bet:
        print(f"Best bet: {bet.market} | Model: {bet.model_prob:.1%} | Market: {bet.market_prob:.1%} | EV: {bet.expected_value:.1%} | Odds: {bet.odds}")
    else:
        print("No value bet found.")
