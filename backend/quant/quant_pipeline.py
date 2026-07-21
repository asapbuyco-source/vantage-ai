"""
quant_pipeline.py
─────────────────
Main orchestrator for the quantitative football betting pipeline.

Daily workflow:
  1. Fetch upcoming fixtures (50+ from approved leagues)
  2. Build team statistics via data_pipeline
  3. Run Poisson model
  4. Run Elo model
  5. Run Form model
  6. Combine models (60/30/10)
  7. Evaluate all markets for EV
  8. Apply risk filters
  9. Calculate Kelly stakes
  10. Generate accumulators
  11. Save to Firestore quant_predictions/{dateKey}
  12. Compute performance metrics

Usage:
  python quant_pipeline.py              # Run for today
  python quant_pipeline.py 2025-03-14  # Run for specific date
  python quant_pipeline.py --dry-run   # Mock data, no API calls
"""

import os
import sys

# Force UTF-8 output to prevent emoji/unicode errors on Windows terminals
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1)
if sys.stderr.encoding and sys.stderr.encoding.lower() != 'utf-8':
    sys.stderr = open(sys.stderr.fileno(), mode='w', encoding='utf-8', buffering=1)

# Auto-configure gRPC SSL certificate bundle path for Windows/Local environments
try:
    import certifi
    os.environ["GRPC_DEFAULT_SSL_ROOTS_FILE_PATH"] = certifi.where()
except ImportError:
    pass
import json
import math
from datetime import datetime, timezone, timedelta

# ── Local imports ─────────────────────────────────────────────────────────────
from data_pipeline import fetch_matches, MatchData, TeamStats
from poisson_model import compute_probabilities, compute_dynamic_rho, top_scorelines, compute_score_grid
import math as _math
from elo_rating import load_ratings_from_firestore, match_probabilities as elo_probs, save_dirty_ratings, get_team_rating, is_derby_match, DEFAULT_ELO
from form_model import compute_form_probabilities
from probability_engine import compute_combined, CombinedProbabilities
from ev_engine import evaluate_all_markets, get_best_value_bet
from risk_filters import (
    filter_bets,
    grade_risk,
    check_odds_staleness,
    odds_age_minutes,
    is_odds_fresh_for_vault,
)
from kelly_optimizer import kelly_stake_pct, market_max_stake_pct
from accumulator_engine import generate_accumulators, accumulator_to_dict
from risk_filters import check_btts_blanking_risk

# ── Constants ─────────────────────────────────────────────────────────────────
MAX_PREDICTIONS_PER_DAY = 100


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _corner_over_prob(total_xg: float, line: float) -> float:
    """Poisson probability of exceeding a corner line given expected total xG."""
    lam = max(0.5, total_xg * 1.2)
    cdf = sum(_math.exp(-lam) * (lam ** k) / _math.factorial(k) for k in range(int(line) + 1))
    return round(max(0.0, min(1.0, 1.0 - cdf)), 4)


def _safe_print(text: str, file=sys.stdout):
    """Safely print text that may contain emojis on Windows CMD/PowerShell."""
    try:
        print(text, file=file)
    except UnicodeEncodeError:
        print(text.encode('ascii', 'replace').decode('ascii'), file=file)


def _model_agreement_for_bet(best_bet, probs: CombinedProbabilities) -> float:
    """Pick the right per-market confidence score from CombinedProbabilities."""
    if not best_bet:
        return 0.0
    m = best_bet.market.lower()
    if any(k in m for k in ["over", "under"]):
        return probs.goals_confidence
    if "btts" in m:
        return probs.btts_confidence
    return probs.result_confidence


def _data_quality_score(match, best_bet, odds_fresh: bool, home_stats, away_stats) -> float:
    """Score 0-1 based on data quality factors affecting prediction reliability."""
    score = 1.0
    if not odds_fresh:
        score -= 0.15
    if match.league_tier >= 4:
        score -= 0.10
    if match.league_tier == 5:
        score -= 0.15
    if not home_stats or not home_stats.matches_analyzed or home_stats.matches_analyzed < 5:
        score -= 0.10
    if not best_bet or best_bet.odds <= 1.0:
        score -= 0.20
    if getattr(match, 'provider_source', '') == 'api_football':
        score -= 0.05
    return max(0.0, round(score, 2))


def _get_firestore():
    try:
        import firebase_admin
        from firebase_admin import firestore as fs
        return fs.client()
    except Exception as e:
        print(f"[QuantPipeline] Firestore unavailable: {e}", file=sys.stderr)
        return None


def _init_firebase():
    """Initialize firebase_admin if not already initialized."""
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
        if not firebase_admin._apps:
            service_account_raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
            if service_account_raw:
                import json as _json
                sa = _json.loads(service_account_raw)
                if "private_key" in sa:
                    sa["private_key"] = sa["private_key"].replace('\\n', '\n')
                cred = credentials.Certificate(sa)
            else:
                cred = credentials.ApplicationDefault()
            firebase_admin.initialize_app(cred)
        return True
    except Exception as e:
        print(f"[QuantPipeline] Firebase init error: {e}", file=sys.stderr)
        return False


