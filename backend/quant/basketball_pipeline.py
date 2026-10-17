"""
basketball_pipeline.py
──────────────────────────────────────────────────────────────────────────────
Quantitative basketball prediction pipeline for Vantage AI using The Odds API.

Architecture:
  1. Fetch today's NBA games from The Odds API (using ODDS_API_KEY).
  2. Compute "Consensus True Probability" by averaging vig-free implied probabilities across all bookmakers.
  3. Find the "Best Available Odds" across the market.
  4. Compare Best Odds vs True Probability to calculate Expected Value (EV).
  5. Generate value bets that pass EV + confidence gates.
  6. Save to Firestore: basketball_predictions/{date}

Usage:
  python basketball_pipeline.py [YYYY-MM-DD] [--dry-run]
"""

import sys
import os

# Auto-configure gRPC SSL certificate bundle path for Windows/Local environments
try:
    import certifi
    os.environ["GRPC_DEFAULT_SSL_ROOTS_FILE_PATH"] = certifi.where()
except ImportError:
    pass
import json
import math
import datetime
import urllib.request
import urllib.error

# ── Firestore imports (Firebase Admin SDK) ────────────────────────────────────
try:
    import firebase_admin
    from firebase_admin import credentials, firestore as fs
    FIREBASE_AVAILABLE = True
except ImportError:
    FIREBASE_AVAILABLE = False

# ─────────────────────────────────────────────────────────────────────────────
# CONSTANTS & CONFIG
# ─────────────────────────────────────────────────────────────────────────────

ODDS_API_KEY = os.environ.get("ODDS_API_KEY")
SPORT = 'basketball_nba'
REGIONS = 'us,eu'
MARKETS = 'h2h' # Focusing on Moneyline (Match Winner) for highest reliability

MIN_EV = 0.03               # 3% minimum expected value
MIN_PROBABILITY = 0.50      # 50% minimum true probability
MIN_VALUE_BETS = 3          # Keep the daily basketball card useful when markets are thin
RELAXED_MIN_EV = 0.01       # Reduced defensive gate used only when strict value is scarce
RELAXED_MIN_PROBABILITY = 0.47

# ─────────────────────────────────────────────────────────────────────────────
# HELPER: Get Lagos date
# ─────────────────────────────────────────────────────────────────────────────
def get_lagos_date(offset_days=0):
    from datetime import timezone as _tz, timedelta as _td
    lagos_tz = _tz(_td(hours=1))
    lagos = datetime.datetime.now(lagos_tz) + datetime.timedelta(days=offset_days)
    return lagos.strftime("%Y-%m-%d")

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1: Fetch Odds Data
# ─────────────────────────────────────────────────────────────────────────────
def fetch_odds():
    if not ODDS_API_KEY:
        print("[Basketball] Error: No ODDS_API_KEY provided.", file=sys.stderr)
        return None
        
    url = f"https://api.the-odds-api.com/v4/sports/{SPORT}/odds?apiKey={ODDS_API_KEY}&regions={REGIONS}&markets={MARKETS}&oddsFormat=decimal"
    
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "VantageAI-Basketball/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body)
    except urllib.error.HTTPError as e:
        print(f"[Basketball] HTTP {e.code} fetching Odds API", file=sys.stderr)
        return None
    except Exception as e:
        print(f"[Basketball] Error fetching Odds API: {e}", file=sys.stderr)
        return None

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2: Process consensus probabilities and find EV
# ─────────────────────────────────────────────────────────────────────────────
def process_games(games_data, min_ev=MIN_EV, min_probability=MIN_PROBABILITY, relaxed=False):
    approved_bets = []
    
    for game in games_data:
        home_team = game.get('home_team')
        away_team = game.get('away_team')
        game_id = game.get('id')
        start_time = game.get('commence_time')
        
        bookmakers = game.get('bookmakers', [])
        if not bookmakers:
            continue
            
        home_implied_probs = []
        away_implied_probs = []
        
        best_home_odds = 0.0
        best_away_odds = 0.0
        
        # Calculate vig-free implied probabilities for all bookies
        for bookie in bookmakers:
            for market in bookie.get('markets', []):
                if market['key'] == 'h2h':
                    home_odds = 0
                    away_odds = 0
                    
                    for outcome in market['outcomes']:
                        if outcome['name'] == home_team:
                            home_odds = outcome['price']
                        elif outcome['name'] == away_team:
                            away_odds = outcome['price']
                            
                    if home_odds > 0 and away_odds > 0:
                        # Find best odds globally
                        best_home_odds = max(best_home_odds, home_odds)
                        best_away_odds = max(best_away_odds, away_odds)
                        
                        # Remove Vig to find True Probability
                        ip_home = 1.0 / home_odds
                        ip_away = 1.0 / away_odds
                        total_ip = ip_home + ip_away
                        
                        true_prob_home = ip_home / total_ip
                        true_prob_away = ip_away / total_ip
                        
                        home_implied_probs.append(true_prob_home)
                        away_implied_probs.append(true_prob_away)
                        
        if not home_implied_probs:
            continue
            
        # The Consensus Model
        consensus_prob_home = sum(home_implied_probs) / len(home_implied_probs)
        consensus_prob_away = sum(away_implied_probs) / len(away_implied_probs)
        
        home_ev = (best_home_odds * consensus_prob_home) - 1.0
        away_ev = (best_away_odds * consensus_prob_away) - 1.0
        
        bet = None
        if home_ev >= min_ev and consensus_prob_home >= min_probability:
            bet = {
                "team": home_team,
                "prediction_en": "Home Win",
                "prediction_fr": "Victoire Domicile",
                "prob": consensus_prob_home,
                "ev": home_ev,
                "odds": best_home_odds
            }
        elif away_ev >= min_ev and consensus_prob_away >= min_probability:
            bet = {
                "team": away_team,
                "prediction_en": "Away Win",
                "prediction_fr": "Victoire Extérieure",
                "prob": consensus_prob_away,
                "ev": away_ev,
                "odds": best_away_odds
            }
            
        if bet:
            confidence = round(bet["prob"] * 100)
            category = "safe" if confidence >= 70 else "value" if confidence >= 60 else "risky"
            if relaxed and category == "safe":
                category = "value"

            relaxation_note_en = " | Relaxed gates: thin value slate" if relaxed else ""
            relaxation_note_fr = " | Filtres assouplis: peu de value" if relaxed else ""
            
            approved_bets.append({
                "id": f"bball_{game_id}",
                "fixture_id": f"bball_{game_id}",
                "league": "NBA",
                "league_tier": 1,
                "homeTeam": home_team,
                "awayTeam": away_team,
                "homeTeamLogo": "",
                "awayTeamLogo": "",
                "time": start_time,
                "prediction": bet["prediction_en"],
                "prediction_en": bet["prediction_en"],
                "prediction_fr": bet["prediction_fr"],
                "confidence": confidence,
                "probability": round(bet["prob"], 4),
                "odds": round(bet["odds"], 2),
                "category": category,
                "value_rank": "high" if category == "safe" else "medium",
                "ev_pct": round(bet["ev"] * 100, 1),
                "expected_value": round(bet["ev"], 4),
                "vault_eligible": True,
                "analysis_en": f"Consensus EV: +{round(bet['ev']*100, 1)}% | Win Prob: {confidence}% | Best Odds: {bet['odds']}{relaxation_note_en}",
                "analysis_fr": f"Consensus EV: +{round(bet['ev']*100, 1)}% | Prob Victoire: {confidence}% | Meilleure Cote: {bet['odds']}{relaxation_note_fr}",
                "sport": "basketball",
                "status": "pending",
                "generatedBy": "quant_basketball",
                "filterMode": "relaxed" if relaxed else "strict",
            })
            
    return approved_bets

