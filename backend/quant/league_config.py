"""
league_config.py
────────────────
Approved league tiers and IDs for the quant pipeline.
Only matches from these leagues are analyzed.

Two ID namespaces are tracked:
  - Sportmonks / API-Football IDs (legacy, used by api_football provider)
  - Sport Highlights API IDs     (used by sport_highlights provider)
"""

# ── Tier 1: Top European + Global competitions ─────────────────────────────
TIER_1 = {
    8:    "English Premier League",
    2:    "UEFA Champions League",
    3:    "UEFA Europa League",
    5:    "UEFA Europa League (Legacy ID)",
    564:  "La Liga",
    82:   "Bundesliga",
    384:  "Serie A",
    294:  "FIFA World Cup (Legacy)",
    1:    "FIFA World Cup",
}

# ── Tier 2: Strong mid-tier European ──────────────────────────────────────
TIER_2 = {
    301:  "Ligue 1",
    462:  "Primeira Liga",
    848:  "UEFA Europa Conference League",
    7:    "UEFA Conference League (Legacy ID)",
    72:   "Eredivisie",
    9:    "Championship",
    1204: "Scottish Premiership",
    138:  "Jupiler Pro League",
    98:   "J1 League (Japan)",          # Summer league: Mar-Dec
    262:  "Liga MX (Mexico)",           # Summer league: Jul-May
    169:  "Chinese Super League",      # Summer league: Mar-Nov
}

# ── Tier 3: Reliable data, good volume ────────────────────────────────────
TIER_3 = {
    253:  "Major League Soccer",
    71:   "Brasileirão Série A",
    325:  "Argentine Primera División",
    176:  "Turkish Süper Lig",
    570:  "Saudi Pro League",
    103:  "Eliteserien (Norway)",
    113:  "Allsvenskan (Sweden)",
    244:  "Veikkausliiga (Finland)",
    292:  "K League 1 (South Korea)",
    288:  "Ekstraklasa (Poland)",
    1186: "CAF Champions League",
    1187: "CAF Confederation Cup",
    567:  "Segunda División (Spain)",
    85:   "2. Bundesliga (Germany)",
    395:  "Serie B (Italy)",
    302:  "Ligue 2 (France)",
    255:  "USL Championship (USA)",    # Summer league: Mar-Oct
    401:  "Premier Soccer League (South Africa)",  # Aug-May
    344:  "Primera División (Venezuela)",
    # ── Summer-active leagues (Jun-Aug window) ──
    268:  "Uruguayan Primera División", # Feb-Dec
    266:  "Chilean Primera División",   # Feb-Nov
    281:  "Peruvian Liga 1",             # Feb-Nov
    269:  "Ecuadorian Serie A",          # Feb-Dec
    346:  "Irish Premier Division",      # Feb-Nov
    # ── International tournaments (summer window) ──
    9:   "Copa America",
    13:  "FIFA World Cup Qualifiers (CONMEBOL)",
    31:  "FIFA World Cup Qualifiers (CONCACAF)",
    15:  "FIFA World Cup Qualifiers (AFC)",
    33:  "FIFA World Cup Qualifiers (CAF)",
}

# ── Tier 4: Minor / High Variance (Safety First) ──────────────────────────
TIER_4 = {
    10:   "England League 1",
    12:   "England League 2",
    254:  "Brasileirão Série B",
    14:   "England National League",
    51:   "Liga Portugal 2",
    256:  "USL League Two (USA)",     # Summer development league
    388:  "1. Division (Cyprus)",
    667:  "Friendlies Clubs",         # Pre-season — low data quality but available
    259:  "Canadian Championship",
    653:  "Second League - Group 4 (Romania)",
    248:  "Kakkonen - Lohko B (Finland)",
    328:  "Esiliiga A (Estonia)",
    243:  "Liga Pro Serie B (Ecuador)",
    917:  "Copa Ecuador",
}

# ── All approved leagues (merged) ─────────────────────────────────────────
ALL_APPROVED_LEAGUES: dict[int, dict] = {}
for _league_id, _name in TIER_1.items():
    ALL_APPROVED_LEAGUES[_league_id] = {"name": _name, "tier": 1, "weight": 1.0}
