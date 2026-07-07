"""
prediction_audit.py
──────────────────
Comprehensive Firestore Prediction Audit Tool

Pulls ALL predictions from Firestore, grades them against API-Football actual
results, validates corner predictions, and analyzes losing bets to identify
exactly which predictions could have been fixed.

Usage:
    python prediction_audit.py --days 14 --full
    python prediction_audit.py --start 2026-06-01 --end 2026-06-30
    python prediction_audit.py --dates 2026-06-20,2026-06-21,2026-06-22
    python prediction_audit.py --days 7 --grade-only       (fast: no stats/events)
    python prediction_audit.py --days 7 --dry-run           (show what would run)

Options:
    --days N              Audit last N days (default: 7)
    --start YYYY-MM-DD    Start date
    --end YYYY-MM-DD      End date (default: yesterday)
    --dates D1,D2,...     Specific dates (comma-separated)
    --full                Run full audit with corner stats + event analysis
    --grade-only          Grade only (skip corner/event API calls)
    --no-cache            Skip all file caches, force fresh API calls
    --dry-run             Show what would be fetched without API calls
"""

import os, sys, json, math, time
from datetime import datetime, timedelta, timezone
from collections import defaultdict, Counter
from typing import Dict, List, Optional, Any, Tuple

# ── Force UTF-8 on Windows ────────────────────────────────────────────────────
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1)
if sys.stderr.encoding and sys.stderr.encoding.lower() != 'utf-8':
    sys.stderr = open(sys.stderr.fileno(), mode='w', encoding='utf-8', buffering=1)

try:
    import certifi
    os.environ["GRPC_DEFAULT_SSL_ROOTS_FILE_PATH"] = certifi.where()
except ImportError:
    pass

# Add quant dir to path so we can import api_football_client
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# ── Market Type Enum (mirrors grading_engine.py) ──────────────────────────────
class MarketType:
    HOME_WIN = "home_win"
    AWAY_WIN = "away_win"
    DRAW = "draw"
    DOUBLE_CHANCE_1X = "double_chance_1x"
    DOUBLE_CHANCE_X2 = "double_chance_x2"
    DOUBLE_CHANCE_12 = "double_chance_12"
    DRAW_NO_BET_HOME = "draw_no_bet_home"
    DRAW_NO_BET_AWAY = "draw_no_bet_away"
    OVER_1_5 = "over_1_5"
    OVER_2_5 = "over_2_5"
    OVER_3_5 = "over_3_5"
    UNDER_2_5 = "under_2_5"
    UNDER_3_5 = "under_3_5"
    BTTS_YES = "btts_yes"
    BTTS_NO = "btts_no"
    OVER_8_5_CORNERS = "over_8_5_corners"
    OVER_9_5_CORNERS = "over_9_5_corners"
    FH_OVER_0_5 = "fh_over_0_5"
    FH_OVER_1_5 = "fh_over_1_5"
    FH_BTTS = "fh_btts"
    FH_HOME_WIN = "fh_home_win"
    FH_DRAW = "fh_draw"
    FH_AWAY_WIN = "fh_away_win"
    UNKNOWN = "unknown"


def resolve_market(market: str) -> str:
    """Normalize free-text market string to MarketType value."""
    m = market.lower().strip()

    if "home win" in m and "draw no bet" not in m and "double" not in m:
        return MarketType.HOME_WIN
    if "away win" in m and "draw no bet" not in m and "double" not in m:
        return MarketType.AWAY_WIN
    if m == "draw":
        return MarketType.DRAW
    if "double chance (1x)" in m or (("double" in m or "chance" in m) and "1x" in m and "home" in m):
        return MarketType.DOUBLE_CHANCE_1X
    if "double chance (x2)" in m or (("double" in m or "chance" in m) and "x2" in m and "away" in m):
        return MarketType.DOUBLE_CHANCE_X2
    if "double chance (12)" in m or (("double" in m or "chance" in m) and "12" in m):
        return MarketType.DOUBLE_CHANCE_12
    if "draw no bet (home)" in m or "dnb home" in m:
        return MarketType.DRAW_NO_BET_HOME
    if "draw no bet (away)" in m or "dnb away" in m:
        return MarketType.DRAW_NO_BET_AWAY
    if "over 1.5" in m:
        return MarketType.OVER_1_5
    if "over 2.5" in m or "over 2.5" in market.lower():
        return MarketType.OVER_2_5
    if "over 3.5" in m or "over 3.5" in market.lower():
        return MarketType.OVER_3_5
    if "under 2.5" in m or "under 2.5" in market.lower():
        return MarketType.UNDER_2_5
    if "under 3.5" in m or "under 3.5" in market.lower():
        return MarketType.UNDER_3_5
    if ("btts" in m or "both teams to score" in m) and "no" not in m:
        return MarketType.BTTS_YES
    if ("btts" in m or "both teams to score" in m) and "no" in m:
        return MarketType.BTTS_NO
    if "over 0.5" in m and ("first half" in m or "fh" in m or "1st half" in m):
        return MarketType.FH_OVER_0_5
    if "over 1.5" in m and ("first half" in m or "fh" in m or "1st half" in m):
        return MarketType.FH_OVER_1_5

    return MarketType.UNKNOWN


