"""
accumulator_engine.py
──────────────────────
Generates 4 premium named accumulators from the filtered value bet pool.

Tiers:
  1. The Baseline    – Safest treble (3 legs, highest probability)
  2. The Alpha Edge  – Best EV treble (3 legs, highest expected value)
  3. The Syndicate   – 4-leg balanced combo
  4. The Variance Play – 5+ leg moonshot (high combined odds)

Only matches with approved value bets (safe/value category) are eligible.
"""

from dataclasses import dataclass, field
from itertools import combinations
from collections import defaultdict
from ticket_rules import SAME_LEAGUE_PENALTY, SAME_FIXTURE_PENALTY, passes_layering, ticket_quality_score as _canonical_quality_score


# ── Accumulator config ─────────────────────────────────────────────────────────
TIER_CONFIG = {
    "baseline": {
        "label": "The Baseline",
        "description": "Highest probability treble — built for bankroll protection",
        "icon": "🛡️",
        "max_legs": 3,
        "min_legs": 2,
        "min_prob": 0.55,  # Relaxed from 0.60
        "min_combined_odds": 1.50, # Relaxed from 2.00
        "sort_key": "prob",   # sort by probability
        "count": 1,
        "risk_level": "moderate",
        "risk_warning": "Multi-leg — higher variance than single bets. Stake conservatively.",
    },
    "alpha_edge": {
        "label": "The Alpha Edge",
        "description": "Highest expected value — where the model found market mispricing",
        "icon": "⚡",
        "max_legs": 3,
        "min_legs": 2,
        "min_prob": 0.50,
        "min_combined_odds": 2.00, # Relaxed from 2.50
        "sort_key": "ev",     # sort by expected value
        "count": 1,
        "risk_level": "high",
        "risk_warning": "EV-optimized — combines uncorrelated edges but variance compounds.",
    },
    "syndicate": {
        "label": "The Syndicate",
        "description": "Balanced combo — value meets volume",
        "icon": "🎯",
        "max_legs": 4,
        "min_legs": 2, # Relaxed from 3
        "min_prob": 0.50,
        "min_combined_odds": 3.00, # Relaxed from 4.00
        "sort_key": "composite",  # sort by EV*0.5 + prob*0.5
        "count": 1,
        "risk_level": "very_high",
        "risk_warning": "High-risk — for entertainment only. Do NOT stake from core bankroll.",
    },
    "variance_play": {
        "label": "The Variance Play",
        "description": "High-yield moonshot — big odds, calculated risk",
        "icon": "🚀",
        "max_legs": 5,
        "min_legs": 3, # Relaxed from 4
        "min_prob": 0.50,  # Relaxed from 0.58
        "min_combined_odds": 5.00, # Relaxed from 8.00
        "sort_key": "ev",
        "count": 1,
        "risk_level": "extreme",
        "risk_warning": "Extreme variance — 5-leg accumulator. Bankroll suicide without a separate dedicated fund.",
    },
}


@dataclass
class AccumulatorLeg:
    fixture_id: str
    home_team: str
    away_team: str
    market: str
    odds: float
    model_prob: float
    expected_value: float
    league: str = "unknown"


@dataclass
class Accumulator:
    tier: str
    tier_label: str
    tier_description: str
    tier_icon: str
    legs: list[AccumulatorLeg]
    combined_odds: float = 0.0
    combined_prob: float = 0.0
    combined_ev: float = 0.0
    kelly_stake: float = 0.0
    leg_count: int = 0

    def __post_init__(self):
        self.leg_count = len(self.legs)
        if self.legs:
            self.combined_odds = 1.0
            self.combined_prob = 1.0
            for l in self.legs:
                self.combined_odds *= l.odds
                self.combined_prob *= l.model_prob

            # FIX #7a: Same-league correlation penalty.
            # Research puts intra-day same-league correlations at 10-20%.
            # Old 2% reduction (0.98^n) was empirically far too small.
            # New: 8% reduction per extra same-league leg (0.92^n).
            league_counts = {}
            for l in self.legs:
                league_counts[l.league] = league_counts.get(l.league, 0) + 1
            duplicate_count = sum(max(0, c - 1) for c in league_counts.values())
            self.combined_prob *= (SAME_LEAGUE_PENALTY ** duplicate_count)

            # FIX #7b: Same-fixture cross-market correlation penalty.
            # BTTS and Over 2.5 on the same fixture are highly correlated — 15% reduction.
            fixture_ids = [l.fixture_id for l in self.legs]
            same_fixture_pairs = len(fixture_ids) - len(set(fixture_ids))
            self.combined_prob *= (SAME_FIXTURE_PENALTY ** same_fixture_pairs)

            self.combined_odds = round(self.combined_odds, 2)
            self.combined_prob = round(self.combined_prob, 4)
            self.combined_ev = round((self.combined_prob * self.combined_odds) - 1.0, 4)

            # Conservative fractional Kelly for parlays (0.10 multiplier)
            b = self.combined_odds - 1
            if b > 0:
                p = self.combined_prob
                q = 1 - p
                kelly = (b * p - q) / b
                self.kelly_stake = round(max(0, kelly * 100 * 0.10), 2)


