"""
poisson_model.py
────────────────
Poisson goal model.
Given expected goals (mu_home, mu_away), computes a full score-grid (0-5 x 0-5),
then derives probabilities for all key markets.
"""

import math
from dataclasses import dataclass


# ── Score grid config ─────────────────────────────────────────────────────────
MAX_GOALS = 12         # Fix #7: raised from 8 — correctly prices Over 3.5 in high-scoring fixtures
MAX_XG_CAP = 4.5      # Cap extreme xG values to prevent Poisson truncation issues
DIXON_COLES_RHO = -0.13  # Default rho for low-score bias correction


def compute_dynamic_rho(mu_home: float, mu_away: float, league_tier: int = 1, is_derby: bool = False) -> float:
    """
    Upgrade #5: Compute context-dependent Dixon-Coles rho.
    - Derby/rivalry matches: stronger correction (more 0-0s and 1-1s)
    - High-scoring expected matches: weaker correction (goals flow freely)
    - Top vs bottom mismatches: weaker correction (blowouts)

    FIX #1: rho is now floored so tau(1,0) = 1 + mu_away*rho >= 0
    and tau(0,1) = 1 + mu_home*rho >= 0, preventing negative Poisson cells.
    """
    rho = DIXON_COLES_RHO  # Start with default -0.13

    # Derby adjustment: more extreme low-score correlation
    if is_derby:
        rho = -0.20

    # High xG matches: goals flow freely, less correction
    total_xg = mu_home + mu_away
    if total_xg > 3.5:
        rho *= 0.6
    elif total_xg < 1.5:
        rho *= 1.3

    # Mismatch: one-sided matches have less score correlation
    xg_ratio = max(mu_home, mu_away) / max(min(mu_home, mu_away), 0.3)
    if xg_ratio > 2.5:
        rho *= 0.7

    # FIX #1: ensure tau(1,0)=1+mu_away*rho>=0 and tau(0,1)=1+mu_home*rho>=0
    # => rho >= -1/max(mu_home, mu_away)  (add 0.001 margin above singularity)
    max_mu = max(mu_home, mu_away, 0.01)
    rho_floor = -1.0 / max_mu + 0.001
    rho = max(rho_floor, rho)

    return max(-0.30, min(-0.05, rho))


@dataclass
class MarketProbabilities:
    """All market probabilities derived from the Poisson score grid."""
    home_win: float = 0.0
    draw: float = 0.0
    away_win: float = 0.0
    over15: float = 0.0
    under15: float = 0.0
    over25: float = 0.0
    under25: float = 0.0
    over35: float = 0.0
    under35: float = 0.0
    btts: float = 0.0
    btts_no: float = 0.0
    btts_and_over25: float = 0.0
    double_chance_1x: float = 0.0   # Home or Draw
    double_chance_x2: float = 0.0   # Away or Draw
    double_chance_12: float = 0.0   # Home or Away (no draw)
    draw_no_bet_home: float = 0.0   # Home win (excluding draws)
    draw_no_bet_away: float = 0.0   # Away win (excluding draws)
    under05: float = 0.0            # P(0 goals)
    under45: float = 0.0            # P(≤4 goals)
    score_grid: dict | None = None  # Optional: full {(h,a): prob}


def _poisson_pmf(k: int, mu: float) -> float:
    """P(X=k) for Poisson distribution with mean mu."""
    if mu <= 0:
        return 1.0 if k == 0 else 0.0
    return (mu ** k) * math.exp(-mu) / math.factorial(k)


def _tau(h: int, a: int, mu_h: float, mu_a: float, rho: float) -> float:
    """
    Dixon-Coles correction factor tau for low-scoring scorelines.
    Only applied to scores (0,0), (1,0), (0,1), (1,1).
    rho < 0 means these 4 scorelines get adjusted (0-0 and 1-1 boosted,
    1-0 and 0-1 reduced) to match empirical football distributions.

    FIX #1: All branches are clamped to 0.0 — tau must never be negative.
    A negative tau would produce a negative cell probability which corrupts
    every downstream market calculation.
    """
    if h == 0 and a == 0:
        val = 1 - mu_h * mu_a * rho
    elif h == 1 and a == 0:
        val = 1 + mu_a * rho
    elif h == 0 and a == 1:
        val = 1 + mu_h * rho
    elif h == 1 and a == 1:
        val = 1 - rho
    else:
        return 1.0
    return max(0.0, val)  # tau must never be negative


def compute_score_grid(mu_home: float, mu_away: float, rho: float | None = None) -> dict[tuple[int, int], float]:
    """
    Build a (MAX_GOALS+1 x MAX_GOALS+1) dictionary of score probabilities
    with Dixon-Coles rho correction applied to the four low-score cells.
    Key: (home_goals, away_goals), Value: corrected probability.
    Grid is re-normalized so all probabilities sum to 1.0.

    MODEL-04: Warns when truncation at MAX_GOALS exceeds 1% of total mass,
    which can distort Over 3.5+ markets in high-scoring fixtures.
    """
    import sys
    if rho is None:
        rho = DIXON_COLES_RHO
    # Apply xG cap to prevent Poisson truncation issues for high-scoring fixtures
    mu_home = min(mu_home, MAX_XG_CAP)
    mu_away = min(mu_away, MAX_XG_CAP)
    grid: dict[tuple[int, int], float] = {}
    for h in range(MAX_GOALS + 1):
        for a in range(MAX_GOALS + 1):
            raw = _poisson_pmf(h, mu_home) * _poisson_pmf(a, mu_away)
            correction = _tau(h, a, mu_home, mu_away, rho)
            grid[(h, a)] = raw * correction

    # MODEL-04: Estimate truncated mass before normalisation
    raw_total = sum(_poisson_pmf(h, mu_home) * _poisson_pmf(a, mu_away)
                    for h in range(MAX_GOALS + 1) for a in range(MAX_GOALS + 1))
    truncated = 1.0 - raw_total
    if truncated > 0.01:
        print(
            f"[Poisson] WARNING: {truncated:.1%} probability mass truncated "
            f"(mu_home={mu_home:.2f}, mu_away={mu_away:.2f}). "
            f"Consider raising MAX_GOALS above {MAX_GOALS}.",
            file=sys.stderr,
        )

    # Re-normalize to handle the correction disturbing the sum
    total = sum(grid.values())
    if total > 0:
        grid = {k: v / total for k, v in grid.items()}
    return grid


