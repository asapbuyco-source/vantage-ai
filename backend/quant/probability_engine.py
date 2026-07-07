"""
probability_engine.py
────────────────────
Weighted model combiner.
Merges Poisson, Elo, and Form probabilities into a single consensus.

Weights: 60% Poisson | 30% Elo | 10% Form

MODEL-07: Probability calibration layer added.
Before this fix, model probabilities were systematically 10-30% too high
(O2.5 predicted 92% → actual 82%, BTTS No predicted 88% → actual 58%).
Calibration factors are empirical discounts derived from 30-day backtest data.
These are applied BEFORE EV calculation and Kelly staking, fixing the entire
decision chain: overconfident prob → inflated EV → oversized Kelly → blow-ups.

CAL-02: Per-market confidence scores added.
The old confidence_score was Shannon entropy of 1X2 outcomes — meaningless for
80% of bets which are on goals markets. Three new per-market agreement scores:
  - result_confidence: entropy of 1X2 (unchanged logic, renamed)
  - goals_confidence: 1 - CV of over/under probability spread
  - btts_confidence: 1 - |P(BTTS) - P(H)*P(A)| (measures Poisson-grid coherence)
Safety downgrades now use the appropriate per-market confidence score.
"""

from dataclasses import dataclass, field
from typing import TYPE_CHECKING
from calibration_registry import get_calibration_factor
from poisson_model import MarketProbabilities, compute_probabilities, compute_fh_markets
from elo_rating import match_probabilities as elo_match_probs
from form_model import compute_form_probabilities, FormProbabilities
import math

if TYPE_CHECKING:
    from data_pipeline import TeamStats

INTERNATIONAL_LEAGUE_IDS = {294, 3016, 3015, 3014, 3013, 3012, 3011, 3010, 3009, 3008, 3007}

# ── Model weights (must sum to 1.00) ─────────────────────────────────────────
# FIX-3: Enabled H2H contribution (5%). H2H data is fetched via API-Football.
# H2H provides ~5% signal on match outcomes when 3+ meetings exist.
W_POISSON = 0.60  # Poisson score model (primary — strongest for goals markets)
W_ELO     = 0.25  # Elo ratings (secondary — good for match outcomes)
W_FORM    = 0.10  # Form model (10% — recency-weighted team performance)


def get_adaptive_h2h_weight(h2h_total: int, is_derby: bool, h2h_home_wins: int = 0, h2h_away_wins: int = 0, h2h_draws: int = 0) -> float:
    """
    Adaptive H2H weighting based on match type and data quality.
    Replaces the fixed W_H2H = 0.05 constant.

    - Derby matches with rich H2H history: 12% (H2H is highly predictive)
    - Many H2H meetings (8+): 8% (more data = more weight)
    - Standard 3+ meetings: 5% baseline
    - Insufficient data (<3): 5% (fallback)
    """
    if h2h_total < 3:
        return 0.05  # baseline — insufficient data
    if is_derby and h2h_total >= 5:
        return 0.12  # derby with good history — H2H is highly predictive
    if h2h_total >= 8:
        return 0.08  # lots of H2H data — increase weight slightly
    return 0.05  # default


def _calibrate(raw: float, market_key: str, default: float = 0.92) -> float:
    """Apply empirical calibration discount to a raw probability."""
    factor = get_calibration_factor(market_key, default)
    return max(0.01, min(0.99, raw * factor))


@dataclass
class CombinedProbabilities:
    """Final consensus probabilities for all markets."""
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
    double_chance_1x: float = 0.0
    double_chance_x2: float = 0.0
    double_chance_12: float = 0.0
    draw_no_bet_home: float = 0.0
    draw_no_bet_away: float = 0.0
    # OPP-01: BTTS + Over 2.5 composite probability
    btts_and_over25: float = 0.0
    # Model contributions for transparency
    poisson_home: float = 0.0
    elo_home: float = 0.0
    form_home: float = 0.0
    # CAL-02: Per-market confidence scores (replaces old single confidence_score)
    result_confidence: float = 0.0   # Shannon entropy of 1X2 (renamed from confidence_score)
    goals_confidence: float = 0.0   # Agreement on goals total (new)
    btts_confidence: float = 0.0   # Poisson-grid coherence for BTTS (new)
    # First Half markets
    fh_over05: float = 0.0    # Over 0.5 FH Goals
    fh_over15: float = 0.0    # Over 1.5 FH Goals
    fh_btts: float = 0.0      # BTTS in First Half
    fh_home_win: float = 0.0  # First Half Home Win
    fh_draw: float = 0.0      # First Half Draw
    fh_away_win: float = 0.0  # First Half Away Win
    # Over/Under 0.5 & 4.5 Goals (extreme goal lines)
    over05: float = 0.0
    under05: float = 0.0
    over45: float = 0.0
    under45: float = 0.0
    # Corner markets (derived in quant_pipeline, stored here for EV engine)
    over85_corners: float = 0.0
    over95_corners: float = 0.0
    # HT/FT compound markets (Phase 4.3)
    hthome_fthome: float = 0.0
    htdraw_fthome: float = 0.0
    hthome_ftdraw: float = 0.0