def _market_base(market: str) -> str:
    """Normalize market names for correlation grouping."""
    m = market.lower()
    if any(x in m for x in ["home win", "away win", "draw"]): return "1x2"
    if any(x in m for x in ["over", "under"]): return "goals_total"
    if "btts" in m: return "btts"
    if "double chance" in m: return "double_chance"
    if "draw no bet" in m: return "dnb"
    return market


def _select_legs(bets: list[dict], config: dict, exclude_fixtures: set = None) -> list[dict]:
    """
    Select legs for an accumulator tier based on its config.
    Applies fixture deduplication, market correlation guard, and risk parity.
    """
    if exclude_fixtures is None:
        exclude_fixtures = set()

    min_prob = config["min_prob"]
    max_legs = config["max_legs"]
    sort_key = config["sort_key"]

    # Filter pool
    pool = [b for b in bets if b["model_prob"] >= min_prob and b["fixture_id"] not in exclude_fixtures]

    # Tier-specific sorting
    if sort_key == "prob":
        pool.sort(key=lambda x: (x["model_prob"], x["expected_value"]), reverse=True)
    elif sort_key == "ev":
        pool.sort(key=lambda x: (x["expected_value"], x["model_prob"]), reverse=True)
    elif sort_key == "composite":
        pool.sort(key=lambda x: x["expected_value"] * 0.5 + x["model_prob"] * 0.5, reverse=True)

    selected = []
    seen_fixtures = set()
    market_counts = {}
    hour_counts = {}  # Phase 3.3: Time diversification

    for b in pool:
        if b["fixture_id"] in seen_fixtures:
            continue

        # Phase 3.3: Max 2 legs per kickoff hour for hedging opportunity
        kickoff = b.get("kickoff_local", "") or b.get("kickoff_utc", "")
        kickoff_hour = kickoff.split("T")[1][:2] if "T" in kickoff else "00"
        if hour_counts.get(kickoff_hour, 0) >= 2:
            continue

        # Market correlation guard: max 2 legs from same market type,
        # EXCEPT goals_total (Over/Under) which is capped at 1 per acca (M-07)
        m_base = _market_base(b["market"])
        cap = 1 if m_base == "goals_total" else 2
        if market_counts.get(m_base, 0) >= cap:
            continue

        selected.append(b)
        seen_fixtures.add(b["fixture_id"])
        market_counts[m_base] = market_counts.get(m_base, 0) + 1
        hour_counts[kickoff_hour] = hour_counts.get(kickoff_hour, 0) + 1

        if len(selected) >= max_legs:
            break

    return selected


def _optimize_legs(bets: list[dict], config: dict, exclude_fixtures: set = None) -> list[dict]:
    """
    Phase 4.1: Combinatorial optimizer using branch-and-bound.
    Finds the globally optimal leg combination instead of greedy selection.
    Falls back to greedy if pool is too large (>30 candidates).
    """
    if exclude_fixtures is None:
        exclude_fixtures = set()

    min_prob = config["min_prob"]
    max_legs = config["max_legs"]
    sort_key = config["sort_key"]

    pool = [b for b in bets if b["model_prob"] >= min_prob and b["fixture_id"] not in exclude_fixtures]

    if len(pool) > 30:
        return _select_legs(bets, config, exclude_fixtures)

    best_combo = []
    best_score = 0.0
    seen_fixtures_set = set()

    def score_combo(combo: list) -> float:
        if not combo:
            return 0.0
        total_prob = 1.0
        total_odds = 1.0
        for b in combo:
            total_prob *= b["model_prob"]
            total_odds *= b["odds"]
        league_counts = defaultdict(int)
        for b in combo:
            league_counts[b.get("league", "")] += 1
        dup = sum(max(0, c - 1) for c in league_counts.values())
        total_prob *= (0.92 ** dup)
        fids = [b["fixture_id"] for b in combo]
        same_fixture_pairs = len(fids) - len(set(fids))
        total_prob *= (0.85 ** same_fixture_pairs)
        ev = (total_prob * total_odds) - 1.0
        return total_prob * 0.5 + max(0, ev) * 0.5

    def valid(combo: list, new_bet: dict) -> bool:
        if new_bet["fixture_id"] in {b["fixture_id"] for b in combo}:
            return False
        market_counts = defaultdict(int)
        hour_counts = defaultdict(int)
        for b in combo + [new_bet]:
            m_base = _market_base(b["market"])
            market_counts[m_base] += 1
            if m_base == "goals_total" and market_counts[m_base] > 1:
                return False
            if market_counts[m_base] > 2:
                return False
            kickoff = b.get("kickoff_local", "") or b.get("kickoff_utc", "")
            kickoff_hour = kickoff.split("T")[1][:2] if "T" in kickoff else "00"
            hour_counts[kickoff_hour] += 1
            if hour_counts[kickoff_hour] > 2:
                return False
        return True

    def backtrack(combo: list, start_idx: int):
        nonlocal best_combo, best_score
        score = score_combo(combo)
        if len(combo) >= config["min_legs"] and score > best_score:
            best_combo = combo[:]
            best_score = score

        if len(combo) >= max_legs:
            return

        remaining = len(pool) - start_idx
        if len(combo) + remaining < config["min_legs"]:
            return

        max_possible = score
        for i in range(start_idx, len(pool)):
            if valid(combo, pool[i]):
                combo.append(pool[i])
                backtrack(combo, i + 1)
                combo.pop()
            if max_possible < best_score * 0.5 and i > start_idx + 5:
                break

    backtrack([], 0)
    return best_combo if best_combo else _select_legs(bets, config, exclude_fixtures)


