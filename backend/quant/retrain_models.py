"""
retrain_models.py
─────────────────
Retrains the quant models using historical API-Football graded data.

Uses per-prediction probability fields stored in Firestore to find:
  1. Optimal Poisson/Elo/Form weight combination for 1X2 markets
  2. Optimal calibration factors for goals/BTTS markets
  3. Optimal risk filter thresholds

Usage:
  python retrain_models.py --days 14
  python retrain_models.py --days 30 --apply
"""

import os, sys, json, math
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from typing import Dict, List, Tuple, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = open(sys.stdout.fileno(), mode='w', encoding='utf-8', buffering=1)

try:
    import certifi
    os.environ["GRPC_DEFAULT_SSL_ROOTS_FILE_PATH"] = certifi.where()
except ImportError:
    pass

try:
    import firebase_admin
    from firebase_admin import firestore as fs, credentials
except ImportError:
    print("firebase-admin not installed"); sys.exit(1)

LAGOS_TZ = timezone(timedelta(hours=1))

# ── Market grading ─────────────────────────────────────────────────────────
def grade_from_score(market: str, hg: int, ag: int) -> str:
    m = market.lower().strip(); t = hg + ag
    if "home win" in m and "draw no bet" not in m and "double" not in m:
        return "won" if hg > ag else "lost"
    if "away win" in m and "draw no bet" not in m and "double" not in m:
        return "won" if ag > hg else "lost"
    if m == "draw": return "won" if hg == ag else "lost"
    if "double chance (1x)" in m: return "won" if hg >= ag else "lost"
    if "double chance (x2)" in m: return "won" if ag >= hg else "lost"
    if "double chance (12)" in m: return "won" if hg != ag else "lost"
    if "draw no bet (home)" in m: return "void" if hg == ag else ("won" if hg > ag else "lost")
    if "draw no bet (away)" in m: return "void" if hg == ag else ("won" if ag > hg else "lost")
    if "over 0.5" in m: return "won" if t > 0 else "lost"
    if "over 1.5" in m: return "won" if t > 1 else "lost"
    if "over 2.5" in m: return "won" if t > 2 else "lost"
    if "over 3.5" in m: return "won" if t > 3 else "lost"
    if "over 4.5" in m: return "won" if t > 4 else "lost"
    if "under 1.5" in m: return "won" if t < 2 else "lost"
    if "under 2.5" in m: return "won" if t < 3 else "lost"
    if "under 3.5" in m: return "won" if t < 4 else "lost"
    if ("btts" in m or "both teams to score" in m) and "no" not in m:
        return "won" if hg > 0 and ag > 0 else "lost"
    if ("btts" in m or "both teams to score" in m) and "no" in m:
        return "won" if (hg == 0 or ag == 0) else "lost"
    if "btts + over 2.5" in m: return "won" if (hg > 0 and ag > 0 and t > 2) else "lost"
    return "void"


def market_key(market: str) -> str:
    m = market.lower().strip()
    for k, v in {
        "home win": "home_win", "away win": "away_win", "draw": "draw",
        "over 1.5": "over15", "over 2.5": "over25", "over 3.5": "over35",
        "over 0.5": "over05", "over 4.5": "over45",
        "under 1.5": "under15", "under 2.5": "under25", "under 3.5": "under35",
        "btts": "btts", "double chance (1x)": "dc_1x",
        "double chance (x2)": "dc_x2", "double chance (12)": "dc_12",
    }.items():
        if k in m: return v
    return m.replace(" ", "_")


# ═══════════════════════════════════════════════════════════════════════════
# DATA EXTRACTION
# ═══════════════════════════════════════════════════════════════════════════

def load_grading_cache(date_str: str) -> dict:
    cache_file = os.path.join(os.path.dirname(__file__), ".cache", f"grading_results_{date_str}.json")
    if not os.path.exists(cache_file):
        return {}
    with open(cache_file, "r") as f:
        return json.load(f)


