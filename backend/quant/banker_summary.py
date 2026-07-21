"""
banker_summary.py
─────────────────
Computes Banker of the Day performance summary after grading.
Saves to Firestore banker_summary/current for public display.

Runs after the grading engine completes each night.
"""

import os, sys, json
from datetime import datetime, timedelta, timezone
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import firebase_admin
    from firebase_admin import firestore as fs, credentials
except ImportError:
    print(json.dumps({"status": "error", "error": "firebase-admin not installed"}))
    sys.exit(1)

LAGOS_TZ = timezone(timedelta(hours=1))


def init_firestore():
    if not firebase_admin._apps:
        sa_raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
        if sa_raw:
            sa_dict = json.loads(sa_raw)
            if "private_key" in sa_dict:
                sa_dict["private_key"] = sa_dict["private_key"].replace('\\n', '\n')
            firebase_admin.initialize_app(credentials.Certificate(sa_dict))
    return fs.client()


def compute_banker_summary(days: int = 30):
    """Compute Banker of the Day performance over last N days."""
    db = init_firestore()

    today = datetime.now(LAGOS_TZ)
    dates = [(today - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days)]

    results = []
    wins = 0
    losses = 0
    voids = 0
    current_streak = 0
    streak_type = None

    for date_str in dates:
        doc = db.collection("banker_picks").document(date_str).get()
        if not doc.exists:
            continue

        data = doc.to_dict()
        pick = data.get("pick", {})
        status = pick.get("status", "pending")
        result = pick.get("result")

        if status not in ("won", "lost", "void"):
            continue

        entry = {
            "date": date_str,
            "fixture": f"{pick.get('home_team','?')} vs {pick.get('away_team','?')}",
            "market": pick.get("market", ""),
            "score": pick.get("score", ""),
            "result": result,
            "probability": pick.get("probability", 0),
        }

        if result == "won":
            wins += 1
            if streak_type == "win":
                current_streak += 1
            else:
                current_streak = 1
                streak_type = "win"
        elif result == "lost":
            losses += 1
            if streak_type == "loss":
                current_streak += 1
            else:
                current_streak = 1
                streak_type = "loss"
        else:
            voids += 1

        entry["streak"] = current_streak
        entry["streak_type"] = streak_type
        results.append(entry)

    total = wins + losses
    win_rate = wins / total if total > 0 else 0.0

    summary = {
        "period": f"{dates[-1]} to {dates[0]}",
        "total_bets": total,
        "wins": wins,
        "losses": losses,
        "voids": voids,
        "win_rate": round(win_rate, 3),
        "win_rate_pct": round(win_rate * 100, 1),
        "current_streak": current_streak,
        "streak_type": streak_type,
        "recent_results": results[:10],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    db.collection("banker_summary").document("current").set(summary)

    streak_label = f"{current_streak} {'Win' if streak_type == 'win' else 'Loss'} Streak"
    print(json.dumps({
        "status": "ok",
        "win_rate": f"{win_rate:.0%}",
        "wins": wins,
        "losses": losses,
        "streak": streak_label,
    }))


if __name__ == "__main__":
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env.local"))
    except ImportError:
        pass

    compute_banker_summary()
