"""
Vantage AI - Full Environment & Library Diagnostic
Run from: backend/quant/
"""
import sys
import os
import importlib
import traceback

# Force UTF-8 output on Windows
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# ── Colour helpers ──────────────────────────────────────────────────
GREEN  = ""
RED    = ""
YELLOW = ""
BLUE   = ""
RESET  = ""
BOLD   = ""

ok   = lambda msg: print(f"  [PASS] {msg}")
fail = lambda msg: print(f"  [FAIL] {msg}")
warn = lambda msg: print(f"  [WARN] {msg}")
info = lambda msg: print(f"  [INFO] {msg}")

def section(title):
    print(f"\n{BOLD}{'='*60}{RESET}")
    print(f"{BOLD}  {title}{RESET}")
    print(f"{BOLD}{'='*60}{RESET}")

results = {"passed": 0, "failed": 0, "warned": 0}

def check(name, fn):
    try:
        result = fn()
        if result is True or result is None:
            ok(name)
            results["passed"] += 1
        elif isinstance(result, str):
            ok(f"{name} → {result}")
            results["passed"] += 1
        else:
            ok(name)
            results["passed"] += 1
    except ImportError as e:
        fail(f"{name} — ImportError: {e}")
        results["failed"] += 1
    except Exception as e:
        fail(f"{name} — {type(e).__name__}: {e}")
        results["failed"] += 1

# ═══════════════════════════════════════════════════════════════════════════════
section("1. Python Environment")
# ═══════════════════════════════════════════════════════════════════════════════
check("Python version",    lambda: f"{sys.version}")
check("Platform",          lambda: f"{sys.platform}")
check("Working directory", lambda: f"{os.getcwd()}")

# ═══════════════════════════════════════════════════════════════════════════════
section("2. Core Scientific Libraries")
# ═══════════════════════════════════════════════════════════════════════════════
def check_scipy():
    import scipy
    from scipy.stats import poisson
    p = poisson.pmf(2, 1.5)
    assert 0 < p < 1, "Poisson PMF out of range"
    return f"scipy {scipy.__version__} — Poisson PMF OK"

def check_numpy():
    import numpy as np
    arr = np.array([1.5, 2.0, 3.0])
    assert arr.mean() > 0
    return f"numpy {np.__version__} — Array ops OK"

def check_pandas():
    import pandas as pd
    df = pd.DataFrame({"a": [1, 2], "b": [3, 4]})
    assert len(df) == 2
    return f"pandas {pd.__version__} — DataFrame OK"

check("scipy (Poisson engine)", check_scipy)
check("numpy (array ops)",      check_numpy)
check("pandas (data frames)",   check_pandas)

# ═══════════════════════════════════════════════════════════════════════════════
section("3. HTTP & Networking")
# ═══════════════════════════════════════════════════════════════════════════════
def check_requests():
    import requests
    return f"requests {requests.__version__}"

def check_requests_live():
    import requests
    r = requests.get("https://httpbin.org/get", timeout=10)
    assert r.status_code == 200, f"Status {r.status_code}"
    return f"Live HTTP GET → 200 OK"

check("requests (library)",     check_requests)
check("requests (live GET)",    check_requests_live)

# ═══════════════════════════════════════════════════════════════════════════════
section("4. Data Sources & APIs")
# ═══════════════════════════════════════════════════════════════════════════════
def check_understat():
    import understatapi
    return f"understatapi {understatapi.__version__ if hasattr(understatapi, '__version__') else 'installed'}"

def check_lxml():
    import lxml
    return f"lxml {lxml.__version__}"

def check_soccerdata():
    import soccerdata
    return f"soccerdata {soccerdata.__version__ if hasattr(soccerdata, '__version__') else 'installed'}"

def check_sofascore():
    import requests
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Origin": "https://www.sofascore.com",
        "Referer": "https://www.sofascore.com/",
    }
    r = requests.get("https://api.sofascore.com/api/v1/sport/football/events/live",
                     headers=headers, timeout=10)
    if r.status_code == 200:
        data = r.json()
        count = len(data.get("events", []))
        return f"Sofascore live API → 200 OK ({count} live events)"
    else:
        raise Exception(f"HTTP {r.status_code}")

def check_fotmob():
    import requests
    from datetime import datetime
    today = datetime.utcnow().strftime("%Y%m%d")
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Referer": "https://www.fotmob.com/",
    }
    r = requests.get(f"https://www.fotmob.com/api/matches?date={today}",
                     headers=headers, timeout=10)
    if r.status_code == 200:
        data = r.json()
        leagues = len(data.get("leagues", []))
        return f"Fotmob API → 200 OK ({leagues} leagues today)"
    else:
        raise Exception(f"HTTP {r.status_code}")