def derive_markets(grid: dict[tuple[int, int], float]) -> MarketProbabilities:
    """Aggregate score-grid into standard betting market probabilities."""
    mp = MarketProbabilities(score_grid=grid)

    for (h, a), prob in grid.items():
        total = h + a

        if h > a:
            mp.home_win += prob
        elif h == a:
            mp.draw += prob
        else:
            mp.away_win += prob

        if total > 1.5: mp.over15 += prob
        if total <= 1.5: mp.under15 += prob
        if total > 2.5: mp.over25 += prob
        if total < 2.5: mp.under25 += prob
        if total > 3.5: mp.over35 += prob
        if total < 3.5: mp.under35 += prob

        if h >= 1 and a >= 1: mp.btts += prob
        if h == 0 or a == 0: mp.btts_no += prob
        if h >= 1 and a >= 1 and total > 2.5: mp.btts_and_over25 += prob

        if total == 0: mp.under05 += prob
        if total <= 4: mp.under45 += prob

    # Compound markets
    mp.double_chance_1x = mp.home_win + mp.draw
    mp.double_chance_x2 = mp.away_win + mp.draw
    mp.double_chance_12 = mp.home_win + mp.away_win

    # Draw No Bet: re-normalize excluding draw probability
    non_draw = mp.home_win + mp.away_win
    if non_draw > 0:
        mp.draw_no_bet_home = mp.home_win / non_draw
        mp.draw_no_bet_away = mp.away_win / non_draw

    return mp


def compute_probabilities(mu_home: float, mu_away: float, rho: float | None = None) -> MarketProbabilities:
    """
    Main entry point.
    Given expected goal means, return all market probabilities.
    Upgrade #5: Accepts optional rho for dynamic context.
    """
    mu_home = max(0.01, mu_home)
    mu_away = max(0.01, mu_away)
    grid = compute_score_grid(mu_home, mu_away, rho)
    return derive_markets(grid)


def compute_first_half_probabilities(mu_home: float, mu_away: float, rho: float | None = None) -> MarketProbabilities:
    """
    Compute probabilities for First Half markets.
    First half xG is approximately 45% of full-match xG.
    """
    mu_home_fh = max(0.01, mu_home * 0.45)
    mu_away_fh = max(0.01, mu_away * 0.45)
    fh_rho = (rho or DIXON_COLES_RHO) * 0.5 if rho else DIXON_COLES_RHO * 0.5
    grid = compute_score_grid(mu_home_fh, mu_away_fh, fh_rho)
    return derive_markets(grid)


def compute_fh_markets(mu_home: float, mu_away: float, rho: float | None = None) -> dict:
    """
    Compute First Half specific probabilities directly from the FH score grid.
    Returns: {fh_over05, fh_over15, fh_btts, fh_home_win, fh_draw, fh_away_win}
    """
    mu_home_fh = max(0.01, mu_home * 0.45)
    mu_away_fh = max(0.01, mu_away * 0.45)
    fh_rho = (rho or DIXON_COLES_RHO) * 0.5 if rho else DIXON_COLES_RHO * 0.5
    grid = compute_score_grid(mu_home_fh, mu_away_fh, fh_rho)
    
    over05 = 0.0
    over15 = 0.0
    btts = 0.0
    home_win = 0.0
    draw = 0.0
    away_win = 0.0
    
    for (h, a), prob in grid.items():
        total = h + a
        if total >= 1:
            over05 += prob
        if total >= 2:
            over15 += prob
        if h >= 1 and a >= 1:
            btts += prob
        if h > a:
            home_win += prob
        elif h == a:
            draw += prob
        else:
            away_win += prob
    
    return {
        "fh_over05": round(over05, 4),
        "fh_over15": round(over15, 4),
        "fh_btts": round(btts, 4),
        "fh_home_win": round(home_win, 4),
        "fh_draw": round(draw, 4),
        "fh_away_win": round(away_win, 4),
    }


# ── Utility ────────────────────────────────────────────────────────────────────
def top_scorelines(grid: dict[tuple[int, int], float], n: int = 5) -> list[tuple[str, float]]:
    """Return the N most probable scorelines as Firestore-safe dicts."""
    sorted_scores = sorted(grid.items(), key=lambda x: x[1], reverse=True)
    return [{"score": f"{h}-{a}", "prob": round(p, 4)} for (h, a), p in sorted_scores[:n]]


if __name__ == "__main__":
    import json
    # Example: Arsenal (1.8 xG) vs Everton (0.9 xG)
    probs = compute_probabilities(1.80, 0.90)
    print(f"Home Win:  {probs.home_win:.3f}")
    print(f"Draw:      {probs.draw:.3f}")
    print(f"Away Win:  {probs.away_win:.3f}")
    print(f"Over 2.5:  {probs.over25:.3f}")
    print(f"Under 2.5: {probs.under25:.3f}")
    print(f"BTTS:      {probs.btts:.3f}")
    grid = compute_score_grid(1.80, 0.90)
    print("Top scorelines:", top_scorelines(grid))
