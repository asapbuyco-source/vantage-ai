"""
elo_rating.py
─────────────
Elo rating system for football teams.
Ratings are persisted in Firestore `elo_ratings/{teamId}`.
Provides match outcome probabilities from Elo spread.
"""

import math
import os
from typing import Optional


# ── Elo constants ──────────────────────────────────────────────────────────────
DEFAULT_ELO = 1500.0
K_FACTOR = 20.0          # Default K — overridden per-league by LEAGUE_K_FACTOR
HOME_ADVANTAGE = 55.0    # Default Elo points added to home team
DRAW_PROB_BASE = 0.26    # Base draw probability correction

# ── League-specific K-factor (MODEL-03) ───────────────────────────────────────
# Higher K = results in this competition teach the model more per match.
# Elite continental competitions carry more information value.
# NOTE: league IDs are API-Football space (the pipeline's fixture source).
LEAGUE_K_FACTOR: dict[int, float] = {
    2:   30.0,  # UEFA Champions League — highest information
    3:   28.0,  # UEFA Europa League
    848: 25.0,  # UEFA Conference League
    39:  22.0,  # English Premier League
    140: 22.0,  # La Liga
    78:  22.0,  # Bundesliga
    135: 22.0,  # Serie A
    61:  20.0,  # Ligue 1
    88:  19.0,  # Eredivisie
    # All other leagues use the default K_FACTOR (20.0)
}

# ── Derby / Rivalry pairs ─────────────────────────────────────────────────────
# Checked by BOTH API-Football team IDs (primary fixture source) and normalized
# team NAMES (robust to any ID system). Used by quant_pipeline to set is_derby=True
# for the Dixon-Coles rho computation, boosting 0-0 and 1-1 scoreline probability.
DERBY_PAIRS: set[frozenset] = {
    frozenset({541, 529}),    # El Clásico — Real Madrid vs Barcelona
    frozenset({50, 33}),      # Man City vs Man United
    frozenset({42, 49}),      # Arsenal vs Chelsea
    frozenset({40, 49}),      # Liverpool vs Chelsea
    frozenset({42, 40}),      # Arsenal vs Liverpool
    frozenset({157, 165}),    # Bayern Munich vs Borussia Dortmund (Der Klassiker)
    frozenset({505, 496}),    # Inter vs Juventus (Derby d'Italia)
    frozenset({497, 487}),    # Roma vs Lazio (Derby della Capitale)
    frozenset({47, 33}),      # Tottenham vs Man United
    frozenset({47, 42}),      # Tottenham vs Arsenal (North London Derby)
    frozenset({85, 80}),      # PSG vs Lyon (Le Classique)
}

# Same derbies by normalized club names — independent of any ID numbering system.
DERBY_NAME_PAIRS: set[frozenset] = {
    frozenset({"real madrid", "barcelona"}),
    frozenset({"manchester city", "manchester united"}),
    frozenset({"arsenal", "chelsea"}),
    frozenset({"liverpool", "chelsea"}),
    frozenset({"arsenal", "liverpool"}),
    frozenset({"bayern", "borussia dortmund"}),
    frozenset({"inter", "juventus"}),
    frozenset({"roma", "lazio"}),
    frozenset({"tottenham", "manchester united"}),
    frozenset({"tottenham", "arsenal"}),
    frozenset({"paris saint germain", "lyon"}),
    frozenset({"psg", "lyon"}),
    frozenset({"wydad", "al ahly"}),
}


def _norm_name(name: str) -> str:
    return (name or "").strip().lower().replace("fc", "").replace("cf", "").replace("ac", "").replace("sc", "").strip()


def is_derby_match(home_team_id: int, away_team_id: int, home_team_name: str = "", away_team_name: str = "") -> bool:
    """Return True if this fixture is a known rivalry/derby match.
    Checks API-Football ID pairs first, then normalized team-name pairs (robust
    to any ID system, including the Sportmonks tables no longer in use)."""
    if frozenset({home_team_id, away_team_id}) in DERBY_PAIRS:
        return True
    if home_team_name and away_team_name:
        hn, an = _norm_name(home_team_name), _norm_name(away_team_name)
        if frozenset({hn, an}) in DERBY_NAME_PAIRS:
            return True
    return False