def grade_bet(market: str, home_goals: int, away_goals: int) -> Tuple[str, str]:
    """Grade a bet given the actual score. Returns (status, market_type)."""
    mt = resolve_market(market)
    total = home_goals + away_goals

    los = lambda: ("lost", mt)
    won = lambda: ("won", mt)

    if mt == MarketType.HOME_WIN:
        return won() if home_goals > away_goals else los()
    if mt == MarketType.AWAY_WIN:
        return won() if away_goals > home_goals else los()
    if mt == MarketType.DRAW:
        return won() if home_goals == away_goals else los()
    if mt == MarketType.DOUBLE_CHANCE_1X:
        return won() if home_goals >= away_goals else los()
    if mt == MarketType.DOUBLE_CHANCE_X2:
        return won() if away_goals >= home_goals else los()
    if mt == MarketType.DOUBLE_CHANCE_12:
        return won() if home_goals != away_goals else los()
    if mt == MarketType.DRAW_NO_BET_HOME:
        if home_goals == away_goals: return ("void", mt)
        return won() if home_goals > away_goals else los()
    if mt == MarketType.DRAW_NO_BET_AWAY:
        if home_goals == away_goals: return ("void", mt)
        return won() if away_goals > home_goals else los()
    if mt == MarketType.OVER_1_5:
        return won() if total > 1 else los()
    if mt == MarketType.OVER_2_5:
        return won() if total > 2 else los()
    if mt == MarketType.UNDER_2_5:
        return won() if total < 3 else los()
    if mt == MarketType.OVER_3_5:
        return won() if total > 3 else los()
    if mt == MarketType.UNDER_3_5:
        return won() if total < 4 else los()
    if mt == MarketType.BTTS_YES:
        return won() if home_goals > 0 and away_goals > 0 else los()
    if mt == MarketType.BTTS_NO:
        return won() if (home_goals == 0 or away_goals == 0) else los()
    if mt == MarketType.FH_OVER_0_5:
        return won() if total > 0 else los()
    if mt == MarketType.FH_OVER_1_5:
        return won() if total > 1 else los()

    return ("void", mt)


# ═══════════════════════════════════════════════════════════════════════════════
# FIXABILITY ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

def analyze_fixability(pred: dict, home_goals: int, away_goals: int) -> dict:
    """
    For a LOST prediction, determine WHY it lost and whether a different market
    on the SAME match would have won.

    Returns a dict with:
        - close_loss: bool       (was 1 goal/event away)
        - close_detail: str      (e.g. "Needed 3 goals, got 2")
        - overconfident: bool    (prob >= 0.70 but lost)
        - alternative_winners: list of (market_label, prob, would_win_status)
        - all_value_bets_winners: list of value bets that would have won
        - recommended_fix: str   (actionable suggestion)
        - fix_severity: str      ("minor" | "moderate" | "major")
    """
    total = home_goals + away_goals
    bet_type = pred.get("bet_type") or pred.get("prediction") or ""
    mt = resolve_market(bet_type)
    prob = float(pred.get("probability", 0) or pred.get("calibrated_probability", 0) or 0)
    odds = float(pred.get("pick_time_odds", 0) or pred.get("odds", 0) or 0)

    result = {
        "close_loss": False,
        "close_detail": "",
        "overconfident": prob >= 0.65,
        "alternative_winners": [],
        "value_bets_winners": [],
        "recommended_fix": "",
        "fix_severity": "",
    }

    # ── 1. Close loss detection ─────────────────────────────────────────────
    close_detail = ""
    if mt == MarketType.OVER_2_5 and total == 2:
        close_detail = "Over 2.5 needed 3 goals, got 2 (1 goal short)"
        result["close_loss"] = True
    elif mt == MarketType.OVER_3_5 and total == 3:
        close_detail = "Over 3.5 needed 4 goals, got 3 (1 goal short)"
        result["close_loss"] = True
    elif mt == MarketType.UNDER_2_5 and total == 3:
        close_detail = "Under 2.5 needed <3 goals, got 3 (1 goal over)"
        result["close_loss"] = True
    elif mt == MarketType.UNDER_3_5 and total == 4:
        close_detail = "Under 3.5 needed <4 goals, got 4 (1 goal over)"
        result["close_loss"] = True
    elif mt == MarketType.BTTS_YES and not (home_goals > 0 and away_goals > 0):
        if home_goals == 0 and away_goals > 0:
            close_detail = "BTTS Yes failed: home team blanked (1 team short)"
            result["close_loss"] = True
        elif away_goals == 0 and home_goals > 0:
            close_detail = "BTTS Yes failed: away team blanked (1 team short)"
            result["close_loss"] = True
        elif home_goals == 0 and away_goals == 0:
            close_detail = "BTTS Yes failed: 0-0 draw (both blanked)"
    elif mt == MarketType.HOME_WIN and home_goals == away_goals:
        close_detail = f"Home Win failed: drew {home_goals}-{away_goals} (draw instead)"
        result["close_loss"] = True
    elif mt == MarketType.AWAY_WIN and home_goals == away_goals:
        close_detail = f"Away Win failed: drew {home_goals}-{away_goals} (draw instead)"
        result["close_loss"] = True
    elif mt == MarketType.HOME_WIN and home_goals + 2 == away_goals:
        close_detail = f"Home Win failed: lost by exactly 1 goal ({home_goals}-{away_goals})"
        result["close_loss"] = True
    elif mt == MarketType.AWAY_WIN and away_goals + 2 == home_goals:
        close_detail = f"Away Win failed: lost by exactly 1 goal ({home_goals}-{away_goals})"
        result["close_loss"] = True
    result["close_detail"] = close_detail

    # ── 2. Check ALL model probabilities for alternative winners ────────────
    alt_probs = {
        ("Home Win", pred.get("home_win_prob", 0)): lambda h, a: h > a,
        ("Draw", pred.get("draw_prob", 0)): lambda h, a: h == a,
        ("Away Win", pred.get("away_win_prob", 0)): lambda h, a: a > h,
        ("Over 2.5 Goals", pred.get("over25_prob", 0)): lambda h, a: h + a > 2,
        ("Under 2.5 Goals", pred.get("under25_prob", 0)): lambda h, a: h + a < 3,
        ("Over 1.5 Goals", pred.get("over15_prob", 0)): lambda h, a: h + a > 1,
        ("Over 3.5 Goals", pred.get("over35_prob", 0)): lambda h, a: h + a > 3,
        ("BTTS Yes", pred.get("btts_prob", 0)): lambda h, a: h > 0 and a > 0,
        ("Double Chance 1X", pred.get("double_chance_1x", 0)): lambda h, a: h >= a,
        ("Double Chance X2", pred.get("double_chance_x2", 0)): lambda h, a: a >= h,
        ("1H Over 0.5", pred.get("fh_over05_prob", 0)): lambda h, a: h + a > 0,
        ("1H Over 1.5", pred.get("fh_over15_prob", 0)): lambda h, a: h + a > 1,
        ("1H BTTS", pred.get("fh_btts_prob", 0)): lambda h, a: h > 0 and a > 0,
    }

    for (label, p), checker in alt_probs.items():
        p_val = float(p or 0)
        if p_val > 0 and checker(home_goals, away_goals):
            result["alternative_winners"].append({
                "market": label,
                "prob": round(p_val, 3),
                "would_win": True,
            })

    # ── 3. Check all_value_bets for winners ─────────────────────────────────
    all_value_bets = pred.get("all_value_bets", [])
    if isinstance(all_value_bets, list):
        for vb in all_value_bets:
            vb_market = vb.get("bet_type", "") or vb.get("market", "")
            vb_status, _ = grade_bet(vb_market, home_goals, away_goals)
            if vb_status == "won":
                vb_prob = float(vb.get("probability", 0) or 0)
                vb_ev = float(vb.get("expected_value", 0) or 0)
                result["value_bets_winners"].append({
                    "market": vb_market,
                    "prob": round(vb_prob, 3),
                    "ev": round(vb_ev, 3),
                    "odds": vb.get("odds", 0),
                })

    # ── 4. Generate recommendation ──────────────────────────────────────────
    alt_winners = result["alternative_winners"]
    vb_winners = result["value_bets_winners"]

    if vb_winners:
        best_alt = vb_winners[0]["market"]
        result["recommended_fix"] = f"Value bet '{best_alt}' on same match would have won"
        result["fix_severity"] = "minor"
    elif alt_winners and result["close_loss"]:
        sorted_alts = sorted(alt_winners, key=lambda x: x["prob"], reverse=True)
        best_alt = sorted_alts[0]["market"]
        result["recommended_fix"] = f"Close miss; '{best_alt}' would have won on this match"
        result["fix_severity"] = "moderate"
    elif alt_winners:
        sorted_alts = sorted(alt_winners, key=lambda x: x["prob"], reverse=True)
        best_alt = sorted_alts[0]["market"]
        result["recommended_fix"] = f"Alternative market '{best_alt}' would have won"
        result["fix_severity"] = "major"
    elif result["overconfident"]:
        result["recommended_fix"] = f"Model overconfident ({prob:.0%} prob); needs calibration adjustment"
        result["fix_severity"] = "major"
    else:
        result["recommended_fix"] = "No clear alternative winner identified"
        result["fix_severity"] = "major"

    return result


