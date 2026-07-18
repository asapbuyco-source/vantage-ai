"""
data_pipeline.py
────────────────
Fetches and normalizes match + team data from sport-highlights-api (RapidAPI).
Outputs a list of enriched MatchData objects ready for the model pipeline.

Data sources:
  - sport-highlights-api (fixtures, match details, AI consensus predictions)
  - sportscore_client / free_data_client (team form, odds)
  - API-Football (H2H data — free plan)
"""

import os
import sys
import math
import time
import requests
import urllib3
urllib3.disable_warnings()
from datetime import datetime, timedelta, timezone

LAGOS_TZ = timezone(timedelta(hours=1))
from dataclasses import dataclass, field
from typing import Optional
from league_config import APPROVED_LEAGUE_IDS, TIER_PRIORITY, get_league_info, get_league_info_by_name, get_priority_score

# ── Config ────────────────────────────────────────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), '..', '..', '.env.local'))
except ImportError:
    pass

MAX_MATCHES = 100
RECENT_DAYS = 90  # Look back 90 days for form data

# API-Football (for H2H data — free plan, 100 calls/day)
AF_KEY = os.environ.get("API_FOOTBALL_KEY", "")
AF_BASE = "https://v3.football.api-sports.io"

# ── Sportmonks compatibility (for cache-based backtesting) ──────────────────
SM_TOKEN = ""
try:
    from api_football_client import _get
except ImportError:
    def _get(path, params=None):
        return None

def _get_paginated(path, params=None, max_pages=5):
    return _get(path, params)

# ── ClubElo Seeding (override manual club Elo system) ───────────────────────
def _seed_club_elo_cache():
    """Seed Elo cache from ClubElo at startup."""
    try:
        from clubelo_client import seed_elo_cache as _seed_elo
        elos = _seed_elo()
        if elos:
            print(f"[DataPipeline] ClubElo cache seeded with {len(elos)} ratings", file=sys.stderr)
    except Exception as e:
        print(f"[DataPipeline] ClubElo seeding failed (non-fatal): {e}", file=sys.stderr)

_club_elo_seeded = False
def _ensure_club_elo_seeded():
    global _club_elo_seeded
    if not _club_elo_seeded:
        _seed_club_elo_cache()
        _club_elo_seeded = True

# ── League Average Goals Helper ────────────────────────────────────────────────
_LEAGUE_AVG_CACHE = {}

# Per-league average total goals per game (approximate — update from API data)
_LEAGUE_GPG = {
    # Tier 1
    2:   2.85, 3: 2.75, 5: 2.75, 8: 2.80, 39: 2.80, 78: 3.10, 82: 3.10,
    135: 2.60, 140: 2.50, 384: 2.60, 564: 2.50,
    # Tier 2
    61:  2.70, 72: 3.20, 98: 2.80, 138: 2.75, 169: 3.30, 262: 2.70, 301: 2.70,
    462: 2.50, 1204: 2.70, 848: 2.65,
    # Tier 3
    71:  2.35, 85: 2.60, 103: 2.80, 113: 2.70, 176: 2.60, 244: 2.50, 253: 2.80,
    255: 2.60, 288: 2.55, 292: 2.50, 302: 2.30, 325: 2.20, 395: 2.20,
    401: 2.30, 567: 2.10, 570: 2.70,
    # Tier 4 (low-scoring / high variance)
    10:  2.40, 12: 2.30, 14: 2.50, 51: 2.20, 254: 2.00, 256: 2.60, 388: 2.40,
    667: 2.80,  # friendlies — high variance
}

def _league_avg(league_id: int) -> float:
    """Return average total goals for a league (cached)."""
    if league_id in _LEAGUE_AVG_CACHE:
        return _LEAGUE_AVG_CACHE[league_id]
    avg = _LEAGUE_GPG.get(league_id, 2.65)  # per-league fallback, else default
    _LEAGUE_AVG_CACHE[league_id] = avg
    return avg


def _form_score(results: list[str]) -> float:
    """Return a 0-1 normalized points score from W/D/L form results."""
    if not results:
        return 0.5
    points = sum(3 if r == "W" else 1 if r == "D" else 0 for r in results)
    return points / (3 * len(results))


def _win_rate(results: list[str]) -> float:
    if not results:
        return 0.0
    return sum(1 for r in results if r == "W") / len(results)