def ensure_minimum_value_bets(games_data, strict_bets):
    if len(strict_bets) >= MIN_VALUE_BETS:
        return strict_bets

    relaxed_bets = process_games(
        games_data,
        min_ev=RELAXED_MIN_EV,
        min_probability=RELAXED_MIN_PROBABILITY,
        relaxed=True,
    )
    by_id = {bet["id"]: bet for bet in strict_bets}
    for bet in relaxed_bets:
        if bet["id"] not in by_id:
            by_id[bet["id"]] = bet
        if len(by_id) >= MIN_VALUE_BETS:
            break

    filled = list(by_id.values())
    print(
        f"[Basketball] Strict value slate had {len(strict_bets)} picks; "
        f"relaxed defensive gates added {len(filled) - len(strict_bets)}."
    )
    return filled

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3: Firestore Persistence
# ─────────────────────────────────────────────────────────────────────────────
def init_firebase():
    if not FIREBASE_AVAILABLE:
        return None
    if firebase_admin._apps:
        return fs.client()
    sa_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
    if not sa_json:
        print("[Basketball] FIREBASE_SERVICE_ACCOUNT not set — skipping Firestore.", file=sys.stderr)
        return None
    try:
        sa_dict = json.loads(sa_json)
        cred = credentials.Certificate(sa_dict)
        firebase_admin.initialize_app(cred)
        return fs.client()
    except Exception as e:
        print(f"[Basketball] Firebase init error: {e}", file=sys.stderr)
        return None

def save_to_firestore(db, date_str, matches):
    if not db:
        print("[Basketball] Firestore not available — write skipped.")
        return
    ref = db.collection("basketball_predictions").document(date_str)
    ref.set({
        "matches": matches,
        "generatedAt": datetime.datetime.utcnow().isoformat() + "Z",
        "generatedBy": "quant_basketball",
        "updatedAt": datetime.datetime.utcnow().isoformat() + "Z",
        "date": date_str,
    })
    print(f"[Basketball] [PASS] Saved {len(matches)} basketball predictions to Firestore for {date_str}.")

# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────
def main():
    dry_run = "--dry-run" in sys.argv
    date_str = get_lagos_date()
    
    print(f"[Basketball] Quant Pipeline starting for {date_str} (dry_run={dry_run})")
    print(f"[Basketball] Fetching NBA games from The Odds API...")
    
    games_data = fetch_odds()
    if not games_data:
        print("[Basketball] Failed to fetch games.")
        return
        
    print(f"[Basketball] Found {len(games_data)} NBA games. Finding Consensus EV edges...")
    strict_approved = process_games(games_data)
    approved = ensure_minimum_value_bets(games_data, strict_approved)
    
    print(f"\n[Basketball] Pipeline complete!")
    print(f"  Games analyzed: {len(games_data)}")
    print(f"  Value bets identified: {len(approved)}")
    
    if dry_run:
        print("[Basketball] [DRY RUN] Firestore write skipped.")
        if approved:
            print("\n[Basketball] DRY RUN OUTPUT:")
            for m in approved:
                print(f"  {m['homeTeam']} vs {m['awayTeam']} — {m['prediction_en']} ({m['confidence']}%) @ {m['odds']} | {m['analysis_en']}")
        return
    
    db = init_firebase()
    save_to_firestore(db, date_str, approved)
    
    print(f"\n[PASS] Basketball Pipeline complete!")

if __name__ == "__main__":
    main()