# ═══════════════════════════════════════════════════════════════════════════════
# CORNER ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

def analyze_corner_predictions(predictions: list, corner_stats_map: dict) -> dict:
    """
    Compare predicted corner probabilities against actual corner counts.
    """
    results = {
        "total_matches_with_corners": 0,
        "over85": {"predicted": 0, "actual_wins": 0, "probabilities": [], "outcomes": []},
        "over95": {"predicted": 0, "actual_wins": 0, "probabilities": [], "outcomes": []},
        "expected_vs_actual": [],
        "brier_scores": {},
        "recommendation": "",
    }

    for pred in predictions:
        if not pred.get("expected_corners") and not pred.get("over85_corners_prob") and not pred.get("over95_corners_prob"):
            continue

        fid = str(pred.get("fixture_id", ""))
        stats = corner_stats_map.get(fid)
        if not stats:
            continue

        home_corners = stats.get("home_corners", 0) or 0
        away_corners = stats.get("away_corners", 0) or 0
        total_corners = home_corners + away_corners

        if total_corners <= 0:
            continue

        results["total_matches_with_corners"] += 1

        expected = float(pred.get("expected_corners", 0) or 0)
        results["expected_vs_actual"].append({
            "match": f"{pred.get('home_team','?')} vs {pred.get('away_team','?')}",
            "fixture_id": fid,
            "expected": round(expected, 1),
            "actual": total_corners,
            "diff": round(total_corners - expected, 1),
        })

        over85_prob = float(pred.get("over85_corners_prob", 0) or 0)
        if over85_prob > 0:
            results["over85"]["predicted"] += 1
            results["over85"]["probabilities"].append(over85_prob)
            actual_win = 1 if total_corners > 8 else 0
            results["over85"]["outcomes"].append(actual_win)
            if actual_win:
                results["over85"]["actual_wins"] += 1

        over95_prob = float(pred.get("over95_corners_prob", 0) or 0)
        if over95_prob > 0:
            results["over95"]["predicted"] += 1
            results["over95"]["probabilities"].append(over95_prob)
            actual_win = 1 if total_corners > 9 else 0
            results["over95"]["outcomes"].append(actual_win)
            if actual_win:
                results["over95"]["actual_wins"] += 1

    # Compute Brier scores
    for key in ["over85", "over95"]:
        probs = results[key]["probabilities"]
        outcomes = results[key]["outcomes"]
        if probs and len(probs) > 0:
            brier = sum((p - o) ** 2 for p, o in zip(probs, outcomes)) / len(probs)
            results["brier_scores"][key] = round(brier, 4)

    # Average expected vs actual
    diffs = [d["diff"] for d in results["expected_vs_actual"]]
    if diffs:
        results["avg_corner_error"] = round(sum(abs(d) for d in diffs) / len(diffs), 2)
        results["avg_corner_bias"] = round(sum(diffs) / len(diffs), 2)

    # Recommendation
    o85_win_pct = results["over85"]["actual_wins"] / max(results["over85"]["predicted"], 1)
    o85_avg_prob = sum(results["over85"]["probabilities"]) / max(len(results["over85"]["probabilities"]), 1)
    o85_brier = results["brier_scores"].get("over85", 1.0)

    if o85_brier < 0.15 and results["over85"]["predicted"] >= 10:
        results["recommendation"] = (
            f"STRONG: Corner predictions are well-calibrated (Brier={o85_brier:.3f}). "
            f"Add Over 8.5 Corners as a value bet market. "
            f"Actual hit rate: {o85_win_pct:.1%} vs predicted: {o85_avg_prob:.1%}"
        )
    elif o85_brier < 0.25:
        results["recommendation"] = (
            f"MODERATE: Corner predictions show promise (Brier={o85_brier:.3f}). "
            f"Consider adding with conservative calibration. "
            f"Actual hit rate: {o85_win_pct:.1%} vs predicted: {o85_avg_prob:.1%}"
        )
    else:
        results["recommendation"] = (
            f"WEAK: Corner predictions need improvement (Brier={o85_brier:.3f}). "
            f"Actual hit rate: {o85_win_pct:.1%} vs predicted: {o85_avg_prob:.1%}. "
            f"Consider tuning the xG-to-corners multiplier (currently 3.7x)."
        )

    return results