for _league_id, _name in TIER_2.items():
    ALL_APPROVED_LEAGUES[_league_id] = {"name": _name, "tier": 2, "weight": 0.85}
for _league_id, _name in TIER_3.items():
    ALL_APPROVED_LEAGUES[_league_id] = {"name": _name, "tier": 3, "weight": 0.70}
for _league_id, _name in TIER_4.items():
    ALL_APPROVED_LEAGUES[_league_id] = {"name": _name, "tier": 4, "weight": 0.55}

# ── API-Football league IDs (current data source) ─────────────────────────
# The pipeline now fetches via API-Football, whose league IDs differ from the
# Sportmonks IDs above. Without these, every fixture is dropped as "unapproved".
API_LEAGUE_IDS: dict[int, dict] = {
    # Tier 1 — top European + global
    39:  {"name": "English Premier League", "tier": 1, "weight": 1.0},
    2:   {"name": "UEFA Champions League", "tier": 1, "weight": 1.0},
    3:   {"name": "UEFA Europa League", "tier": 1, "weight": 1.0},
    140: {"name": "La Liga", "tier": 1, "weight": 1.0},
    78:  {"name": "Bundesliga", "tier": 1, "weight": 1.0},
    135: {"name": "Serie A", "tier": 1, "weight": 1.0},
    1:   {"name": "FIFA World Cup", "tier": 1, "weight": 1.0},
    # Tier 2
    61:  {"name": "Ligue 1", "tier": 2, "weight": 0.85},
    94:  {"name": "Primeira Liga", "tier": 2, "weight": 0.85},
    848: {"name": "UEFA Europa Conference League", "tier": 2, "weight": 0.85},
    88:  {"name": "Eredivisie", "tier": 2, "weight": 0.85},
    40:  {"name": "Championship", "tier": 2, "weight": 0.85},
    179: {"name": "Scottish Premiership", "tier": 2, "weight": 0.85},
    144: {"name": "Jupiler Pro League", "tier": 2, "weight": 0.85},
    98:  {"name": "J1 League (Japan)", "tier": 2, "weight": 0.85},
    262: {"name": "Liga MX (Mexico)", "tier": 2, "weight": 0.85},
    169: {"name": "Chinese Super League", "tier": 2, "weight": 0.85},
    # Tier 3
    253: {"name": "Major League Soccer", "tier": 3, "weight": 0.70},
    71:  {"name": "Brasileirão Série A", "tier": 3, "weight": 0.70},
    128: {"name": "Argentine Primera División", "tier": 3, "weight": 0.70},
    203: {"name": "Turkish Süper Lig", "tier": 3, "weight": 0.70},
    307: {"name": "Saudi Pro League", "tier": 3, "weight": 0.70},
    103: {"name": "Eliteserien (Norway)", "tier": 3, "weight": 0.70},
    113: {"name": "Allsvenskan (Sweden)", "tier": 3, "weight": 0.70},
    244: {"name": "Veikkausliiga (Finland)", "tier": 3, "weight": 0.70},
    292: {"name": "K League 1 (South Korea)", "tier": 3, "weight": 0.70},
    288: {"name": "Ekstraklasa (Poland)", "tier": 3, "weight": 0.70},
    1406: {"name": "CAF Champions League", "tier": 3, "weight": 0.70},
    1405: {"name": "CAF Confederation Cup", "tier": 3, "weight": 0.70},
    141: {"name": "Segunda División (Spain)", "tier": 3, "weight": 0.70},
    81:  {"name": "2. Bundesliga (Germany)", "tier": 3, "weight": 0.70},
    136: {"name": "Serie B (Italy)", "tier": 3, "weight": 0.70},
    60:  {"name": "Ligue 2 (France)", "tier": 3, "weight": 0.70},
    2532: {"name": "USL Championship (USA)", "tier": 3, "weight": 0.70},
    1062: {"name": "Premier Soccer League (South Africa)", "tier": 3, "weight": 0.70},
    # Tier 4
    119: {"name": "England League 1", "tier": 4, "weight": 0.55},
    120: {"name": "England League 2", "tier": 4, "weight": 0.55},
    121: {"name": "England National League", "tier": 4, "weight": 0.55},
    1447: {"name": "Liga Portugal 2", "tier": 4, "weight": 0.55},
    378: {"name": "1. Division (Cyprus)", "tier": 4, "weight": 0.55},
    1589: {"name": "Friendlies Clubs", "tier": 4, "weight": 0.55},
    2331: {"name": "Canadian Championship", "tier": 4, "weight": 0.55},
}
for _league_id, _info in API_LEAGUE_IDS.items():
    ALL_APPROVED_LEAGUES[_league_id] = _info