# ── Data Structures ───────────────────────────────────────────────────────────
@dataclass
class TeamStats:
    team_id: int
    team_name: str
    avg_scored: float = 0.0
    avg_conceded: float = 0.0
    home_avg_scored: float = 0.0
    home_avg_conceded: float = 0.0
    away_avg_scored: float = 0.0
    away_avg_conceded: float = 0.0
    form: str = "N/A"          # e.g. "W W D L W"
    form_score: float = 0.5    # 0–1 normalized
    win_rate: float = 0.0
    clean_sheet_rate: float = 0.0
    matches_analyzed: int = 0

    # --- Advanced Form Metrics ---
    avg_xg_created: float = 0.0
    avg_xg_conceded: float = 0.0
    avg_possession: float = 50.0
    avg_shots_on_target: float = 0.0
    sidelined_count: int = 0

    # FIX-6: Opponent strengths for form model (opponent Elo ratings)
    recent_opponents: list[int] = field(default_factory=list)


@dataclass
class OddsData:
    home_odds: float = 0.0
    draw_odds: float = 0.0
    away_odds: float = 0.0
    over25_odds: float = 0.0
    under25_odds: float = 0.0
    over15_odds: float = 0.0
    under15_odds: float = 0.0
    over35_odds: float = 0.0
    under35_odds: float = 0.0
    btts_yes_odds: float = 0.0
    btts_no_odds: float = 0.0
    # OPP-01: Composite odds
    btts_and_over25_odds: float = 0.0
    # Double Chance
    dc_1x_odds: float = 0.0
    dc_x2_odds: float = 0.0
    dc_12_odds: float = 0.0
    # Draw No Bet
    dnb_home_odds: float = 0.0
    dnb_away_odds: float = 0.0
    # Asian Handicap -0.5 (equivalent to DNB but priced differently)
    ah_home_minus05: float = 0.0
    ah_away_plus05: float = 0.0
    # First Half odds (Phase 2.1)
    fh_over05_odds: float = 0.0
    fh_over15_odds: float = 0.0
    fh_btts_odds: float = 0.0
    fh_home_odds: float = 0.0
    fh_draw_odds: float = 0.0
    fh_away_odds: float = 0.0
    # Corner odds (Phase 2.5)
    corners_over85_odds: float = 0.0
    corners_over95_odds: float = 0.0
    # Correct Score & Asian Handicap (Phase 2.2-2.3) — dict fields
    correct_score_odds: dict = field(default_factory=dict)
    asian_handicap_odds: dict = field(default_factory=dict)
    # Line movement tracking (Upgrade #3)
    opening_home_odds: float = 0.0
    opening_away_odds: float = 0.0
    opening_draw_odds: float = 0.0
    odds_fetched_at: str = ""  # ISO timestamp for staleness guard
    odds_last_bookmaker_update: str = ""  # When the bookmaker last updated the line

    def has_odds(self) -> bool:
        return self.home_odds > 1.0 and self.away_odds > 1.0


@dataclass
class MatchData:
    fixture_id: str
    league: str
    league_id: int
    league_tier: int
    home_team: str
    home_team_id: int
    away_team: str
    away_team_id: int
    kickoff_utc: str
    kickoff_local: str
    home_logo: str = ""
    away_logo: str = ""
    provider_source: str = "sport_highlights"
    home_stats: Optional[TeamStats] = None
    away_stats: Optional[TeamStats] = None
    home_sidelined_count: int = 0
    away_sidelined_count: int = 0
    h2h_home_wins: int = 0
    h2h_away_wins: int = 0
    h2h_draws: int = 0
    h2h_avg_goals: float = 0.0
    h2h_btts_rate: float = 0.0
    odds: OddsData = field(default_factory=OddsData)
    # Derived fields (filled by model pipeline)
    expected_goals_home: float = 0.0
    expected_goals_away: float = 0.0
    sm_pred_home_win: float = 0.0
    sm_pred_draw: float = 0.0
    sm_pred_away_win: float = 0.0
    sm_pred_available: bool = False
    # Pinnacle odds (sharpest lines for EV verification)
    pinnacle_home: float = 0.0
    pinnacle_draw: float = 0.0
    pinnacle_away: float = 0.0
    pinnacle_over25: float = 0.0
    pinnacle_under25: float = 0.0
    pinnacle_over15: float = 0.0
    pinnacle_over35: float = 0.0
    pinnacle_btts_yes: float = 0.0
    pinnacle_btts_no: float = 0.0