# ═══════════════════════════════════════════════════════════════════════════════
# CORE AUDIT ENGINE
# ═══════════════════════════════════════════════════════════════════════════════

class PredictionAuditor:
    def __init__(self, dates: List[str], full_audit: bool = False, no_cache: bool = False):
        self.dates = sorted(dates)
        self.full_audit = full_audit
        self.no_cache = no_cache
        self.db = None
        self.api_client = None

        self.all_predictions: List[dict] = []
        self.results_map: Dict[str, dict] = {}
        self.corner_stats_map: Dict[str, dict] = {}
        self.event_map: Dict[str, list] = {}

        self.graded_count = 0
        self.wins = 0
        self.losses = 0
        self.voids = 0
        self.failed_fetch = 0

        self.by_market = defaultdict(lambda: {"wins": 0, "losses": 0, "voids": 0})
        self.by_league = defaultdict(lambda: {"wins": 0, "losses": 0, "voids": 0})
        self.by_confidence = {"high": {"wins": 0, "losses": 0}, "medium": {"wins": 0, "losses": 0}, "low": {"wins": 0, "losses": 0}}
        self.loss_analysis: List[dict] = []
        self.corner_analysis: dict = {}

        self.total_profit = 0.0
        self.total_stake = 0.0

    def connect_firestore(self):
        """Initialize Firestore connection."""
        import firebase_admin
        from firebase_admin import credentials, firestore

        if not firebase_admin._apps:
            sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
            if sa_json:
                sa_dict = json.loads(sa_json)
                if "private_key" in sa_dict:
                    sa_dict["private_key"] = sa_dict["private_key"].replace('\\n', '\n')
                cred = credentials.Certificate(sa_dict)
            else:
                print("[Audit] FIREBASE_SERVICE_ACCOUNT not set, using ADC")
                cred = credentials.ApplicationDefault()
            firebase_admin.initialize_app(cred)

        self.db = firestore.client()

    def load_api_client(self):
        """Import api_football_client module."""
        try:
            global fetch_fixtures_by_date, fetch_fixture_statistics, fetch_events, RateLimitError
            from api_football_client import (
                fetch_fixtures_by_date,
                fetch_fixture_statistics,
                fetch_events,
                RateLimitError
            )
            self.api_client = True
        except ImportError as e:
            print(f"[Audit] Could not import api_football_client: {e}")
            print("[Audit] Running in Firestore-only mode (no API grading)")
            self.api_client = False

    def pull_predictions(self):
        """Fetch all predictions from Firestore for the configured dates."""
        print(f"\n{'='*70}")
        print(f"  PULLING PREDICTIONS FROM FIRESTORE")
        print(f"{'='*70}")
        print(f"  Date range: {self.dates[0]} to {self.dates[-1]}")
        print(f"  Total dates: {len(self.dates)}")

        for date_str in self.dates:
            doc = self.db.collection("quant_predictions").document(date_str).get()
            if not doc.exists:
                print(f"  {date_str}: NO DATA")
                continue

            data = doc.to_dict()
            preds = data.get("predictions", [])
            status = data.get("status", "unknown")
            graded_at = data.get("graded_at", "not graded")

            for p in preds:
                p["_date"] = date_str

            self.all_predictions.extend(preds)
            print(f"  {date_str}: {len(preds)} predictions (status={status}, graded={graded_at})")

        print(f"\n  Total predictions pulled: {len(self.all_predictions)}")

    def fetch_results(self):
        """Fetch actual match results from API-Football for all dates."""
        if not self.api_client:
            print("\n[Audit] Skipping API fetch - no API client available")
            return

        print(f"\n{'='*70}")
        print(f"  FETCHING MATCH RESULTS (API-Football)")
        print(f"{'='*70}")

        unique_dates = sorted(set(self.dates))
        for date_str in unique_dates:
            try:
                fixtures = fetch_fixtures_by_date(date_str)
                if not fixtures:
                    print(f"  {date_str}: 0 fixtures returned")
                    continue

                finished = 0
                for item in fixtures:
                    fixture = item.get("fixture", {})
                    match_id = str(fixture.get("id") or "")
                    if not match_id:
                        continue
                    status = fixture.get("status", {}).get("short", "")
                    if status not in ("FT", "AET", "PEN"):
                        continue

                    goals = item.get("goals", {})
                    hg = goals.get("home")
                    ag = goals.get("away")
                    if hg is None or ag is None:
                        continue

                    self.results_map[match_id] = {
                        "home_goals": int(hg),
                        "away_goals": int(ag),
                        "status": status,
                        "home_name": item.get("teams", {}).get("home", {}).get("name", ""),
                        "away_name": item.get("teams", {}).get("away", {}).get("name", ""),
                    }
                    finished += 1

                print(f"  {date_str}: {finished} finished fixtures cached ({len(fixtures)} total)")
            except RateLimitError:
                print(f"  {date_str}: RATE LIMITED - stopping API calls")
                break
            except Exception as e:
                print(f"  {date_str}: Error - {e}")

        print(f"\n  Total results in map: {len(self.results_map)}")

    def grade_all(self):
        """Grade every prediction against fetched results."""
        print(f"\n{'='*70}")
        print(f"  GRADING PREDICTIONS")
        print(f"{'='*70}")

        for pred in self.all_predictions:
            fid = str(pred.get("fixture_id", ""))
            result = self.results_map.get(fid)

            if not result:
                self.failed_fetch += 1
                continue

            hg = result["home_goals"]
            ag = result["away_goals"]
            market = pred.get("bet_type") or pred.get("prediction") or ""

            status, mt = grade_bet(market, hg, ag)

            pred["_audit_status"] = status
            pred["_audit_market_type"] = mt
            pred["_audit_score"] = f"{hg}-{ag}"
            pred["_audit_hg"] = hg
            pred["_audit_ag"] = ag

            self.graded_count += 1
            if status == "won":
                self.wins += 1
                key_suffix = "wins"
            elif status == "lost":
                self.losses += 1
                key_suffix = "losses"
            elif status == "void":
                self.voids += 1
                key_suffix = "voids"
            else:
                key_suffix = None

            if key_suffix:
                # Per-market stats
                market_label = pred.get("bet_type") or pred.get("prediction") or "Unknown"
                self.by_market[market_label][key_suffix] += 1

                # Per-league stats
                league = pred.get("league", "Unknown")
                self.by_league[league][key_suffix] += 1

            # Per-confidence stats
            conf = float(pred.get("confidence", 0) or 0)
            if conf >= 0.70:
                bucket = "high"
            elif conf >= 0.55:
                bucket = "medium"
            else:
                bucket = "low"
            if status in ("won", "lost"):
                self.by_confidence[bucket][key_suffix] += 1

            # ROI calculation
            odds = float(pred.get("pick_time_odds", 0) or pred.get("odds", 0) or 0)
            stake = float(pred.get("kelly_stake", 0) or 0) / 100.0 if pred.get("kelly_stake") else 1.0
            if odds > 1.0:
                self.total_stake += stake
                if status == "won":
                    self.total_profit += stake * (odds - 1)
                elif status == "lost":
                    self.total_profit -= stake
                elif status == "void":
                    pass
                # half_won logic could go here

        # Sort grade all predictions
        print(f"  Graded: {self.graded_count} | Won: {self.wins} | Lost: {self.losses} | Void: {self.voids} | No result: {self.failed_fetch}")
        win_rate = self.wins / max(self.wins + self.losses, 1) * 100
        roi = (self.total_profit / max(self.total_stake, 0.001)) * 100
        print(f"  Win Rate: {win_rate:.1f}% | ROI: {roi:+.1f}%")

    def analyze_losses(self):
        """Deep-dive into every losing prediction to find fixable patterns."""
        print(f"\n{'='*70}")
        print(f"  LOSS PATTERN ANALYSIS")
        print(f"{'='*70}")

        fixable_minor = []
        fixable_moderate = []
        fixable_major = []
        patterns = Counter()

        for pred in self.all_predictions:
            if pred.get("_audit_status") != "lost":
                continue

            hg = pred.get("_audit_hg", 0)
            ag = pred.get("_audit_ag", 0)
            fix = analyze_fixability(pred, hg, ag)

            entry = {
                "date": pred.get("_date", ""),
                "match": f"{pred.get('home_team','?')} vs {pred.get('away_team','?')}",
                "fixture_id": pred.get("fixture_id", ""),
                "bet_type": pred.get("bet_type") or pred.get("prediction") or "",
                "score": pred.get("_audit_score", "?-?"),
                "probability": pred.get("probability", 0),
                "odds": pred.get("pick_time_odds", 0) or pred.get("odds", 0),
                "confidence": pred.get("confidence", 0),
                "close_loss": fix["close_loss"],
                "close_detail": fix["close_detail"],
                "overconfident": fix["overconfident"],
                "alternative_winners": fix["alternative_winners"][:3],
                "value_bets_winners": fix["value_bets_winners"][:3],
                "recommended_fix": fix["recommended_fix"],
                "fix_severity": fix["fix_severity"],
            }

            self.loss_analysis.append(entry)

            if fix["fix_severity"] == "minor":
                fixable_minor.append(entry)
            elif fix["fix_severity"] == "moderate":
                fixable_moderate.append(entry)
            else:
                fixable_major.append(entry)

            patterns[fix["recommended_fix"]] += 1

        print(f"\n  Total losses analyzed: {len(self.loss_analysis)}")
        print(f"  Fixable - Minor:  {len(fixable_minor)} (value bet on same match would have won)")
        print(f"  Fixable - Moderate: {len(fixable_moderate)} (close miss, alternative market available)")
        print(f"  Fixable - Major:   {len(fixable_major)} (no clear alternative or overconfident)")
        print(f"\n  Top fix patterns:")
        for pattern, count in patterns.most_common(5):
            print(f"    [{count}x] {pattern}")

    def fetch_corner_stats(self):
        """Fetch corner statistics for matches with corner predictions."""
        if not self.api_client or not self.full_audit:
            print("\n[Audit] Skipping corner stats fetch")
            return

        print(f"\n{'='*70}")
        print(f"  FETCHING CORNER STATISTICS")
        print(f"{'='*70}")

        fixtures_to_fetch = set()
        for pred in self.all_predictions:
            if pred.get("expected_corners") or pred.get("over85_corners_prob") or pred.get("over95_corners_prob"):
                fid = str(pred.get("fixture_id", ""))
                if fid and fid not in self.corner_stats_map:
                    fixtures_to_fetch.add(fid)

        print(f"  Fixtures with corner predictions: {len(fixtures_to_fetch)}")

        for i, fid in enumerate(sorted(fixtures_to_fetch)):
            try:
                stats = fetch_fixture_statistics(int(fid))
                if not stats:
                    continue

                home_stats = stats.get("home", {}).get("statistics", [])
                away_stats = stats.get("away", {}).get("statistics", [])

                def _extract_corners(stat_list):
                    for s in stat_list:
                        if s.get("type") == "Corner Kicks":
                            try:
                                return int(s.get("value", 0))
                            except (ValueError, TypeError):
                                return 0
                    return 0

                hc = _extract_corners(home_stats)
                ac = _extract_corners(away_stats)

                self.corner_stats_map[fid] = {
                    "home_corners": hc,
                    "away_corners": ac,
                    "total_corners": hc + ac,
                }

                if (i + 1) % 20 == 0:
                    print(f"  ... {i+1}/{len(fixtures_to_fetch)} fetched")
            except RateLimitError:
                print(f"  RATE LIMITED at {i+1}/{len(fixtures_to_fetch)} - stopping corner fetches")
                break
            except Exception as e:
                print(f"  Error fetching corners for fixture {fid}: {e}")

        print(f"  Corner stats fetched: {len(self.corner_stats_map)}")

    def run_corner_analysis(self):
        """Validate corner predictions against actual data."""
        self.corner_analysis = analyze_corner_predictions(self.all_predictions, self.corner_stats_map)
        ca = self.corner_analysis

        print(f"\n{'='*70}")
        print(f"  CORNER PREDICTION VALIDATION")
        print(f"{'='*70}")
        print(f"  Matches with corner data: {ca['total_matches_with_corners']}")
        print(f"  Over 8.5 Corners: {ca['over85']['predicted']} predictions | "
              f"{ca['over85']['actual_wins']} actual wins | "
              f"Brier: {ca['brier_scores'].get('over85', 'N/A')}")
        print(f"  Over 9.5 Corners: {ca['over95']['predicted']} predictions | "
              f"{ca['over95']['actual_wins']} actual wins | "
              f"Brier: {ca['brier_scores'].get('over95', 'N/A')}")

        if ca.get("avg_corner_error"):
            print(f"  Avg absolute error: {ca['avg_corner_error']} corners")
            print(f"  Avg bias: {ca['avg_corner_bias']:+.1f} corners (positive = model underestimates)")
            print(f"\n  Recommendation: {ca['recommendation']}")

    def generate_report(self) -> str:
        """Generate comprehensive audit report."""
        win_rate = self.wins / max(self.wins + self.losses, 1) * 100
        roi = (self.total_profit / max(self.total_stake, 0.001)) * 100

        lines = []
        lines.append("")
        lines.append("=" * 78)
        lines.append("  VANTAGE AI - PREDICTION AUDIT REPORT")
        lines.append("=" * 78)
        lines.append(f"  Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
        lines.append(f"  Period: {self.dates[0]} to {self.dates[-1]} ({len(self.dates)} days)")
        lines.append(f"  Mode: {'Full Audit' if self.full_audit else 'Grade Only'}")
        lines.append("")

        # ── 1. OVERALL SUMMARY ─────────────────────────────────────────────
        lines.append("-" * 78)
        lines.append("  1. OVERALL PERFORMANCE")
        lines.append("-" * 78)
        lines.append(f"  Total Predictions: {len(self.all_predictions)}")
        lines.append(f"  Graded: {self.graded_count}")
        lines.append(f"  Won: {self.wins} | Lost: {self.losses} | Void: {self.voids} | No Result: {self.failed_fetch}")
        lines.append(f"  Win Rate: {win_rate:.1f}%")
        lines.append(f"  ROI: {roi:+.1f}%")
        lines.append(f"  Profit: {self.total_profit:+.2f} units on {self.total_stake:.2f} staked")
        lines.append("")

        # ── 2. PERFORMANCE BY MARKET ───────────────────────────────────────
        lines.append("-" * 78)
        lines.append("  2. PERFORMANCE BY MARKET TYPE")
        lines.append("-" * 78)
        lines.append(f"  {'Market':<30} {'Bets':>6} {'Wins':>6} {'Losses':>6} {'Win%':>8} {'Profit':>8}")
        for market, stats in sorted(self.by_market.items(), key=lambda x: x[1]["wins"] + x[1]["losses"], reverse=True):
            total_bets = stats["wins"] + stats["losses"] + stats["voids"]
            if total_bets == 0:
                continue
            w = stats["wins"]
            l = stats["losses"]
            wr = w / max(w + l, 1) * 100
            lines.append(f"  {market[:30]:<30} {total_bets:>6} {w:>6} {l:>6} {wr:>7.1f}%")
        lines.append("")

        # ── 3. PERFORMANCE BY LEAGUE ───────────────────────────────────────
        lines.append("-" * 78)
        lines.append("  3. PERFORMANCE BY LEAGUE (top 10 by volume)")
        lines.append("-" * 78)
        lines.append(f"  {'League':<30} {'Bets':>6} {'Wins':>6} {'Losses':>6} {'Win%':>8}")
        for league, stats in sorted(self.by_league.items(), key=lambda x: x[1]["wins"] + x[1]["losses"], reverse=True)[:10]:
            total_bets = stats["wins"] + stats["losses"] + stats["voids"]
            if total_bets == 0:
                continue
            w = stats["wins"]
            l = stats["losses"]
            wr = w / max(w + l, 1) * 100
            lines.append(f"  {league[:30]:<30} {total_bets:>6} {w:>6} {l:>6} {wr:>7.1f}%")
        lines.append("")

        # ── 4. CONFIDENCE ANALYSIS ─────────────────────────────────────────
        lines.append("-" * 78)
        lines.append("  4. PERFORMANCE BY CONFIDENCE TIER")
        lines.append("-" * 78)
        for tier, stats in self.by_confidence.items():
            total = stats["wins"] + stats["losses"]
            if total == 0:
                continue
            wr = stats["wins"] / max(total, 1) * 100
            tier_label = f"{tier} (>=70%)" if tier == "high" else (f"{tier} (55-69%)" if tier == "medium" else f"{tier} (<55%)")
            lines.append(f"  {tier_label:<20}: {stats['wins']}/{total} = {wr:.1f}%")
        lines.append("")

        # ── 5. CORNER ANALYSIS ─────────────────────────────────────────────
        ca = self.corner_analysis
        if ca and ca.get("total_matches_with_corners", 0) > 0:
            lines.append("-" * 78)
            lines.append("  5. CORNER PREDICTION VALIDATION")
            lines.append("-" * 78)
            lines.append(f"  Matches with corner data: {ca['total_matches_with_corners']}")
            for key in ["over85", "over95"]:
                o = ca[key]
                if o["predicted"] > 0:
                    hit_rate = o["actual_wins"] / max(o["predicted"], 1) * 100
                    brier = ca["brier_scores"].get(key, "N/A")
                    lines.append(f"  {key}: {o['predicted']} predictions | "
                                 f"{o['actual_wins']} actual wins ({hit_rate:.1f}%) | Brier: {brier}")
            if ca.get("avg_corner_error"):
                lines.append(f"  Avg absolute error: {ca['avg_corner_error']} corners")
                lines.append(f"  Avg bias: {ca.get('avg_corner_bias', 0):+.1f} corners")
            lines.append(f"  Recommendation: {ca.get('recommendation', 'N/A')}")
            lines.append("")

        # ── 6. LOSS ANALYSIS ───────────────────────────────────────────────
        la = self.loss_analysis
        if la:
            minor = [l for l in la if l["fix_severity"] == "minor"]
            moderate = [l for l in la if l["fix_severity"] == "moderate"]
            major = [l for l in la if l["fix_severity"] == "major"]
            close = [l for l in la if l["close_loss"]]
            overconfident = [l for l in la if l["overconfident"]]

            lines.append("-" * 78)
            lines.append("  6. LOSS PATTERN ANALYSIS")
            lines.append("-" * 78)
            lines.append(f"  Total losses: {len(la)}")
            lines.append(f"  Close losses (1 goal/event short): {len(close)} ({len(close)/max(len(la),1)*100:.1f}%)")
            lines.append(f"  Overconfident (>=65% prob but lost): {len(overconfident)} ({len(overconfident)/max(len(la),1)*100:.1f}%)")
            lines.append(f"  Fixable - Minor (value bet existed): {len(minor)} ({len(minor)/max(len(la),1)*100:.1f}%)")
            lines.append(f"  Fixable - Moderate (alternative market): {len(moderate)} ({len(moderate)/max(len(la),1)*100:.1f}%)")
            lines.append(f"  Fixable - Major / Unfixable: {len(major)} ({len(major)/max(len(la),1)*100:.1f}%)")
            lines.append("")

            if close:
                lines.append("  Close Losses (top 10):")
                lines.append(f"  {'Date':<12} {'Match':<35} {'Bet':<22} {'Score':<6} {'Detail'}")
                for l in close[:10]:
                    lines.append(f"  {l['date']:<12} {l['match'][:35]:<35} {l['bet_type'][:22]:<22} {l['score']:<6} {l['close_detail']}")
                lines.append("")

            if minor:
                lines.append("  Easily Fixable (value bet on same match won) - top 10:")
                lines.append(f"  {'Date':<12} {'Match':<35} {'Picked':<22} {'Score':<6} {'Winner'}")
                for l in minor[:10]:
                    winner = l["value_bets_winners"][0]["market"] if l["value_bets_winners"] else "?"
                    lines.append(f"  {l['date']:<12} {l['match'][:35]:<35} {l['bet_type'][:22]:<22} {l['score']:<6} {winner}")
                lines.append("")

        # ── 7. RECOMMENDATIONS ─────────────────────────────────────────────
        lines.append("-" * 78)
        lines.append("  7. KEY RECOMMENDATIONS")
        lines.append("-" * 78)
        recs = []
        i = 1

        # Corner recommendation
        if ca and ca.get("recommendation"):
            recs.append(f"  {i}. CORNERS: {ca['recommendation']}")
            i += 1

        # Overconfidence
        if len(overconfident) > len(la) * 0.3:
            recs.append(f"  {i}. CALIBRATION: {len(overconfident)}/{len(la)} losses ({len(overconfident)/max(len(la),1)*100:.0f}%) were overconfident. "
                        f"Apply stricter calibration to high-probability predictions.")
            i += 1

        # Worst-performing market
        worst_market = None
        worst_wr = 1.0
        for market, stats in self.by_market.items():
            total = stats["wins"] + stats["losses"]
            if total >= 5:
                wr = stats["wins"] / max(total, 1)
                if wr < worst_wr:
                    worst_wr = wr
                    worst_market = market
        if worst_market:
            recs.append(f"  {i}. MARKET: '{worst_market}' is your worst-performing market "
                        f"({worst_wr:.0%} win rate). Consider reducing weight or excluding it.")
            i += 1

        # Best-performing market
        best_market = None
        best_wr = 0.0
        for market, stats in self.by_market.items():
            total = stats["wins"] + stats["losses"]
            if total >= 5:
                wr = stats["wins"] / max(total, 1)
                if wr > best_wr:
                    best_wr = wr
                    best_market = market
        if best_market and best_wr > 0.55:
            recs.append(f"  {i}. MARKET: '{best_market}' is your best market ({best_wr:.0%} win rate). "
                        f"Increase allocation and feature more prominently.")
            i += 1

        # Value bets analysis
        if minor:
            pct = len(minor) / max(len(la), 1) * 100
            recs.append(f"  {i}. VALUE BETS: {len(minor)} losses ({pct:.0f}%) could have been avoided if "
                        f"a different value bet was picked on the same match. Implement a "
                        f"'best of N' strategy: evaluate ALL value bets and pick the highest-EV one "
                        f"rather than the first qualifying bet.")
            i += 1

        # Close losses
        if close:
            pct_close = len(close) / max(len(la), 1) * 100
            recs.append(f"  {i}. CLOSE LOSSES: {len(close)} losses ({pct_close:.0f}%) were by a single goal. "
                        f"Consider adding a 'saver' recommendation: for Over 2.5 picks with high confidence, "
                        f"suggest hedging with Over 1.5 as insurance.")
            i += 1

        if not recs:
            recs.append(f"  Insufficient data for recommendations. Run on more dates.")

        lines.extend(recs)
        lines.append("")
        lines.append("=" * 78)
        lines.append("  END OF REPORT")
        lines.append("=" * 78)

        return "\n".join(lines)

    def save_report(self, report: str, filename: str = None):
        """Save report to file."""
        if not filename:
            filename = f"audit_report_{self.dates[0]}_to_{self.dates[-1]}.txt"
        filepath = os.path.join(os.path.dirname(__file__), filename)
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(report)
        print(f"\n[Audit] Report saved to: {filepath}")
        return filepath

    def save_json(self, filename: str = None):
        """Save detailed JSON data for further analysis."""
        if not filename:
            filename = f"audit_data_{self.dates[0]}_to_{self.dates[-1]}.json"

        data = {
            "metadata": {
                "generated": datetime.now(timezone.utc).isoformat(),
                "date_range": [self.dates[0], self.dates[-1]],
                "total_dates": len(self.dates),
                "mode": "full" if self.full_audit else "grade_only",
            },
            "summary": {
                "total_predictions": len(self.all_predictions),
                "graded": self.graded_count,
                "wins": self.wins,
                "losses": self.losses,
                "voids": self.voids,
                "failed_fetch": self.failed_fetch,
                "win_rate": self.wins / max(self.wins + self.losses, 1),
                "roi": self.total_profit / max(self.total_stake, 0.001),
                "total_profit": self.total_profit,
                "total_stake": self.total_stake,
            },
            "by_market": {
                k: {"wins": v["wins"], "losses": v["losses"], "voids": v["voids"]}
                for k, v in self.by_market.items()
            },
            "by_league": {
                k: {"wins": v["wins"], "losses": v["losses"], "voids": v["voids"]}
                for k, v in self.by_league.items()
            },
            "by_confidence": dict(self.by_confidence),
            "corner_analysis": self.corner_analysis,
            "loss_analysis_summary": {
                "total_losses": len(self.loss_analysis),
                "close_losses": sum(1 for l in self.loss_analysis if l["close_loss"]),
                "overconfident": sum(1 for l in self.loss_analysis if l["overconfident"]),
                "fixable_minor": sum(1 for l in self.loss_analysis if l["fix_severity"] == "minor"),
                "fixable_moderate": sum(1 for l in self.loss_analysis if l["fix_severity"] == "moderate"),
                "fixable_major": sum(1 for l in self.loss_analysis if l["fix_severity"] == "major"),
            },
            "loss_analysis": self.loss_analysis,
        }

        filepath = os.path.join(os.path.dirname(__file__), filename)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=str)
        print(f"[Audit] JSON data saved to: {filepath}")
        return filepath

    def run(self) -> str:
        """Run the full audit pipeline."""
        start_time = time.time()

        print("")
        print("╔" + "═" * 68 + "╗")
        print("║  VANTAGE AI - PREDICTION AUDIT TOOL" + " " * 30 + "║")
        print("╚" + "═" * 68 + "╝")

        # Step 1: Connect
        self.connect_firestore()
        self.load_api_client()

        # Step 2: Pull data
        self.pull_predictions()

        if not self.all_predictions:
            print("\n[Audit] No predictions found. Exiting.")
            return "No predictions found."

        # Step 3: Fetch results
        self.fetch_results()

        # Step 4: Grade
        self.grade_all()

        # Step 5: Loss analysis
        self.analyze_losses()

        # Step 6: Corner analysis (full audit only)
        if self.full_audit:
            self.fetch_corner_stats()
            self.run_corner_analysis()

        # Step 7: Generate report
        report = self.generate_report()
        print(report)

        # Step 8: Save
        self.save_report(report)
        self.save_json()

        elapsed = time.time() - start_time
        print(f"\n[Audit] Completed in {elapsed:.1f}s")

        return report


