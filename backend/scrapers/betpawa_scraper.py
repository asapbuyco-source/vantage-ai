# RETIRED (2026-09): legacy arb Firestore writer - superseded by backend/personal_arb/arb_scanner_live.js (period/scope gated, aligned verification, Telegram/WhatsApp only). Do NOT re-enable; the private scanner is the only source of arb signals.
# This file is inert: quantService.runArbScanner is now a hard no-op and the scheduler task is disabled.
import requests
import json
import time
import logging

REQUIRED_FIELDS = {'home_team', 'away_team', 'odds_1', 'odds_x', 'odds_2'}
ODDS_RANGE = (1.01, 50.0)

class BetPawaScraper:
    def __init__(self, country_code="cm", db=None): # Default to Cameroon (cm), can be ng, ke, etc.
        self.url = f"https://www.betpawa.{country_code}/api/events/top"
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json"
        }
        self.db = db

    def _validate_match(self, match):
        if not REQUIRED_FIELDS.issubset(match.keys()):
            return False
        for field in ('odds_1', 'odds_x', 'odds_2'):
            v = match.get(field)
            if not isinstance(v, (int, float)) or not (ODDS_RANGE[0] <= v <= ODDS_RANGE[1]):
                return False
        if match.get('home_team') in ('Unknown', '', None):
            return False
        return True

    def fetch_odds(self):
        """
        Fetch top upcoming matches and their 1X2 odds.
        """
        matches = []
        error_msg = None
        
        for attempt in range(3):
            try:
                response = requests.get(self.url, headers=self.headers, timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    
                    events = data.get("events", [])
                    for item in events:
                        home_team = item.get("home", "Unknown")
                        away_team = item.get("away", "Unknown")
                        
                        markets = item.get("markets", [])
                        match_result_market = next((m for m in markets if m.get("name") == "1X2"), None)
                        
                        if match_result_market:
                            selections = match_result_market.get("selections", [])
                            
                            home_odds = next((s.get("price") for s in selections if s.get("name") == "1"), None)
                            draw_odds = next((s.get("price") for s in selections if s.get("name") == "X"), None)
                            away_odds = next((s.get("price") for s in selections if s.get("name") == "2"), None)

                            if home_odds and draw_odds and away_odds:
                                match = {
                                    "bookmaker": "BetPawa",
                                    "home_team": home_team,
                                    "away_team": away_team,
                                    "odds_1": float(home_odds),
                                    "odds_x": float(draw_odds),
                                    "odds_2": float(away_odds),
                                    "match_time": item.get("start", 0)
                                }
                                if self._validate_match(match):
                                    matches.append(match)
                    break # Success, exit retry loop
                elif response.status_code == 429:
                    logging.warning(f"[BetPawa] HTTP 429 on attempt {attempt+1}")
                    time.sleep(2 ** attempt * 5)
                else:
                    logging.warning(f"[BetPawa] HTTP {response.status_code} on attempt {attempt+1}")
            except requests.exceptions.Timeout:
                logging.warning(f"[BetPawa] Timeout on attempt {attempt+1}")
                time.sleep(2 ** attempt)
            except Exception as e:
                error_msg = str(e)
                logging.error(f"[BetPawa Scraper] Error fetching odds: {error_msg}")
                break

        # Log scraper health
        if self.db:
            try:
                self.db.collection('scraper_health').document('betpawa').set({
                    'last_fetch': time.time(),
                    'match_count': len(matches),
                    'status': 'ok' if matches else 'empty',
                    'error': error_msg,
                })
            except Exception as e:
                logging.error(f"[BetPawa] Failed to write health: {str(e)}")

        return matches

if __name__ == "__main__":
    scraper = BetPawaScraper()
    print("Fetching BetPawa Odds...")
    results = scraper.fetch_odds()
    print(f"Found {len(results)} matches with odds.")
    for r in results[:3]:
        print(r)