# ── Mock data for dry-run ─────────────────────────────────────────────────────
def _mock_matches() -> list[MatchData]:
    from data_pipeline import MatchData, TeamStats, OddsData
    matches = []
    fixtures = [
        ("Arsenal", "Everton", 8, "English Premier League", 1.65, 3.60, 5.50, 1.90, 1.95, 1.85, 1.95),
        ("Real Madrid", "Getafe", 564, "La Liga", 1.45, 4.20, 7.50, 1.75, 2.10, 1.75, 2.00),
        ("Bayern", "Dortmund", 82, "Bundesliga", 1.70, 3.50, 5.00, 1.80, 2.00, 1.65, 2.15),
        ("PSG", "Lyon", 301, "Ligue 1", 1.50, 4.00, 6.50, 1.70, 2.20, 1.75, 2.05),
        ("Juventus", "Roma", 384, "Serie A", 1.85, 3.50, 4.50, 1.90, 1.95, 1.80, 2.00),
    ]
    for i, (home, away, lid, league, ho, do, ao, ov25o, un25o, bttsy, bttsn) in enumerate(fixtures):
        home_stats = TeamStats(team_id=100+i, team_name=home,
                               avg_scored=1.7, avg_conceded=0.9,
                               home_avg_scored=2.0, home_avg_conceded=0.8,
                               away_avg_scored=1.4, away_avg_conceded=1.1,
                               form="W W W D W", form_score=0.80, win_rate=0.70)
        away_stats = TeamStats(team_id=200+i, team_name=away,
                               avg_scored=1.1, avg_conceded=1.4,
                               home_avg_scored=1.3, home_avg_conceded=1.1,
                               away_avg_scored=0.9, away_avg_conceded=1.7,
                               form="L D L W D", form_score=0.45, win_rate=0.30)
        od = OddsData(home_odds=ho, draw_odds=do, away_odds=ao,
                      dc_1x_odds=1.20, dc_x2_odds=1.35, dc_12_odds=1.15,
                      over15_odds=1.25, under15_odds=3.00,
                      over25_odds=ov25o, under25_odds=un25o,
                      btts_yes_odds=bttsy, btts_no_odds=bttsn,
                      odds_fetched_at=_now_iso())
        m = MatchData(
            fixture_id=str(5000+i), league=league, league_id=lid, league_tier=1,
            home_team=home, home_team_id=100+i,
            away_team=away, away_team_id=200+i,
            kickoff_utc="2025-03-14T18:00:00Z", kickoff_local="19:00",
            home_stats=home_stats, away_stats=away_stats, odds=od,
            expected_goals_home=1.80, expected_goals_away=0.90,
        )
        matches.append(m)
    return matches


