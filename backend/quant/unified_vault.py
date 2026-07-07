"""
unified_vault.py
────────────────
Unified vault builder that pools value bets from football, basketball, and cricket
predictions into a single daily vault document readable by VaultTab.tsx.

Expands league coverage to tier 4 leagues (was tier < 5, now tier <= 4)
with stricter EV requirements for lower tiers.

Usage:
    python unified_vault.py [date]
"""

import os, sys, json, math
from datetime import datetime, timedelta, timezone
from collections import defaultdict

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1)

try:
    import certifi
    os.environ["GRPC_DEFAULT_SSL_ROOTS_FILE_PATH"] = certifi.where()
except ImportError:
    pass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import firebase_admin
    from firebase_admin import firestore as fs, credentials
except ImportError:
    print(json.dumps({"status": "error", "error": "firebase-admin not installed"}))
    sys.exit(1)

LAGOS_TZ = timezone(timedelta(hours=1))

# Tier-based EV thresholds (higher tier = stricter for lower leagues)
TIER_EV_THRESHOLDS = {1: 2.0, 2: 2.0, 3: 3.0, 4: 5.0}

SUPPRESSED_MARKETS = {"home win", "away win", "draw", "double chance (x2)"}


def init_firestore():
    if not firebase_admin._apps:
        sa_raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
        if sa_raw:
            sa_dict = json.loads(sa_raw)
            if "private_key" in sa_dict:
                sa_dict["private_key"] = sa_dict["private_key"].replace('\\n', '\n')
            firebase_admin.initialize_app(credentials.Certificate(sa_dict))
    return fs.client()


def is_suppressed(market: str) -> bool:
    m = market.lower()
    return any(s in m for s in SUPPRESSED_MARKETS)


def extract_vault_candidates(predictions: list, sport: str) -> list:
    """Extract vault-eligible picks from any sport's predictions."""
    candidates = []
    for pred in predictions:
        market = pred.get("bet_type") or pred.get("prediction") or ""
        if not market or market == "N/A":
            continue

        if is_suppressed(market):
            continue

        if pred.get("vault_eligible") is False:
            continue
        if pred.get("odds_fresh") is False:
            continue

        odds = float(pred.get("pick_time_odds", 0) or pred.get("odds", 0) or 0)
        prob = float(pred.get("calibrated_probability", 0) or pred.get("probability", 0) or 0)

        if odds <= 1.0 or prob <= 0:
            continue

        category = pred.get("category", "lean")
        if category not in ("safe", "value"):
            continue

        league_tier = pred.get("league_tier", 2)
        if league_tier is None:
            league_tier = 2

        # Phase 5.2: Allow tier 4 leagues but with stricter EV
        if league_tier > 4:
            continue

        ev_pct = float(pred.get("ev_pct", 0) or 0)
        min_ev = TIER_EV_THRESHOLDS.get(league_tier, 5.0)
        if ev_pct < min_ev:
            continue

        # BTTS blanking check
        if "btts" in market.lower() and "no" not in market.lower():
            home_avg = float(pred.get("home_avg_scored", 1.0) or 1.0)
            away_avg = float(pred.get("away_avg_scored", 1.0) or 1.0)
            if home_avg < 0.8 or away_avg < 0.8:
                continue

        calib_tier = pred.get("calibration_tier", "stable") or "stable"
        kelly = float(pred.get("kelly_stake", 0) or 0)
        if kelly <= 0:
            kelly = 1.0

        candidates.append({
            "fixture_id": str(pred.get("fixture_id", "")),
            "home_team": pred.get("home_team", ""),
            "away_team": pred.get("away_team", ""),
            "home_team_logo": pred.get("home_team_logo", "") or pred.get("homeLogo", ""),
            "away_team_logo": pred.get("away_team_logo", "") or pred.get("awayLogo", ""),
            "league": pred.get("league", ""),
            "league_tier": league_tier,
            "market": market,
            "odds": odds,
            "probability": prob,
            "ev_pct": ev_pct,
            "kelly_stake": kelly,
            "calibration_tier": calib_tier,
            "category": category,
            "value_rank": pred.get("value_rank", "medium"),
            "inefficiency": pred.get("inefficiency", 0),
            "expected_value": pred.get("expected_value", 0),
            "sport": sport,
            "kickoff_utc": pred.get("kickoff_utc", ""),
            "kickoff_local": pred.get("kickoff_local", ""),
            "confidence": pred.get("confidence", 0),
            "odds_fresh": pred.get("odds_fresh", True),
            "odds_age_minutes": pred.get("odds_age_minutes"),
            "provider_source": pred.get("provider_source", sport),
        })

    return candidates