APPROVED_LEAGUE_IDS = set(ALL_APPROVED_LEAGUES.keys())

# ── Name-based matching (case-insensitive substrings) ─────────────────────
# Used when an API returns a league with an unrecognised numeric ID.
_APPROVED_NAMES_TIER: list[tuple[str, int, float]] = [
    # (lowercase substring, tier, weight)
    ("premier league", 1, 1.0),
    ("champions league", 1, 1.0),
    ("world cup", 1, 1.0),
    ("copa del mundo", 1, 1.0),
    ("europa league", 1, 1.0),
    ("conference league", 1, 1.0),
    ("la liga", 1, 1.0),
    ("bundesliga", 1, 1.0),
    ("serie a", 2, 0.90),
    ("ligue 1", 2, 0.85),
    ("eredivisie", 2, 0.85),
    ("primeira liga", 2, 0.85),
    ("championship", 2, 0.85),
    ("scottish premiership", 2, 0.85),
    ("jupiler", 2, 0.85),
    ("mls", 3, 0.70),
    ("brasileirão", 3, 0.70),
    ("brasileiro", 3, 0.70),
    ("primera división", 3, 0.70),
    ("primera division", 3, 0.70),
    ("süper lig", 3, 0.70),
    ("super lig", 3, 0.70),
    ("saudi pro league", 3, 0.70),
    ("eliteserien", 3, 0.70),
    ("allsvenskan", 3, 0.70),
    ("ekstraklasa", 3, 0.70),
    ("caf champions", 3, 0.70),
    ("segunda división", 3, 0.65),
    ("segunda division", 3, 0.65),
    ("2. bundesliga", 3, 0.70),
    ("serie b", 3, 0.70),
    ("ligue 2", 3, 0.70),
    ("league one", 4, 0.55),
    ("league two", 4, 0.55),
    ("usl championship", 3, 0.70),
    ("primera nacional", 3, 0.65),
    ("copa de la liga", 3, 0.65),
    ("copa chile", 3, 0.65),
    ("j1 league", 2, 0.85),
    ("j league", 2, 0.85),
    ("liga mx", 2, 0.85),
    ("chinese super", 2, 0.85),
    ("uruguayan", 3, 0.70),
    ("chilean", 3, 0.70),
    ("peruvian", 3, 0.70),
    ("ecuadorian", 3, 0.70),
    ("copa america", 3, 0.80),
    ("irish premier", 3, 0.70),
    ("world cup qualif", 3, 0.80),
    ("usl league two", 4, 0.55),
    ("friendlies clubs", 4, 0.45),
    ("friendlies", 4, 0.45),
    ("canadian championship", 4, 0.55),
    ("premier soccer league", 3, 0.70),
    ("primera divisi", 3, 0.70),
]


def get_league_info_by_name(league_name: str) -> dict | None:
    """Return league metadata matched by name substring (case-insensitive)."""
    lower = league_name.lower()
    for substr, tier, weight in _APPROVED_NAMES_TIER:
        if substr in lower:
            return {"name": league_name, "tier": tier, "weight": weight}
    return None


# ── Priority scores for fixture sorting (higher = more important) ──────────
TIER_PRIORITY = {1: 150, 2: 100, 3: 60, 4: 30}


def get_league_info(league_id: int) -> dict | None:
    """Return league metadata or None if not approved."""
    return ALL_APPROVED_LEAGUES.get(league_id)


def get_priority_score(league_id: int) -> int:
    info = ALL_APPROVED_LEAGUES.get(league_id)
    if not info:
        return 0
    return TIER_PRIORITY[info["tier"]]