# League-specific home advantage (Elo points). Falls back to HOME_ADVANTAGE.
# NOTE: league IDs are API-Football space (the pipeline's fixture source).
LEAGUE_HOME_ADV: dict[int, float] = {
    39: 45,     # EPL (post-COVID decline)
    140: 55,    # La Liga
    78: 50,     # Bundesliga
    135: 55,    # Serie A
    61: 50,     # Ligue 1
    2: 30,      # UCL (neutral-ish venues)
    3: 35,      # Europa League
    203: 75,    # Turkish Süper Lig (intense home crowds)
    71: 65,     # Brasileirão
    253: 50,    # MLS
    307: 70,    # Saudi Pro League
}

# ── Fix #6: Pre-seed Elo ratings for top clubs ────────────────────────────────
# API-Football team IDs (verified against v3 API, league rosters 2025) → approximate
# Elo (based on 2024/25 perf + UEFA coefficient). Prevents cold-start.
# Real graded Firestore values will override these seeds.
PRE_SEED_ELO: dict[int, float] = {
    541: 1870,  # Real Madrid
    50:  1855,  # Manchester City
    157: 1830,  # Bayern Munich
    42:  1820,  # Arsenal
    40:  1815,  # Liverpool
    529: 1810,  # Barcelona
    85:  1805,  # PSG
    530: 1800,  # Atletico Madrid
    49:  1790,  # Chelsea
    168: 1785,  # Bayer Leverkusen
    505: 1780,  # Inter Milan
    165: 1775,  # Borussia Dortmund
    496: 1770,  # Juventus
    492: 1765,  # Napoli
    66:  1760,  # Aston Villa
    33:  1755,  # Manchester United
    47:  1750,  # Tottenham
    212: 1740,  # Porto
    211: 1730,  # Benfica
    247: 1720,  # Celtic
    194: 1715,  # Ajax
}

# ── In-memory cache (populated from Firestore at startup) ─────────────────────
_elo_cache: dict[int, float] = {}
_dirty: set[int] = set()   # Teams whose rating changed and need saving


def _get_firestore():
    """Lazy import of firebase_admin to avoid circular deps."""
    try:
        import firebase_admin
        from firebase_admin import firestore as fs
        return fs.client()
    except Exception:
        return None


def load_ratings_from_firestore():
    """Load all Elo ratings from Firestore into memory cache.
    Fix #6: Pre-seeds unknown teams from PRE_SEED_ELO before loading real values.
    Real Firestore values overwrite seeds for any team with recorded match history.
    """
    # Apply pre-seeds for teams not yet in cache (won't overwrite real values)
    for team_id, seed_rating in PRE_SEED_ELO.items():
        if team_id not in _elo_cache:
            _elo_cache[team_id] = seed_rating
    print(f"[Elo] Pre-seeded {len(PRE_SEED_ELO)} elite club ratings.")

    db = _get_firestore()
    if not db:
        print("[Elo] No Firestore — using pre-seeded ratings only.")
        return
    try:
        docs = db.collection("elo_ratings").stream()
        count = 0
        for doc in docs:
            data = doc.to_dict()
            team_id = int(doc.id)
            _elo_cache[team_id] = float(data.get("rating", DEFAULT_ELO))  # Real value overrides seed
            count += 1
        print(f"[Elo] Loaded {count} Elo ratings from Firestore (overrides pre-seeds where applicable).")
    except Exception as e:
        print(f"[Elo] Firestore load error: {e}")


def save_dirty_ratings():
    """Persist only modified Elo ratings back to Firestore."""
    if not _dirty:
        return
    db = _get_firestore()
    if not db:
        return
    try:
        batch = db.batch()
        for team_id in _dirty:
            ref = db.collection("elo_ratings").document(str(team_id))
            batch.set(ref, {"rating": _elo_cache[team_id], "updatedAt": _now_iso()}, merge=True)
        batch.commit()
        print(f"[Elo] Saved {len(_dirty)} updated ratings to Firestore.")
        _dirty.clear()
    except Exception as e:
        print(f"[Elo] Firestore save error: {e}")


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


# ── Rating accessors ───────────────────────────────────────────────────────────
def get_rating(team_id: int) -> float:
    return _elo_cache.get(team_id, DEFAULT_ELO)


def get_team_rating(team_id: int) -> float:
    """Alias for get_rating, used by pipeline."""
    return get_rating(team_id)


def set_rating(team_id: int, rating: float):
    _elo_cache[team_id] = round(rating, 2)
    _dirty.add(team_id)