# ═══════════════════════════════════════════════════════════════════════════════
# CLI
# ═══════════════════════════════════════════════════════════════════════════════

def parse_dates(args) -> List[str]:
    """Parse date range from CLI arguments."""
    if hasattr(args, 'dates') and args.dates:
        return [d.strip() for d in args.dates.split(",")]

    end_str = getattr(args, 'end', None)
    if not end_str:
        end = datetime.now(timezone.utc) - timedelta(days=1)
        end_str = end.strftime("%Y-%m-%d")
    end = datetime.strptime(end_str, "%Y-%m-%d")

    days = getattr(args, 'days', 7)
    start_str = getattr(args, 'start', None)
    if start_str:
        start = datetime.strptime(start_str, "%Y-%m-%d")
    else:
        start = end - timedelta(days=days - 1)

    dates = []
    current = start
    while current <= end:
        dates.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)

    return dates


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Vantage AI Prediction Audit Tool")
    parser.add_argument("--days", type=int, default=7, help="Number of days to audit (default: 7)")
    parser.add_argument("--start", type=str, help="Start date YYYY-MM-DD")
    parser.add_argument("--end", type=str, help="End date YYYY-MM-DD (default: yesterday)")
    parser.add_argument("--dates", type=str, help="Comma-separated specific dates")
    parser.add_argument("--full", action="store_true", help="Full audit with corner stats + event analysis")
    parser.add_argument("--grade-only", action="store_true", help="Grade only (skip corner/event API calls)")
    parser.add_argument("--no-cache", action="store_true", help="Skip file caches")
    parser.add_argument("--dry-run", action="store_true", help="Show what would run without API calls")
    args = parser.parse_args()

    dates = parse_dates(args)

    if args.dry_run:
        print(f"Would audit {len(dates)} dates: {dates[0]} to {dates[-1]}")
        print(f"Mode: {'Full' if args.full else 'Grade Only'}")
        return

    # .env loading
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env.local"))
    except ImportError:
        pass

    full_audit = args.full and not getattr(args, 'grade_only', False)

    auditor = PredictionAuditor(
        dates=dates,
        full_audit=full_audit,
        no_cache=args.no_cache,
    )
    auditor.run()


if __name__ == "__main__":
    main()
