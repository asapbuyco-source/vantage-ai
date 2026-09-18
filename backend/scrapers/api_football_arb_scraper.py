# RETIRED (2026-09): legacy arb Firestore writer - superseded by backend/personal_arb/arb_scanner_live.js (period/scope gated, aligned verification, Telegram/WhatsApp only). Do NOT re-enable; the private scanner is the only source of arb signals.
# This file is inert: quantService.runArbScanner is now a hard no-op and the scheduler task is disabled.
import os
import time
import requests
import logging
from datetime import datetime, timezone

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def get_db():
    import firebase_admin
    from firebase_admin import credentials, firestore
    if not firebase_admin._apps:
        import json
        sa_raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
        if sa_raw:
            try:
                sa = json.loads(sa_raw)
                if "private_key" in sa:
                    sa["private_key"] = sa["private_key"].replace('\\n', '\n')
                cred = credentials.Certificate(sa)
                firebase_admin.initialize_app(cred)
            except Exception as e:
                logging.error(f"Error parsing FIREBASE_SERVICE_ACCOUNT: {e}")
                return None
        else:
            cred_path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS', 'vantage-ai-firebase-adminsdk.json')
            if os.path.exists(cred_path):
                cred = credentials.Certificate(cred_path)
                firebase_admin.initialize_app(cred)
            else:
                logging.error(f"Could not find Firebase credentials at {cred_path}")
                return None
    return firestore.client()