# ── Core Elo formulas ──────────────────────────────────────────────────────────
def expected_score(rating_a: float, rating_b: float) -> float:
    """
    Elo expected score for team A vs team B.
    Returns probability A wins (0–1), ignoring draws.
    """
    return 1.0 / (1.0 + 10.0 ** ((rating_b - rating_a) / 400.0))


def match_probabilities(home_team_id: int, away_team_id: int,
                        home_adj: float = HOME_ADVANTAGE,
                        league_id: int | None = None) -> dict[str, float]:
    """
    Compute match outcome probabilities from Elo ratings.
    Returns: {home_win, draw, away_win}
    Uses the Bradley-Terry logistic model with draw zone.
    """
    adj = LEAGUE_HOME_ADV.get(league_id, home_adj) if league_id else home_adj
    ra = get_rating(home_team_id) + adj  # Home advantage bonus
    rb = get_rating(away_team_id)

    # P(home wins) ignoring draws
    p_win_raw = expected_score(ra, rb)

    # Apply draw zone correction using logistic squeezing
    # P(draw) is higher when teams are evenly matched
    rating_diff = abs(ra - rb)
    draw_prob = DRAW_PROB_BASE * math.exp(-rating_diff / 350.0)

    p_home = p_win_raw * (1.0 - draw_prob)
    p_away = (1.0 - p_win_raw) * (1.0 - draw_prob)

    # Normalize so they sum to 1
    total = p_home + draw_prob + p_away
    return {
        "home_win": p_home / total,
        "draw": draw_prob / total,
        "away_win": p_away / total,
    }


# ── Rating update ──────────────────────────────────────────────────────────────
def update_ratings(
    home_team_id: int,
    away_team_id: int,
    home_goals: int,
    away_goals: int,
    league_id: int | None = None,
):
    """
    Update Elo ratings after a match result.
    Actual score: 1 = win, 0.5 = draw, 0 = loss.
    M-05: Uses LEAGUE_HOME_ADV for the expected-score calculation so rating
    updates are consistent with the probability predictions.
    MODEL-03: Uses LEAGUE_K_FACTOR so elite competition results carry more weight.
    """
    ra = get_rating(home_team_id)
    rb = get_rating(away_team_id)

    # M-05: use the league-specific home advantage, not the global constant
    home_adv = LEAGUE_HOME_ADV.get(league_id, HOME_ADVANTAGE) if league_id else HOME_ADVANTAGE
    ea = expected_score(ra + home_adv, rb)
    eb = 1.0 - ea

    if home_goals > away_goals:
        sa, sb = 1.0, 0.0
    elif home_goals < away_goals:
        sa, sb = 0.0, 1.0
    else:
        sa, sb = 0.5, 0.5

    # Goal difference multiplier (larger wins = bigger rating swing)
    goal_diff = abs(home_goals - away_goals)
    k_mult = 1.0 if goal_diff <= 1 else (1.5 if goal_diff == 2 else 1.75)

    # MODEL-03: league-specific K-factor
    k = LEAGUE_K_FACTOR.get(league_id, K_FACTOR) if league_id else K_FACTOR
    # Ensure minimum K of 20 for tier 3+ leagues to prevent Elo stagnation
    k = max(20.0, k)

    new_ra = ra + k * k_mult * (sa - ea)
    new_rb = rb + k * k_mult * (sb - eb)

    set_rating(home_team_id, new_ra)
    set_rating(away_team_id, new_rb)


# ── Bulk update from graded matches ───────────────────────────────────────────
def bulk_update_from_results(match_results: list[dict]):
    """
    Update Elo ratings from a list of match results.
    Each dict: {home_team_id, away_team_id, home_goals, away_goals, league_id (optional)}
    """
    for m in match_results:
        try:
            update_ratings(
                int(m["home_team_id"]), int(m["away_team_id"]),
                int(m["home_goals"]), int(m["away_goals"]),
                league_id=int(m["league_id"]) if m.get("league_id") else None,
            )
        except (KeyError, ValueError, TypeError) as e:
            print(f"[Elo] Skipping result due to error: {e}")
    save_dirty_ratings()
    print(f"[Elo] Bulk update complete for {len(match_results)} matches.")


if __name__ == "__main__":
    # Quick demo
    probs = match_probabilities(12, 14)  # Fake team IDs
    print(f"Home Win: {probs['home_win']:.3f}")
    print(f"Draw:     {probs['draw']:.3f}")
    print(f"Away Win: {probs['away_win']:.3f}")