def extract_training_samples(db, days: int) -> List[dict]:
    """Extract per-prediction data with individual model probabilities and actual outcomes."""
    today = datetime.now(LAGOS_TZ)
    dates = [(today - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days, 0, -1)]

    samples = []

    for date_str in dates:
        doc = db.collection("quant_predictions").document(date_str).get()
        if not doc.exists:
            continue

        next_date = (datetime.strptime(date_str, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
        results = {}
        results.update(load_grading_cache(date_str) or {})
        results.update(load_grading_cache(next_date) or {})

        for pred in doc.to_dict().get("predictions", []):
            fid = str(pred.get("fixture_id", ""))
            result = results.get(fid)
            if not result:
                continue

            hg, ag = result.get("home_goals", 0) or 0, result.get("away_goals", 0) or 0
            market = pred.get("bet_type") or pred.get("prediction") or ""
            if not market or market == "N/A":
                continue

            grade = grade_from_score(market, hg, ag)
            if grade not in ("won", "lost"):
                continue

            odds = float(pred.get("pick_time_odds", 0) or pred.get("odds", 0) or 0)
            if odds <= 1.0:
                continue

            sample = {
                "date": date_str,
                "fixture_id": fid,
                "market": market,
                "market_key": market_key(market),
                "odds": odds,
                "outcome": 1 if grade == "won" else 0,
                "hg": hg, "ag": ag,
                "total_goals": hg + ag,
                "btts": 1 if hg > 0 and ag > 0 else 0,
                "home_team": pred.get("home_team", ""),
                "away_team": pred.get("away_team", ""),
                "league_id": pred.get("league_id"),
                "league_tier": pred.get("league_tier", 2),
                "category": pred.get("category", ""),
            }

            # Individual model probabilities (1X2 only)
            sample["poisson_home"] = float(pred.get("poisson_home", 0) or 0)
            sample["elo_home"] = float(pred.get("elo_home", 0) or 0)
            sample["form_home"] = float(pred.get("form_home", 0) or 0)

            # Per-market probabilities
            sample["home_win_prob"] = float(pred.get("home_win_prob", 0) or 0)
            sample["draw_prob"] = float(pred.get("draw_prob", 0) or 0)
            sample["away_win_prob"] = float(pred.get("away_win_prob", 0) or 0)
            sample["over25_prob"] = float(pred.get("over25_prob", 0) or 0)
            sample["over15_prob"] = float(pred.get("over15_prob", 0) or 0)
            sample["over35_prob"] = float(pred.get("over35_prob", 0) or 0)
            sample["btts_prob"] = float(pred.get("btts_prob", 0) or 0)
            sample["over05_prob"] = float(pred.get("over05_prob", 0) or 0)
            sample["over45_prob"] = float(pred.get("over45_prob", 0) or 0)

            # Existing calibrated probability
            sample["calibrated_prob"] = float(pred.get("calibrated_probability", 0) or pred.get("probability", 0) or 0)
            sample["confidence"] = float(pred.get("confidence", 0) or 0)
            sample["expected_value"] = float(pred.get("expected_value", 0) or 0)
            sample["inefficiency"] = float(pred.get("inefficiency", 0) or 0)
            sample["calibration_factor"] = float(pred.get("calibration_factor", 0) or 1.0)
            sample["calibration_tier"] = pred.get("calibration_tier", "stable")

            samples.append(sample)

    return samples


# ═══════════════════════════════════════════════════════════════════════════
# OPTIMIZATION: 1X2 Model Weights
# ═══════════════════════════════════════════════════════════════════════════

def optimize_1x2_weights(samples: List[dict]) -> List[Dict]:
    """
    Test every combination of Poisson/Elo/Form weights (step 0.05)
    for 1X2 predictions (Home Win, Away Win, Draw).
    """
    print("\n" + "=" * 60)
    print("  RETRAINING: 1X2 MODEL WEIGHTS")
    print("=" * 60)

    # Only 1X2 samples with individual model probabilities
    samples_1x2 = [s for s in samples
                   if s["poisson_home"] > 0 and s["elo_home"] > 0
                   and market_key(s["market"]) in ("home_win", "away_win", "draw")]

    if not samples_1x2:
        print("  No 1X2 samples with individual model probabilities.")
        print("  (Individual model probs only saved for recent predictions)")
        return []

    print(f"  Samples available: {len(samples_1x2)}")
    print(f"  Current weights: Poisson=0.60, Elo=0.30, Form=0.10\n")

    steps = [x / 100.0 for x in range(0, 105, 5)]
    best_configs = []

    count = 0; total = len([1 for p in steps for e in steps for f in steps if abs(p + e + f - 1.0) < 0.001])
    print(f"  Testing {total} weight combinations...")

    for wp in steps:
        for we in steps:
            wf = 1.0 - wp - we
            if wf < 0 or wf > 1.0:
                continue
            if abs(wp + we + wf - 1.0) > 0.001:
                continue

            wins = 0; losses = 0; brier_sum = 0.0; n = 0

            for s in samples_1x2:
                # Recompute combined 1X2 probability with new weights
                p_home = wp * s["poisson_home"] + we * s["elo_home"] + wf * s["form_home"]
                p_draw = wp * s.get("poisson_draw", s["draw_prob"]) + we * s.get("elo_draw", s["draw_prob"]) + wf * s.get("form_draw", s["draw_prob"])
                p_away = 1.0 - p_home - p_draw

                # Normalize
                total_p = p_home + p_draw + p_away
                if total_p > 0:
                    p_home /= total_p; p_draw /= total_p; p_away /= total_p

                # Determine which probability to use based on market
                mk = market_key(s["market"])
                if mk == "home_win": prob = p_home
                elif mk == "away_win": prob = p_away
                elif mk == "draw": prob = p_draw
                else: continue

                pred_win = prob >= 0.50
                actual_win = s["outcome"] == 1

                if pred_win and actual_win: wins += 1
                elif pred_win and not actual_win: losses += 1
                elif not pred_win and actual_win: losses += 1
                elif not pred_win and not actual_win: wins += 1

                brier_sum += (prob - s["outcome"]) ** 2
                n += 1

            if n > 0:
                hit_rate = wins / (wins + losses) if (wins + losses) > 0 else 0
                brier = brier_sum / n
                best_configs.append({
                    "poisson": wp, "elo": we, "form": wf,
                    "hit_rate": hit_rate, "brier": brier,
                    "samples": n, "wins": wins, "losses": losses,
                })

            count += 1
            if count % 50 == 0:
                print(f"  ... {count}/{total}")

    best_configs.sort(key=lambda x: (x["hit_rate"], -x["brier"]), reverse=True)

    print(f"\n  Top 5 Weight Configurations:")
    print(f"  {'#':>3} {'Poisson':>8} {'Elo':>8} {'Form':>8} {'Hit%':>8} {'Brier':>8} {'N':>5}")
    for i, c in enumerate(best_configs[:5]):
        print(f"  {i+1:>3} {c['poisson']:>7.0%} {c['elo']:>7.0%} {c['form']:>7.0%} {c['hit_rate']:>7.1%} {c['brier']:>7.4f} {c['samples']:>5}")

    return best_configs[:5]


# ═══════════════════════════════════════════════════════════════════════════
# OPTIMIZATION: Calibration Factors (Goals/BTTS)
# ═══════════════════════════════════════════════════════════════════════════

def optimize_calibration_factors(samples: List[dict]) -> Dict[str, dict]:
    """
    For each goals/BTTS market, find optimal calibration factor
    by testing factors from 0.50 to 1.00 in 0.02 steps.
    """
    print("\n" + "=" * 60)
    print("  RETRAINING: CALIBRATION FACTORS (Goals/BTTS)")
    print("=" * 60)

    market_samples = defaultdict(list)

    # Map market types to their probability fields
    prob_fields = {
        "over05": "over05_prob", "over15": "over15_prob",
        "over25": "over25_prob", "over35": "over35_prob",
        "over45": "over45_prob", "btts": "btts_prob",
        "under25": "under25_prob", "under35": "under35_prob",
    }

    # Map market keys to bet types
    market_to_bet = {
        "over05": "over 0.5", "over15": "over 1.5", "over25": "over 2.5",
        "over35": "over 3.5", "over45": "over 4.5", "btts": "btts",
        "under25": "under 2.5", "under35": "under 3.5",
    }

    outcomes_for_market = {
        "over05": lambda s: 1 if s["total_goals"] > 0 else 0,
        "over15": lambda s: 1 if s["total_goals"] > 1 else 0,
        "over25": lambda s: 1 if s["total_goals"] > 2 else 0,
        "over35": lambda s: 1 if s["total_goals"] > 3 else 0,
        "over45": lambda s: 1 if s["total_goals"] > 4 else 0,
        "btts": lambda s: s["btts"],
        "under25": lambda s: 1 if s["total_goals"] < 3 else 0,
        "under35": lambda s: 1 if s["total_goals"] < 4 else 0,
    }

    for s in samples:
        for mk, prob_field in prob_fields.items():
            raw_prob = float(s.get(prob_field, 0) or 0)
            if raw_prob <= 0 or raw_prob >= 1:
                continue
            outcome_fn = outcomes_for_market.get(mk)
            if not outcome_fn:
                continue
            market_samples[mk].append((raw_prob, outcome_fn(s)))

    results = {}
    print(f"  {'Market':<20} {'Optimal':>8} {'Brier':>7} {'N':>5} {'Hit%':>7}")
    print(f"  {'-'*20} {'-'*8} {'-'*7} {'-'*5} {'-'*7}")

    for mk, preds in sorted(market_samples.items()):
        if len(preds) < 3:
            continue

        best_factor = 1.0
        best_brier = 1.0

        for factor in [x / 100.0 for x in range(50, 101, 2)]:
            adjusted = [(p * factor, o) for p, o in preds]
            brier = sum((p - o) ** 2 for p, o in adjusted) / len(adjusted)
            if brier < best_brier:
                best_brier = brier
                best_factor = factor

        avg_raw = sum(p for p, _ in preds) / len(preds)
        actual_hit = sum(o for _, o in preds) / len(preds)

        results[mk] = {
            "factor": round(best_factor, 2),
            "brier": round(best_brier, 4),
            "n": len(preds),
            "avg_raw_prob": round(avg_raw, 3),
            "actual_hit_rate": round(actual_hit, 3),
        }

        print(f"  {mk:<20} {best_factor:>7.2f} {best_brier:>7.4f} {len(preds):>5} {actual_hit:>6.1%}")

    return results


# ═══════════════════════════════════════════════════════════════════════════
# APPLY RESULTS
# ═══════════════════════════════════════════════════════════════════════════

def apply_optimal_weights(best_weights: List[Dict], prob_engine_path: str):
    """Update probability_engine.py with optimal model weights."""
    if not best_weights:
        return

    best = best_weights[0]
    with open(prob_engine_path, "r") as f:
        content = f.read()

    lines = content.split("\n")
    changes = 0

    # Update W_POISSON, W_ELO, W_FORM, W_H2H
    weight_map = {
        "W_POISSON": best["poisson"],
        "W_ELO": best["elo"],
        "W_FORM": best["form"],
        "W_H2H": best.get("h2h", 0.0),
    }

    for i, line in enumerate(lines):
        for var, new_val in weight_map.items():
            if var in line and "=" in line and "#" not in line.split("=")[0]:
                old_val = None
                try:
                    parts = line.split("=")[1].strip().split("#")[0].strip()
                    old_val = float(parts)
                except:
                    continue
                if old_val is not None and abs(old_val - new_val) > 0.01:
                    lines[i] = line.replace(str(old_val), str(new_val), 1)
                    changes += 1
                    print(f"  {var}: {old_val} -> {new_val}")

    if changes > 0:
        with open(prob_engine_path, "w") as f:
            f.write("\n".join(lines))
        print(f"  Applied {changes} weight changes to {prob_engine_path}")


def apply_optimal_calibration(results: Dict[str, dict], registry_path: str):
    """Update calibration_registry.py with optimal factors."""
    with open(registry_path, "r") as f:
        content = f.read()

    lines = content.split("\n")
    changes = 0

    for mk, info in results.items():
        factor = info["factor"]
        for i, line in enumerate(lines):
            if f'"{mk}"' in line and '(' in line:
                parts = line.split(",")
                if len(parts) >= 3:
                    try:
                        old_factor = float(parts[2].strip().split(")")[0].strip().split()[0])
                        if abs(old_factor - factor) > 0.02:
                            parts[2] = parts[2].replace(str(old_factor), str(factor), 1)
                            lines[i] = ",".join(parts)
                            changes += 1
                            print(f"  calibration_registry[{mk}]: {old_factor:.2f} -> {factor:.2f}")
                    except:
                        pass

    if changes > 0:
        with open(registry_path, "w") as f:
            f.write("\n".join(lines))
        print(f"  Applied {changes} calibration changes to {registry_path}")


# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--1x2-only", action="store_true")
    parser.add_argument("--goals-only", action="store_true")
    args = parser.parse_args()

    # Load .env BEFORE Firebase init
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))
        load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env.local"))
    except ImportError:
        pass

    # Init Firestore
    if not firebase_admin._apps:
        sa_raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "")
        if sa_raw:
            sa_dict = json.loads(sa_raw)
            if "private_key" in sa_dict:
                sa_dict["private_key"] = sa_dict["private_key"].replace('\\n', '\n')
            firebase_admin.initialize_app(credentials.Certificate(sa_dict))
    db = fs.client()

    print(f"\n{'='*70}")
    print(f"  MODEL RETRAINING PIPELINE")
    print(f"  Data Source: API-Football + Firestore")
    print(f"  Lookback: {args.days} days")
    print(f"{'='*70}")

    # Step 1: Extract training data
    print(f"\n  Extracting training samples from Firestore...")
    samples = extract_training_samples(db, args.days)

    if not samples:
        print("  No training samples found. Run the pipeline first to generate predictions.")
        return

    print(f"  Samples loaded: {len(samples)}")
    markets_found = set(market_key(s["market"]) for s in samples)
    print(f"  Markets: {len(markets_found)} types")

    # Step 2: Optimize 1X2 weights
    best_weights = optimize_1x2_weights(samples)

    # Step 3: Optimize calibration factors
    best_calibration = optimize_calibration_factors(samples)

    # Step 4: Print summary
    print(f"\n{'='*70}")
    print(f"  RETRAINING COMPLETE")
    print(f"{'='*70}")

    if best_weights:
        w = best_weights[0]
        print(f"  Optimal 1X2 weights: P={w['poisson']:.0%} E={w['elo']:.0%} F={w['form']:.0%}")
        print(f"  Expected 1X2 hit rate: {w['hit_rate']:.1%} ({w['wins']}W/{w['losses']}L)")
        print(f"  Previous weights: P=60% E=30% F=10%")

    if best_calibration:
        improvements = 0
        for mk, info in best_calibration.items():
            if abs(info["factor"] - 1.0) > 0.02:
                improvements += 1
        print(f"  Calibration factors optimized for {len(best_calibration)} markets ({improvements} changed)")

    # Step 5: Apply
    if args.apply:
        base = os.path.dirname(os.path.abspath(__file__))
        if best_weights:
            apply_optimal_weights(best_weights, os.path.join(base, "probability_engine.py"))
        if best_calibration:
            apply_optimal_calibration(best_calibration, os.path.join(base, "calibration_registry.py"))
        print(f"\n  Changes applied. Restart the pipeline for effects to take hold.")
    else:
        print(f"\n  Run with --apply to write optimal parameters to code.")
        print(f"  python backend/quant/retrain_models.py --days 30 --apply")


if __name__ == "__main__":
    main()