# ── API Helpers ───────────────────────────────────────────────────────────────
# (Sportmonks helpers removed — using sport_highlights_client instead)


def _af_fetch_fixtures(date_str: str) -> list:
    """Fallback fixture source when Sportmonks returns an empty slate.

    API-Football fallback intentionally does not create value bets by itself
    because odds may be unavailable. It keeps the dashboard populated with
    real fixtures and model probability leans instead of leaving users with a
    blank day.
    """
    if not AF_KEY:
        print("[DataPipeline] API-Football fallback skipped: API_FOOTBALL_KEY is not configured.", file=sys.stderr)
        return []

    data = _af_get("fixtures", {"date": date_str, "timezone": "Africa/Lagos"})
    rows = data.get("response", []) if isinstance(data, dict) else []
    if not rows:
        errors = data.get("errors") if isinstance(data, dict) else None
        print(f"[DataPipeline] API-Football fallback returned 0 fixtures for {date_str}. errors={str(errors)[:300]}", file=sys.stderr)
        return []

    fixtures = []
    for row in rows[:MAX_MATCHES]:
        fixture = row.get("fixture", {}) or {}
        league = row.get("league", {}) or {}
        teams = row.get("teams", {}) or {}
        home = teams.get("home", {}) or {}
        away = teams.get("away", {}) or {}
        if not fixture.get("id") or not home.get("id") or not away.get("id"):
            continue
        fixtures.append({
            "_provider": "api_football",
            "id": fixture.get("id"),
            "league_id": league.get("id") or 0,
            "league": {
                "id": league.get("id") or 0,
                "name": league.get("name") or "Unknown League",
                "image_path": league.get("logo") or "",
            },
            "starting_at": fixture.get("date") or "",
            "participants": [
                {
                    "id": home.get("id"),
                    "name": home.get("name") or "Home",
                    "image_path": home.get("logo") or "",
                    "meta": {"location": "home"},
                },
                {
                    "id": away.get("id"),
                    "name": away.get("name") or "Away",
                    "image_path": away.get("logo") or "",
                    "meta": {"location": "away"},
                },
            ],
            "scores": [],
            "odds": [],
            "statistics": [],
            "sidelined": [],
        })

    print(f"[DataPipeline] API-Football fallback supplied {len(fixtures)} fixtures for {date_str}.")
    return fixtures