class APIFootballArbScanner:
    def __init__(self):
        try:
            from dotenv import load_dotenv
            if os.path.exists('.env.local'):
                load_dotenv('.env.local')
            elif os.path.exists('../.env.local'):
                load_dotenv('../.env.local')
        except ImportError:
            pass
            
        self.db = get_db()
        self.api_key = os.getenv("API_FOOTBALL_KEY")
        self.headers = {
            "x-apisports-key": self.api_key
        }
        self.threshold = 0.985 # Look for combined probability < 98.5% (1.5% profit margin)
        
        # Focus on bookmakers accessible in Cameroon/Africa
        self.ALLOWED_BOOKMAKERS = {
            "1xBet",
            "Bet365",
            "Pinnacle",
            "Marathonbet",
            "888Sport",
            "Betfair"
        }

    def fetch_odds(self):
        date_str = datetime.now().strftime("%Y-%m-%d")
        url = f"https://v3.football.api-sports.io/odds?date={date_str}"
        logging.info(f"Fetching odds from API-Football for {date_str}...")
        
        try:
            response = requests.get(url, headers=self.headers, timeout=15)
            if response.status_code == 200:
                data = response.json()
                return data.get("response", [])
            else:
                logging.error(f"API-Football HTTP {response.status_code}: {response.text}")
                return []
        except Exception as e:
            logging.error(f"Error fetching API-Football odds: {e}")
            return []

    def extract_1x2(self, bookmaker):
        # Find the Match Winner (1X2) market
        bets = bookmaker.get("bets", [])
        match_winner = next((b for b in bets if b.get("id") == 1 or b.get("name") == "Match Winner"), None)
        if not match_winner:
            return None
        
        values = match_winner.get("values", [])
        try:
            odds_1 = float(next(v["odd"] for v in values if str(v["value"]).lower() == "home"))
            odds_x = float(next(v["odd"] for v in values if str(v["value"]).lower() == "draw"))
            odds_2 = float(next(v["odd"] for v in values if str(v["value"]).lower() == "away"))
            return {"1": odds_1, "X": odds_x, "2": odds_2}
        except Exception:
            return None

    def find_arbs(self):
        fixtures_data = self.fetch_odds()
        if not fixtures_data:
            return []

        arbs_found = []
        logging.info(f"Analyzing {len(fixtures_data)} fixtures from API-Football...")

        for item in fixtures_data:
            fixture = item.get("fixture", {})
            bookmakers = item.get("bookmakers", [])
            
            if len(bookmakers) < 2:
                continue
                
            # Extract 1X2 odds for each bookmaker
            bk_odds = {}
            for bk in bookmakers:
                if bk["name"] not in self.ALLOWED_BOOKMAKERS:
                    continue
                odds = self.extract_1x2(bk)
                if odds:
                    bk_odds[bk["name"]] = odds
                    
            if len(bk_odds) < 2:
                continue
                
            # Check combinations
            bks = list(bk_odds.keys())
            from itertools import product
            for bk1, bkx, bk2 in product(bks, repeat=3):
                if bk1 == bkx == bk2:
                    continue # same bookmaker for all = no arb
                    
                p1 = 1 / bk_odds[bk1]["1"]
                px = 1 / bk_odds[bkx]["X"]
                p2 = 1 / bk_odds[bk2]["2"]
                
                prob = p1 + px + p2
                
                if prob < self.threshold:
                    match_name = f"Fixture {fixture.get('id')} - {fixture.get('date')[:16].replace('T', ' ')}"
                    profit_margin = (1 - prob) * 100
                    
                    # Ensure we don't pick up fake/crazy arbs (e.g. 50% profit usually means API error)
                    if profit_margin > 15:
                        continue
                        
                    arb = {
                        "match": match_name,
                        "profit_margin": round(profit_margin, 2),
                        "timestamp": time.time(),
                        "legs": [
                            {"selection": "Home (1)", "bookmaker": bk1, "odds": bk_odds[bk1]["1"]},
                            {"selection": "Draw (X)", "bookmaker": bkx, "odds": bk_odds[bkx]["X"]},
                            {"selection": "Away (2)", "bookmaker": bk2, "odds": bk_odds[bk2]["2"]}
                        ]
                    }
                    arbs_found.append(arb)
                    
        return arbs_found

    def push_to_firestore(self, arbs):
        if not self.db:
            return
            
        logging.info(f"Pushing {len(arbs)} arbitrage opportunities to Firestore...")
        batch = self.db.batch()
        arb_ref = self.db.collection('arbitrage_bets')
        
        # Deduplicate
        unique_arbs = {}
        for a in arbs:
            k = f"{a['match']}_{a['profit_margin']}"
            unique_arbs[k] = a
            
        for arb in unique_arbs.values():
            doc_id = f"{arb['match']}_{arb['profit_margin']:.3f}_{int(arb['timestamp'])}".replace(' ', '_').replace('/', '_').replace(':', '')
            doc_ref = arb_ref.document(doc_id)
            batch.set(doc_ref, arb)
            
        batch.commit()
        logging.info("Push complete.")

    def run(self):
        try:
            # Delete stale arbs (> 30 mins)
            if self.db:
                cutoff = time.time() - (30 * 60)
                old = self.db.collection('arbitrage_bets').where('timestamp', '<', cutoff).stream()
                batch = self.db.batch()
                c = 0
                for doc in old:
                    batch.delete(doc.reference)
                    c += 1
                if c > 0:
                    batch.commit()
            
            arbs = self.find_arbs()
            
            # Filter for actual profitable arbs (> 0.5% profit to cover hidden friction)
            profitable_arbs = [a for a in arbs if a['profit_margin'] > 0.5]
            
            if profitable_arbs:
                logging.info(f"FOUND {len(profitable_arbs)} PROFITABLE ARBS!")
                for a in profitable_arbs:
                    logging.info(f"ARB: {a['profit_margin']}% -> {a['match']}")
                self.push_to_firestore(profitable_arbs)
            else:
                logging.info("No profitable arbs found in this cycle.")
                
            # Log health to Firestore
            if self.db:
                self.db.collection('scraper_health').document('arb_scanner').set({
                    'last_run': time.time(),
                    'arbs_found': len(profitable_arbs),
                    'source': 'api-football',
                    'status': 'ok'
                })
                
        except Exception as e:
            logging.error(f"Scanner error: {str(e)}")
            if self.db:
                self.db.collection('scraper_health').document('arb_scanner').set({
                    'last_run': time.time(),
                    'status': 'error',
                    'error': str(e)
                })

if __name__ == "__main__":
    scanner = APIFootballArbScanner()
    scanner.run()