check("understatapi",       check_understat)
check("lxml (HTML parser)", check_lxml)
check("soccerdata",         check_soccerdata)
check("Sofascore live API", check_sofascore)
check("Fotmob API",         check_fotmob)

# ═══════════════════════════════════════════════════════════════════════════════
section("5. Firebase / Firestore")
# ═══════════════════════════════════════════════════════════════════════════════
def check_firebase_admin():
    import firebase_admin
    return f"firebase-admin {firebase_admin.__version__}"

def check_firestore():
    from google.cloud import firestore
    return f"google-cloud-firestore installed"

def check_grpcio():
    import grpc
    return f"grpcio {grpc.__version__}"

check("firebase-admin",          check_firebase_admin)
check("google-cloud-firestore",  check_firestore)
check("grpcio",                  check_grpcio)

# ═══════════════════════════════════════════════════════════════════════════════
section("6. Utility Libraries")
# ═══════════════════════════════════════════════════════════════════════════════
def check_dateutil():
    from dateutil.parser import parse
    d = parse("2025-06-17T19:00:00Z")
    return f"python-dateutil — parsed ISO datetime OK"

check("python-dateutil", check_dateutil)

# ═══════════════════════════════════════════════════════════════════════════════
section("7. Internal Modules (Quant Engine)")
# ═══════════════════════════════════════════════════════════════════════════════
# (free_data_client / sofascore_client / sport_highlights_client checks removed —
#  those modules were deleted when the pipeline consolidated on API-Football.)

def check_league_config():
    import league_config
    assert hasattr(league_config, 'ALL_APPROVED_LEAGUES'), "Missing ALL_APPROVED_LEAGUES"
    assert hasattr(league_config, 'APPROVED_LEAGUE_IDS'),  "Missing APPROVED_LEAGUE_IDS"
    count = len(league_config.ALL_APPROVED_LEAGUES)
    return f"league_config — {count} leagues configured"

def check_data_pipeline():
    import data_pipeline
    assert hasattr(data_pipeline, 'fetch_matches'), "Missing fetch_matches"
    assert hasattr(data_pipeline, 'APPROVED_LEAGUE_IDS'), "Missing APPROVED_LEAGUE_IDS"
    return f"data_pipeline — fetch_matches present"

check("league_config",     check_league_config)
check("data_pipeline",     check_data_pipeline)

# ═══════════════════════════════════════════════════════════════════════════════
section("8. Environment Variables")
# ═══════════════════════════════════════════════════════════════════════════════
ENV_VARS = {
    "FOOTBALL_DATA_KEY":          "football-data.org API key",
    "ODDS_API_KEY":               "The Odds API key",
    "SPORTMONKS_API_TOKEN":       "Sportmonks token",
    "GOOGLE_GENAI_API_KEY":       "Google Gemini key",
    "OPENAI_API_KEY":             "OpenAI key",
    "TELEGRAM_BOT_TOKEN":         "Telegram bot token",
    "FAPSHI_API_KEY":             "Fapshi payment key",
    "GMAIL_REFRESH_TOKEN":        "Gmail OAuth token",
    "FIREBASE_PROJECT_ID":        "Firebase project ID",
}

for var, label in ENV_VARS.items():
    val = os.environ.get(var, "")
    if val:
        masked = val[:4] + "..." + val[-4:] if len(val) > 10 else "****"
        ok(f"{var} ({label}) → {masked}")
        results["passed"] += 1
    else:
        warn(f"{var} ({label}) — NOT SET")
        results["warned"] += 1

# ═══════════════════════════════════════════════════════════════════════════════
section("SUMMARY")
# ═══════════════════════════════════════════════════════════════════════════════
total = results["passed"] + results["failed"] + results["warned"]
print(f"\n  Total checks : {total}")
print(f"  {GREEN}Passed  : {results['passed']}{RESET}")
print(f"  {YELLOW}Warnings: {results['warned']}{RESET}  (env vars missing = set in Railway, not .env)")
print(f"  {RED}Failed  : {results['failed']}{RESET}")

if results["failed"] == 0:
    print(f"\n  *** All checks passed! App is ready to deploy. ***")
else:
    print(f"\n  !!! {results['failed']} check(s) failed. Review errors above. !!!")