def fetch_matches(date_str: str | None = None) -> list[MatchData]:
    """
    Fetch and normalize matches for the given date (YYYY-MM-DD) using
    API-Football as the centralized data source (fixtures, odds, predictions, stats).
    Returns a list of MatchData sorted by league tier.
    """
    if date_str is None:
        date_str = datetime.now(LAGOS_TZ).strftime("%Y-%m-%d")

    print(f"[DataPipeline] Fetching fixtures for {date_str} via API-Football...")

    from api_football_client import (
        fetch_fixtures_by_date, fetch_odds_for_fixture,
        fetch_predictions, fetch_team_form_and_xg, fetch_injuries,
        reset_call_counts, log_api_summary, _fetch_h2h_cached
    )
    reset_call_counts()

    target_date = datetime.strptime(date_str, "%Y-%m-%d")
    next_date_str = (target_date + timedelta(days=1)).strftime("%Y-%m-%d")

    try:
        raw_fixtures = fetch_fixtures_by_date(date_str) or []
        next_fixtures = fetch_fixtures_by_date(next_date_str) or []
    except Exception as e:
        if "RateLimitError" in str(type(e).__name__):
            print(f"[DataPipeline] 🛑 FATAL: API-Football Rate Limit Reached! Cannot fetch fixtures for {date_str}.", file=sys.stderr)
        else:
            print(f"[DataPipeline] Error fetching fixtures: {e}", file=sys.stderr)
        return []
    
    # Deduplicate in case API returns overlaps
    seen_ids = set()
    all_fixtures = []
    for fix in raw_fixtures + next_fixtures:
        fid = fix.get("fixture", {}).get("id")
        if fid and fid not in seen_ids:
            seen_ids.add(fid)
            all_fixtures.append(fix)

    if not all_fixtures:
        print("[DataPipeline] No fixtures found for this date or the next.", file=sys.stderr)
        return []

    # ── Step 1: Filter to approved leagues & future time ──────────────
    now_utc = datetime.now(timezone.utc)
    
    # A "betting day" runs from 00:00 Lagos Time to 06:00 Lagos Time the following day (30-hour window)
    target_start_utc = target_date.replace(tzinfo=LAGOS_TZ).astimezone(timezone.utc)
    target_end_utc = target_start_utc + timedelta(hours=30)
    
    approved = []
    for fix in all_fixtures:
        lid = fix.get("league", {}).get("id")
        league_info = get_league_info(lid)
        if not league_info:
            continue
            
        status = fix.get("fixture", {}).get("status", {}).get("short")
        if status in ["FT", "AET", "PEN", "CANC", "PSTP", "ABD"]:
            continue # skip finished or cancelled

        starting_at = fix.get("fixture", {}).get("date", "")
        if starting_at:
            try:
                kick = datetime.fromisoformat(starting_at.replace("Z", "+00:00"))
                if kick.tzinfo is None:
                    kick = kick.replace(tzinfo=timezone.utc)
                
                # Filter strictly to our extended 30-hour betting day window
                if not (target_start_utc <= kick < target_end_utc):
                    continue
                    
                # If starting within 30 mins from now, skip to ensure odds haven't closed
                if kick <= (now_utc + timedelta(minutes=30)):
                    continue
            except Exception:
                pass
                
        tier = league_info["tier"]
        priority = get_priority_score(lid)
        approved.append({
            "raw": fix,
            "league_id": lid,
            "league_name": league_info["name"],
            "league_tier": tier,
            "priority": priority
        })

    approved.sort(key=lambda x: x["priority"], reverse=True)
    approved = approved[:MAX_MATCHES]
    print(f"[DataPipeline] Final fixtures for analysis: {len(approved)}")

    matches: list[MatchData] = []
    
    for entry in approved:
        fix = entry["raw"]
        fixture_id = fix["fixture"]["id"]
        lid = entry["league_id"]
        
        home_team = fix["teams"]["home"]
        away_team = fix["teams"]["away"]
        home_id = home_team["id"]
        away_id = away_team["id"]
        home_name = home_team["name"]
        away_name = away_team["name"]
        
        kickoff_utc = fix["fixture"]["date"]
        try:
            kick_utc = datetime.fromisoformat(kickoff_utc.replace("Z", "+00:00"))
            kick_lagos = kick_utc + timedelta(hours=1)
            kickoff_local = kick_lagos.strftime("%H:%M")
        except Exception:
            kickoff_local = kickoff_utc

        md = MatchData(
            fixture_id=str(fixture_id),
            league=entry["league_name"],
            league_id=lid,
            league_tier=entry["league_tier"],
            home_team=home_name,
            home_team_id=home_id,
            away_team=away_name,
            away_team_id=away_id,
            kickoff_utc=kickoff_utc,
            kickoff_local=kickoff_local,
            home_logo=home_team.get("logo", ""),
            away_logo=away_team.get("logo", ""),
            provider_source="api_football",
        )

        # ── Enrich: Native Odds (100% Match Rate) ──────────────
        try:
            odds_dict = fetch_odds_for_fixture(fixture_id)
            if odds_dict:
                md.odds = OddsData(
                    home_odds=odds_dict.get("home_odds", 0.0),
                    draw_odds=odds_dict.get("draw_odds", 0.0),
                    away_odds=odds_dict.get("away_odds", 0.0),
                    over25_odds=odds_dict.get("over25_odds", 0.0),
                    under25_odds=odds_dict.get("under25_odds", 0.0),
                    over15_odds=odds_dict.get("over15_odds", 0.0),
                    under15_odds=odds_dict.get("under15_odds", 0.0),
                    over35_odds=odds_dict.get("over35_odds", 0.0),
                    under35_odds=odds_dict.get("under35_odds", 0.0),
                    btts_yes_odds=odds_dict.get("btts_yes_odds", 0.0),
                    btts_no_odds=odds_dict.get("btts_no_odds", 0.0),
                    dc_1x_odds=odds_dict.get("dc_1x_odds", 0.0),
                    dc_12_odds=odds_dict.get("dc_12_odds", 0.0),
                    dc_x2_odds=odds_dict.get("dc_x2_odds", 0.0),
                    dnb_home_odds=odds_dict.get("dnb_home_odds", 0.0),
                    dnb_away_odds=odds_dict.get("dnb_away_odds", 0.0),
                    # Phase 2: First Half odds
                    fh_over05_odds=odds_dict.get("fh_over05_odds", 0.0),
                    fh_over15_odds=odds_dict.get("fh_over15_odds", 0.0),
                    fh_home_odds=odds_dict.get("fh_home_odds", 0.0),
                    fh_draw_odds=odds_dict.get("fh_draw_odds", 0.0),
                    fh_away_odds=odds_dict.get("fh_away_odds", 0.0),
                    # Phase 2: Corner odds
                    corners_over85_odds=odds_dict.get("corners_over85_odds", 0.0),
                    corners_over95_odds=odds_dict.get("corners_over95_odds", 0.0),
                    # Phase 2: Correct Score & Asian Handicap
                    correct_score_odds=odds_dict.get("correct_score_odds", {}),
                    asian_handicap_odds=odds_dict.get("asian_handicap_odds", {}),
                    odds_fetched_at=datetime.now(timezone.utc).isoformat()
                )
        except Exception as e:
            print(f"[DataPipeline] Odds fetch error for {home_name} vs {away_name}: {e}", file=sys.stderr)

        # ── Enrich: Predictions (Restoring 10% AI Consensus) ──────────────
        try:
            preds = fetch_predictions(fixture_id)
            if preds and preds.get("home_win"):
                hw_str = str(preds.get("home_win", "0%")).replace("%", "")
                dr_str = str(preds.get("draw", "0%")).replace("%", "")
                aw_str = str(preds.get("away_win", "0%")).replace("%", "")
                md.sm_pred_home_win = float(hw_str) / 100.0
                md.sm_pred_draw = float(dr_str) / 100.0
                md.sm_pred_away_win = float(aw_str) / 100.0
                md.sm_pred_available = True
        except Exception as e:
            print(f"[DataPipeline] Predictions fetch error for {fixture_id}: {e}", file=sys.stderr)

        # ── Enrich: Form & xG (No more rate limits) ──────────────
        try:
            home_form_str, home_avg_sc, home_avg_con = fetch_team_form_and_xg(home_id, limit=20)
            away_form_str, away_avg_sc, away_avg_con = fetch_team_form_and_xg(away_id, limit=20)
            
            home_form = home_form_str[:9] if home_form_str else "N/A"
            away_form = away_form_str[:9] if away_form_str else "N/A"
            home_results = [r for r in home_form_str.split() if r in {"W", "D", "L"}]
            away_results = [r for r in away_form_str.split() if r in {"W", "D", "L"}]

            md.home_stats = TeamStats(
                team_id=home_id, team_name=home_name,
                form=home_form,
                form_score=_form_score(home_results),
                win_rate=_win_rate(home_results),
                matches_analyzed=len(home_results),
                home_avg_scored=home_avg_sc or 0.0,
                home_avg_conceded=home_avg_con or 0.0,
                avg_scored=home_avg_sc or 0.0,
                avg_conceded=home_avg_con or 0.0,
                avg_xg_created=(home_avg_sc or 0.0) * 0.95,
                avg_xg_conceded=(home_avg_con or 0.0) * 0.95,
            )
            md.away_stats = TeamStats(
                team_id=away_id, team_name=away_name,
                form=away_form,
                form_score=_form_score(away_results),
                win_rate=_win_rate(away_results),
                matches_analyzed=len(away_results),
                away_avg_scored=away_avg_sc or 0.0,
                away_avg_conceded=away_avg_con or 0.0,
                avg_scored=away_avg_sc or 0.0,
                avg_conceded=away_avg_con or 0.0,
                avg_xg_created=(away_avg_sc or 0.0) * 0.95,
                avg_xg_conceded=(away_avg_con or 0.0) * 0.95,
            )
            
            league_avg = _league_avg(lid)
            # Use actual form averages for expected goals, fallback to league_avg
            if home_avg_sc is not None and away_avg_sc is not None:
                md.expected_goals_home = max(0.5, home_avg_sc)
                md.expected_goals_away = max(0.5, away_avg_sc)
                xg_source = "AF-Form"
            else:
                md.expected_goals_home = max(0.75, league_avg / 2)
                md.expected_goals_away = max(0.60, league_avg / 2)
                xg_source = "League-Avg"

        except Exception as e:
            print(f"[DataPipeline] Form/xG fetch error for {fixture_id}: {e}", file=sys.stderr)
            md.expected_goals_home = max(0.75, _league_avg(lid) / 2)
            md.expected_goals_away = max(0.60, _league_avg(lid) / 2)
            xg_source = "League-Avg (Error)"

        # ── Enrich: Team Season Stats (real xG) ──────────────────────────
        try:
            from api_football_client import fetch_team_season_stats
            home_season = fetch_team_season_stats(home_id, lid)
            away_season = fetch_team_season_stats(away_id, lid)

            if home_season and home_season.get("xg_for", 0) > 0:
                md.home_stats.avg_xg_created = home_season.get("xg_for", 0)

            # ── Low-xG penalty ──────────────────────────────────────────
            if home_avg_sc is not None and home_avg_sc < 1.0:
                deficit = (1.0 - home_avg_sc) / 1.0
                penalty = 1.0 - deficit * 0.15
                md.expected_goals_home *= max(0.80, penalty)
            if away_avg_sc is not None and away_avg_sc < 1.0:
                deficit = (1.0 - away_avg_sc) / 1.0
                penalty = 1.0 - deficit * 0.15
                md.expected_goals_away *= max(0.80, penalty)

            # ── League-specific xG cap ──────────────────────────────────
            league_gpg = _league_avg(lid)
            if league_gpg < 2.4:
                md.expected_goals_home = min(md.expected_goals_home, league_gpg * 0.75)
                md.expected_goals_away = min(md.expected_goals_away, league_gpg * 0.70)
        except Exception as e:
            print(f"[DataPipeline] Team stats fetch error for {fixture_id}: {e}", file=sys.stderr)

        # ── Enrich: Pinnacle Odds (sharpest lines for EV verification) ───
        try:
            from api_football_client import fetch_pinnacle_odds
            pinnacle = fetch_pinnacle_odds(fixture_id)
            if pinnacle:
                md.pinnacle_home = pinnacle.get("pinnacle_home", 0.0)
                md.pinnacle_draw = pinnacle.get("pinnacle_draw", 0.0)
                md.pinnacle_away = pinnacle.get("pinnacle_away", 0.0)
                md.pinnacle_over25 = pinnacle.get("pinnacle_over25", 0.0)
                md.pinnacle_under25 = pinnacle.get("pinnacle_under25", 0.0)
                md.pinnacle_btts_yes = pinnacle.get("pinnacle_btts_yes", 0.0)
                md.pinnacle_btts_no = pinnacle.get("pinnacle_btts_no", 0.0)
        except Exception as e:
            print(f"[DataPipeline] Pinnacle odds fetch error for {fixture_id}: {e}", file=sys.stderr)

        # ── Enrich: Injuries (New Feature) ──────────────
        try:
            injuries = fetch_injuries(fixture_id)
            md.home_sidelined_count = injuries.get(home_id, 0)
            md.away_sidelined_count = injuries.get(away_id, 0)
        except Exception as e:
            print(f"[DataPipeline] Injuries fetch error for {fixture_id}: {e}", file=sys.stderr)

        # ── Fetch H2H (Cached) ──────────────
        try:
            hw, aw, dr, avg_g, btts_r = _fetch_h2h_cached(
                home_id, away_id
            )
            md.h2h_home_wins = hw
            md.h2h_away_wins = aw
            md.h2h_draws = dr
            md.h2h_avg_goals = avg_g
            md.h2h_btts_rate = btts_r
        except Exception as e:
            md.h2h_avg_goals = _league_avg(lid)

        matches.append(md)
        print(f"[DataPipeline]   [OK] {home_name} vs {away_name} "
              f"(xG: {md.expected_goals_home:.2f}-{md.expected_goals_away:.2f} [{xg_source}])")

    # ── Step 6: Grade past matches (Feedback Loop) ──────────────
    # Grading is handled by a separate cron job in scheduler.js (22:00 Lagos)

    log_api_summary(fixtures_analyzed=len(matches))
    return matches