def generate_accumulators(value_bets: list[dict]) -> dict[str, list[dict]]:
    """
    Generate 4 named accumulators from the value bet pool.
    Returns a dict keyed by tier name, each containing up to 3 accumulator dicts.

    FIX-9: Cross-tier fixture deduplication.
    Phase 4.1: Branch-and-bound optimizer (falls back to greedy for large pools).
    Phase 4.2: Multi-alternative generation (top 3 per tier).
    """
    results = {tier: [] for tier in TIER_CONFIG}
    used_fixtures = set()

    for tier_key, config in TIER_CONFIG.items():
        count = config.get("count", 1)
        for _ in range(min(count, 3)):  # Phase 4.2: generate up to 3 alternatives
            legs = _optimize_legs(value_bets, config, used_fixtures)

            if len(legs) >= config["min_legs"]:
                acca = Accumulator(
                    tier=tier_key,
                    tier_label=config["label"],
                    tier_description=config["description"],
                    tier_icon=config["icon"],
                    legs=[AccumulatorLeg(**l) for l in legs],
                )

                if acca.combined_odds >= config["min_combined_odds"]:
                    results[tier_key].append(accumulator_to_dict(acca))
                    for leg in legs:
                        used_fixtures.add(leg["fixture_id"])

    return results


def accumulator_to_dict(acca: Accumulator) -> dict:
    """Serialize an accumulator to a Firestore-ready dict."""
    config = TIER_CONFIG.get(acca.tier, {})
    return {
        "tier": acca.tier,
        "tier_label": acca.tier_label,
        "tier_description": acca.tier_description,
        "tier_icon": acca.tier_icon,
        "leg_count": acca.leg_count,
        "combined_odds": acca.combined_odds,
        "combined_prob": acca.combined_prob,
        "combined_ev": acca.combined_ev,
        "kelly_stake": acca.kelly_stake,
        "kelly_stake_unit": "pct_of_bankroll",
        "risk_level": config.get("risk_level", "unknown"),
        "risk_warning": config.get("risk_warning", ""),
        "legs": [
            {
                "fixture_id": l.fixture_id,
                "home_team": l.home_team,
                "away_team": l.away_team,
                "market": l.market,
                "odds": l.odds,
                "model_prob": l.model_prob,
                "expected_value": l.expected_value,
                "league": l.league,
            }
            for l in acca.legs
        ],
    }


if __name__ == "__main__":
    # Demo
    sample_bets = [
        {"fixture_id": "101", "home_team": "Arsenal", "away_team": "Everton",
         "market": "Home Win", "odds": 1.65, "model_prob": 0.72, "expected_value": 0.088, "league": "EPL"},
        {"fixture_id": "102", "home_team": "Real Madrid", "away_team": "Getafe",
         "market": "Over 2.5 Goals", "odds": 1.75, "model_prob": 0.68, "expected_value": 0.085, "league": "La Liga"},
        {"fixture_id": "103", "home_team": "Bayern", "away_team": "Dortmund",
         "market": "BTTS", "odds": 1.70, "model_prob": 0.65, "expected_value": 0.105, "league": "Bundesliga"},
        {"fixture_id": "104", "home_team": "PSG", "away_team": "Lyon",
         "market": "Home Win", "odds": 1.55, "model_prob": 0.78, "expected_value": 0.209, "league": "Ligue 1"},
        {"fixture_id": "105", "home_team": "Juventus", "away_team": "Roma",
         "market": "Double Chance (1X)", "odds": 1.30, "model_prob": 0.82, "expected_value": 0.066, "league": "Serie A"},
        {"fixture_id": "106", "home_team": "Ajax", "away_team": "PSV",
         "market": "Over 2.5 Goals", "odds": 1.80, "model_prob": 0.62, "expected_value": 0.116, "league": "Eredivisie"},
    ]

    accas = generate_accumulators(sample_bets)
    for tier, tickets in accas.items():
        if tickets:
            t = tickets[0]
            print(f"{t['tier_icon']} {t['tier_label']}: {t['leg_count']} legs | Odds: {t['combined_odds']:.2f}x | EV: {t['combined_ev']:.2%}")
            for leg in t['legs']:
                print(f"   └─ {leg['home_team']} vs {leg['away_team']}: {leg['market']} ({leg['odds']}x)")
        else:
            cfg = TIER_CONFIG[tier]
            print(f"{cfg['icon']} {cfg['label']}: Not enough qualifying bets")

