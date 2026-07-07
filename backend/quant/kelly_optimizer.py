"""
kelly_optimizer.py

Kelly Criterion optimal stake calculator.

f* = (b * p - q) / b
where:
  b = net odds (decimal odds - 1)
  p = probability of winning
  q = probability of losing (1 - p)

A fractional Kelly (12.5%, 1/8th) is used to be conservative.
Default stake is capped at 2% of bankroll, with stricter caps for fragile markets.
"""

KELLY_FRACTION = 0.125  # Reduced from 0.25 to 1/8th Kelly
MAX_STAKE_PCT = 0.02    # Capped at 2% instead of 3%
FRAGILE_MARKET_MAX_STAKE_PCT = 0.01
WATCH_MARKET_MAX_STAKE_PCT = 0.015
MIN_STAKE_PCT = 0.005


def market_max_stake_pct(market: str = "", calibration_tier: str = "stable") -> float:
    """Return the bankroll cap for a market after calibration."""
    tier = (calibration_tier or "stable").lower()
    if tier == "fragile":
        return FRAGILE_MARKET_MAX_STAKE_PCT
    if tier == "watch":
        return WATCH_MARKET_MAX_STAKE_PCT

    m = (market or "").lower()
    if any(k in m for k in ["away win", "draw", "btts no", "over 3.5"]):
        return FRAGILE_MARKET_MAX_STAKE_PCT
    if any(k in m for k in ["under 2.5", "under 3.5", "double chance (x2)", "draw no bet (away)"]):
        return WATCH_MARKET_MAX_STAKE_PCT
    return MAX_STAKE_PCT


def kelly_stake(
    probability: float,
    decimal_odds: float,
    fraction: float = KELLY_FRACTION,
    max_stake_pct: float = MAX_STAKE_PCT,
) -> float:
    """
    Compute optimal stake as a fraction of bankroll.

    Returns 0.0 if Kelly is negative, and caps positive stakes by market risk.
    """
    if decimal_odds <= 1.0 or probability <= 0 or probability >= 1:
        return 0.0

    b = decimal_odds - 1.0
    p = probability
    q = 1.0 - p

    full_kelly = (b * p - q) / b
    if full_kelly <= 0:
        return 0.0

    frac_kelly = full_kelly * fraction
    return round(min(max_stake_pct, frac_kelly), 4)


def kelly_stake_pct(
    probability: float,
    decimal_odds: float,
    market: str = "",
    calibration_tier: str = "stable",
) -> float:
    """Return stake as a percentage value on a 0-100 scale."""
    max_pct = market_max_stake_pct(market, calibration_tier)
    return round(kelly_stake(probability, decimal_odds, max_stake_pct=max_pct) * 100, 2)


def recommended_stake_amount(
    probability: float,
    decimal_odds: float,
    bankroll: float,
    market: str = "",
    calibration_tier: str = "stable",
) -> dict:
    """Return full stake recommendation with amounts."""
    max_pct = market_max_stake_pct(market, calibration_tier)
    pct = kelly_stake(probability, decimal_odds, max_stake_pct=max_pct)
    amount = bankroll * pct
    profit = amount * (decimal_odds - 1.0)
    total_return = amount * decimal_odds

    return {
        "stake_pct": round(pct * 100, 2),
        "stake_amount": round(amount, 2),
        "potential_profit": round(profit, 2),
        "potential_return": round(total_return, 2),
        "max_stake_pct": round(max_pct * 100, 2),
    }


if __name__ == "__main__":
    prob = 0.63
    odds = 1.85
    pct = kelly_stake_pct(prob, odds, market="Home Win", calibration_tier="stable")
    print(f"Kelly stake: {pct:.2f}%")
    reco = recommended_stake_amount(prob, odds, 10000, market="Home Win", calibration_tier="stable")
    print(
        "On NGN 10,000 bankroll: "
        f"Stake NGN {reco['stake_amount']:.2f} -> "
        f"Potential profit NGN {reco['potential_profit']:.2f}"
    )