def build_unified_vault(date_str: str = None):
    """Build vault for a given date from all sports."""
    if not date_str:
        date_str = datetime.now(LAGOS_TZ).strftime("%Y-%m-%d")

    db = init_firestore()
    all_candidates = []

    print(f"\n  Building unified vault for {date_str}...")

    # ── Football ──────────────────────────────────────────────────────────
    try:
        doc = db.collection("quant_predictions").document(date_str).get()
        if doc.exists:
            preds = doc.to_dict().get("predictions", [])
            candidates = extract_vault_candidates(preds, "football")
            all_candidates.extend(candidates)
            print(f"  Football: {len(preds)} predictions -> {len(candidates)} vault candidates")
    except Exception as e:
        print(f"  Football: error - {e}")

    # ── Basketball ────────────────────────────────────────────────────────
    try:
        doc = db.collection("basketball_predictions").document(date_str).get()
        if doc.exists:
            preds = doc.to_dict().get("predictions", [])
            candidates = extract_vault_candidates(preds, "basketball")
            all_candidates.extend(candidates)
            print(f"  Basketball: {len(preds)} predictions -> {len(candidates)} vault candidates")
    except Exception as e:
        print(f"  Basketball: error - {e}")

    # ── Cricket ───────────────────────────────────────────────────────────
    try:
        doc = db.collection("cricket_predictions").document(date_str).get()
        if doc.exists:
            preds = doc.to_dict().get("predictions", [])
            candidates = extract_vault_candidates(preds, "cricket")
            all_candidates.extend(candidates)
            print(f"  Cricket: {len(preds)} predictions -> {len(candidates)} vault candidates")
    except Exception as e:
        print(f"  Cricket: error - {e}")

    if not all_candidates:
        print(f"  No vault candidates for {date_str}")
        return {"status": "empty", "candidates": 0}

    # ── Sort & Select Top 7 ──────────────────────────────────────────────
    tier_priority = {"safe": 3, "value": 2}
    all_candidates.sort(key=lambda c: (
        tier_priority.get(c.get("category", ""), 0),
        c["expected_value"] * 0.4 + c["probability"] * 0.4 + c.get("inefficiency", 0) * 0.2,
    ), reverse=True)

    selected = all_candidates[:7]

    # ── Save to Firestore ─────────────────────────────────────────────────
    vault_doc = {
        "date": date_str,
        "picks": selected,
        "count": len(selected),
        "sports": list(set(c["sport"] for c in selected)),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_candidates": len(all_candidates),
    }

    db.collection("unified_vault").document(date_str).set(vault_doc)

    print(f"\n  Selected {len(selected)} vault picks:")
    sports_breakdown = defaultdict(int)
    for c in selected:
        sports_breakdown[c["sport"]] += 1
        print(f"    [{c['sport'][:3].upper()}] {c['home_team']} vs {c['away_team']}: "
              f"{c['market']} (EV {c['ev_pct']:.1f}%, odds {c['odds']:.2f}, tier {c['league_tier']})")

    print(f"\n  Sports breakdown: {dict(sports_breakdown)}")
    print(f"  Saved to unified_vault/{date_str}")

    return {
        "status": "success",
        "candidates": len(all_candidates),
        "selected": len(selected),
        "sports": dict(sports_breakdown),
        "date": date_str,
    }


if __name__ == "__main__":
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env.local"))
    except ImportError:
        pass

    date = sys.argv[1] if len(sys.argv) > 1 else None
    result = build_unified_vault(date)
    print(json.dumps(result))
