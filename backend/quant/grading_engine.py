"""
grading_engine.py
─────────────────
Grades quant predictions stored in Firestore.
Fetches final results from Sportmonks and updates each prediction with:
  status: "won" | "lost" | "void"
  score: "2-1"
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
import requests
from datetime import datetime, timezone, timedelta

try:
    from free_data_client import fetch_match_result_free
except ImportError:
    fetch_match_result_free = None


# (Sportmonks helpers removed — using sport-highlights-api instead)

FINISHED_STATES = {"FT", "AET", "PEN", "FINS"}
VOIDED_STATES = {"CANCL", "POSTP", "INT", "ABANDONED", "TBA", "NS"}


# ── Market type enum ─────────────────────────────────────────────────────────
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
    UNKNOWN = "unknown"


def resolveMarket(market: str) -> MarketType:
    """
    Normalize a free-text market string to a MarketType enum value.
    Handles Sportmonks labels, lower/upper case, and common shorthand.
    """
    m = market.lower().strip()

    # Home/Away Win (exclude draw no bet and double chance)
    if "home win" in m and "draw no bet" not in m and "double" not in m:
        return MarketType.HOME_WIN
    if "away win" in m and "draw no bet" not in m and "double" not in m:
        return MarketType.AWAY_WIN
    if m == "draw":
        return MarketType.DRAW

    # Double Chance
    if "double chance (1x)" in m or (("double" in m or "chance" in m) and ("1x" in m or ("home" in m and "draw" in m))):
        return MarketType.DOUBLE_CHANCE_1X
    if "double chance (x2)" in m or (("double" in m or "chance" in m) and ("x2" in m or ("away" in m and "draw" in m))):
        return MarketType.DOUBLE_CHANCE_X2
    if "double chance (12)" in m or (("double" in m or "chance" in m) and ("12" in m)):
        return MarketType.DOUBLE_CHANCE_12

    # Draw No Bet
    if "draw no bet (home)" in m or "dnb home" in m:
        return MarketType.DRAW_NO_BET_HOME
    if "draw no bet (away)" in m or "dnb away" in m:
        return MarketType.DRAW_NO_BET_AWAY

    # Over/Under
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

    # BTTS
    if "btts" in m and "no" not in m:
        return MarketType.BTTS_YES
    if "btts" in m and "no" in m:
        return MarketType.BTTS_NO

    return MarketType.UNKNOWN


# (Sportmonks helper functions removed — using sport-highlights-api instead)


def _compute_clv(pick_odds: float, closing_odds: float) -> float:
    """
    Compute Closing Line Value.

    CLV = (implied_prob_closing - implied_prob_pick) / implied_prob_pick

    Positive CLV → you got better odds than the closing line → edge confirmed.
    Negative CLV → the line moved against you → no proven edge on this bet.

    Example: Pick at 1.85 (54.05%), closing at 1.75 (57.14%)
      CLV = (57.14% - 54.05%) / 54.05% = +5.7%  → the market agreed with you.
    """
    if pick_odds <= 1.0 or closing_odds <= 1.0:
        return 0.0
    pick_implied = 1.0 / pick_odds
    closing_implied = 1.0 / closing_odds
    if pick_implied <= 0:
        return 0.0
    return round((closing_implied - pick_implied) / pick_implied, 4)

def _compute_ev(pick_odds: float, win_prob: float) -> float:
    """
    Compute Expected Value of a bet.

    EV = (win_prob * pick_odds) - (1 - win_prob)
       = win_prob * (pick_odds - 1) - (1 - win_prob)

    Positive EV → profitable bet on average.
    Negative EV → unprofitable bet on average.
    """
    if pick_odds <= 1.0 or win_prob <= 0.0 or win_prob >= 1.0:
        return 0.0
    return (win_prob * pick_odds) - (1.0 - win_prob)

def _has_negative_ev(pred: dict) -> bool:
    """
    Check if a prediction has negative expected value.
    Returns True if EV < 0 (bad EV should not be pushed to users).
    """
    pick_odd = float(pred.get("pick_time_odds", 0) or pred.get("odds", 0) or 0)
    if pick_odd <= 1.0:
        return False
    market = pred.get("bet_type", "")
    home_prob = float(pred.get("home_prob", 0) or 0)
    away_prob = float(pred.get("away_prob", 0) or 0)
    draw_prob = float(pred.get("draw_prob", 0) or 0)
    over25_prob = float(pred.get("over25_prob", 0) or 0)
    btts_yes_prob = float(pred.get("btts_yes_prob", 0) or 0)
    win_prob = 0.0
    if "home win" in market.lower() and home_prob > 0:
        win_prob = home_prob
    elif "away win" in market.lower() and away_prob > 0:
        win_prob = away_prob
    elif market.lower() == "draw" and draw_prob > 0:
        win_prob = draw_prob
    elif "over 2.5" in market.lower() and over25_prob > 0:
        win_prob = over25_prob
    elif "btts" in market.lower() and "no" not in market.lower() and btts_yes_prob > 0:
        win_prob = btts_yes_prob
    if win_prob <= 0:
        return False
    ev = _compute_ev(pick_odd, win_prob)
    return ev < 0


def _grade_bet(market: str, home_goals: int, away_goals: int) -> str:
    """Return 'won', 'lost', or 'void' for a specific bet given the result."""
    total = home_goals + away_goals
    mt = resolveMarket(market)

    if mt == MarketType.HOME_WIN:
        return "won" if home_goals > away_goals else "lost"
    if mt == MarketType.AWAY_WIN:
        return "won" if away_goals > home_goals else "lost"
    if mt == MarketType.DRAW:
        return "won" if home_goals == away_goals else "lost"
    if mt == MarketType.DOUBLE_CHANCE_1X:
        return "won" if home_goals >= away_goals else "lost"
    if mt == MarketType.DOUBLE_CHANCE_X2:
        return "won" if away_goals >= home_goals else "lost"
    if mt == MarketType.DOUBLE_CHANCE_12:
        return "won" if home_goals != away_goals else "lost"
    if mt == MarketType.DRAW_NO_BET_HOME:
        if home_goals == away_goals: return "void"
        return "won" if home_goals > away_goals else "lost"
    if mt == MarketType.DRAW_NO_BET_AWAY:
        if home_goals == away_goals: return "void"
        return "won" if away_goals > home_goals else "lost"
    if mt == MarketType.OVER_1_5:
        return "won" if total > 1 else "lost"
    if mt == MarketType.OVER_2_5:
        return "won" if total > 2 else "lost"
    if mt == MarketType.UNDER_2_5:
        return "won" if total < 3 else "lost"
    if mt == MarketType.OVER_3_5:
        return "won" if total > 3 else "lost"
    if mt == MarketType.UNDER_3_5:
        return "won" if total < 4 else "lost"
    if mt == MarketType.BTTS_YES:
        return "won" if home_goals > 0 and away_goals > 0 else "lost"
    if mt == MarketType.BTTS_NO:
        return "won" if home_goals == 0 or away_goals == 0 else "lost"

    return "void"  # Unknown market


def _fetch_results_from_football_data_org(date_str: str, predictions: list) -> dict:
    """
    Fallback grading data source: football-data.org
    Free tier, no daily cap. Matches by team name since IDs differ from API-Football.
    """
    key = os.environ.get("FOOTBALL_DATA_KEY", "")
    headers = {"X-Auth-Token": key} if key else {}
    url = f"https://api.football-data.org/v4/matches"
    params = {"dateFrom": date_str, "dateTo": date_str, "status": "FINISHED"}
    results = {}
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=15)
        if resp.status_code != 200:
            print(f"[Grading-FD] football-data.org returned {resp.status_code}", file=sys.stderr)
            return {}
        matches = resp.json().get("matches", [])
        print(f"[Grading-FD] football-data.org returned {len(matches)} finished matches for {date_str}")

        # Build name-indexed lookup
        for m in matches:
            home_name = m.get("homeTeam", {}).get("name", "").lower().strip()
            away_name = m.get("awayTeam", {}).get("name", "").lower().strip()
            score = m.get("score", {}).get("fullTime", {})
            hg, ag = score.get("home"), score.get("away")
            if home_name and away_name and hg is not None and ag is not None:
                # Use a synthetic key — FD IDs are different from API-Football IDs
                key_str = f"fd_{m.get('id', '')}"
                results[key_str] = {
                    "home_goals": int(hg),
                    "away_goals": int(ag),
                    "state": "FT",
                    "closing_odds": {},
                    "home_name": home_name,
                    "away_name": away_name,
                }
    except Exception as e:
        print(f"[Grading-FD] football-data.org error: {e}", file=sys.stderr)
    return results




def grade_predictions(date_str: str, force_regrade: bool = False) -> dict:
    """
    Grade all quant predictions for a given date.
    Also fetches closing odds and computes CLV for each prediction.
    Reads from and writes to Firestore collection `quant_predictions/{date_str}`.
    """
    try:
        import firebase_admin
        from firebase_admin import firestore as fs, credentials

        # Initialize if not already done
        if not firebase_admin._apps:
            sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
            if sa_json:
                import json
                sa_dict = json.loads(sa_json)
                if "private_key" in sa_dict:
                    sa_dict["private_key"] = sa_dict["private_key"].replace('\\n', '\n')
                cred = credentials.Certificate(sa_dict)
            else:
                # Fallback: try Application Default Credentials
                cred = credentials.ApplicationDefault()
            firebase_admin.initialize_app(cred)

        db = fs.client()
    except Exception as e:
        print(f"[Grading] Firestore unavailable: {e}", file=sys.stderr)
        return {"status": "error", "error": str(e)}


    doc_ref = db.collection("quant_predictions").document(date_str)
    doc = doc_ref.get()
    if not doc.exists:
        return {"status": "skipped", "reason": "no_document", "date": date_str}

    data = doc.to_dict()
    predictions = data.get("predictions", [])
    if not predictions:
        return {"status": "skipped", "reason": "no_predictions", "date": date_str}

    # If not force regrade, skip already graded
    to_grade = predictions if force_regrade else [p for p in predictions if p.get("status") == "pending"]
    if not to_grade:
        return {"status": "skipped", "reason": "already_graded", "date": date_str}

    target_date = datetime.strptime(date_str, "%Y-%m-%d")
    # Extended window: ±2 days to catch late finishes and cross-midnight fixtures
    date_window = [(target_date + timedelta(days=d)).strftime("%Y-%m-%d") for d in range(-2, 3)]

    print(f"[Grading] Fetching results for {date_window[0]} to {date_window[-1]} ({len(date_window)}-day window)...")
    results_map = {}

    # ── Step 1: Load from local grading cache ────────────────────────────────
    try:
        from api_football_client import load_grading_cache
        for dw in date_window:
            cached = load_grading_cache(dw) or {}
            results_map.update(cached)
        if results_map:
            print(f"[Grading] ✅ Loaded {len(results_map)} results from grading cache ({len(date_window)}-day window).")
    except Exception as e:
        print(f"[Grading] Cache load error: {e}", file=sys.stderr)

    # ── Step 2: Try API-Football (if cache is empty or too small) ────────────
    if len(results_map) < len(predictions):
        try:
            from api_football_client import fetch_fixtures_by_date, RateLimitError
            for dw in date_window:
                fixtures = fetch_fixtures_by_date(dw) or []
                for item in fixtures:
                    fixture = item.get("fixture", {})
                    match_id = str(fixture.get("id") or "")
                    if not match_id:
                        continue
                    status = fixture.get("status", {}).get("short")
                    if status not in ["FT", "AET", "PEN"]:
                        continue
                    goals = item.get("goals", {})
                    hg, ag = goals.get("home"), goals.get("away")
                    if hg is None or ag is None:
                        continue
                    try:
                        results_map[match_id] = {
                            "home_goals": int(hg),
                            "away_goals": int(ag),
                            "state": "FT",
                            "closing_odds": {},
                            "home_name": item.get("teams", {}).get("home", {}).get("name", ""),
                            "away_name": item.get("teams", {}).get("away", {}).get("name", ""),
                        }
                    except Exception:
                        pass
            print(f"[Grading] Found {len(results_map)} finished fixtures from API-Football.")
        except Exception as e:
            print(f"[Grading] API-Football fetch failed: {e}", file=sys.stderr)

    # ── Step 3: Fallback to football-data.org (free, no daily cap) ───────────
    if not results_map:
        res1 = _fetch_results_from_football_data_org(date_str, predictions) or {}
        res2 = _fetch_results_from_football_data_org(next_date_str, predictions) or {}
        results_map = {**res1, **res2}

    graded_count = 0
    clv_sum = 0.0
    clv_count = 0

    pending_preds = []
    negative_ev_count = 0

    for pred in to_grade:
        if _has_negative_ev(pred):
            pred["status"] = "no_bet"
            pred["ev_negative"] = True
            negative_ev_count += 1
            continue
        fid = str(pred.get("fixture_id", ""))
        result = results_map.get(fid)
        if not result:
            pending_preds.append((fid, pred))
            continue  # Will be handled by fallback

        hg = result["home_goals"]
        ag = result["away_goals"]
        market = pred.get("bet_type", "")

        pred["status"] = _grade_bet(market, hg, ag)
        pred["score"] = f"{hg}-{ag}"
        pred["graded_at"] = datetime.now(timezone.utc).isoformat()

        # ── Grade the safest (highest-probability) bet too ──────────────────
        safest = pred.get("_safest_bet")
        if safest and isinstance(safest, list) and len(safest) == 2:
            safest_market, safest_prob = safest
            pred["safest_bet"] = safest_market
            pred["safest_bet_prob"] = round(safest_prob, 4)
            pred["safest_bet_result"] = _grade_bet(safest_market, hg, ag)
        elif safest and isinstance(safest, str):
            pred["safest_bet_result"] = _grade_bet(safest, hg, ag)

        # ── CLV Tracking ──────────────────────────────────────────────────
        closing_odds_map = result.get("closing_odds", {})
        closing_odd = closing_odds_map.get(market, 0.0)
        pick_odd = float(pred.get("pick_time_odds", 0) or pred.get("odds", 0) or 0)

        if closing_odd > 1.0 and pick_odd > 1.0:
            clv = _compute_clv(pick_odd, closing_odd)
            pred["closing_odds"] = closing_odd
            pred["clv"] = clv
            clv_sum += clv
            clv_count += 1
            direction = "+" if clv >= 0 else ""
            print(f"[Grading]   CLV {pred.get('home_team','?')} vs {pred.get('away_team','?')}: "
                  f"pick {pick_odd} -> close {closing_odd} = {direction}{clv:.2%}")

        graded_count += 1

    # ── Fallback: team-name match against football-data.org results ──────────
    # Runs after the ID-based lookup. Matches predictions that weren't found by fixture_id.
    if pending_preds and results_map:
        # Build a name-based lookup from the results_map
        name_lookup = {}
        for fid, r in results_map.items():
            home_n = r.get("home_name", "").lower().strip()
            away_n = r.get("away_name", "").lower().strip()
            if home_n and away_n:
                name_lookup[(home_n, away_n)] = r

        still_pending = []
        for fid, pred in pending_preds:
            home_pred = (pred.get("home_team") or "").lower().strip()
            away_pred = (pred.get("away_team") or "").lower().strip()
            matched = None
            for (home_n, away_n), r in name_lookup.items():
                if (home_pred[:5] in home_n or home_n[:5] in home_pred) and \
                   (away_pred[:5] in away_n or away_n[:5] in away_pred):
                    matched = r
                    break
            if matched:
                hg = matched["home_goals"]
                ag = matched["away_goals"]
                market = pred.get("bet_type", "")
                pred["status"] = _grade_bet(market, hg, ag)
                pred["score"] = f"{hg}-{ag}"
                pred["graded_at"] = datetime.now(timezone.utc).isoformat()
                pred["graded_by"] = "team_name_match"
                # Grade safest bet too
                safest = pred.get("_safest_bet")
                if safest and isinstance(safest, list) and len(safest) == 2:
                    pred["safest_bet"] = safest[0]
                    pred["safest_bet_prob"] = round(safest[1], 4)
                    pred["safest_bet_result"] = _grade_bet(safest[0], hg, ag)
                graded_count += 1
                print(f"[Grading] ✅ Team-name match: {pred.get('home_team')} vs {pred.get('away_team')} -> {pred['score']}")
            else:
                still_pending.append((fid, pred))
        pending_preds = still_pending

    graded_count += 0  # already incremented above


    avg_clv = round(clv_sum / clv_count, 4) if clv_count > 0 else None

    doc_ref.set({
        "predictions": predictions,
        "graded_at": datetime.now(timezone.utc).isoformat(),
        "graded_count": graded_count,
        "avg_clv": avg_clv,
        "clv_sample_size": clv_count,
    }, merge=True)

    # Wire calibration into grading
    try:
        from calibration import compute_calibration, save_calibration
        cal_data = compute_calibration(predictions)
        save_calibration(date_str, cal_data)
    except Exception as e:
        print(f"[Grading] Calibration failed (non-fatal): {e}", file=sys.stderr)

    # Workstream 6: Auto-update calibration from grading results
    try:
        from calibration_registry import update_calibration_from_results
        graded_preds = [p for p in predictions if p.get("status") in ("won", "lost", "void")]
        if graded_preds:
            calib_result = update_calibration_from_results(graded_preds)
            if calib_result.get("markets_updated", 0) > 0:
                print(f"[Grading] ✅ Auto-updated calibration for {calib_result['markets_updated']} markets")
    except Exception as e:
        print(f"[Grading] Calibration auto-update failed (non-fatal): {e}", file=sys.stderr)

    # FIX-2: Update Elo ratings from graded results
    try:
        from elo_rating import bulk_update_from_results
        results_to_update = []
        for pred in predictions:
            if pred.get("status") in ("won", "lost", "void") and pred.get("home_team_id") and pred.get("away_team_id"):
                score_str = pred.get("score", "")
                if score_str and "-" in score_str:
                    try:
                        hg, ag = map(int, score_str.split("-"))
                        results_to_update.append({
                            "home_team_id": int(pred["home_team_id"]),
                            "away_team_id": int(pred["away_team_id"]),
                            "home_goals": hg,
                            "away_goals": ag,
                            "league_id": pred.get("league_id"),
                        })
                    except (ValueError, TypeError):
                        pass
        if results_to_update:
            bulk_update_from_results(results_to_update)
            print(f"[Grading] ✅ Elo ratings updated from {len(results_to_update)} graded matches.")
    except Exception as e:
        print(f"[Grading] Elo update failed (non-fatal): {e}", file=sys.stderr)

    # ── Grade Banker of the Day ────────────────────────────────────────────
    try:
        banker_doc = db.collection("banker_picks").document(date_str).get()
        if banker_doc.exists:
            banker = banker_doc.to_dict()
            pick = banker.get("pick", {})
            fid = str(pick.get("fixture_id", ""))
            result = results_map.get(fid)
            if result:
                hg, ag = result["home_goals"], result["away_goals"]
                market = pick.get("market", "")
                banker_status = _grade_bet(market, hg, ag)
                pick["status"] = banker_status
                pick["score"] = f"{hg}-{ag}"
                pick["result"] = "won" if banker_status == "won" else ("lost" if banker_status == "lost" else "void")
                banker["pick"] = pick
                banker["graded_at"] = datetime.now(timezone.utc).isoformat()
                db.collection("banker_picks").document(date_str).set(banker, merge=True)
                icon = "✅" if banker_status == "won" else ("❌" if banker_status == "lost" else "⚪")
                print(f"[Grading] 🏦 Banker of the Day: {pick.get('home_team','?')} vs {pick.get('away_team','?')} — {market} — {icon} {banker_status} ({hg}-{ag})")
    except Exception as e:
        print(f"[Grading] Banker grading failed (non-fatal): {e}", file=sys.stderr)

    clv_str = f" | Avg CLV: {avg_clv:+.2%} ({clv_count} bets)" if avg_clv is not None else ""
    neg_ev_str = f" | {negative_ev_count} predictions filtered (negative EV)" if negative_ev_count > 0 else ""
    not_found = len(pending_preds)
    already_graded = len(predictions) - len(to_grade)
    diag_parts = [f"graded={graded_count}", f"not_found={not_found}", f"negative_ev={negative_ev_count}"]
    if already_graded > 0: diag_parts.append(f"already_graded={already_graded}")
    print(f"[Grading] {graded_count}/{len(predictions)} predictions for {date_str}.{clv_str}{neg_ev_str}")
    print(f"[Grading] 📊 Diagnostic: {', '.join(diag_parts)} | Results cache size: {len(results_map)}")
    if not_found > 0:
        sample_ids = [fid[:6] for fid, _ in pending_preds[:3]]
        print(f"[Grading] ⚠️  {not_found} predictions had no matching result. Sample fixture IDs: {sample_ids}")
    return {"status": "success", "total": len(predictions), "graded": graded_count,
            "date": date_str, "avg_clv": avg_clv, "clv_sample_size": clv_count,
            "negative_ev_filtered": negative_ev_count}


if __name__ == "__main__":
    date = sys.argv[1] if len(sys.argv) > 1 else None
    if not date:
        yesterday = (datetime.now(timezone(timedelta(hours=1))) - timedelta(days=1)).strftime("%Y-%m-%d")
        date = yesterday
    try:
        result = grade_predictions(date)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"status": "error", "error": str(e)}))
        sys.exit(1)
