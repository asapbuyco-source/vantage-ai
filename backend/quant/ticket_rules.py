"""
ticket_rules.py
───────────────
Canonical ticket construction rules shared between backend (accumulator_engine.py)
and frontend (TicketWizard.tsx).

Any change to correlation guards, risk tiers, quality scoring, or leg constraints
MUST be made here first, then reflected in both implementations.
"""

# ── Risk Tier Configuration ──────────────────────────────────────────────────
RISK_TIERS = {
    "low": {
        "label": "Conservative",
        "max_legs": 4,
        "min_confidence": 80,
        "min_probability": 0.55,
        "max_same_league": 2,
        "max_same_sport": 3,
        "max_same_market": 2,
        "allow_fragile": False,
        "max_odds_per_leg": 2.50,
    },
    "medium": {
        "label": "Balanced",
        "max_legs": 5,
        "min_confidence": 65,
        "min_probability": 0.50,
        "max_same_league": 2,
        "max_same_sport": 3,
        "max_same_market": 2,
        "allow_fragile": False,
        "max_odds_per_leg": 3.00,
    },
    "high": {
        "label": "Aggressive",
        "max_legs": 6,
        "min_confidence": 50,
        "min_probability": 0.45,
        "max_same_league": 3,
        "max_same_sport": 3,
        "max_same_market": 3,
        "allow_fragile": True,
        "max_odds_per_leg": 4.00,
    },
}

# ── Market Correlation Groups ─────────────────────────────────────────────────
MARKET_GROUPS = {
    "1x2": ["home win", "away win", "draw"],
    "goals_total": ["over 1.5", "over 2.5", "over 3.5", "over 4.5",
                    "under 1.5", "under 2.5", "under 3.5", "under 4.5",
                    "over 0.5", "under 0.5"],
    "btts": ["btts", "btts no", "btts yes"],
    "double_chance": ["double chance (1x)", "double chance (x2)", "double chance (12)"],
    "draw_no_bet": ["draw no bet (home)", "draw no bet (away)"],
    "first_half": ["over 0.5 fh", "over 1.5 fh", "btts fh", "1h home win", "1h draw", "1h away win"],
    "corners": ["over 8.5 corners", "over 9.5 corners"],
    "correct_score": ["correct score"],
}

# ── Correlation Penalties ─────────────────────────────────────────────────────
SAME_LEAGUE_PENALTY = 0.92   # Per extra same-league leg
SAME_FIXTURE_PENALTY = 0.85  # Per same-fixture pair (cross-market)

# ── Quality Scoring Formula ───────────────────────────────────────────────────
def ticket_quality_score(confidence: float, probability: float, ev: float, odds: float) -> float:
    return confidence + probability * 35 + ev * 120 - max(0, odds - 2.5) * 4


# ── Layering Rules ────────────────────────────────────────────────────────────
def passes_layering(leg_pool: list, new_leg: dict, risk: str) -> bool:
    tier = RISK_TIERS.get(risk, RISK_TIERS["medium"])

    league_count = sum(1 for l in leg_pool if l.get("league") == new_leg.get("league"))
    if league_count >= tier["max_same_league"]:
        return False

    sport_count = sum(1 for l in leg_pool if l.get("sport", "football") == new_leg.get("sport", "football"))
    if sport_count >= tier["max_same_sport"]:
        return False

    new_group = _market_group(new_leg.get("market", ""))
    group_count = sum(1 for l in leg_pool if _market_group(l.get("market", "")) == new_group)
    if new_group == "goals_total" and group_count >= 1:
        return False
    if group_count >= tier["max_same_market"]:
        return False

    # Team dedup: same team can't appear in 2 legs
    team_set = set()
    for l in leg_pool:
        team_set.add(l.get("home_team", ""))
        team_set.add(l.get("away_team", ""))
    if new_leg.get("home_team") in team_set or new_leg.get("away_team") in team_set:
        return False

    return True


def _market_group(market: str) -> str:
    m = market.lower()
    for group, keywords in MARKET_GROUPS.items():
        for kw in keywords:
            if kw in m:
                return group
    return "other"
