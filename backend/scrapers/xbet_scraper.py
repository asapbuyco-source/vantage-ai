# RETIRED (2026-09): legacy arb Firestore writer - superseded by backend/personal_arb/arb_scanner_live.js (period/scope gated, aligned verification, Telegram/WhatsApp only). Do NOT re-enable; the private scanner is the only source of arb signals.
# This file is inert: quantService.runArbScanner is now a hard no-op and the scheduler task is disabled.
import requests
import json
import time
import logging

REQUIRED_FIELDS = {'home_team', 'away_team', 'odds_1', 'odds_x', 'odds_2'}
ODDS_RANGE = (1.01, 50.0)

class XbetScraper:
    def __init__(self, db=None):
        self.url = "https://1xbet.mobi/LineFeed/Get1x2_VZip"
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json",
            "Origin": "https://1xbet.mobi"
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

    def fetch_odds(self, sport_id=1):
        """
        Fetch odds for a specific sport. Sport ID 1 = Football.
        """
        params = {
            "sports": sport_id,
            "count": 50, # Get top 50 matches
            "tf": 1000000,
            "tz": 3,
            "mode": 4,
            "getEmpty": True
        }
        
        matches = []
        error_msg = None
        
        for attempt in range(3):
            try:
                response = requests.get(self.url, params=params, headers=self.headers, timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    if "Value" in data and data["Value"]:
                        for item in data["Value"]:
                            home_team = item.get("O1E", "Unknown")
                            away_team = item.get("O2E", "Unknown")
                            
                            odds_data = item.get("E", [])
                            home_odds = next((o.get("C") for o in odds_data if o.get("T") == 1), None)
                            draw_odds = next((o.get("C") for o in odds_data if o.get("T") == 2), None)
                            away_odds = next((o.get("C") for o in odds_data if o.get("T") == 3), None)

                            if home_odds and draw_odds and away_odds:
                                match = {
                                    "bookmaker": "1XBet",
                                    "home_team": home_team,
                                    "away_team": away_team,
                                    "odds_1": float(home_odds),
                                    "odds_x": float(draw_odds),
                                    "odds_2": float(away_odds),
                                    "match_time": item.get("S", 0)
                                }
                                if self._validate_match(match):
                                    matches.append(match)
                    break # Success, exit retry loop
                elif response.status_code == 429:
                    logging.warning(f"[XBet] HTTP 429 on attempt {attempt+1}")
                    time.sleep(2 ** attempt * 5)
                else:
                    logging.warning(f"[XBet] HTTP {response.status_code} on attempt {attempt+1}")
            except requests.exceptions.Timeout:
                logging.warning(f"[XBet] Timeout on attempt {attempt+1}")
                time.sleep(2 ** attempt)
            except Exception as e:
                error_msg = str(e)
                logging.error(f"[XBet Scraper] Error fetching odds: {error_msg}")
                break

        # Log scraper health
        if self.db:
            try:
                self.db.collection('scraper_health').document('xbet').set({
                    'last_fetch': time.time(),
                    'match_count': len(matches),
                    'status': 'ok' if matches else 'empty',
                    'error': error_msg,
                })
            except Exception as e:
                logging.error(f"[XBet] Failed to write health: {str(e)}")
                
        return matches

if __name__ == "__main__":
    scraper = XbetScraper()
    print("Fetching 1XBet Odds...")
    results = scraper.fetch_odds()
    print(f"Found {len(results)} matches with odds.")
    for r in results[:3]:
        print(r)