# ── Core pipeline ─────────────────────────────────────────────────────────────
def run_pipeline(date_str: str | None = None, dry_run: bool = False, weights_override: dict | None = None, preloaded_matches: list | None = None) -> dict:
    """
    Run the full quantitative pipeline for the given date.
    Returns a summary dict with status, generated count, and predictions.
    Accepts weights_override and preloaded_matches for fast grid search execution.
    """
    if date_str is None:
        date_str = datetime.now(timezone(timedelta(hours=1))).strftime("%Y-%m-%d")

    _safe_print(f"[QuantPipeline] 🚀 Starting quant pipeline for {date_str} (dry_run={dry_run})")

    # ── Step 0: Initialize Firebase ────────────────────────────────────────
    if not dry_run:
        _init_firebase()
        load_ratings_from_firestore()

    # ── Step 1: Fetch matches ──────────────────────────────────────────────
    # Upgrade #11: If date_str is provided and not "today", we likely want REAL data 
    # even in dry_run (for backtesting), but we still skip the Firestore save.
    is_today = date_str == datetime.now(timezone(timedelta(hours=1))).strftime("%Y-%m-%d")
    
    if preloaded_matches is not None:
        matches = preloaded_matches
    elif dry_run and is_today:
        matches = _mock_matches()
        print(f"[QuantPipeline] [DRY RUN] Using {len(matches)} mock matches.")
    else:
        matches = fetch_matches(date_str)

    if not matches:
        print("[QuantPipeline] No matches found. Exiting.")
        return {"status": "skipped", "reason": "no_matches", "date": date_str}

    # ── Deduplicate fixtures (Sportmonks pagination can return same fixture multiple times) ──
    seen_fixture_ids = set()
    deduped_matches = []
    for m in matches:
        if m.fixture_id not in seen_fixture_ids:
            seen_fixture_ids.add(m.fixture_id)
            deduped_matches.append(m)
    if len(deduped_matches) < len(matches):
        print(f"[QuantPipeline] Deduped {len(matches)} -> {len(deduped_matches)} fixtures (removed {len(matches) - len(deduped_matches)} duplicates)")
    matches = deduped_matches

    print(f"[QuantPipeline] Processing {len(matches)} matches...")

    # ── Steps 2–9: Model pipeline per match ───────────────────────────────
    # MATCH ANALYSIS PLATFORM: Analyze ALL matches, never discard.
    # Filtering is ONLY applied when building accumulators.
    predictions: list[dict] = []
    bet_pool: list[dict] = []  # Only value bets go here (for accumulators)
    acc_pool: list[dict] = []  # Highest-probability picks per fixture (for accumulators)
    high_prob_pool: list[dict] = []  # 85%+ prob bets for Safe Stack

    for match in matches[:MAX_PREDICTIONS_PER_DAY]:
        try:
            mu_home = match.expected_goals_home
            mu_away = match.expected_goals_away
            home_id = match.home_team_id
            away_id = match.away_team_id
            
            home_stats = match.home_stats if match.home_stats else TeamStats(team_id=home_id, team_name=match.home_team)
            away_stats = match.away_stats if match.away_stats else TeamStats(team_id=away_id, team_name=match.away_team)
            
            home_form_str = home_stats.form
            away_form_str = away_stats.form

            # ── Extract opponent strengths for form model ───────────────────
            home_opp_strengths = []
            away_opp_strengths = []
            if match.home_stats and hasattr(match.home_stats, 'recent_opponents'):
                # FIX #14: Use DEFAULT_ELO constant instead of hardcoded 1500
                home_opp_strengths = [get_team_rating(opp_id) / DEFAULT_ELO for opp_id in match.home_stats.recent_opponents[:5]]
            if match.away_stats and hasattr(match.away_stats, 'recent_opponents'):
                away_opp_strengths = [get_team_rating(opp_id) / DEFAULT_ELO for opp_id in match.away_stats.recent_opponents[:5]]

            # ── Dynamic Dixon-Coles rho (BUG-01 fixed) ─────────────────────
            # BUG-01: was `str(id) in str(id)` which was always True for any ID
            # containing a digit that appeared in another. Now uses frozenset lookup.
            is_derby = is_derby_match(match.home_team_id, match.away_team_id)
            rho = compute_dynamic_rho(mu_home, mu_away, match.league_tier, is_derby)

            # Combine models (Poisson + Elo + Form + H2H)
            probs: CombinedProbabilities = compute_combined(
                mu_home, mu_away, home_id, away_id, home_stats, away_stats,
                home_opp_strengths=home_opp_strengths,
                away_opp_strengths=away_opp_strengths,
                h2h_home_wins=match.h2h_home_wins,
                h2h_away_wins=match.h2h_away_wins,
                h2h_draws=match.h2h_draws,
                home_sidelined=match.home_sidelined_count,
                away_sidelined=match.away_sidelined_count,
                rho=rho,
                weights_override=weights_override,
                league_tier=match.league_tier if hasattr(match, 'league_tier') else 2,
                is_derby=is_derby,
            )


            # ── Evaluate ALL markets for this match (FIX: was undefined) ────
            current_month = datetime.now().month
            all_value_bets = evaluate_all_markets(probs, match.odds, match.league_id, current_month)

            # ── Apply risk filters to find approved value bets ──────────────
            approved_bets = filter_bets(all_value_bets, match.league_tier)

            # ── Determine best bet & category ───────────────────────────────
            # Match Analysis Platform: NEVER skip a match. Always pick the
            # best available angle even if it has no edge.
            if approved_bets:
                best_bet = approved_bets[0]
                category = grade_risk(best_bet)
                value_rank = "high" if category == "safe" else "medium"
            elif all_value_bets:
                # No approved bet, but markets exist — pick the best lean
                all_value_bets.sort(key=lambda b: b.expected_value * 0.5 + b.model_prob * 0.5, reverse=True)
                best_bet = all_value_bets[0]
                # Check if it has positive EV but just failed a minor filter
                if best_bet.expected_value > 0:
                    category = "lean"
                    value_rank = "low"
                else:
                    category = "no_edge"
                    value_rank = "none"
            else:
                # No odds/markets at all — still keep the match for the dashboard
                _safe_print(f"[QuantPipeline]   ⚪ {match.home_team} vs {match.away_team}: No odds available, providing probability lean.")
                
                from ev_engine import ValueBet
                candidate_markets = [
                    ("Home Win", probs.home_win),
                    ("Away Win", probs.away_win),
                    ("Draw", probs.draw),
                    ("Over 2.5 Goals", probs.over25),
                    ("Under 2.5 Goals", probs.under25),
                    ("BTTS", probs.btts),
                    ("Double Chance (1X)", probs.double_chance_1x),
                    ("Double Chance (X2)", probs.double_chance_x2),
                ]
                lean_market, lean_prob = max(candidate_markets, key=lambda x: x[1])
                
                best_bet = ValueBet(
                    market=lean_market,
                    bet_label=lean_market,
                    model_prob=lean_prob,
                    market_prob=1.0,
                    odds=0.0,
                    expected_value=0.0,
                    inefficiency=0.0,
                    is_value=False
                )
                category = "lean"
                value_rank = "none"

            # ── Conditional Safety Downgrade for Predictions (Risk Mitigation) ──
            if best_bet:
                dynamic_draw_safe = "Double Chance (1X)" if probs.home_win >= probs.away_win else "Double Chance (X2)"
                
                SAFETY_DOWNGRADES = {
                    "Over 2.5 Goals": "Over 1.5 Goals",
                    "Over 3.5 Goals": "Over 2.5 Goals",
                    "Home Win": "Double Chance (1X)",
                    "Away Win": "Double Chance (X2)",
                    "BTTS": "Over 1.5 Goals",
                    "Draw": dynamic_draw_safe
                }
                
                if best_bet.market in SAFETY_DOWNGRADES:
                    # CAL-02: Use per-market confidence scores instead of the old single
                    # confidence_score which only measured 1X2 entropy (irrelevant for goals markets).
                    m = best_bet.market.lower()
                    if any(k in m for k in ["over", "under"]):
                        is_low_agreement = probs.goals_confidence < 0.25
                    elif "btts" in m:
                        is_low_agreement = probs.btts_confidence < 0.25
                    else:
                        is_low_agreement = probs.result_confidence < 0.25

                    is_risky_prob = best_bet.model_prob < 0.62
                    is_volatile_league = match.league_tier >= 3

                    # MODEL-06: Over 3.5 Goals is ALWAYS downgraded to Over 2.5 Goals.
                    # Backtesting shows O3.5 hit rate is ~20% despite 75-80% model probability,
                    # causing systematic losses. Over 2.5 (82% hit rate) captures the same upside
                    # without the tail risk of 4+ goals needed for O3.5.
                    is_over35 = best_bet.market == "Over 3.5 Goals"

                    # Downgrade if: Over 3.5 (always), OR (both prob low AND agreement low) OR volatile league
                    should_downgrade = is_over35 or (is_risky_prob and is_low_agreement) or is_volatile_league

                    if should_downgrade:
                        safe_target = SAFETY_DOWNGRADES[best_bet.market]
                        safe_bet = next((b for b in all_value_bets if b.market == safe_target), None)
                        if safe_bet:
                            reasons = []
                            if is_over35: reasons.append("Over 3.5 auto-downgrade")
                            if is_risky_prob: reasons.append(f"Prob {best_bet.model_prob:.0%}")
                            if is_low_agreement: reasons.append(f"Agreement {probs.goals_confidence:.2f}" if "btts" not in m and not any(k in m for k in ["over","under"]) else f"Conf {probs.goals_confidence:.2f}")
                            if is_volatile_league: reasons.append(f"Tier {match.league_tier}")
                            reason_str = " & ".join(reasons)
                            _safe_print(f"[QuantPipeline]   🛡️ Safety Downgrade [{reason_str}]: {best_bet.market} -> {safe_target}")
                            best_bet = safe_bet

            # ── Odds Staleness Guard ────────────────────────────────────────
            odds_fetched_at = match.odds.odds_fetched_at if match.odds else ""
            odds_age_min = odds_age_minutes(odds_fetched_at)
            odds_fresh = is_odds_fresh_for_vault(odds_fetched_at, max_minutes=75.0)
            staleness_mult = check_odds_staleness(odds_fetched_at, max_hours=1.0) if match.odds else 0.0

            vault_eligible = bool(
                best_bet
                and best_bet.odds > 1.0
                and odds_fresh
                and category in ("safe", "value")
                and value_rank in ("high", "medium")
                and match.league_tier < 5  # tier-5 / unknown leagues are analysis-only
                and (
                    "over 1.5" in best_bet.market.lower()
                    or "under 3.5" in best_bet.market.lower()
                )  # VAULT_APPROVED: only proven high-hit-rate markets
            )

            # Phase 1.5: Promote Over 1.5 Goals — boost vault priority
            vault_priority_boost = best_bet is not None and "over 1.5" in best_bet.market.lower()

            # Phase 1.3: BTTS blanking filter — check if either team has low scoring rate
            btts_blanking = False
            btts_blanking_reason = ""
            if best_bet and "btts" in best_bet.market.lower() and "no" not in best_bet.market.lower():
                btts_blanking, btts_blanking_reason = check_btts_blanking_risk({
                    "bet_type": best_bet.market,
                    "home_team": match.home_team,
                    "away_team": match.away_team,
                    "home_avg_scored": home_stats.avg_scored if home_stats else 0,
                    "away_avg_scored": away_stats.avg_scored if away_stats else 0,
                })
                if btts_blanking:
                    vault_eligible = False
                    _safe_print(f"[QuantPipeline]   ⚠️ {btts_blanking_reason}")

            # ── Kelly stake (ISSUE-01 fixed) ────────────────────────────────
            if best_bet and vault_eligible:
                # Kelly already applies kelly_fraction=0.25 internally in kelly_stake_pct().
                # Don't apply it again here.
                base_kelly = kelly_stake_pct(
                    best_bet.model_prob,
                    best_bet.odds,
                    best_bet.market,
                    best_bet.calibration_tier,
                )
                kelly = round(max(0, base_kelly * staleness_mult), 2)
            else:
                kelly = 0.0

            # ── Build prediction dict with RICH match stats ─────────────────
            pred = {
                "fixture_id": match.fixture_id,
                "league": match.league,
                "league_id": match.league_id,
                "league_tier": match.league_tier,
                "home_team": match.home_team,
                "home_team_id": match.home_team_id,
                "away_team": match.away_team,
                "away_team_id": match.away_team_id,
                "home_team_logo": match.home_logo,
                "away_team_logo": match.away_logo,
                "provider_source": getattr(match, "provider_source", "sportmonks"),
                "kickoff_utc": match.kickoff_utc,
                "kickoff_local": match.kickoff_local,
                # ── Best bet for this match ─────────────────────────────────
                "bet_type": best_bet.market if best_bet else "N/A",
                "prediction": best_bet.market if best_bet else "N/A",
                "probability": round(best_bet.model_prob, 4) if best_bet else 0,
                "confidence": round(best_bet.model_prob * 100, 1) if best_bet else 0,  # UI compat — misleading label kept
                "model_agreement": round(_model_agreement_for_bet(best_bet, probs), 2) if best_bet else 0,
                "data_quality": round(_data_quality_score(match, best_bet, odds_fresh, home_stats, away_stats), 2) if best_bet else 0,
                "odds": best_bet.odds if best_bet else 0,
                "pick_time_odds": best_bet.odds if best_bet else 0,
                "clv_tracked": True,
                "expected_value": best_bet.expected_value if best_bet else 0,
                "ev_pct": round(best_bet.expected_value * 100, 2) if best_bet else 0,
                "market_implied_prob": best_bet.market_prob if best_bet else 0,
                "inefficiency": best_bet.inefficiency if best_bet else 0,
                "kelly_stake": kelly,
                "raw_probability": round(best_bet.raw_model_prob, 4) if best_bet else 0,
                "calibrated_probability": round(best_bet.model_prob, 4) if best_bet else 0,
                "calibration_factor": best_bet.calibration_factor if best_bet else 1.0,
                "calibration_tier": best_bet.calibration_tier if best_bet else "none",
                "odds_fetched_at": odds_fetched_at,
                "odds_age_minutes": round(odds_age_min, 1) if odds_age_min is not None else None,
                "odds_fresh": odds_fresh,
                "vault_eligible": vault_eligible,
                "vault_priority_boost": vault_priority_boost,
                "btts_blanking_risk": btts_blanking,
                "btts_blanking_reason": btts_blanking_reason,
                "max_stake_pct": round(
                    market_max_stake_pct(best_bet.market, best_bet.calibration_tier) * 100,
                    2,
                ) if best_bet else 0,
                # OPP-03: Flag high-value away wins as potential upsets
                "upset_alert": best_bet is not None and best_bet.market == "Away Win" and best_bet.expected_value >= 0.05,
                # ── Match analysis data (rich stats for cards) ──────────────
                "expected_goals_home": round(mu_home, 2),
                "expected_goals_away": round(mu_away, 2),
                "home_form": home_form_str,
                "away_form": away_form_str,
                "home_win_rate": round(home_stats.win_rate * 100, 1),
                "away_win_rate": round(away_stats.win_rate * 100, 1),
                "home_avg_scored": round(home_stats.avg_scored, 2),
                "away_avg_scored": round(away_stats.avg_scored, 2),
                "home_avg_conceded": round(home_stats.avg_conceded, 2),
                "away_avg_conceded": round(away_stats.avg_conceded, 2),
                "home_clean_sheet_rate": round(home_stats.clean_sheet_rate * 100, 1),
                "away_clean_sheet_rate": round(away_stats.clean_sheet_rate * 100, 1),
                "home_xg_avg": round(home_stats.avg_xg_created, 2),
                "away_xg_avg": round(away_stats.avg_xg_created, 2),
                "home_possession": round(home_stats.avg_possession, 1),
                "away_possession": round(away_stats.avg_possession, 1),
                "home_shots_on_target": round(home_stats.avg_shots_on_target, 1),
                "away_shots_on_target": round(away_stats.avg_shots_on_target, 1),
                # ── Head-to-head ────────────────────────────────────────────
                "h2h_home_wins": match.h2h_home_wins,
                "h2h_away_wins": match.h2h_away_wins,
                "h2h_draws": match.h2h_draws,
                # ── Model probabilities (all markets) ───────────────────────
                "home_win_prob": round(probs.home_win, 4),
                "draw_prob": round(probs.draw, 4),
                "away_win_prob": round(probs.away_win, 4),
                "over25_prob": round(probs.over25, 4),
                "under25_prob": round(probs.under25, 4),
                "over15_prob": round(probs.over15, 4),
                "over35_prob": round(probs.over35, 4),
                "btts_prob": round(probs.btts, 4),
                "double_chance_1x": round(probs.double_chance_1x, 4),
                "double_chance_x2": round(probs.double_chance_x2, 4),
                # Over/Under 0.5 & 4.5 Goals
                "over05_prob": round(probs.over05, 4),
                "under05_prob": round(probs.under05, 4),
                "over45_prob": round(probs.over45, 4),
                "under45_prob": round(probs.under45, 4),
                # First Half markets
                "fh_over05_prob": round(probs.fh_over05, 4),
                "fh_over15_prob": round(probs.fh_over15, 4),
                "fh_btts_prob": round(probs.fh_btts, 4),
                "fh_home_win_prob": round(probs.fh_home_win, 4),
                "fh_draw_prob": round(probs.fh_draw, 4),
                "fh_away_win_prob": round(probs.fh_away_win, 4),
                # CAL-02: All three per-market confidence scores
                "result_confidence": round(probs.result_confidence, 4),
                "goals_confidence": round(probs.goals_confidence, 4),
                "btts_confidence": round(probs.btts_confidence, 4),
                # Legacy alias for backward compat with existing dashboard
                "model_confidence": round(probs.goals_confidence, 4),
                # ── Classification ──────────────────────────────────────────
                "category": category,
                "value_rank": value_rank,  # high / medium / low / none
                "status": "pending",
                "score": None,
                "sport": "football",
                "model": "quant",
                "model_version": "2026-07-v5",  # Audit trail: bump when weights/calibration change
                "generated_by": "quant_pipeline",
                "timestamp": _now_iso(),
                # All approved bets for this match (metadata)
                "all_value_bets": [
                    {
                        "market": b.market,
                        "prob": b.model_prob,
                        "raw_prob": b.raw_model_prob,
                        "odds": b.odds,
                        "ev": b.expected_value,
                        "calibration_tier": b.calibration_tier,
                    }
                    for b in approved_bets[:5]
                ],
                # Most likely scorelines from Poisson grid (for UI display)
                "top_scorelines": top_scorelines(compute_score_grid(mu_home, mu_away, rho), n=4),
                # Phase 1.6: Hedge Over 1.5 saver for high-confidence Over 2.5 picks
                "hedge_suggestion": {
                    "market": "Over 1.5 Goals",
                    "probability": round(probs.over15, 4),
                    "reason": "Insurance: if Over 2.5 fails by 1 goal, Over 1.5 still wins"
                } if (best_bet and "over 2.5" in best_bet.market.lower() and probs.over15 > 0.85) else None,
                # Corner prediction (xG-correlated — r≈0.65, ~1.2 corners per expected goal, calibrated from 14-day audit)
                "expected_corners": round((mu_home + mu_away) * 1.2, 1),
                "over85_corners_prob": round(_corner_over_prob(mu_home + mu_away, 8.5), 4),
                "over95_corners_prob": round(_corner_over_prob(mu_home + mu_away, 9.5), 4),
            }
            predictions.append(pred)

            # ── Add to accumulator pool — separate eligibility from vault ───
            acca_eligible = bool(
                best_bet
                and best_bet.odds > 1.0
                and odds_fresh
                and category in ("safe", "value")
                and value_rank in ("high", "medium")
                and match.league_tier < 5
            )
            if best_bet and acca_eligible:
                bet_pool.append({
                    "fixture_id": match.fixture_id,
                    "league": match.league,
                    "home_team": match.home_team,
                    "away_team": match.away_team,
                    "market": best_bet.market,
                    "odds": best_bet.odds,
                    "model_prob": best_bet.model_prob,
                    "expected_value": best_bet.expected_value,
                    "kickoff_utc": match.kickoff_utc,
                    "kickoff_local": match.kickoff_local,
                })

            # ── Accumulator pool: HIGHEST-probability pick per fixture (not EV pick) ──
            # Users want accumulators built from safest bets, not value bets
            acc_markets = [
                ("Over 1.5 Goals", probs.over15, best_bet.odds if best_bet and "over 1.5" in best_bet.market.lower() else 0),
                ("Over 2.5 Goals", probs.over25, best_bet.odds if best_bet and "over 2.5" in best_bet.market.lower() else 0),
                ("Under 2.5 Goals", probs.under25, best_bet.odds if best_bet and "under 2.5" in best_bet.market.lower() else 0),
                ("Under 3.5 Goals", probs.under35, best_bet.odds if best_bet and "under 3.5" in best_bet.market.lower() else 0),
                ("BTTS", probs.btts, best_bet.odds if best_bet and "btts" in best_bet.market.lower() else 0),
                ("Over 1.5 FH Goals", probs.fh_over15, 0),
                ("Over 0.5 FH Goals", probs.fh_over05, 0),
                ("Home Win", probs.home_win, best_bet.odds if best_bet and "home win" in best_bet.market.lower() else 0),
                ("Away Win", probs.away_win, best_bet.odds if best_bet and "away win" in best_bet.market.lower() else 0),
                ("Draw", probs.draw, best_bet.odds if best_bet and "draw" in best_bet.market.lower() else 0),
                ("DC 1X", probs.double_chance_1x, best_bet.odds if best_bet and "double chance (1x)" in best_bet.market.lower() else 0),
            ]
            # Filter to markets with probability >= 70% and odds > 1.0
            acc_candidates = [(m, p, o) for m, p, o in acc_markets if p >= 0.70 and o > 0]
            if acc_candidates:
                # Pick the highest probability market
                best_market, best_prob, best_odds = max(acc_candidates, key=lambda x: x[1])
                acc_pool.append({
                    "fixture_id": match.fixture_id,
                    "league": match.league,
                    "home_team": match.home_team,
                    "away_team": match.away_team,
                    "market": best_market,
                    "odds": best_odds,
                    "model_prob": round(best_prob, 4),
                    "expected_value": round(best_prob * best_odds - 1, 4) if best_odds > 0 else 0,
                    "category": "safe",
                    "kickoff_utc": match.kickoff_utc,
                    "kickoff_local": match.kickoff_local,
                })

            emoji = {"high": "🟢", "medium": "🟡", "low": "⚪", "none": "⚫"}.get(value_rank, "⚫")
            bet_label = best_bet.market if best_bet else "N/A"
            ev_label = f"EV {best_bet.expected_value:.1%}" if best_bet else "No odds"
            _safe_print(f"[QuantPipeline]   {emoji} {match.home_team} vs {match.away_team}: {bet_label} | {ev_label} | Rank={value_rank}")

        except Exception as e:
            _safe_print(f"[QuantPipeline]   ❌ Error processing {match.home_team} vs {match.away_team}: {e}", file=sys.stderr)
            import traceback
            traceback.print_exc()

    if not predictions:
        _safe_print("[QuantPipeline] No matches could be analyzed today.")
        return {"status": "skipped", "reason": "no_matches_analyzed", "date": date_str, "matches_analyzed": len(matches)}

    # ── Step 10: Generate accumulators ─────────────────────────────────────
    accas_dict = generate_accumulators(acc_pool, acc_pool)
    
    total_accas = sum(len(v) for v in accas_dict.values())
    _safe_print(f"[QuantPipeline] 🎰 Generated {total_accas} named accumulators across 4 tiers.")

    # ── Banker of the Day: single safest pick across all fixtures ──────────
    banker_pick = None
    if predictions:
        safe_bets = [p for p in predictions if p.get("category") == "safe" and p.get("_safest_bet")]
        if safe_bets:
            banker = max(safe_bets, key=lambda p: (
                p["_safest_bet"][1] if isinstance(p["_safest_bet"], list) else 0
            ))
            banker_pick = {
                "fixture_id": banker["fixture_id"],
                "home_team": banker["home_team"],
                "away_team": banker["away_team"],
                "league": banker["league"],
                "market": banker["_safest_bet"][0] if isinstance(banker["_safest_bet"], list) else str(banker["_safest_bet"]),
                "probability": round(float(banker["_safest_bet"][1] if isinstance(banker["_safest_bet"], list) else 0), 4),
                "odds": banker.get("odds", 0),
                "category": "safe",
                "status": "pending",
                "score": None,
                "result": None,
            }
            _safe_print(f"[QuantPipeline] 🏦 Banker of the Day: {banker_pick['home_team']} vs {banker_pick['away_team']} — {banker_pick['market']} ({round(banker_pick['probability']*100)}%)")

    # ── Step 11: Save to Firestore ─────────────────────────────────────────
    # Create two payloads: public (basic data) and VIP (full analysis)
    predictions_public = [
        {
            "fixture_id": p["fixture_id"],
            "league": p["league"],
            "league_id": p["league_id"],
            "league_tier": p["league_tier"],
            "home_team": p["home_team"],
            "home_team_id": p["home_team_id"],
            "away_team": p["away_team"],
            "away_team_id": p["away_team_id"],
            "home_team_logo": p["home_team_logo"],
            "away_team_logo": p["away_team_logo"],
            "provider_source": p["provider_source"],
            "kickoff_utc": p["kickoff_utc"],
            "kickoff_local": p["kickoff_local"],
            "category": p["category"],
            "value_rank": p["value_rank"],
            "status": p["status"],
            "score": p["score"],
            "sport": p["sport"],
            "model": p["model"],
            "timestamp": p["timestamp"],
            "prediction": p.get("prediction"),
            "prediction_en": p.get("prediction_en", p.get("prediction")),
            "prediction_fr": p.get("prediction_fr", p.get("prediction")),
            "odds": p.get("odds"),
            "probability": p.get("probability"),
            "confidence": p.get("confidence"),
            "analysis_en": p.get("analysis_en"),
            "analysis_fr": p.get("analysis_fr"),
            "home_form": p.get("home_form"),
            "away_form": p.get("away_form"),
            "expected_goals_home": p.get("expected_goals_home"),
            "expected_goals_away": p.get("expected_goals_away"),
            "expected_corners": p.get("expected_corners"),
            "over85_corners_prob": p.get("over85_corners_prob"),
            "over95_corners_prob": p.get("over95_corners_prob"),
            "fh_over05_prob": p.get("fh_over05_prob"),
            "fh_over15_prob": p.get("fh_over15_prob"),
            "fh_btts_prob": p.get("fh_btts_prob"),
            # Probability fields for analysis display
            "home_win_prob": p.get("home_win_prob"),
            "draw_prob": p.get("draw_prob"),
            "away_win_prob": p.get("away_win_prob"),
            "over25_prob": p.get("over25_prob"),
            "over15_prob": p.get("over15_prob"),
            "btts_prob": p.get("btts_prob"),
            "double_chance_1x": p.get("double_chance_1x"),
            "double_chance_x2": p.get("double_chance_x2"),
            "top_scorelines": p.get("top_scorelines"),
            "fh_home_win_prob": p.get("fh_home_win_prob"),
            "fh_draw_prob": p.get("fh_draw_prob"),
            "fh_away_win_prob": p.get("fh_away_win_prob"),
            # Vault / EV fields
            "ev_pct": p.get("ev_pct"),
            "expected_value": p.get("expected_value"),
            "kelly_stake": p.get("kelly_stake"),
            "inefficiency": p.get("inefficiency"),
            "data_quality": p.get("data_quality"),
            "odds_fresh": p.get("odds_fresh"),
            "vault_eligible": p.get("vault_eligible"),
            "calibration_tier": p.get("calibration_tier"),
            "calibrated_probability": p.get("calibrated_probability"),
            "bet_type": p.get("bet_type"),
        }
        for p in predictions
    ]

    doc = {
        "date": date_str,
        "status": "completed",
        "predictions": predictions_public,
        "matches_analyzed": len(matches),
        "value_bets_found": len([p for p in predictions if p["value_rank"] in ("high", "medium")]),
        "total_analyzed": len(predictions),
        "generated_at": _now_iso(),
        "generated_by": "quant_pipeline",
    }

    # VIP document with full analysis data (EV, Kelly, model probabilities, etc.)
    vip_doc = {
        "date": date_str,
        "status": "completed",
        "predictions": predictions,
        "accumulators": accas_dict,
        "matches_analyzed": len(matches),
        "value_bets_found": len([p for p in predictions if p["value_rank"] in ("high", "medium")]),
        "total_analyzed": len(predictions),
        "generated_at": _now_iso(),
        "generated_by": "quant_pipeline",
    }

    if not dry_run:
        db = _get_firestore() # Re-fetch db if not dry_run
        if db:
            try:
                db.collection("quant_predictions").document(date_str).set(doc)
                _safe_print(f"[QuantPipeline] 💾 Saved {len(predictions)} match analyses to Firestore for {date_str}")
                try:
                    db.collection("quant_vip").document(date_str).set(vip_doc)
                    _safe_print(f"[QuantPipeline] 💾 Saved VIP analyses to quant_vip/{date_str}")
                except Exception as ve:
                    _safe_print(f"[QuantPipeline]   ⚠️  VIP save failed (non-fatal): {ve}", file=sys.stderr)
                # Save Banker of the Day
                if banker_pick:
                    try:
                        banker_doc = {
                            "date": date_str,
                            "pick": banker_pick,
                            "generated_at": _now_iso(),
                            "model_version": "2026-07-v5",
                        }
                        db.collection("banker_picks").document(date_str).set(banker_doc)
                        _safe_print(f"[QuantPipeline] 🏦 Banker saved to banker_picks/{date_str}")
                    except Exception as be:
                        _safe_print(f"[QuantPipeline]   ⚠️  Banker save failed (non-fatal): {be}", file=sys.stderr)
                # Update Elo ratings
                save_dirty_ratings()
            except Exception as e:
                _safe_print(f"[QuantPipeline]   ❌ Error saving to Firestore: {e}", file=sys.stderr)
        else:
            _safe_print("[QuantPipeline] ⚠️  Firestore unavailable — skipping save.", file=sys.stderr)
    else:
        _safe_print(f"[QuantPipeline] 🛑 Dry run: Skipping Firestore save.")

    _safe_print(f"\n[QuantPipeline] ✅ Pipeline complete!")
    _safe_print(f"  Matches analyzed: {len(matches)}")
    _safe_print(f"  Predictions generated: {len(predictions)}")
    value_count = len([p for p in predictions if p["value_rank"] in ("high", "medium")])
    _safe_print(f"  Value bets (high/medium): {value_count}")
    _safe_print(f"  Accumulators: {total_accas}")
    for tier_name, tier_list in accas_dict.items():
        if tier_list:
            t = tier_list[0]
            _safe_print(f"    {t.get('tier_icon', '')} {t.get('tier_label', tier_name)}: {t['combined_odds']:.2f}x ({t['leg_count']} legs)")

    return {
        "status": "success",
        "date": date_str,
        "generated": len(predictions),
        "matches_analyzed": len(matches),
        "predictions": predictions,
        "accumulators": accas_dict,
    }


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    date_arg = next((a for a in sys.argv[1:] if not a.startswith("--")), None)

    result = run_pipeline(date_arg, dry_run=dry_run)

    if result["status"] == "success":
        print(f"\n{'='*60}")
        print(f"OUTPUT SUMMARY ({result['date']})")
        print(f"{'='*60}")
        print(f"Matches analyzed: {result['matches_analyzed']}")
        print(f"Value bets found: {result['generated']}")
        print(f"\nPREDICTIONS:")
        for p in result["predictions"]:
            print(f"  {p['home_team']} vs {p['away_team']}")
            print(f"    Bet: {p['bet_type']}")
            print(f"    Prob: {p['confidence']}% | Odds: {p['odds']} | EV: +{p['ev_pct']}% | Kelly: {p['kelly_stake']}%")
    else:
        print(f"\n[STATUS] {result['status']}: {result.get('reason', '')}")
