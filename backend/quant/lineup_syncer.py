"""
lineup_syncer.py
────────────────
Fetches starting XIs from API-Football for today's fixtures and saves them
to the Firestore `lineups/{fixtureId}` collection so the frontend
MatchDetails page can display the Visual Pitch.

Each player is stored as:
  {
    name: str,
    number: int,
    position: str,   # "G" | "D" | "M" | "F"
    grid: str,       # "Y:X" e.g. "1:1" (GK) or "3:2" (midfield)
    teamName: str,
    isHome: bool,
  }

Run on a cron (via scheduler.js) ~1 hour before each match kickoff.
"""

import os
import sys
import json
from datetime import datetime

try:
    import certifi
    os.environ["GRPC_DEFAULT_SSL_ROOTS_FILE_PATH"] = certifi.where()
except ImportError:
    pass

import firebase_admin
from firebase_admin import credentials, firestore

from api_football_client import fetch_lineups, fetch_fixtures_by_date


def init_firebase():
    if not firebase_admin._apps:
        try:
            service_account_raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
            if service_account_raw:
                sa = json.loads(service_account_raw)
                if "private_key" in sa:
                    sa["private_key"] = sa["private_key"].replace('\\n', '\n').lstrip('\n\r\t ')
                cred = credentials.Certificate(sa)
            else:
                cred = credentials.ApplicationDefault()
            firebase_admin.initialize_app(cred)
        except Exception as e:
            print(f"[LineupSyncer] Firebase init error: {e}")
            return None
    return firestore.client()


def parse_player(player_entry: dict, team_name: str, is_home: bool) -> dict:
    """Map a single API-Football startXI player entry to our Firestore schema."""
    player = player_entry.get("player", {})
    return {
        "name": player.get("name", "Unknown"),
        "number": player.get("number"),
        "position": player.get("pos", ""),     # "G", "D", "M", "F"
        "grid": player.get("grid", ""),         # "Y:X" e.g. "2:3"
        "teamName": team_name,
        "isHome": is_home,
    }


def sync_lineups_for_date(date_str: str = None):
    """
    Fetch all fixtures for date_str, then for each fixture that has lineups
    available, save them to Firestore under lineups/{fixtureId}.
    """
    if not date_str:
        date_str = datetime.utcnow().strftime("%Y-%m-%d")

    db = init_firebase()
    if not db:
        print("[LineupSyncer] Firebase unavailable. Aborting.")
        return

    print(f"[LineupSyncer] Fetching fixtures for {date_str}...")
    fixtures = fetch_fixtures_by_date(date_str)

    if not fixtures:
        print("[LineupSyncer] No fixtures found.")
        return

    saved = 0
    skipped = 0

    for fixture in fixtures:
        fixture_data = fixture.get("fixture", {})
        fixture_id = fixture_data.get("id")
        if not fixture_id:
            continue

        teams = fixture.get("teams", {})
        home_team_name = teams.get("home", {}).get("name", "Home")
        away_team_name = teams.get("away", {}).get("name", "Away")

        # Check if we already have lineups for this fixture
        existing = db.collection("lineups").document(str(fixture_id)).get()
        if existing.exists:
            print(f"[LineupSyncer] Fixture {fixture_id} already has lineups. Skipping.")
            skipped += 1
            continue

        # Fetch lineups from API
        raw_lineups = fetch_lineups(fixture_id)
        if not raw_lineups:
            # Lineups not published yet — skip quietly
            skipped += 1
            continue

        home_players = []
        away_players = []

        for entry in raw_lineups:
            team = entry.get("team", {})
            team_id = team.get("id")
            home_team_id = teams.get("home", {}).get("id")
            is_home = team_id == home_team_id
            t_name = home_team_name if is_home else away_team_name

            start_xi = entry.get("startXI", [])
            for p in start_xi:
                parsed = parse_player(p, t_name, is_home)
                if is_home:
                    home_players.append(parsed)
                else:
                    away_players.append(parsed)

        if not home_players and not away_players:
            skipped += 1
            continue

        # Save to Firestore
        try:
            db.collection("lineups").document(str(fixture_id)).set({
                "home": home_players,
                "away": away_players,
                "fixtureId": fixture_id,
                "homeTeam": home_team_name,
                "awayTeam": away_team_name,
                "savedAt": datetime.utcnow().isoformat(),
            })
            print(f"[LineupSyncer] ✅ Saved lineup for fixture {fixture_id} ({home_team_name} vs {away_team_name}) — {len(home_players)}+{len(away_players)} players")
            saved += 1
        except Exception as e:
            print(f"[LineupSyncer] ❌ Error saving fixture {fixture_id}: {e}")

    print(f"\n[LineupSyncer] Done — {saved} saved, {skipped} skipped.")


if __name__ == "__main__":
    date_arg = sys.argv[1] if len(sys.argv) > 1 else None
    sync_lineups_for_date(date_arg)