def _normalize(p_home: float, p_draw: float, p_away: float) -> tuple[float, float, float]:
    total = p_home + p_draw + p_away
    if total == 0:
        return 1/3, 1/3, 1/3
    return p_home / total, p_draw / total, p_away / total


def compute_combined(
    mu_home: float,
    mu_away: float,
    home_team_id: int,
    away_team_id: int,
    home_stats: 'TeamStats',
    away_stats: 'TeamStats',
    home_opp_strengths: list[float] | None = None,
    away_opp_strengths: list[float] | None = None,
    h2h_home_wins: int = 0,
    h2h_away_wins: int = 0,
    h2h_draws: int = 0,
    home_sidelined: int = 0,
    away_sidelined: int = 0,
    rho: float | None = None,
    weights_override: dict | None = None,
    league_tier: int = 2,
    league_id: int | None = None,
    is_derby: bool = False,
) -> CombinedProbabilities:
    """
    Combine Poisson + Elo + Form + H2H into final probabilities.
    FIX-3: H2H contributes 5% when 3+ meetings exist.
    FIX-5: league_tier read from match (not TeamStats) for correct home advantage.
    For international matches (league_id in INTERNATIONAL_LEAGUE_IDS), uses
    international Elo via international_data.py instead of club Elo.

    Args:
        mu_home: Expected goals for home team (from data_pipeline)
        mu_away: Expected goals for away team
        home_team_id: Sportmonks team ID (for Elo lookup)
        away_team_id:
        home_stats: TeamStats object
        away_stats: TeamStats object
        home_opp_strengths: list of opponent Elo ratings
        away_opp_strengths:
        h2h_home_wins: Number of H2H wins for home team (last 8 meetings)
        h2h_away_wins: Number of H2H wins for away team
        h2h_draws: Number of H2H draws
        home_sidelined: Count of injured/suspended players for home team
        away_sidelined: Count of injured/suspended players for away team
        rho: Dixon-Coles rho for score correlation
        weights_override: dict of model weights (poisson, elo, form, h2h)
        league_tier: League tier (1=elite, 5=lower) for home advantage multiplier
        is_derby: Whether this is a derby/rivalry match (increases H2H weight)

    Returns:
        CombinedProbabilities with all markets filled.
    """

    # Apply weights override if provided (H2H is handled separately via adaptive weighting)
    w_poisson = weights_override.get('poisson', W_POISSON) if weights_override else W_POISSON
    w_elo = weights_override.get('elo', W_ELO) if weights_override else W_ELO
    w_form = weights_override.get('form', W_FORM) if weights_override else W_FORM
    # Note: w_h2h is set via get_adaptive_h2h_weight() above, not from weights_override

    W_SM = 0.10
    # FIX-1: SM (Sportmonks prediction) integration is disabled until data_pipeline
    # populates sm_pred_home_win/sm_pred_draw/sm_pred_away_win on MatchData.
    # Default to disabled. When wired, pass sm_probs dict to compute_combined.
    has_sm = False

    # Compute H2H weight up front so it's available for normalization below.
    # Must be set before the weight normalization block that references it.
    h2h_total = h2h_home_wins + h2h_away_wins + h2h_draws
    w_h2h = get_adaptive_h2h_weight(h2h_total, is_derby, h2h_home_wins, h2h_away_wins, h2h_draws)

    # FIX #4: Normalize base weights BEFORE applying SM scale.
    # Previously, normalization happened AFTER scale, which restored original
    # weights then added W_SM=0.10 on top → total sum = 1.10.
    # Step 1: normalize the four base model weights to sum = 1.0
    w_total = w_poisson + w_elo + w_form + w_h2h
    if w_total > 0:
        w_poisson /= w_total
        w_elo     /= w_total
        w_form    /= w_total
        w_h2h     /= w_total

    # Step 2: if Sportmonks prediction available, scale all base weights by (1-W_SM)
    # so that base_sum = 0.90, and adding W_SM=0.10 in the final combination = 1.00
    if has_sm:
        scale = 1.0 - W_SM
        w_poisson *= scale
        w_elo     *= scale
        w_form    *= scale
        w_h2h     *= scale
        # No further normalization needed — sum is now exactly 1.00
    # ── Model 1: Poisson (MODEL-01: form-adjusted xG before grid) ────────
    # Multiplicative xG form scaling applied before Poisson grid so the full
    # probability distribution stays coherent (old additive tweak did not).
    _hfs = getattr(home_stats, 'form_score', 0.5) if home_stats else 0.5
    _afs = getattr(away_stats, 'form_score', 0.5) if away_stats else 0.5
    
    # UPGRADE #13: Sidelined (Injury) Penalty
    # Every missing player reduces expected goals by ~3%. 
    # If more than 4 players are missing, it signals a deeper squad crisis.
    home_injury_penalty = min(0.25, home_sidelined * 0.03 + (0.05 if home_sidelined > 4 else 0.0))
    away_injury_penalty = min(0.25, away_sidelined * 0.03 + (0.05 if away_sidelined > 4 else 0.0))

    # FIX #3 + FIX #10: Form is NO LONGER baked into adj_mu.
    # It enters the consensus purely through W_FORM * form.home_win below.
    # Old multiplier (0.90 + _hfs*0.20) double-counted form AND had a range of
    # [0.90, 1.10] that punished neutral teams (form_score=0 → -10% xG).
    # New multiplier: (0.85 + _hfs*0.30) would be correct IF we kept form here,
    # but we remove it entirely and apply injury penalty only.
    adj_mu_home = max(0.20, mu_home * (1.0 - home_injury_penalty))
    adj_mu_away = max(0.20, mu_away * (1.0 - away_injury_penalty))

    # FIX-5: Home advantage is now read from the league_tier parameter
    # (correctly passed from match.league_tier, not from TeamStats which doesn't have it)
    # FIX-4: Only ONE home advantage multiplier applied (removed data_pipeline's 1.12)
    HOME_ADVANTAGE = {1: 1.10, 2: 1.08, 3: 1.05, 4: 1.03, 5: 1.00}
    adj_mu_home *= HOME_ADVANTAGE.get(league_tier, 1.08)

    poisson: MarketProbabilities = compute_probabilities(adj_mu_home, adj_mu_away, rho)
    fh = compute_fh_markets(adj_mu_home, adj_mu_away, rho)

    # ── Model 2: Elo ───────────────────────────────────────────────────────
    is_intl = league_id in INTERNATIONAL_LEAGUE_IDS if league_id else False
    if is_intl:
        try:
            from international_data import get_intl_elo, intl_match_probabilities as intl_probs
            home_elo = get_intl_elo(getattr(home_stats, 'team_name', '') or str(home_team_id))
            away_elo = get_intl_elo(getattr(away_stats, 'team_name', '') or str(away_team_id))
            intl_elo = intl_probs(home_elo, away_elo)
            elo = {
                "home_win": intl_elo["home_win"],
                "draw": intl_elo["draw"],
                "away_win": intl_elo["away_win"],
            }
        except Exception:
            elo = elo_match_probs(home_team_id, away_team_id)
    else:
        elo = elo_match_probs(home_team_id, away_team_id)

    # ── Model 3: Form (FIX-6: opponent strength aware + FIX-10: league-tier aware) ─
    form: FormProbabilities = compute_form_probabilities(
        home_stats, away_stats, home_opp_strengths, away_opp_strengths, league_tier
    )

    # ── Model 4: H2H (Fix #5) ─────────────────────────────────────────────
    if h2h_total >= 3:  # Only use H2H signal if sufficient samples
        h2h_p_home = h2h_home_wins / h2h_total
        h2h_p_draw = h2h_draws / h2h_total
        h2h_p_away = h2h_away_wins / h2h_total
    else:
        # Insufficient H2H data — fall back to Poisson (neutral contribution)
        h2h_p_home = poisson.home_win
        h2h_p_draw = poisson.draw
        h2h_p_away = poisson.away_win

    # ── Weighted combination of 1x2 probabilities ──────────────────────────
    # SM (Sportmonks) prediction disabled until wired — defaults to 0
    sm_home = 0.0
    sm_draw = 0.0
    sm_away = 0.0

    p_home = (w_poisson * poisson.home_win + w_elo * elo["home_win"]
              + w_form * form.home_win + w_h2h * h2h_p_home)
    p_draw = (w_poisson * poisson.draw + w_elo * elo["draw"]
              + w_form * form.draw + w_h2h * h2h_p_draw)
    p_away = (w_poisson * poisson.away_win + w_elo * elo["away_win"]
              + w_form * form.away_win + w_h2h * h2h_p_away)

    p_home, p_draw, p_away = _normalize(p_home, p_draw, p_away)

    # ── Goals markets: taken directly from form-adjusted Poisson grid ─────
    # MODEL-01: Poisson already used form-scaled xG above — no additive tweaks.
    # CAL-01: Raw Poisson probabilities are systematically overconfident.
    # Apply empirical calibration factors derived from 30-day backtest.
    raw_over25 = poisson.over25
    raw_over35 = poisson.over35
    raw_over15 = poisson.over15
    raw_btts   = poisson.btts

    # Apply calibration discounts — removed from probability_engine (was double-applied with ev_engine).
    # Calibration is now exclusively handled by ev_engine.calibrate_market_probability().
    # See PREDICTION_ENGINE_IMPLEMENTATION_PLAN.md FIX-1 for details.
    over25 = raw_over25
    over35 = raw_over35
    over15 = raw_over15
    btts   = raw_btts

    under25 = 1.0 - over25
    under35 = 1.0 - over35
    under15 = 1.0 - over15
    btts_no = 1.0 - btts

    # ── Realistic probability caps for defensive markets ───────────────────
    # MODEL-07: These caps are now superseded by calibration — but kept as
    # a safety backstop for matches where calibration produces extreme values.
    under25 = min(under25, 0.80)
    over25  = 1.0 - under25
    under35 = min(under35, 0.88)
    over35  = 1.0 - under35
    under15 = under15  # no cap — O1.5 hit rate validates as-is
    over15  = 1.0 - under15
    btts_no = min(btts_no, 0.85)
    btts    = 1.0 - btts_no

    # FIX #2: Enforce stochastic ordering — must hold: over15 >= over25 >= over35
    over35  = min(over35,  over25)
    under35 = 1.0 - over35
    over15  = max(over15,  over25)
    under15 = 1.0 - over15

    # Phase 2.4: Over/Under 0.5 & 4.5 Goals (extreme goal lines)
    over05 = 1.0 - poisson.under05  # P(≥1 goal)
    under05 = poisson.under05       # P(0 goals)
    over45 = 1.0 - poisson.under45  # P(≥5 goals)
    under45 = poisson.under45       # P(≤4 goals)

    # Phase 4.3: HT/FT compound probabilities
    # Uses first-half Poisson + conditional second-half Poisson (simplified: halves are ~independent)
    mu_home_2h = adj_mu_home * 0.50
    mu_away_2h = adj_mu_away * 0.50

    def _poisson_grid_2h(mu_h: float, mu_a: float) -> dict:
        grid = {}
        for h in range(8):
            for a in range(8):
                ph = (mu_h ** h) * math.exp(-mu_h) / math.factorial(h)
                pa = (mu_a ** a) * math.exp(-mu_a) / math.factorial(a)
                grid[(h, a)] = ph * pa
        return grid

    fh_grid = _poisson_grid_2h(adj_mu_home * 0.50, adj_mu_away * 0.50)
    sh_grid = _poisson_grid_2h(mu_home_2h, mu_away_2h)

    # Aggregate HT/FT probabilities
    ht_home_lead = 0.0
    ht_draw = 0.0
    ht_away_lead = 0.0
    for (h, a), p in fh_grid.items():
        if h > a: ht_home_lead += p
        elif h == a: ht_draw += p
        else: ht_away_lead += p

    # Conditional: P(home wins full time | HT state) ~ P(home outscored in 2H)
    def _ft_outcome_2h(state_lead: str) -> tuple:
        w, d, l = 0.0, 0.0, 0.0
        for (h, a), p in sh_grid.items():
            if state_lead == "home":
                if h >= a: w += p  # home maintains or extends lead
                elif h + 1 == a and a - h <= 1: d += p
                else: l += p
            elif state_lead == "draw":
                if h > a: w += p
                elif h == a: d += p
                else: l += p
            else:  # away
                if a >= h: l += p  # away maintains
                elif a + 1 == h and h - a <= 1: d += p
                else: w += p
        total = w + d + l
        return (w/total, d/total, l/total) if total > 0 else (0, 0, 0)

    hw2h, hd2h, hl2h = _ft_outcome_2h("home")
    dw2h, dd2h, dl2h = _ft_outcome_2h("draw")
    aw2h, ad2h, al2h = _ft_outcome_2h("away")

    hthome_fthome = ht_home_lead * hw2h
    htdraw_fthome = ht_draw * dw2h
    hthome_ftdraw = ht_home_lead * hd2h

    # ── Compound markets ───────────────────────────────────────────────────
    dc_1x = p_home + p_draw
    dc_x2 = p_away + p_draw
    dc_12 = p_home + p_away

    non_draw = p_home + p_away
    dnb_home = p_home / non_draw if non_draw > 0 else 0.5
    dnb_away = p_away / non_draw if non_draw > 0 else 0.5

    # ── CAL-02: Per-market confidence scores ──────────────────────────────
    #
    # OLD: Single confidence_score = Shannon entropy of 1X2.
    # This was meaningless for 80% of bets (goals markets).
    #
    # NEW: Three purpose-built confidence scores.
    # Each measures model agreement relevant to its market category.

    def shannon_entropy(probs: list[float]) -> float:
        return -sum(p * math.log2(p) for p in probs if p > 0)

    # 1. Result confidence: entropy of 1X2 outcomes (unchanged logic, renamed)
    entropy = shannon_entropy([p_home, p_draw, p_away])
    result_confidence = max(0.0, min(1.0, 1.0 - (entropy / 1.585)))

    # 2. Goals confidence: 1 minus normalized spread of over/under probabilities.
    # If Poisson is very certain about total goals (e.g., 95% O2.5, 5% U2.5),
    # the spread is large and goals_confidence is high.
    # If it's ambiguous (55% O2.5, 45% U2.5), confidence is low.
    over25_frac = over25 / (over25 + under25 + 0.001)
    goals_confidence = abs(over25_frac - 0.5) * 2  # 0=coin-flip, 1=max certainty

    # 3. BTTS confidence: coherence of Poisson grid joint vs marginal probabilities.
    # P(BTTS) should ≈ P(H)*P(A) for an independent model.
    # A large gap means the models disagree, BTTS confidence is low.
    independence_btts = p_home * p_away
    gap = abs(btts - independence_btts)
    btts_confidence = max(0.0, 1.0 - (gap / 0.25))  # 0.25 gap = 0 confidence, 0 gap = 1

    cp = CombinedProbabilities(
        home_win=round(p_home, 4),
        draw=round(p_draw, 4),
        away_win=round(p_away, 4),
        over15=round(over15, 4),
        under15=round(under15, 4),
        over25=round(over25, 4),
        under25=round(under25, 4),
        over35=round(over35, 4),
        under35=round(under35, 4),
        btts=round(btts, 4),
        btts_no=round(btts_no, 4),
        double_chance_1x=round(dc_1x, 4),
        double_chance_x2=round(dc_x2, 4),
        double_chance_12=round(dc_12, 4),
        draw_no_bet_home=round(dnb_home, 4),
        draw_no_bet_away=round(dnb_away, 4),
        btts_and_over25=round(poisson.btts_and_over25, 4),
        poisson_home=round(poisson.home_win, 4),
        elo_home=round(elo["home_win"], 4),
        form_home=round(form.home_win, 4),
        result_confidence=round(result_confidence, 4),
        goals_confidence=round(goals_confidence, 4),
        btts_confidence=round(btts_confidence, 4),
        # First Half markets
        fh_over05=round(fh["fh_over05"], 4),
        fh_over15=round(fh["fh_over15"], 4),
        fh_btts=round(fh["fh_btts"], 4),
        fh_home_win=round(fh["fh_home_win"], 4),
        fh_draw=round(fh["fh_draw"], 4),
        fh_away_win=round(fh["fh_away_win"], 4),
        # Over/Under 0.5 & 4.5 Goals
        over05=round(over05, 4),
        under05=round(under05, 4),
        over45=round(over45, 4),
        under45=round(under45, 4),
        # HT/FT compounds
        hthome_fthome=round(hthome_fthome, 4),
        htdraw_fthome=round(htdraw_fthome, 4),
        hthome_ftdraw=round(hthome_ftdraw, 4),
    )
    return cp


if __name__ == "__main__":
    result = compute_combined(1.8, 0.9, 12, 14, "W W W D W", "L D L L W")
    print(f"Home Win:    {result.home_win:.3f}")
    print(f"Draw:        {result.draw:.3f}")
    print(f"Away Win:    {result.away_win:.3f}")
    print(f"Over 2.5:    {result.over25:.3f}  (calibrated)")
    print(f"BTTS:        {result.btts:.3f}  (calibrated)")
    print(f"Result Conf: {result.result_confidence:.3f}")
    print(f"Goals Conf:   {result.goals_confidence:.3f}")
    print(f"BTTS Conf:    {result.btts_confidence:.3f}")
